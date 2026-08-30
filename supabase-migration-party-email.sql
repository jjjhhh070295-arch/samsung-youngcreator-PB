-- ================================================================
-- parties: email 컬럼 추가 마이그레이션
-- Supabase SQL Editor에서 실행 (기존 데이터에 영향 없음, 컬럼만 추가)
-- ================================================================
--
-- 목적: 고객 연락용 이메일 주소를 저장한다. 개인 고객은 본인 이메일,
--       법인 고객은 담당자 이메일을 같은 컬럼에 넣는다 — parties는
--       개인·법인 공통 상위 테이블이므로 individuals/corporates로
--       나누지 않아야 rowToClient의 "한 필드가 두 컬럼을 겸함" 패턴
--       (birthDate = birth_date ?? established_at)이 늘어나지 않는다.
--
-- 제약을 걸지 않는 이유:
--   NOT NULL — 기존 고객 전원이 미입력 상태이고, 이메일은 선택 입력이다.
--   UNIQUE   — 부부가 같은 주소를 쓰거나 담당자가 여러 법인을 겸임하는
--              경우가 흔해 중복이 정상이다.
--   형식 검증은 DB check가 아니라 ClientForm.tsx의 submit()에서 한다
--   (생년월일 미래 차단과 동일한 방식).
--
-- 적용 순서 주의: 이 SQL을 먼저 실행한 뒤에 코드를 배포해야 한다.
--   반대 순서면 clientToPartyRow/createClient가 parties에 email을 쓰면서
--   고객 추가·수정이 전부 실패한다(읽기는 select * 라 영향 없음).

-- 1. 컬럼 추가
--    DEFAULT 없음 → 기존 행은 전부 null로 남는다(미입력 상태).
alter table parties
  add column if not exists email text;

-- 2. 결과 확인
select '① parties 전체'        as 항목, count(*) as 행수 from parties
union all
select '② email 입력된 고객',            count(*) from parties where email is not null
union all
select '③ email 미입력 고객',            count(*) from parties where email is null
order by 항목;
