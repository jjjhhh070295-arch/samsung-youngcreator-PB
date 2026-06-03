# PB 상담 지원 웹앱 — 프로젝트 청사진 (BLUEPRINT)

> 이 문서는 Claude Code에게 전달하는 **구현 사양서**입니다.
> Claude Code에게 "이 BLUEPRINT.md를 읽고, 빌드 단계를 1단계부터 순서대로 구현해줘. 각 단계가 끝나면 멈추고 확인받아줘"라고 요청하세요.

---

## 1. 프로젝트 개요

PB(Private Banker)가 고객을 응대할 때의 피로감을 줄이고, 동시에 고객 편의성을 높이는 웹앱.

여러 명의 PB와 여러 명의 고객(개인/법인)을 관리하며, **상담 내용을 RRTTLLU 7요인으로 구조화**해 IPS(투자정책서)로 정리한다. 상담은 **타이머로 소요시간을 측정**하고, **상담 이력을 누적**해 고객의 성향 변화를 그래프로 추적한다. PB별 **운용자산·평균 상담시간 등 대시보드 통계**도 제공한다. 데이터는 Supabase에 저장되어 **팀원이 공유**한다.

최종 지향점은 **7요인 + 고객 현금흐름 + 특이사항을 근거로 최적화된 포트폴리오 후보 3개를 출력**(세금 등 고려)하고, **PB가 임의로 수정**하며, 몇 가지 지표로 **스트레스 테스트**까지 하는 것이다. 단, **포트폴리오 최적화·스트레스 테스트 부분은 팀원이 이어서 구현**하므로, 본 청사진에서는 **데이터 구조·화면·인터페이스를 더미(스캐폴드)로만** 깔아둔다(11~12단계). 실제 최적화/검정 로직은 팀원이 채운다.

> ⚠️ **규제 주의**: 최적 포트폴리오 산출은 투자자문·일임업 등 규제 영역에 닿을 수 있다. 본 결과물은 **PB 검토를 전제로 한 참고용 보조도구**이며, 실제 서비스 전 법적 검토가 필요하다. 화면·문서에 "투자 권유가 아님, 참고용" 디스클레이머를 표기한다.

### 신뢰성 설계 (AI 오류·과대계상 방지)
AI 분석은 **근거 인용 + 공백 허용 + PB 검토 필수**로 통제한다. 각 요인을 3단계로 구분: ① **직접 근거**가 있으면 점수+원문 인용, ② **추론 단서만** 있으면 점수는 비우고 단서를 참고용으로만 제시(점수에 반영 안 함), ③ **근거·단서 모두 없으면 공백**으로 둔다(임의값 금지). 모든 AI 결과는 PB가 검토 확정해야 최종값·그래프에 반영된다.

### 상담 입력 3가지 방식 (모두 RRTTLLU 결과로 수렴)
1. **전문 텍스트 입력** → AI가 7요인 자동 분석·채움
2. **7요인 직접 입력** → AI 없이 각 요인 값·점수를 PB가 직접 입력
3. **음성 파일 업로드** → 텍스트 변환(STT) → 전문 텍스트로 → AI 분석

### RRTTLLU 7요인
| 요인 | 의미 |
|---|---|
| **R**eturn | 목표 수익률 |
| **R**isk | 위험 허용도 |
| **T**ime horizon | 투자 기간 |
| **T**ax | 세금 요인 |
| **L**iquidity | 유동성 필요 시기 |
| **L**egal | 법적/규제 제약 |
| **U**nique circumstances | 고객 고유 상황 |

---

## 2. 기술 스택

- **프레임워크**: Next.js 14+ (App Router) + TypeScript
- **스타일**: Tailwind CSS
- **차트**: Recharts (레이더 차트, 시계열 선 그래프)
- **DB**: Supabase (Postgres) — `@supabase/supabase-js`
- **AI 분석**: Anthropic API (`@anthropic-ai/sdk`) — 서버 라우트 전용
- **음성→텍스트(STT)**: 네이버 CLOVA Speech 기준(서버 라우트 전용). `lib/stt.ts` 분리, Whisper 교체 가능.

