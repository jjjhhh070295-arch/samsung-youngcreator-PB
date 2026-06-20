-- ================================================================
-- 마이그레이션 — 우선순위 1~2
-- parties / individuals / corporates 생성 + 자산 테이블 연결
-- Supabase SQL Editor에서 전체 실행
-- ================================================================

-- ── 0. 혹시 중간에 멈췄을 경우 초기화 (안전하게 재실행) ──
drop table if exists corporates  cascade;
drop table if exists individuals cascade;
drop table if exists parties     cascade;

-- ── 1. parties (공통 상위 테이블) ──
create table if not exists parties (
  id                 uuid primary key default gen_random_uuid(),
  party_type         text not null check (party_type in ('individual', 'corporate')),
  display_name       text not null,
  is_client          boolean not null default true,
  pb_id              uuid references pbs(id) on delete set null,
  code               text unique,
  asset_size         bigint default 0,
  consultation_notes text default '',
  ips                jsonb default '{}',
  cash_flows         jsonb default '[]',
  portfolios         jsonb default '[]',
  stages             jsonb default '{}',
  created_at         timestamptz default now()
);

-- ── 2. individuals (개인 전용) ──
create table if not exists individuals (
  party_id        uuid primary key references parties(id) on delete cascade,
  birth_date      date,
  sub_type        text default 'individual'
                  check (sub_type in ('individual', 'sole_proprietor')),
  resident_no_enc text,   -- 주민번호 암호화 저장용 (평문 금지)
  notes           text
);

-- ── 3. corporates (법인 전용) ──
create table if not exists corporates (
  party_id                uuid primary key references parties(id) on delete cascade,
  biz_reg_no              text,
  corp_reg_no             text,
  established_at          date,
  rep_party_id            uuid references parties(id), -- 대표자 개인 (임시: party_relationships 전)
  ownership_pct           numeric(5,2),
  is_majority_shareholder boolean,
  account_separation      text,
  notes                   text
);

-- ── 4. clients → parties 복사 (UUID 그대로 유지) ──
insert into parties (
  id, party_type, display_name, is_client,
  pb_id, code, asset_size, consultation_notes,
  ips, cash_flows, portfolios, stages, created_at
)
select
  id,
  case
    when client_type in ('individual', 'sole_proprietor') then 'individual'
    else 'corporate'
  end,
  name,
  true,
  assigned_pb_id,
  code,
  coalesce(asset_size, 0),
  coalesce(consultation_notes, ''),
  coalesce(ips, '{}'),
  coalesce(cash_flows, '[]'),
  coalesce(portfolios, '[]'),
  coalesce(stages, '{}'),
  created_at
from clients
on conflict (id) do nothing;

-- ── 5. clients → individuals 복사 ──
insert into individuals (party_id, birth_date, sub_type)
select id, birth_date, client_type::text
from clients
where client_type in ('individual', 'sole_proprietor')
on conflict (party_id) do nothing;

-- ── 6. clients → corporates 복사 ──
insert into corporates (party_id, established_at)
select id, birth_date
from clients
where client_type = 'corporate'
on conflict (party_id) do nothing;

-- ── 7. 자산 테이블에 owner_party_id 컬럼 추가 ──
alter table client_holdings
  add column if not exists owner_party_id uuid references parties(id) on delete cascade;

alter table client_real_estate
  add column if not exists owner_party_id uuid references parties(id) on delete cascade;

-- ── 8. owner_party_id 백필 (client_id = parties.id 동일 UUID이므로 직접 복사) ──
update client_holdings
  set owner_party_id = client_id
  where owner_party_id is null;

update client_real_estate
  set owner_party_id = client_id
  where owner_party_id is null;

-- ── 9. RLS ──
alter table parties     enable row level security;
alter table individuals enable row level security;
alter table corporates  enable row level security;

drop policy if exists "p_parties"     on parties;
drop policy if exists "p_individuals" on individuals;
drop policy if exists "p_corporates"  on corporates;

create policy "p_parties"     on parties     for all using (true) with check (true);
create policy "p_individuals" on individuals for all using (true) with check (true);
create policy "p_corporates"  on corporates  for all using (true) with check (true);

-- ── 10. 결과 확인 ──
select '① parties'                        as 항목, count(*) as 행수 from parties
union all
select '② individuals',                              count(*) from individuals
union all
select '③ corporates',                               count(*) from corporates
union all
select '④ clients (원본, 변경 없음)',                 count(*) from clients
union all
select '⑤ holdings - owner_party_id 채워진 수',      count(*) from client_holdings    where owner_party_id is not null
union all
select '⑥ real_estate - owner_party_id 채워진 수',   count(*) from client_real_estate where owner_party_id is not null
order by 항목;
