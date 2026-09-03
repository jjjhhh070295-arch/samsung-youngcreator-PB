-- pbs 테이블 권한 잠그기 — anon 이 password 컬럼을 읽지 못하게 한다.
--
-- ── 배경 ────────────────────────────────────────────────────────────────────
-- 예전 listPbs()는 select("*")로 pbs 전체를 읽었고 로그인 화면이 로그인 전에 그걸
-- 호출했다. 앱 쪽은 커밋 6012074에서 읽기 컬럼을 화이트리스트로 고쳤지만, 그건
-- "앱이 흘리지 않게" 한 것뿐이다. anon 키는 클라이언트 번들에 그대로 들어 있으므로
-- 누구나 GET /rest/v1/pbs?select=* 를 직접 호출하면 전 PB 비밀번호를 그대로 받는다.
-- 실제 차단은 DB에서만 가능하다 — 이 파일이 그 부분이다.
--
-- ── 왜 "anon SELECT 전면 차단"이 아닌가 ────────────────────────────────────
-- pbs 를 anon 이 아예 못 읽게 막으면 앱이 통째로 멈춘다. listPbs()를 부르는 곳:
--   app/pb/[pbId]/page.tsx            PB 페이지(담당 PB 표시·계정 관리)
--   app/pb/[pbId]/[clientId]/page.tsx 고객 상세 헤더
--   app/pb/[pbId]/[clientId]/ips/page.tsx
--   components/AppNav.tsx             상단 네비의 PB 이름
--   components/PortfolioPanel.tsx     포트폴리오 작성자 표기
--   components/advisory/ConsultationHub.tsx
--   app/page.tsx                      로그인 후 관리자 패널("등록된 PB N명")
-- 이 화면들이 필요로 하는 건 id/code/name 뿐이고 password 는 하나도 안 쓴다.
-- 그래서 테이블 단위가 아니라 "컬럼 단위"로 끊는다 — password 만 못 읽게 하고
-- 나머지 컬럼은 그대로 열어 둔다. 로그인 검증은 아래 SECURITY DEFINER 함수로 옮긴다.
--
-- ── 코드 쪽 준비 상태 ──────────────────────────────────────────────────────
-- lib/store.ts 의 authenticatePb()는 이미 supabase.rpc("authenticate_pb", …) 를 호출한다.
-- 함수가 없는 환경에서는 예전 컬럼 필터 방식으로 자동 폴백하므로, 코드 배포와 이 파일
-- 실행의 순서는 상관없다(로그인이 죽지 않는다).
-- 다만 이 파일을 실행하기 전까지는 그 폴백 경로가 돌기 때문에 상태는 그대로다 —
-- anon 이 password 컬럼을 읽을 수 있고, 비밀번호가 요청 URL(?password=eq.…)로 나간다.
-- 실행해야 비로소 닫힌다.
--
-- ⚠️ 다른 브랜치 영향 ───────────────────────────────────────────────────────
-- origin/feat/pb-main-research-integration-v2 와 origin/feat/pb-macro-evidence-trends 의
-- lib/store.ts 는 아직 pbs 를 select("*") 로 읽고, lib/auth/pbAccess.server.ts 는
-- select("id, name, employee_id, password") 를 한다. 둘 다 이 마이그레이션 적용 후
-- anon 키로는 실패한다(서버에서 service_role 키로 돌면 컬럼 권한을 우회하므로 무관).
-- 머지 전에 Yestar1127 과 맞춰야 한다.

begin;

-- ── 0. 사전 확인 ────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.pbs') is null then
    raise exception 'public.pbs 테이블이 없다 — supabase.sql 을 먼저 실행할 것';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'pbs' and column_name = 'password'
  ) then
    raise notice 'pbs.password 컬럼이 없다 — 컬럼 권한 부분은 사실상 무의미하지만 그대로 진행한다';
  end if;
end $$;

-- ── 1. RLS ─────────────────────────────────────────────────────────────────
-- 이 프로젝트의 다른 테이블(parties/households/daily_reports)과 같은 관례로
-- 행 단위는 전부 허용한다. RLS 에는 컬럼 개념이 없어서 password 차단은 여기서
-- 못 한다 — 실제 방어는 2번의 컬럼 단위 GRANT 다. RLS 를 켜 두는 건 나중에
-- 서버 세션(app/api/auth/session)이 들어와 "본인 행만" 같은 정책을 붙일 자리를
-- 미리 만들어 두는 의미다.
alter table public.pbs enable row level security;

