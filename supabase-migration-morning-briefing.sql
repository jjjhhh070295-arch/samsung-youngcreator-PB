-- ================================================================
-- 모닝 브리핑 이메일 — 1단계 스키마(발송 코드 없음, 컬럼만 추가)
-- Supabase SQL Editor에서 실행
--
-- ⚠️ 코드 배포보다 먼저 실행할 것.
--    supabase-migration-party-email.sql(parties.email)도 아직 안 돌렸다면
--    같이 먼저 실행해야 한다 — 이 마이그레이션은 그 위에 opt-in/opt-out만
--    얹는다(parties.email 자체는 별도 파일이 담당, 여기서 다시 만들지 않음).
--
--    코드는 이 SQL이 실행되기 전에도 깨지지 않도록 방어적으로 짜여 있다
--    (lib/store.ts가 컬럼 부재를 감지하면 새 필드를 뺀 채로 재시도한다).
--    다만 그 상태에서는 PB 이메일/직함/연락처, 고객 브리핑 수신 동의를
--    실제로 저장할 수 없다 — 이 SQL을 실행해야 그 값들이 저장되기 시작한다.
-- ================================================================

-- 1. pbs — 이메일(Reply-To용)·직함·연락처(메일 서명용)
--    전부 nullable, 기존 PB 행은 전부 null로 남는다(미입력 상태).
alter table pbs
  add column if not exists email text;
alter table pbs
  add column if not exists title text;
alter table pbs
  add column if not exists phone text;

-- 2. parties — 모닝 브리핑 수신 동의/거부
--    email_opt_in: 기본값 false — 명시적으로 동의를 켠 고객만 발송 대상이 된다.
--    email_opt_out_at: 수신거부한 시각. null이면 거부한 적 없음.
--      (opt_in을 다시 false로 되돌리지 않고 이 컬럼을 별도로 두는 이유:
--       "언제 거부했는지" 기록을 남겨야 발송 로직/감사 양쪽에 쓸모가 있다.)
alter table parties
  add column if not exists email_opt_in boolean not null default false;
alter table parties
  add column if not exists email_opt_out_at timestamptz;

-- 3. 결과 확인
select '① pbs 전체'                      as 항목, count(*) as 행수 from pbs
union all
select '② pbs - email 입력됨',                     count(*) from pbs where email is not null
union all
select '③ parties 전체',                           count(*) from parties
union all
select '④ parties - email_opt_in=true',            count(*) from parties where email_opt_in = true
union all
select '⑤ parties - email_opt_out_at 있음',        count(*) from parties where email_opt_out_at is not null
order by 항목;
