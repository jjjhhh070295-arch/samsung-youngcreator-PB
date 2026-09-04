-- ================================================================
-- 마이그레이션 — PB 상담 일정 / 기타 일정을 DB로
-- Supabase SQL Editor에서 전체 실행 (기존 테이블에 영향 없음, 새 테이블만 추가)
--
-- 배경: 지금 일정은 브라우저 localStorage(pb-schedules:{pbId},
-- pb-extra-events:{pbId})에만 있다. 서버 왕복이 한 번도 없어서 같은 PB라도 다른
-- 기기·다른 브라우저에서는 아무것도 보이지 않고, 브라우저 데이터를 지우면 그대로
-- 사라진다(백업 없음).
--
-- 특히 components/advisory/ConsultationScheduleModal.tsx 는 저장 한 번에 두 저장소를
-- 쓴다 — 신규 고객은 createClient()로 DB(parties)에 들어가는데 일정은 localStorage로
-- 간다. 그래서 다른 기기에서 보면 "고객은 새로 생겼는데 그 고객과의 상담 일정만 없는"
-- 상태가 된다. 이 테이블이 그 어긋남을 없앤다.
--
-- 이 테이블이 없어도 앱은 정상 동작한다 — lib/store.ts 의 일정 함수들이 42P01/PGRST205
-- (테이블 없음)를 만나면 localStorage로 조용히 폴백한다. 다만 그 상태에서는 일정이 그
-- 브라우저에만 남으므로, 실사용 전에 이 마이그레이션을 반드시 실행할 것.
--
-- 기존 localStorage 일정은 이관하지 않는다. 기능이 2026-09-01에 추가돼 실데이터가
-- 사실상 없고, id 형식이 uuid가 아니라(consult-{timestamp}-{random}) 중복 판정을
-- 따로 만들어야 하는 비용이 이관 가치를 넘는다. 실행 후 각자 다시 등록한다.
-- ================================================================

-- ── 테이블 ──
-- 상담 일정과 기타 일정을 kind 로 구분해 한 테이블에 둔다. 두 종류가 컬럼 두 개만 다르고
-- 캘린더가 항상 둘을 합쳐 한 번에 그리므로, 테이블을 쪼개면 조회마다 union 이 필요하다.
create table if not exists pb_schedules (
  id              uuid primary key default gen_random_uuid(),
  pb_id           uuid not null references pbs(id) on delete cascade,
  kind            text not null check (kind in ('consultation','event')),

  -- kind='consultation' — 고객은 parties 를 참조한다(clients 는 하위호환용 테이블).
  party_id        uuid references parties(id) on delete set null,
  -- 등록 시점 고객명 스냅샷. localStorage 의 clientName 을 그대로 계승한다.
  -- 고객이 삭제되면 party_id 가 null 이 되는데, 그때도 일정이 "이름 없음"이 되지 않는다.
  client_name     text,

  -- kind='event'
  title           text,

  -- KST 벽시계 값. 앱이 date/time 문자열로만 다루므로(todayKstDate·formatKstDate)
  -- timestamptz 로 바꾸지 않는다 — 변환을 끼우면 타임존 버그가 생긴다.
  scheduled_on    date not null,   -- 'YYYY-MM-DD'
  scheduled_at    time not null,   -- 'HH:MM'
  memo            text,

  -- 지금 UI에는 일정 삭제·수정 기능이 없다(pbScheduleStorage 가 add 만 export).
  -- 하드 삭제 대신 상태로 관리해 이력이 남게 한다.
  status          text not null default 'planned'
                  check (status in ('planned','done','canceled')),
  -- 실제로 상담을 진행하면 그 이력과 잇는다. 지금은 일정과 consultations 가 서로를
  -- 전혀 모른다 — 이 컬럼이 그 연결을 만든다.
  consultation_id uuid references consultations(id) on delete set null,

  created_at      timestamptz not null default now(),
  -- 이 프로젝트에는 updated_at 트리거 관례가 없다. 앱(lib/store.ts)이 상태를 바꿀 때
  -- 직접 넣는다.
  updated_at      timestamptz not null default now(),

  -- 종류별 필수 필드. consultation 은 party_id 나 client_name 중 하나만 있으면 된다 —
  -- 고객 삭제로 party_id 가 null 이 될 때 이 제약이 delete 를 막지 않게 하기 위해서다.
  constraint pb_schedules_shape check (
    (kind = 'consultation' and (party_id is not null or client_name is not null))
    or (kind = 'event' and title is not null)
  )
);

-- ── 인덱스 ──
-- 기본 조회는 "내 일정, 이 달" — (pb_id, scheduled_on).
create index if not exists idx_pb_schedules_pb_date on pb_schedules(pb_id, scheduled_on);
-- 날짜 단독 인덱스는 센터 차원 조회(센터장 전체 보기·휴가 대체 담당)를 나중에 열 때 쓴다.
-- 지금 앱은 항상 pb_id 로 거르지만, 요구가 확인되면 쿼리의 필터만 풀면 되게 미리 둔다.
create index if not exists idx_pb_schedules_date on pb_schedules(scheduled_on);
create index if not exists idx_pb_schedules_party on pb_schedules(party_id);

-- ── RLS ──
-- 이 프로젝트의 다른 테이블(parties/consultations/investment_surveys)과 동일하게 전체
-- 허용이다. 제대로 된 "본인 것만" 정책은 DB가 요청자를 알아야(auth.uid()) 가능한데,
-- 이 앱의 PB 로그인은 클라이언트 측이고 Supabase 에는 anon 키 하나로만 접근한다.
-- 일정만 따로 잠가도 보안은 오르지 않고(같은 키로 parties·consultations 가 이미 열려
-- 있다) 기능만 막힌다. 서버 세션(app/api/auth/session)이나 Supabase Auth 가 들어올 때
-- 전 테이블을 일괄 정비하는 것이 맞다.
-- 조회를 본인 것으로 좁히는 일은 지금은 앱이 한다(eq('pb_id', pbId)).
alter table pb_schedules enable row level security;

drop policy if exists "p_pb_schedules" on pb_schedules;

create policy "p_pb_schedules" on pb_schedules
  for all using (true) with check (true);

-- ── 결과 확인 ──
select '① pb_schedules' as 항목, count(*) as 행수 from pb_schedules;
