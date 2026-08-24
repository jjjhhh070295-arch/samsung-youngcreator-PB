-- ================================================================
-- 마이그레이션 — 헤리티지 탭 전문가 상담 예약 저장
-- Supabase SQL Editor에서 전체 실행 (기존 테이블에 영향 없음, 새 테이블만 추가)
--
-- 이 테이블이 없어도 앱은 정상 동작한다 — lib/store.ts의
-- createHeritageMeetingRequest/listHeritageMeetingRequests가 insert 실패 시
-- localStorage로 조용히 폴백한다. 다만 그 상태에서는 예약 기록이 그 브라우저에만
-- 남고 다른 PB·다른 기기에서는 보이지 않으므로, 실사용 전에 이 마이그레이션을
-- 반드시 실행할 것.
-- ================================================================

create table if not exists heritage_meeting_requests (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references parties(id) on delete cascade,
  pb_id             uuid references pbs(id) on delete set null,
  expert_id         text not null,
  expert_name       text not null,
  requested_label   text not null,   -- MeetingBookingModal의 onConfirm 문자열 그대로
  requested_date    date,            -- requested_label에서 파싱(YYYY-MM-DD), 실패 시 null
  requested_time    text,            -- requested_label에서 파싱(HH:MM), 실패 시 null
  status            text not null default 'requested' check (status in ('requested')),
  created_at        timestamptz default now()
);

create index if not exists idx_heritage_meeting_requests_client
  on heritage_meeting_requests(client_id);

-- ── RLS — 이 프로젝트의 다른 테이블(parties/individuals/corporates)과 동일하게
--   행 단위 정책 없이 전체 허용(별도 인증 서버가 앱 레벨에서 PB 로그인을 처리한다). ──
alter table heritage_meeting_requests enable row level security;

drop policy if exists "p_heritage_meeting_requests" on heritage_meeting_requests;

create policy "p_heritage_meeting_requests" on heritage_meeting_requests
  for all using (true) with check (true);

-- ── 결과 확인 ──
select '① heritage_meeting_requests' as 항목, count(*) as 행수 from heritage_meeting_requests;
