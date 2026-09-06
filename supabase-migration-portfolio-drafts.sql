-- ================================================================
-- 마이그레이션 — 포트폴리오(수동 배분) 작업 중 초안을 DB로
-- Supabase SQL Editor에서 전체 실행 (기존 테이블에 영향 없음, 새 테이블만 추가)
--
-- 배경: ManualPortfolioBuilder(포트폴리오2 탭)에서 고르는 "선택 종목·자산군 비중"과
-- KoreanStockTrendFilter의 "체크·확정" 상태가 지금까지 브라우저 localStorage에만
-- 있었다(pb-manual-portfolio-v1-{clientId}, pb-kr-trend-checked-{clientId},
-- pb-kr-trend-confirmed-{clientId}). 서버 왕복이 한 번도 없어서 같은 고객이라도 다른
-- 기기·다른 브라우저에서 열면 통째로 사라졌다. 셋 다 같은 화면의 같은 작업 초안이라
-- 하나의 jsonb 컬럼으로 묶는다.
--
-- 이 테이블이 없어도 앱은 정상 동작한다 — lib/store.ts의
-- savePortfolioDraft/getPortfolioDraft가 42P01/PGRST205(테이블 없음)를 만나면
-- localStorage로 조용히 폴백한다(investment_surveys/pb_schedules와 같은 방식). 다만 그
-- 상태에서는 초안이 그 브라우저에만 남으므로, 실사용 전에 이 마이그레이션을 반드시
-- 실행할 것.
--
-- 승인된 확정본(parties.portfolios, approvePortfolioWorkflow)과는 다른 테이블이다.
-- 이 테이블은 "지금 작업 중인 초안"만 고객당 1행으로 덮어쓴다 — 이력이 아니다.
-- 기존 localStorage 초안은 이관하지 않는다(pb_schedules와 같은 판단 — 저장 시점에
-- 자동으로 다시 채워진다).
-- ================================================================

-- ── 테이블 ──
-- draft를 jsonb 통짜로 두는 이유는 지금 payload 구조(version/allocation/
-- finalAllocation/selected/investableWon/allocatableWon/trendChecked/trendConfirmed)가
-- 아직 바뀌고 있어서다. 컬럼으로 쪼개지 않는다.
create table if not exists portfolio_drafts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null unique references parties(id) on delete cascade,
  pb_id       uuid references pbs(id) on delete set null,
  draft       jsonb not null,
  saved_at    timestamptz not null,
  updated_at  timestamptz not null default now()
);

-- ── 인덱스 ──
-- 조회는 client_id 단건(UNIQUE라 PK와 별개로 이미 인덱싱됨). pb_id는 "누가 작업
-- 중인지" 기록용일 뿐 조회 조건이 아니라 별도 인덱스를 두지 않는다.

-- ── RLS ──
-- 이 프로젝트의 다른 테이블(parties/investment_surveys/pb_schedules)과 동일하게 전체
-- 허용이다. 이 앱의 PB 로그인은 클라이언트 측이고 Supabase에는 anon 키 하나로만
-- 접근한다 — 이 테이블만 따로 잠가도 보안은 오르지 않고(같은 키로 parties가 이미
-- 열려 있다) 기능만 막힌다. 서버 세션이나 Supabase Auth가 들어올 때 전 테이블을
-- 일괄 정비하는 것이 맞다.
alter table portfolio_drafts enable row level security;

drop policy if exists "p_portfolio_drafts" on portfolio_drafts;

create policy "p_portfolio_drafts" on portfolio_drafts
  for all using (true) with check (true);

-- ── 결과 확인 ──
select '① portfolio_drafts' as 항목, count(*) as 행수 from portfolio_drafts;
