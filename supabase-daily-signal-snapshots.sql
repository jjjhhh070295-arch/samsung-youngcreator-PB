-- ================================================================
-- daily_signal_snapshots 테이블 (백테스트용 신호 시점 박제)
-- Supabase SQL Editor에서 실행
-- ================================================================
-- 설계 원칙:
--   • append-only: 한번 들어간 과거 행은 UPDATE/DELETE 불가
--   • 같은 날 재실행 시 ON CONFLICT DO NOTHING (skip)
--   • unique(snapshot_date, asset_class) → 하루·자산군당 1행

-- 1. 테이블 생성
create table if not exists daily_signal_snapshots (
  id                      uuid        primary key default gen_random_uuid(),
  snapshot_date           date        not null,
  asset_class             text        not null
                            check (asset_class in ('equity','bond','liquidity','dollar','gold','risk','tax')),
  score                   numeric     not null,
  report_count            integer     not null default 0,
  dispersion              numeric,                       -- 기여 리포트 direction 표준편차
  contributing_report_ids jsonb       not null default '[]'::jsonb,
  created_at              timestamptz not null default now(),

  unique (snapshot_date, asset_class)
);

-- 2. 시계열 조회 최적화 인덱스
create index if not exists dss_date_asset_idx
  on daily_signal_snapshots (snapshot_date desc, asset_class);

-- 3. Append-only 강제 트리거
--    RLS보다 강력: postgres 역할도 막음
create or replace function _prevent_snapshot_mutation()
returns trigger language plpgsql as $$
begin
  raise exception
    'daily_signal_snapshots is append-only — UPDATE/DELETE are not permitted (백테스트 시점 정합성 보호)';
end;
$$;

drop trigger if exists no_update_snapshots on daily_signal_snapshots;
drop trigger if exists no_delete_snapshots on daily_signal_snapshots;

create trigger no_update_snapshots
  before update on daily_signal_snapshots
  for each row execute function _prevent_snapshot_mutation();

create trigger no_delete_snapshots
  before delete on daily_signal_snapshots
  for each row execute function _prevent_snapshot_mutation();

-- 4. RLS — SELECT + INSERT만 허용, UPDATE/DELETE 정책 없음 → API 레벨 차단
alter table daily_signal_snapshots enable row level security;

drop policy if exists "dss_select" on daily_signal_snapshots;
drop policy if exists "dss_insert" on daily_signal_snapshots;

create policy "dss_select" on daily_signal_snapshots
  for select using (true);

create policy "dss_insert" on daily_signal_snapshots
  for insert with check (true);

-- UPDATE/DELETE 정책 의도적으로 미생성 → RLS 레벨에서 차단
-- 트리거(위)가 postgres 역할까지 포함해 DB 레벨에서 이중으로 막음

-- 5. 확인
select 'daily_signal_snapshots 생성 완료' as 결과,
       (select count(*) from daily_signal_snapshots) as 현재행수;
