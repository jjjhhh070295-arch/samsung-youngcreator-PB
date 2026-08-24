-- ================================================================
-- 백업 스크립트 — 마이그레이션 전 스냅샷 (2026-06-21)
-- Supabase SQL Editor에서 전체 실행
-- 복원 방법: INSERT INTO <원본테이블> SELECT * FROM <백업테이블>
-- ================================================================

-- pbs 백업
create table if not exists _backup_pbs as select * from pbs;

-- clients 백업 (핵심 — 개인/법인 원본)
create table if not exists _backup_clients as select * from clients;

-- consultations 백업
create table if not exists _backup_consultations as select * from consultations;

-- client_holdings 백업
create table if not exists _backup_client_holdings as select * from client_holdings;

-- client_real_estate 백업
create table if not exists _backup_client_real_estate as select * from client_real_estate;

-- client_real_estate_debt 백업
create table if not exists _backup_client_real_estate_debt as select * from client_real_estate_debt;

-- 확인 쿼리 — 각 테이블 행 수 비교
select 'pbs'                    as tbl, count(*) from pbs
union all select 'pbs_backup',                    count(*) from _backup_pbs
union all select 'clients',                       count(*) from clients
union all select 'clients_backup',                count(*) from _backup_clients
union all select 'consultations',                 count(*) from consultations
union all select 'consultations_backup',          count(*) from _backup_consultations
union all select 'client_holdings',               count(*) from client_holdings
union all select 'client_holdings_backup',        count(*) from _backup_client_holdings
union all select 'client_real_estate',            count(*) from client_real_estate
union all select 'client_real_estate_backup',     count(*) from _backup_client_real_estate
union all select 'client_real_estate_debt',       count(*) from client_real_estate_debt
union all select 'client_real_estate_debt_backup',count(*) from _backup_client_real_estate_debt
order by tbl;