drop policy if exists "pbs_all" on public.pbs;
create policy "pbs_all" on public.pbs for all using (true) with check (true);

-- ── 2. 컬럼 단위 권한 ───────────────────────────────────────────────────────
-- password 를 뺀 나머지 컬럼만 읽게 한다. 쓰기는 password 를 포함해 허용한다
-- (비밀번호 "쓰기"는 유출이 아니고, PB 계정 관리 모달의 생성·수정이 여기 의존한다).
-- id/created_at 은 DB 기본값으로 채워지므로 쓰기 대상에서 제외한다.
-- email/title/phone 은 모닝 브리핑 마이그레이션 전이면 없을 수 있어 동적으로 만든다.
do $$
declare
  v_read_cols  text;
  v_write_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_read_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'pbs'
     and column_name <> 'password';

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_write_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'pbs'
     and column_name not in ('id', 'created_at');

  execute 'revoke all on table public.pbs from anon, authenticated';
  execute format('grant select (%s) on table public.pbs to anon, authenticated', v_read_cols);
  execute format('grant insert (%s) on table public.pbs to anon, authenticated', v_write_cols);
  execute format('grant update (%s) on table public.pbs to anon, authenticated', v_write_cols);
  execute 'grant delete on table public.pbs to anon, authenticated';

  raise notice 'pbs 읽기 허용 컬럼: %', v_read_cols;
  raise notice 'pbs 쓰기 허용 컬럼: %', v_write_cols;
end $$;

-- ── 3. 로그인 검증 함수 ─────────────────────────────────────────────────────
-- SECURITY DEFINER 로 소유자 권한에서 password 를 대조하고, 결과에서는 password 키를
-- 빼고 돌려준다. 호출자는 비밀번호를 읽을 수도, 필터링할 수도 없다.
-- 반환을 jsonb 로 둔 이유: email/title/phone 유무에 따라 컬럼 구성이 달라지는데
-- 고정 RETURNS TABLE 로 두면 마이그레이션 상태마다 함수를 고쳐야 한다.
-- 매칭 실패 시 NULL. 사원번호 대소문자·공백은 앱의 기존 동작(trim + upper)과 맞춘다.
create or replace function public.authenticate_pb(p_employee_id text, p_password text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $fn$
  select to_jsonb(p) - 'password'
    from public.pbs p
   where upper(btrim(p.employee_id)) = upper(btrim(p_employee_id))
     and p.password = btrim(p_password)
     and btrim(coalesce(p_password, '')) <> ''      -- 빈 비밀번호로 빈 값 계정에 붙는 것 차단
     and coalesce(p.password, '') <> ''
   limit 1;
$fn$;

comment on function public.authenticate_pb(text, text) is
  'PB 로그인 검증. password 를 노출하지 않고 대조만 한다. lib/store.ts 의 authenticatePb() 가 호출.';

revoke all on function public.authenticate_pb(text, text) from public;
grant execute on function public.authenticate_pb(text, text) to anon, authenticated;

commit;

-- PostgREST 스키마 캐시 갱신 — 이걸 안 하면 새 함수가 잠시 PGRST202("함수 없음")로
-- 보이고, 그동안 앱은 예전 컬럼 필터 경로로 폴백해 로그인만 계속 실패한다.
notify pgrst, 'reload schema';

-- ── 검증 (적용 후 따로 실행) ────────────────────────────────────────────────
-- 1) password 가 읽기 권한에서 빠졌는지
-- select grantee, privilege_type, column_name
--   from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'pbs'
--    and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT'
--  order by grantee, column_name;
--
-- 2) anon 으로 password 를 읽으면 거부되는지 (거부돼야 정상)
-- set role anon;  select password from public.pbs limit 1;  -- ERROR 기대
-- set role anon;  select id, code, name from public.pbs limit 1;  -- 정상 기대
-- reset role;
--
-- 3) 로그인 함수 (데모 계정)
-- select public.authenticate_pb('PB-001', '1234');   -- password 키 없는 jsonb 기대
-- select public.authenticate_pb('PB-001', 'wrong');  -- null 기대

-- ── 롤백 ────────────────────────────────────────────────────────────────────
-- begin;
--   drop function if exists public.authenticate_pb(text, text);
--   grant all on table public.pbs to anon, authenticated;
--   alter table public.pbs disable row level security;
-- commit;
