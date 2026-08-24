-- ================================================================
-- transfer_events 테이블 (명세서 §5) + RLS
-- Supabase SQL Editor에서 실행
-- ================================================================

create table if not exists transfer_events (
  id            uuid primary key default gen_random_uuid(),
  event_type    text not null check (event_type in ('gift', 'inheritance')),
  from_party_id uuid references parties(id) on delete set null,  -- 증여자/피상속인
  to_party_id   uuid not null references parties(id) on delete cascade,  -- 수증자/상속인
  asset_kind    text check (asset_kind in ('cash', 'stock', 'real_estate', 'corp_share', 'other')),
  asset_ref     uuid,          -- 해당 자산 레코드 id (있을 때만)
  amount        numeric check (amount >= 0),  -- 평가액(원)
  event_date    date not null,
  note          text,
  created_at    timestamptz default now()
);

-- §7-3 쿼리 최적화: (to, date) + (from, date) 인덱스
create index if not exists te_to_idx   on transfer_events (to_party_id,   event_date desc);
create index if not exists te_from_idx on transfer_events (from_party_id, event_date desc);

alter table transfer_events enable row level security;
drop policy if exists "p_transfer_events" on transfer_events;
create policy "p_transfer_events" on transfer_events for all using (true) with check (true);

-- §7-3 참고 쿼리 예시 (실행하지 말고 확인용)
-- select coalesce(sum(amount), 0)
-- from transfer_events
-- where event_type = 'gift'
--   and from_party_id = '<donor_uuid>'
--   and to_party_id   = '<donee_uuid>'
--   and event_date   >= current_date - interval '10 years';

select 'transfer_events 생성 완료' as 결과,
       (select count(*) from transfer_events) as 현재행수;