### 디자인 시스템
- **콘셉트**: 고급스러운 프라이빗뱅킹 느낌. **딥블루(네이비) 베이스 + 골드(금색) 포인트**.
- **색상 토큰**(Tailwind `theme.extend` + CSS 변수로 정의):
  - Primary(딥블루): 예) `#0A2540`~`#16386b` 계열. 헤더·주요 버튼·강조.
  - Accent(골드): 예) `#C9A227`/`#D4AF37` 계열. 포인트·선택 상태·중요 수치·구분선.
  - 중립(배경/텍스트)은 라이트/다크 각각의 토큰으로.
- **다크/화이트 모드 전환**: 헤더에 토글. CSS 변수 기반 테마(라이트=밝은 배경+네이비 텍스트, 다크=짙은 네이비 배경+밝은 텍스트, 골드 포인트는 공통). 선택값은 화면 상태로 유지(브라우저 저장 API는 아티팩트 제약상 사용하지 않고, 앱 상태로 관리). Tailwind `darkMode: 'class'` 사용.
- 골드는 과하지 않게 **포인트로만**(테두리·아이콘·핵심 숫자·선택 강조). 면적은 네이비/중립이 차지.

### 환경 변수 (`.env.local`) — 키는 공백으로 두고 나중에 채움
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
CLOVA_SPEECH_INVOKE_URL=
CLOVA_SPEECH_SECRET=
OPENAI_API_KEY=
```
> 서버 전용 키에 `NEXT_PUBLIC` 금지. 키가 비면 해당 기능 호출 시 안내 메시지만 띄우고 나머지는 정상 동작. `.env.local`은 `.gitignore`에 포함.

### 비용 안전장치
- AI·STT는 사용량 과금 → 콘솔에서 **사용 한도 + 자동충전 OFF** (README 안내).
- 음성 업로드 **최대 길이/용량 제한**(예: 10분 / 25MB).

---

## 3. 데이터베이스 (Supabase)

### 3-1. 사전 설정 (사용자가 직접)
1. supabase.com 가입 → 프로젝트 생성
2. Settings → API에서 URL/anon 키 → `.env.local`
3. SQL Editor에서 3-2 실행

### 3-2. 테이블 생성 SQL
```sql
create table pbs (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,          -- "PB-001"
  name text not null,
  created_at timestamptz default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,          -- "C-2026-0001"
  client_type text not null default 'individual',  -- individual | corporate
  name text not null,
  birth_date date,                    -- 개인=생년월일, 법인=설립일
  assigned_pb_id uuid references pbs(id) on delete set null,
  asset_size bigint default 0,        -- 원
  consultation_notes text default '', -- 최신 전문 텍스트
  ips jsonb default '{}',             -- 최신 RRTTLLU 7요인
  cash_flows jsonb default '[]',      -- 고객 현금흐름 목록 (포트폴리오 입력)
  portfolios jsonb default '[]',      -- 포트폴리오 후보 3개 (팀원 더미 → 실구현)
  created_at timestamptz default now()
);

-- 상담 1건 = 1행 (이력 누적 + 타이머 + 성향 스냅샷)
create table consultations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  pb_id uuid references pbs(id) on delete set null,
  started_at timestamptz,             -- 타이머 시작
  ended_at timestamptz,               -- 타이머 종료
  duration_seconds int default 0,     -- 소요시간(초)
  notes text default '',              -- 해당 상담 메모(전문)
  ips_snapshot jsonb default '{}',    -- 종료 시점 RRTTLLU 스냅샷(점수 포함)
  created_at timestamptz default now()
);
```

### 3-3. 접근 정책 (RLS) — 프로토타입용
```sql
alter table pbs enable row level security;
alter table clients enable row level security;
alter table consultations enable row level security;
create policy "p_pbs" on pbs for all using (true) with check (true);
create policy "p_clients" on clients for all using (true) with check (true);
create policy "p_consultations" on consultations for all using (true) with check (true);
-- ⚠️ 프로토타입 전용. 운영 전 반드시 강화.
```

> DB는 snake_case, 코드 타입은 camelCase. `lib/store.ts`에서 변환.

---

## 4. 데이터 모델 (`lib/types.ts`)

```typescript
interface PB { id: string; code: string; name: string; }  // code "PB-001"

