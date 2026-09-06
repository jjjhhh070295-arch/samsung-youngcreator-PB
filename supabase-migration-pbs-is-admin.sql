-- pbs.is_admin — PB 계정 관리 메뉴를 관리자에게만 보이게 하는 플래그
--
-- ⚠️ 먼저 분명히 해야 할 것: 이건 보안 장치가 아니라 UI 게이트다.
--
-- 이 앱은 서버 세션이 없다. 로그인 상태는 localStorage 에만 있고(lib/auth.ts), DB 는
-- 요청자가 누구인지 모른다(auth.uid() 가 없다). supabase-migration-pbs-rls.sql 이
-- password 컬럼 읽기는 막았지만 행 단위 정책은 전부 허용이라, anon 키를 아는 사람은
-- REST 로 직접 pbs 에 insert/update 를 할 수 있다 — anon 키는 클라이언트 번들에 그대로
-- 들어 있다. 즉 is_admin 을 false 로 둬도 그 사람이 마음먹으면 계정을 만들 수 있다.
--
-- 그럼에도 넣는 이유:
--   · 일반 PB 가 화면에서 실수로 남의 비밀번호를 바꾸는 일을 없앤다(현실적으로 이게 대부분이다).
--   · 나중에 서버 세션(app/api/auth/session)이 들어왔을 때 "관리자만" 정책을 붙일 자리가
--     이미 있다. 그때 RLS 나 서버 라우트에서 이 컬럼을 그대로 조건으로 쓰면 된다.
--
-- 진짜 차단이 필요해지면 둘 중 하나가 있어야 한다:
--   ① 서버 라우트에서 service_role 키로만 PB 를 만들고, 그 라우트가 세션을 검증한다.
--   ② Supabase Auth 를 도입해 auth.uid() 기반 RLS 를 건다.
-- 이 파일은 그 전 단계이며, 그 사실을 팀이 알고 쓰는 것이 중요하다.

begin;

-- ── 0. 사전 확인 ────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.pbs') is null then
    raise exception 'public.pbs 테이블이 없다 — supabase.sql 을 먼저 실행할 것';
  end if;
end $$;

-- ── 1. 컬럼 추가 ────────────────────────────────────────────────────────────
-- 기본값 false. 기존 행은 전부 일반 PB 가 되므로, 아래 2번으로 최소 한 명을 올려야
-- 아무도 관리 메뉴를 못 보는 상태가 되지 않는다.
alter table public.pbs
  add column if not exists is_admin boolean not null default false;

comment on column public.pbs.is_admin is
  'PB 계정 관리 메뉴 노출 여부. UI 게이트이며 권한 강제가 아니다(서버 세션 도입 전).';

-- ── 2. 최초 관리자 지정 ─────────────────────────────────────────────────────
-- ⚠️ 실행 전에 사원번호를 실제 값으로 바꿀 것. 데모 계정(PB-001)을 기본으로 뒀다.
--    아무도 지정하지 않으면 관리 메뉴가 전 계정에서 사라져 PB 를 새로 만들 수 없다.
update public.pbs
   set is_admin = true
 where employee_id = 'PB-001';

-- 안전장치 — 관리자가 한 명도 없으면 트랜잭션을 되돌린다. 위 update 가 0건이면
-- (사원번호를 안 바꿨거나 그 계정이 없으면) 여기서 걸린다.
do $$
declare
  admin_count int;
begin
  select count(*) into admin_count from public.pbs where is_admin;
  if admin_count = 0 then
    raise exception '관리자가 0명이다 — 위 update 의 employee_id 를 실제 계정으로 바꾼 뒤 다시 실행할 것';
  end if;
end $$;

-- ── 3. 읽기 권한 ────────────────────────────────────────────────────────────
-- pbs-rls 마이그레이션이 컬럼 단위 GRANT 로 password 만 막고 나머지를 열어 뒀다.
-- 새 컬럼은 그 GRANT 목록에 없으므로 anon 이 읽지 못할 수 있다 — 명시적으로 연다.
-- is_admin 은 비밀이 아니다(누가 관리자인지는 숨겨서 얻는 게 없다).
grant select (is_admin) on public.pbs to anon, authenticated;

commit;

-- ── 결과 확인 ───────────────────────────────────────────────────────────────
select employee_id, name, is_admin
  from public.pbs
 order by is_admin desc, code;
