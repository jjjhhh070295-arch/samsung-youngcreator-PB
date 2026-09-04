-- ================================================================
-- 모닝 브리핑 3단계 — 발송 이력 테이블
-- Supabase SQL Editor에서 실행
--
-- ⚠️ 코드 배포보다 먼저 실행할 것.
--    이 테이블이 없어도 앱은 깨지지 않는다 — app/api/briefing/send 가 테이블 부재를
--    감지하면(42P01/PGRST205) 발송을 시작하지 않고 NO_TABLE 로 거부한다.
--    "이력을 못 남기는 상태에서는 아예 보내지 않는다"가 이 기능의 원칙이다.
--    이력이 없으면 중복 발송을 막을 수단도 없기 때문이다.
-- ================================================================
--
-- 왜 별도 테이블인가:
--   daily_reports 는 "무엇을 만들었나"(하루 1건, 전사 공통)를 담고,
--   이 테이블은 "누구에게 실제로 나갔나"(리포트 × 고객)를 담는다. 축이 다르다.
--
-- 재실행 안전성의 핵심은 unique (report_id, client_id) 다.
--   cron 이 두 번 돌아도, 사람이 수동 발송을 한 번 더 눌러도 같은 사람에게 두 번 가지 않는다.
--   발송 라우트는 보내기 "전에" queued 행을 insert 하고(선점), 성공/실패에 따라 상태만 갱신한다.
--   먼저 보내고 나중에 기록하면 그 사이에 죽었을 때 같은 사람에게 또 보내게 된다.

create table if not exists briefing_sends (
  id                  uuid primary key default gen_random_uuid(),
  report_id           uuid not null references daily_reports(id) on delete cascade,
  client_id           uuid not null references parties(id) on delete cascade,
  pb_id               uuid references pbs(id) on delete set null,  -- 발송 시점 담당 PB
  email               text not null,          -- 발송 시점 주소 스냅샷(이후 고객이 주소를 바꿔도 기록은 남는다)
  status              text not null default 'queued'
                        check (status in ('queued', 'sent', 'failed', 'skipped')),
  provider_message_id text,                   -- Resend 가 돌려준 메시지 id
  error               text,
  sent_at             timestamptz,
  created_at          timestamptz default now(),

  unique (report_id, client_id)
);

-- 발송 라우트가 "이 리포트로 이미 나간 사람"을 한 번의 쿼리로 확인한다.
create index if not exists briefing_sends_report_idx on briefing_sends (report_id, status);
-- 고객 상세에서 "이 고객에게 언제 나갔나"를 볼 때 쓴다.
create index if not exists briefing_sends_client_idx on briefing_sends (client_id, created_at desc);

-- ── RLS — 이 프로젝트의 다른 테이블과 동일하게 전체 허용
--    (앱 레벨에서 PB 로그인을 처리하고, 발송 라우트는 CRON_SECRET 으로 따로 보호한다). ──
alter table briefing_sends enable row level security;

drop policy if exists "p_briefing_sends" on briefing_sends;

create policy "p_briefing_sends" on briefing_sends
  for all using (true) with check (true);

-- ── 결과 확인 ──
select '① briefing_sends 전체' as 항목, count(*) as 행수 from briefing_sends
union all
select '② status=sent',                  count(*) from briefing_sends where status = 'sent'
union all
select '③ status=failed',                count(*) from briefing_sends where status = 'failed'
union all
select '④ status=queued (중단된 발송)',   count(*) from briefing_sends where status = 'queued'
order by 항목;