type ClientType = 'individual' | 'corporate';

interface IPSFactor {
  value: string;            // 핵심 값/설명 (예: "연 6~8%"). 공백 허용("").
  score: number | null;     // 1~5 점수 (레이더·추세용). 명시적 근거 있을 때만. 아니면 null.
  notes: string;            // 상세 메모
  source: 'manual' | 'ai';  // 직접 입력 / AI 분석
  // --- 근거 상태 (3단계) ---
  status: 'explicit' | 'inferred' | 'empty';
  //   explicit = 상담에 직접 근거 있음 → 점수 부여 + evidence 인용
  //   inferred = 직접 언급 없으나 추론 단서 있음 → 점수는 비움, inferenceHint만 참고 제시
  //   empty    = 근거·단서 모두 없음 → 완전 공백 (아무것도 채우지 않음)
  evidence: string;         // status='explicit'일 때 점수 근거가 된 상담 원문 구절 인용.
  inferenceHint: string;    // status='inferred'일 때 추론 단서 설명(점수 미반영, PB 참고용).
  reviewed: boolean;        // PB가 검토·확정했는지. AI 결과는 false(draft)로 시작.
}

interface IPS {
  return: IPSFactor; risk: IPSFactor; timeHorizon: IPSFactor;
  tax: IPSFactor; liquidity: IPSFactor; legal: IPSFactor; unique: IPSFactor;
}

interface Client {
  id: string;
  code: string;          // "C-2026-0001"
  clientType: ClientType;
  name: string;
  birthDate: string;     // YYYY-MM-DD
  assignedPbId: string;
  assetSize: number;     // 원
  consultationNotes: string;  // 최신
  ips: IPS;                   // 최신
  cashFlows: CashFlow[];      // 현금흐름 (포트폴리오 입력)
  portfolios: Portfolio[];    // 포트폴리오 후보 (팀원 더미 → 실구현)
  createdAt: string;
}

// ── 현금흐름 (포트폴리오 입력 데이터) ──
interface CashFlow {
  id: string;
  label: string;       // 예: "급여", "주택 구입", "자녀 학자금"
  amount: number;      // 원. 양수=유입, 음수=유출
  date: string;        // 예상 시점 YYYY-MM
  recurring: boolean;  // 정기 반복 여부
}

// ── 포트폴리오 (★팀원 구현 영역 — 아래는 더미 스캐폴드) ──
interface AssetAllocation {
  assetClass: string;  // 예: "국내주식","해외주식","채권","대체투자","현금"
  weight: number;      // 비중 %, 합계 100
}
interface Portfolio {
  id: string;
  label: string;            // "안정형" | "균형형" | "성장형" (후보 3개)
  allocations: AssetAllocation[];
  expectedReturn: number;   // 예상 연수익률 % (더미값)
  expectedRisk: number;     // 예상 변동성 % (더미값)
  taxNote: string;          // 세금 고려 메모 (더미)
  rationale: string;        // 산출 근거 설명 (더미)
  editedByPb: boolean;      // PB가 수정했는지
}

// ── 스트레스 테스트 (★팀원 구현 영역 — 더미) ──
interface StressScenario {
  id: string;
  name: string;        // 예: "금리 +2%p", "주식 -30%", "인플레 급등"
  params: Record<string, number>;  // 시나리오 파라미터 (더미)
}
interface StressTestResult {
  portfolioId: string;
  scenarioId: string;
  projectedReturn: number;    // 더미
  projectedDrawdown: number;  // 더미 (최대 낙폭 %)
  note: string;               // 더미 코멘트
}

