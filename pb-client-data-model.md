# PB 고객 데이터 모델: 개인·법인·가족·상속/증여 (Claude Code 핸드오프)

> 개인/법인을 분리 운영하던 기존 구조를 확장해, 개인↔법인 소유관계와
> 가족 단위(가문)·상속·증여까지 표현 가능한 데이터 모델로 디벨롭한다.
> Stack: Supabase(Postgres). 자산 모듈(주식/부동산)은 party_id로 연결된다.

---

## 0. 설계 핵심 (왜 이렇게 가나)

1. **개체(Entity)와 관계(Relationship)를 분리.** "개인이 법인을 소유", "가족"은
   개체가 아니라 **개체 사이의 관계**라, 테이블을 아무리 나눠도 관계 테이블 없이는 표현 불가.
2. **공통 상위 `parties`.** 개인이든 법인이든 일단 party 하나로 다룬다 →
   자산·거래를 붙일 때 분기 불필요.
3. **시점(temporal) 관리.** 소유·관계는 덮어쓰지 않고 `valid_from/valid_to`로 이력 보존.
   증여세 10년 합산, 상속 시점 자산 파악에 필수.
4. **이벤트 기록.** 증여·상속은 "사건"으로 별도 테이블에 남겨 세금 시뮬레이션의 근거로.
5. **가문(household) 그룹.** 가족 전체 총자산 + 구성원 개인별 자산을 동시에 본다.

---

## 1. 전체 구조

```
parties (공통 상위: 모든 고객/관계인)
 ├─ individuals  (개인 상세)
 └─ corporates   (법인 상세)

party_relationships (개체 간 관계: 소유 / 가족, 시점 이력)
households + household_members (가문 묶음)
transfer_events (증여·상속 사건 기록)

자산(client_holdings / client_real_estate) → owner_party_id 로 연결
```

---

## 2. 개체 테이블

### 2-1. 공통 상위
```sql
create table parties (
  id          uuid primary key default gen_random_uuid(),
  party_type  text not null check (party_type in ('individual','corporate')),
  display_name text not null,                 -- 표시용 이름/상호
  is_client   boolean not null default true,  -- true=관리고객, false=관계인(가족·소유법인 등)
  created_at  timestamptz default now()
);
```
> `is_client=false`로 "고객은 아니지만 관계로 등록된 사람/법인"(예: 자녀, 소유한 비고객 법인)도 담는다.

### 2-2. 개인
```sql
create table individuals (
  party_id     uuid primary key references parties(id) on delete cascade,
  birth_date   date,
  resident_no_enc text,        -- 주민번호는 암호화 저장(평문 금지). 마스킹 노출.
  -- 기타 KYC 필드…
  notes        text
);
```

### 2-3. 법인
```sql
create table corporates (
  party_id      uuid primary key references parties(id) on delete cascade,
  biz_reg_no    text,          -- 사업자등록번호
  corp_reg_no   text,          -- 법인등록번호
  established_at date,
  -- 기타 필드…
  notes         text
);
```

---

## 3. 관계 테이블 (핵심)

개인↔법인 소유, 가족 관계를 한 테이블로. 시점 이력 보존.

```sql
create table party_relationships (
  id            uuid primary key default gen_random_uuid(),
  from_party_id uuid not null references parties(id) on delete cascade,
  to_party_id   uuid not null references parties(id) on delete cascade,
  relation_type text not null,   -- 'owns' | 'spouse' | 'child' | 'parent' | 'sibling' | 'heir' 등
  ownership_pct numeric,         -- relation_type='owns'일 때 지분율(0~100)
  valid_from    date not null default current_date,
  valid_to      date,            -- null=현재 유효
  created_at    timestamptz default now(),
  check (from_party_id <> to_party_id)
);
create index on party_relationships (from_party_id, relation_type);
create index on party_relationships (to_party_id, relation_type);
```

**예시**
- 김철수가 ㅇㅇ상사 60% 소유: `from=김철수, to=ㅇㅇ상사, owns, pct=60`
- 김철수–배우자: `from=김철수, to=배우자, spouse`
- 김철수–자녀: `from=김철수, to=자녀, child`

> 가족관계는 방향성이 헷갈릴 수 있으니 규칙 고정: parent/child는 **from=부모, to=자녀**.
> spouse/sibling은 양방향이므로 조회 시 양쪽 다 검색하거나, 등록 시 1행만 두고 쿼리에서 OR 처리.

