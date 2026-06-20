-- ================================================================
-- households / household_members 테이블 (명세서 §4) + RLS
-- Supabase SQL Editor에서 실행
-- ================================================================

-- 1. 가문 테이블
create table if not exists households (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  head_party_id uuid references parties(id) on delete set null,
  pb_id         uuid references pbs(id)     on delete set null,  -- 담당 PB
  created_at    timestamptz default now()
);

-- 2. 가문 구성원 테이블
create table if not exists household_members (
  household_id uuid not null references households(id) on delete cascade,
  party_id     uuid not null references parties(id)    on delete cascade,
  role         text,           -- 'head' | 'spouse' | 'child' | 등 (표시용)
  joined_at    date default current_date,
  primary key (household_id, party_id)
);

create index if not exists hm_party_idx on household_members (party_id);

-- 3. RLS
alter table households        enable row level security;
alter table household_members enable row level security;

drop policy if exists "p_households"        on households;
drop policy if exists "p_household_members" on household_members;

create policy "p_households"        on households        for all using (true) with check (true);
create policy "p_household_members" on household_members for all using (true) with check (true);

-- 확인
select 'households 생성 완료' as 결과,
       (select count(*) from households)        as households_수,
       (select count(*) from household_members) as household_members_수;