interface Consultation {
  id: string;
  clientId: string;
  pbId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  notes: string;
  ipsSnapshot: IPS;       // 종료 시점 7요인(점수 포함) → 성향 변화 그래프 소스
  createdAt: string;
}
```

### 식별자/표시 규칙
- PB: `PB-001` 자동. 고객: `C-{연도}-{4자리}` 자동(수정 가능).
- 자산규모: 저장 숫자(원), 표시 "12억 5,000만원".
- 점수(score): 각 요인 1~5. 높을수록 그 요인의 수준이 큼(위험 허용도↑, 투자기간↑ 등). AI가 추정하고 PB가 조정.

---

## 5. 화면 구조

### (1) 홈 — `/`
상단 토글: [PB 기준 폴더] ↔ [고객 기준] (기본: PB 기준).
- **PB 기준 폴더**: PB 폴더 카드(식별자+이름+담당 고객 수) + "PB 추가". 클릭 → 해당 PB 페이지.
- **고객 기준**: 전체 고객 엑셀형 표(5-2).

### (2) 고객 목록 표 (엑셀형) — 공통 `ClientTable`
열: 식별코드 · 이름 · 개인/법인 · 생년월일(설립일) · 담당 PB · 자산규모
- 정렬: 헤더 클릭(오름/내림) — 자산규모/날짜/가나다(`localeCompare('ko')`)/개인법인.
- 필터: 개인 / 법인 / 전체. 행 클릭 → 고객 상세.

### (3) PB 페이지 — `/pb/[pbId]`
- 상단 **PB 대시보드(`PBDashboard`)**: 담당 고객 수, **총 운용자산(AUM = 자산규모 합계)**, 개인/법인 비율, **평균 상담시간**(consultations 기준).
- **PB 정보 [수정]/[삭제]** 버튼(이름 변경, 삭제 시 확인 모달 + 담당 고객 처리 안내).
- 하단: 해당 PB 담당 고객 `ClientTable` + "고객 추가".

### (4) 고객 추가/수정 폼 (`ClientForm`)
- 맨 위 개인/법인 토글 → 라벨 동적(이름↔법인명, 생년월일↔설립일).
- 입력: 개인/법인, 이름, 생년월일(설립일), 자산규모. 식별코드 자동(수정 가능), 담당 PB 자동/선택.
- **추가/수정 공용**: 같은 폼으로 신규 등록과 기존 고객 편집 모두 처리. 고객 카드/행에서 [수정]·[삭제] 진입(삭제는 확인 모달).

### (5) 고객 상세 — PB 화면 — `/pb/[pbId]/[clientId]`
- **상단 기본정보 + 상담 타이머(`ConsultationTimer`)**: [상담 시작] 버튼 → 실시간 경과시간 표시 → [상담 종료] 버튼. 종료 시 consultations에 1행 저장(소요시간 + 현재 메모 + RRTTLLU 스냅샷).
- **입력 영역 = 탭 3개 (`ConsultationInput`)**:
  - ① **전문 텍스트**: 장문 textarea → [AI 분석] → 7요인 자동 채움(`source:'ai'`, 점수 포함).
  - ② **7요인 직접 입력**: 각 요인의 값·점수·메모 직접 입력(`source:'manual'`).
  - ③ **음성 업로드**: 파일 업로드 → [변환] → 결과가 ①칸에 채워짐 → [AI 분석].
- **RRTTLLU 결과 폼 (`IPSForm`)**: 항상 표시, 최종 직접 수정 가능. 요인별 상태에 따라:
  - **explicit**: 점수 + 근거 구절(`evidence`) 표시(AI가 왜 그 점수인지 검증 가능).
  - **inferred**: 점수 칸은 비우고, **추론 단서(`inferenceHint`)를 회색 힌트로 "참고: …" 형태 제시**. PB가 보고 직접 점수를 넣을지 결정.
  - **empty**: 완전 공백("미언급"). 아무것도 채우지 않음. **공백 저장 허용.**
  - 모든 요인에 AI/수동 뱃지 + **[검토 확정] 체크**(`reviewed`). AI 결과는 draft로 시작, PB 확정해야 최종값.
  - **저장 동작 (자동저장 아님)**: 입력/수정 중에는 임시 상태로만 두고, PB가 **[저장 확정] 버튼**을 눌러야 DB(clients.ips 등)에 저장된다. 저장 후 폼은 **읽기 전용(잠금)**으로 바뀌고, 다시 고치려면 **[수정] 버튼**으로 잠금 해제 → 편집 → 다시 [저장 확정]. 미저장 변경이 있는 상태로 화면을 벗어나려 하면 **"저장하지 않은 변경이 있습니다" 경고**.
- **레이더 차트 (`IPSRadar`)**: 현재 7요인 점수를 거미줄 그래프로 한눈에.
- **성향 변화 그래프 (`TrendChart`)** + **상담 이력 (`ConsultationHistory`)**: 과거 상담들의 스냅샷을 시계열 선 그래프로(요인별 점수 변화) + 상담 목록(날짜·소요시간).
- **현금흐름 입력 (`CashFlowEditor`)**: 고객의 예상 유입/유출(급여·주택구입·학자금 등)을 추가/수정. 포트폴리오 산출 입력값.
- **고객 화면 전환** 토글.

### (5-A) 포트폴리오 & 스트레스 테스트 — `/pb/[pbId]/[clientId]/portfolio` ★팀원 담당(더미 스캐폴드)
> 이 화면 전체는 **인터페이스·UI·더미 동작만** 만들어 둔다. 실제 최적화/검정 로직은 팀원이 채운다. 곳곳에 `// TODO(팀원): 실제 로직 구현` 주석을 남긴다. 상단에 "참고용·투자권유 아님" 디스클레이머 배너.
- **입력 요약**: 확정된 RRTTLLU 7요인 + 현금흐름 + 특이사항(unique 요인)을 읽기 전용으로 표시(포트폴리오 산출 근거).
- **포트폴리오 후보 3개 (`PortfolioPanel`)**: [포트폴리오 생성] 버튼 → `lib/portfolio.ts`의 더미 함수가 "안정형/균형형/성장형" 3개를 반환(자산배분·예상수익·예상위험·세금메모·근거는 더미값). 각 후보의 **자산배분 비중을 PB가 직접 수정**(합계 100 검증), 수정 시 `editedByPb=true`. 세금 고려 메모칸도 편집 가능.
- **스트레스 테스트 (`StressTestPanel`)**: 시나리오 선택(금리·주가·인플레 등 더미 목록) → [실행] → `lib/stresstest.ts`의 더미 함수가 후보별 예상수익·최대낙폭 등 더미 결과를 표/막대그래프로 표시.

