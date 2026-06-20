-- ================================================================
-- party_relationships 테이블 + RLS (명세서 §3)
-- Supabase SQL Editor에서 실행
-- ================================================================

create table if not exists party_relationships (
  id            uuid primary key default gen_random_uuid(),
  from_party_id uuid not null references parties(id) on delete cascade,
  to_party_id   uuid not null references parties(id) on delete cascade,
  relation_type text not null check (
    relation_type in ('owns', 'spouse', 'child', 'parent', 'sibling', 'heir')
  ),
  ownership_pct numeric check (ownership_pct > 0 and ownership_pct <= 100),
  valid_from    date not null default current_date,
  valid_to      date,
  created_at    timestamptz default now(),
  check (from_party_id <> to_party_id)
);

-- 방향성 규칙 주석: parent/child는 항상 from=부모 → to=자녀
-- spouse/sibling은 양방향으로 등록하거나 조회 시 OR 처리

create index if not exists pr_from_idx on party_relationships (from_party_id, relation_type);
create index if not exists pr_to_idx   on party_relationships (to_party_id,   relation_type);

alter table party_relationships enable row level security;
drop policy if exists "p_party_relationships" on party_relationships;
create policy "p_party_relationships" on party_relationships for all using (true) with check (true);

-- 확인
select 'party_relationships 생성 완료' as 결과,
       (select count(*) from party_relationships) as 현재행수;