---

## 4. 가문(Household) 그룹

```sql
create table households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,             -- "김철수 패밀리"
  head_party_id uuid references parties(id), -- 가구주(선택)
  created_at  timestamptz default now()
);

create table household_members (
  household_id uuid references households(id) on delete cascade,
  party_id     uuid references parties(id) on delete cascade,
  role         text,                     -- 'head'|'spouse'|'child' 등(표시용)
  joined_at    date default current_date,
  primary key (household_id, party_id)
);
```
> 이걸로 "가문 총자산"(구성원 party들의 자산 합)과 "개인별 자산"을 둘 다 산출.

---

## 5. 증여·상속 이벤트

세금 시뮬레이션(증여세 10년 합산, 상속세)의 근거. "사건"으로 기록.

```sql
create table transfer_events (
  id            uuid primary key default gen_random_uuid(),
  event_type    text not null check (event_type in ('gift','inheritance')), -- 증여|상속
  from_party_id uuid references parties(id),   -- 증여자/피상속인
  to_party_id   uuid not null references parties(id), -- 수증자/상속인
  asset_kind    text,            -- 'cash'|'stock'|'real_estate'|'corp_share' 등
  asset_ref     uuid,            -- 해당 자산 레코드 id(있으면)
  amount        numeric,         -- 평가액(원)
  event_date    date not null,
  note          text,
  created_at    timestamptz default now()
);
create index on transfer_events (to_party_id, event_date);
create index on transfer_events (from_party_id, event_date);
```
> 증여세는 동일인 증여 10년 합산 → `from→to`로 `event_date` 최근 10년 합계 쿼리로 계산 가능.
> 실제 세율·공제는 세금 모듈에서 처리(여기선 사건 데이터만 보관).

---

## 6. 자산 연결 변경

기존 자산 테이블의 소유자를 개인/법인 구분 없이 `parties`로 통일.

```sql
-- 기존 client_holdings / client_real_estate 의 client_id 를 owner_party_id 로 교체(또는 추가)
alter table client_holdings   add column owner_party_id uuid references parties(id);
alter table client_real_estate add column owner_party_id uuid references parties(id);
-- (마이그레이션: 기존 client_id → 대응 party_id 매핑 후 채움)
```

---

## 7. 핵심 조회 (구현할 뷰/함수)

### 7-1. 개인의 "실질 지배자산"
본인 명의 자산 + 소유 법인 자산 × 지분율.
```sql
-- 의사 쿼리
-- 1) 본인 직접 보유 자산 합
-- 2) party_relationships에서 relation='owns', valid_to is null 인 법인들
-- 3) 각 법인 자산 합 × ownership_pct/100
-- → 합산
```

### 7-2. 가문 총자산
household_members의 party들의 자산 합(중복 소유는 지분 안분으로 이중계상 방지).

### 7-3. 증여 10년 합산
```sql
select coalesce(sum(amount),0)
from transfer_events
where event_type='gift' and from_party_id=:donor and to_party_id=:donee
  and event_date >= (current_date - interval '10 years');
```

---

## 8. 구현 우선순위

1. `parties` 상위 + `individuals`/`corporates` 분리, 기존 데이터 마이그레이션
2. 자산 테이블 `owner_party_id` 연결 전환
3. `party_relationships` (개인↔법인 소유부터) + 7-1 실질 지배자산 조회
4. `households`/`household_members` + 7-2 가문 총자산
5. `transfer_events` + 7-3 증여 10년 합산 (세금 모듈 연계)

---

## 9. 주의사항

- **개인정보**: 주민번호·사업자번호 등은 암호화 저장 + 마스킹 노출. 평문 금지.
- **시점 처리**: 소유·관계 변경 시 기존 행을 지우지 말고 `valid_to`를 채워 닫고 새 행 추가.
- **이중계상 방지**: 가문/실질자산 합산 시 지분 안분으로 같은 자산을 두 번 세지 않게.
- **방향성 규칙 고정**: parent/child=from 부모→to 자녀. 문서화해서 일관성 유지.
- **마이그레이션은 단계적으로**: 1~2번을 먼저 안정화한 뒤 관계/가문/이벤트로 확장.