### (6) 고객 화면 — `/client/[clientId]`
간결·시각적. RRTTLLU를 쉬운 언어 요약 + **레이더 차트**로 직관 표시. 핵심 수치만 크게.

---

## 6. 상담 처리 흐름

```
[상담 시작] → 타이머 ON
   ① 전문 텍스트 ─┐
   ③ 음성 업로드 → /api/transcribe → 전문 텍스트 ─┤→ /api/analyze → RRTTLLU(점수 포함) → IPSForm
   ② 7요인 직접 입력 ───────────────────────────→ IPSForm 직접 반영
[상담 종료] → 타이머 OFF → consultations 저장(duration + notes + ips_snapshot)
              → clients.ips / consultation_notes 도 최신값으로 갱신
              → 그래프(TrendChart)에는 **PB가 검토 확정(reviewed)한 요인 값만** 반영(미검토·정보부족은 제외해 추세 오염 방지)
```

### 6-3. 포트폴리오·스트레스 흐름 (★팀원 담당 — 더미 스캐폴드)
```
확정 RRTTLLU + 현금흐름 + 특이사항(unique)
        ↓  lib/portfolio.ts: generatePortfolios(client)  // TODO(팀원): 실제 최적화
   포트폴리오 후보 3개(안정/균형/성장, 더미값) → PB가 비중·세금메모 수정 가능
        ↓  lib/stresstest.ts: runStressTest(portfolios, scenarios)  // TODO(팀원): 실제 검정
   시나리오별 더미 결과(예상수익·최대낙폭) 표·그래프
```
- `lib/portfolio.ts` 스텁: 입력(client) → `Portfolio[]` 3개 반환. 지금은 **고정/단순규칙 더미값**(예: 위험점수에 따라 주식 비중만 대충 조정)과 `// TODO(팀원): RRTTLLU·현금흐름·세금 반영한 실제 최적화로 교체` 주석.
- `lib/stresstest.ts` 스텁: 입력(portfolio, scenario) → `StressTestResult` 더미 반환 + `// TODO(팀원): 실제 시나리오 모델 적용` 주석.
- 화면·타입·저장(clients.portfolios)·PB 수정 UI는 **동작하게** 만들고, 숫자 산출 로직만 더미로 비워둔다. 팀원이 두 lib 함수 본문만 교체하면 실동작.

