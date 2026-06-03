-- Supabase SQL Editor에서 이 전체를 실행하세요. (BLUEPRINT §3-2, §3-3)
-- ⚠️ RLS 정책은 프로토타입 전용. 운영 전 반드시 강화할 것.

create table if not exists pbs (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,          -- "PB-001"
  name text not null,
  created_at timestamptz default now()
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,          -- "C-2026-0001"
  client_type text not null default 'individual',  -- individual | corporate
  name text not null,
  birth_date date,                    -- 개인=생년월일, 법인=설립일
  assigned_pb_id uuid references pbs(id) on delete set null,
  asset_size bigint default 0,        -- 원
  consultation_notes text default '', -- 최신 전문 텍스트
  ips jsonb default '{}',             -- 최신 RRTTLLU 7요인
  cash_flows jsonb default '[]',      -- 고객 현금흐름 목록
  portfolios jsonb default '[]',      -- 포트폴리오 후보 3개
  stages jsonb default '{}',          -- 단계별 PB 확정 상태
  created_at timestamptz default now()
);

-- 기존 프로젝트에 stages 칸이 없으면 추가 (이미 있으면 무시됨)
alter table clients add column if not exists stages jsonb default '{}';

-- 상담 1건 = 1행 (이력 누적 + 타이머 + 성향 스냅샷)
create table if not exists consultations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  pb_id uuid references pbs(id) on delete set null,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds int default 0,
  notes text default '',
  ips_snapshot jsonb default '{}',
  created_at timestamptz default now()
);

-- ── RLS (프로토타입 전용) ──
alter table pbs enable row level security;
alter table clients enable row level security;
alter table consultations enable row level security;

drop policy if exists "p_pbs" on pbs;
drop policy if exists "p_clients" on clients;
drop policy if exists "p_consultations" on consultations;

create policy "p_pbs" on pbs for all using (true) with check (true);
create policy "p_clients" on clients for all using (true) with check (true);
create policy "p_consultations" on consultations for all using (true) with check (true);
