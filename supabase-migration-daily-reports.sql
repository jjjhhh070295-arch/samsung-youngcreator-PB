-- ================================================================
-- 모닝 브리핑 — 2단계 스키마(리포트 저장 테이블, 발송 코드 없음)
-- Supabase SQL Editor에서 실행
--
-- ⚠️ 코드 배포보다 먼저 실행할 것.
--    이 테이블이 없어도 앱은 깨지지 않는다 — "오늘 리포트 생성" 버튼이
--    테이블 부재를 감지해 에러 대신 안내 메시지를 띄운다.
--    다만 이 SQL을 실행해야 실제로 리포트 생성/조회가 동작한다.
-- ================================================================

create table if not exists daily_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,          -- 하루 1건
  headline text not null,
  html_body text not null,
  text_body text not null,
  sources jsonb not null default '[]'::jsonb,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  web_search_count int not null default 0,
  cost_usd numeric not null default 0,
  duration_sec numeric not null default 0,
  generated_at timestamptz not null default now(),
  status text not null default 'draft'        -- draft | approved
);

alter table daily_reports enable row level security;

drop policy if exists daily_reports_all on daily_reports;
create policy daily_reports_all on daily_reports
  for all using (true) with check (true);

-- 결과 확인
select '① daily_reports 전체' as 항목, count(*) as 행수 from daily_reports
union all
select '② status=draft',                count(*) from daily_reports where status = 'draft'
union all
select '③ status=approved',             count(*) from daily_reports where status = 'approved'
order by 항목;