### 6-1. `/api/transcribe` (음성→텍스트)
- 오디오 파일 입력, 길이/용량 검사 → `lib/stt.ts`(CLOVA) → 텍스트. 키 공백 시 안내.

### 6-2. `/api/analyze` (전문 텍스트 → RRTTLLU)
- 입력 `{ notes }`. 시스템 프롬프트에 **오류·과대계상 방지 규칙**을 명시. 각 요인을 다음 3단계 중 하나로 분류:
  - **explicit (직접 근거 있음)**: 상담 원문에 명시적 근거가 있을 때만. 점수(1~5)를 매기고 그 근거 구절을 `evidence`에 그대로 인용.
  - **inferred (추론 단서만 있음)**: 직접 언급은 없으나 정황상 단서가 있을 때. **점수는 매기지 않고(`score:null`)**, 단서를 `inferenceHint`에 적어 PB 참고용으로만 제시. (추론을 점수로 반영 금지)
  - **empty (근거·단서 없음)**: 아무 정보 없음 → 모두 공백, 점수 null.
- 규칙: 애매하면 낮게, 명시적 근거가 강할 때만 높게(보수적 채점). 추정값을 점수로 박지 말 것. **공백을 허용**하고 임의값으로 채우지 말 것.
- 각 요인에 `status`·`score`·`value`·`evidence`·`inferenceHint`를 포함해 **반드시 JSON만** 반환. `IPS` 스키마로 파싱(```json 펜스 제거). 모든 AI 결과는 `source:'ai'`, `reviewed:false`(draft).
- **파싱 방어(3단)**: ① 코드펜스/군더더기 제거 후 JSON 추출 시도 → ② 실패 시 "JSON만, 다른 텍스트 금지"로 **1회 재요청** → ③ 그래도 실패하면 분석을 포기하지 말고 **"자동 분석 실패 — 직접 입력하시겠어요?" 안내 + 수동 입력(②)로 유도**. 앱이 죽지 않게 항상 try/catch.
- 키 공백 시 안내 + 수동 입력 유도.

---

## 6-B. 공통 구현 규칙 (모든 화면에 적용)

1. **저장 모델 (자동저장 아님)**: 7요인 등 핵심 데이터는 **[저장 확정]** 버튼을 눌러야 DB에 기록. 저장 후 **읽기 전용 잠금** → **[수정]** 버튼으로 해제 후 재편집 → 다시 [저장 확정]. 미저장 변경 상태로 이탈 시 경고.
2. **수정·삭제(CRUD)**: PB·고객 모두 추가뿐 아니라 **수정·삭제** 제공. 삭제는 **확인 모달** 필수. 고객 삭제 시 관련 consultations도 함께 삭제(`on delete cascade`).
3. **로딩/에러/빈 상태**: 데이터를 불러오는 모든 화면은 세 상태를 분기 표시 —
   - 로딩: "불러오는 중…" 또는 스켈레톤.
   - 에러: "불러오기 실패" + [다시 시도] 버튼.
   - 빈 상태: "아직 ○○이 없어요" + 추가 버튼 안내.
4. **AI 파싱 방어**: 6-2의 3단 방어(펜스 제거 → 1회 재요청 → 수동 입력 안내). 모든 외부 호출은 try/catch로 감싸 앱이 죽지 않게.
5. **샘플 데이터(seed)**: 첫 실행 동작 확인용으로 `lib/seed.ts`에 **PB 2명 + 고객 4명(개인 2·법인 2)** + 각 고객 상담 1~2건(RRTTLLU 스냅샷 포함) + 현금흐름 약간을 넣는다. "샘플 데이터 채우기/초기화" 버튼으로 수동 실행(실데이터와 섞이지 않게).
6. **디자인 일관성**: 모든 화면은 디자인 시스템(딥블루+골드, 다크/화이트 토글)을 따른다.

---

## 7. 폴더 구조

```
samsung-youngcreator-PB/
├── app/
│   ├── page.tsx                      # 홈
│   ├── layout.tsx / globals.css
│   ├── pb/[pbId]/
│   │   ├── page.tsx                  # PB 대시보드 + 고객 목록
│   │   └── [clientId]/
│   │       ├── page.tsx              # 고객 상세
│   │       └── portfolio/page.tsx    # ★팀원: 포트폴리오 & 스트레스(더미)
│   ├── client/[clientId]/page.tsx    # 고객용 화면
│   └── api/
│       ├── analyze/route.ts
│       └── transcribe/route.ts
├── components/
│   ├── PBCard.tsx / PBForm.tsx
│   ├── PBDashboard.tsx               # 고객수·AUM·개인법인비율·평균상담시간
│   ├── ClientTable.tsx / ClientForm.tsx
│   ├── ConsultationTimer.tsx         # 시작/종료 실시간 타이머
│   ├── ConsultationInput.tsx         # 탭3(전문/7요인직접/음성)
│   ├── IPSForm.tsx                   # 7요인 값·점수 편집
│   ├── IPSRadar.tsx                  # 레이더 차트
│   ├── TrendChart.tsx                # 성향 변화 시계열
│   ├── ConsultationHistory.tsx       # 상담 이력 목록
│   ├── CashFlowEditor.tsx            # 현금흐름 입력
│   ├── PortfolioPanel.tsx            # ★팀원: 포트폴리오 후보 3개(더미·PB수정)
│   ├── StressTestPanel.tsx           # ★팀원: 스트레스 테스트(더미)
│   ├── ThemeToggle.tsx               # 다크/화이트 전환
│   ├── StateViews.tsx                # 로딩/에러/빈상태 공용 컴포넌트
│   ├── ConfirmModal.tsx              # 삭제 등 확인 모달
│   ├── IPSSummary.tsx / ViewToggle.tsx
├── lib/
│   ├── types.ts / supabase.ts / store.ts / stt.ts / format.ts
│   ├── theme.ts                      # 색상 토큰(딥블루/골드) 정의
│   ├── seed.ts                       # 샘플 데이터(PB2·고객4·상담)
│   ├── portfolio.ts                  # ★팀원: 포트폴리오 생성(더미, TODO)
│   └── stresstest.ts                 # ★팀원: 스트레스 테스트(더미, TODO)
├── tailwind.config.ts                # darkMode:'class', 색상 extend
├── .env.local / .gitignore / README.md
```

---

## 8. 빌드 단계 (이 순서대로)

> **1차 목표 = 1~12단계** (DB 구축 + 7요인 분석 툴 + 시각화/대시보드까지). 13단계는 포트폴리오 입력 준비, 14~15단계는 팀원 인계용 더미 스캐폴드, 16단계는 마감.

1. **세팅 + 디자인 토대**: Next.js+TS+Tailwind, Recharts 설치, `tailwind.config.ts`(darkMode:'class', 딥블루/골드 색상 토큰), `lib/theme.ts`, `ThemeToggle`(다크/화이트), 공용 `StateViews`(로딩/에러/빈상태)·`ConfirmModal`, `.gitignore`, 레이아웃·헤더, 빈 `.env.local`.
2. **Supabase 연결**: `lib/supabase.ts` (키 없어도 안 죽게 방어).
3. **모델 + store + 시드**: `types.ts`, `store.ts`(pbs·clients·consultations CRUD = 추가·수정·삭제 전부), `format.ts`, `lib/seed.ts`(샘플 데이터) + "샘플 채우기/초기화" 동작.
4. **홈 + 보기 전환**: PB 폴더 + PB 추가/수정/삭제, 고객 기준 토글. (로딩/빈상태 적용)
5. **고객 표 + CRUD**: `ClientTable`(정렬·필터) + `ClientForm`(개인/법인, 추가·수정 공용) + 삭제(확인 모달).
6. **고객 상세 + 7요인 직접 입력(②) + 저장 모델**: 기본정보 + `IPSForm`(값·점수·근거·정보부족·검토확정 필드). **[저장 확정]→잠금→[수정] 흐름** + 미저장 이탈 경고. AI 없이 먼저.
7. **전문 텍스트 분석(①) + 신뢰장치**: `ConsultationInput` 전문 탭 + `/api/analyze`(보수적 채점·근거 인용·정보부족 규칙, 결과는 draft). `IPSForm`에 근거 표시·"정보 부족" 비움·[검토 확정] 동작. 키 없으면 안내.
8. **음성 업로드(③)**: 음성 탭 + `/api/transcribe` + `lib/stt.ts`. 제한·안내.
9. **상담 타이머 + 이력**: `ConsultationTimer`(시작/종료) → consultations 저장(duration·notes·snapshot) → `ConsultationHistory` 목록.
10. **시각화**: `IPSRadar`(현재 7요인, 공백·추론 요인은 0/회색 처리하고 "미확정" 표시) + `TrendChart`(검토 확정된 explicit 점수만 시계열로).
11. **PB 대시보드**: `PBDashboard`(고객 수·AUM·개인법인 비율·평균 상담시간).
12. **고객 화면**: `/client/[clientId]` + 레이더 차트 요약 + `ViewToggle`.
13. **현금흐름 입력**: `CashFlowEditor`로 clients.cashFlows 추가/수정/저장.
14. **★포트폴리오 스캐폴드(팀원 인계)**: `lib/portfolio.ts` 더미 + `PortfolioPanel`(후보 3개 표시, 비중·세금메모 PB 수정, clients.portfolios 저장). `/pb/[pbId]/[clientId]/portfolio` 페이지 + 디스클레이머 배너. 산출 로직은 TODO 더미.
15. **★스트레스 테스트 스캐폴드(팀원 인계)**: `lib/stresstest.ts` 더미 + `StressTestPanel`(시나리오 선택→실행→더미 결과 표·그래프). 검정 로직은 TODO 더미.
16. **마무리**: 반응형, 디자인 정리, **README**(팀원 셋업 가이드 — `git pull` 후 설치/실행 명령, Supabase 키 넣는 위치, 샘플 데이터 버튼, 비용 안전장치·디스클레이머), 팀원 인계용 TODO 목록 정리.

---

## 9. 주의사항

- **실제 고객정보·녹음 금지**: 프로토타입은 가짜 데이터 + 짧은 테스트 음성만.
- **API 키 보안**: `.env.local` 깃허브 금지. 서버 키에 `NEXT_PUBLIC` 금지.
- **비용 관리**: 사용 한도 + 자동충전 OFF. 음성 짧게.
- **RLS**: 프로토타입용. 운영 전 강화.
- **점수(score)는 보조 지표**: 그래프용 단순화 값이며, 실제 판단은 값·메모와 함께 본다.
- **포트폴리오·스트레스는 더미**: 11~12단계 화면은 인터페이스·UI만 동작하고 산출 로직은 `// TODO(팀원)` 더미다. 팀원이 `lib/portfolio.ts`·`lib/stresstest.ts` 본문을 채운다.
- **투자권유 디스클레이머**: 포트폴리오 산출은 규제 영역에 닿을 수 있어 화면에 "참고용·투자권유 아님, PB 검토 전제" 배너를 표기하고, 실서비스 전 법적 검토를 거친다.
- **점진적 구현**: 단계별 확인.

---

## 10. 확장 아이디어 (선택 — 핵심 완성 후)

1. **IPS 문서 PDF 내보내기** ⭐ (다음 단계 우선): RRTTLLU 결과 + 최신 스냅샷을 정식 투자정책서 양식 PDF로 생성·다운로드. *데이터 구조(IPS, score, 스냅샷)가 이미 잡혀 있어 나중에 붙이기 쉬움.*
2. **검색**: 고객 이름·식별코드 빠른 검색.
3. **고객 화면 공유**: 요약 페이지를 링크/QR로 공유.
4. **자동 저장/임시저장**: 입력 중 유실 방지.
5. **AI 분석 근거 하이라이트**: 각 요인이 전문 텍스트의 어느 부분에서 나왔는지 표시.
6. **로그인·권한(PB 계정)**: 운영 전제. RLS 강화와 함께.

> 자산배분·상품 추천 등 **구체적 투자 권유** 기능은 투자자문업 등 규제 영역 → 도입 전 별도 법적 검토 필수.
