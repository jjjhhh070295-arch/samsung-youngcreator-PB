-- ================================================================
-- 마이그레이션 — 투자성향 설문 응답 원본 저장 (이력 누적)
-- Supabase SQL Editor에서 전체 실행 (기존 테이블에 영향 없음, 새 테이블만 추가)
--
-- 배경: 지금은 설문 원본(answers·점수·최종 성향)이 브라우저 localStorage
-- (pb-investment-survey:{pbId}:{clientId})에만 있고, 7요인으로 가공된 결과만
-- parties.ips 로 DB에 간다. localStorage 키가 (pbId, clientId) 복합이라 담당 PB가
-- 바뀌면 이전 설문이 안 보인다 — 이 테이블은 party_id 만으로 조회해 그 문제를 없앤다.
--
-- 이 테이블이 없어도 앱은 정상 동작한다 — lib/store.ts의
-- saveInvestmentSurvey/getLatestInvestmentSurvey가 insert/select 실패 시
-- localStorage로 조용히 폴백한다. 다만 그 상태에서는 설문 기록이 그 브라우저에만
-- 남고 다른 PB·다른 기기에서는 보이지 않으므로, 실사용 전에 이 마이그레이션을
-- 반드시 실행할 것.
--
-- 이력을 누적한다 — 제출할 때마다 새 행을 insert하고 UPDATE하지 않는다.
-- 조회는 party_id 만으로 한다(pb_id는 "누가 진행했는지" 기록용일 뿐 조회 조건이 아니다).
-- ================================================================

create table if not exists investment_surveys (
  id                    uuid primary key default gen_random_uuid(),
  party_id              uuid not null references parties(id) on delete cascade,
  pb_id                 uuid references pbs(id) on delete set null,   -- 기록용, 조회 조건 아님
  answers               jsonb not null,
  raw_score             integer not null,
  converted_score       numeric not null,
  tendency_before_cap   text,
  final_tendency        text not null,
  cap_reason            text,
  submitted_at          timestamptz not null,
  created_at            timestamptz not null default now()
);

create index if not exists idx_investment_surveys_party_submitted
  on investment_surveys(party_id, submitted_at desc);

-- ── RLS — 이 프로젝트의 다른 테이블(parties/individuals/heritage_meeting_requests)과
--   동일하게 행 단위 정책 없이 전체 허용(별도 인증 서버가 앱 레벨에서 PB 로그인을 처리한다). ──
alter table investment_surveys enable row level security;

drop policy if exists "p_investment_surveys" on investment_surveys;

create policy "p_investment_surveys" on investment_surveys
  for all using (true) with check (true);

-- ── 결과 확인 ──
select '① investment_surveys' as 항목, count(*) as 행수 from investment_surveys;
