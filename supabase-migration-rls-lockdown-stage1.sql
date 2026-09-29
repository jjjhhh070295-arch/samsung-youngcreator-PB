-- RLS 잠그기 1단계 — kis_token_cache 를 anon 에서 차단한다.
--
-- ── 무엇을 왜 ───────────────────────────────────────────────────────────────
-- kis_token_cache 는 한국투자증권(KIS) OAuth 접근토큰 캐시다. 토큰은 그 자체로
-- 자격증명이라, anon 키로 읽히면 누구나 우리 KIS 계정으로 API 를 호출할 수 있다.
-- anon 키는 NEXT_PUBLIC_ 이라 배포된 사이트의 번들에 그대로 들어 있다 — 저장소를
-- 공개하지 않아도 이미 얻을 수 있는 값이다. 그래서 DB 에서 막아야 한다.
--
-- ── 앱에 영향이 없는 근거 ───────────────────────────────────────────────────
-- 이 테이블을 다루는 코드는 lib/pricing/kis-token.ts 한 곳뿐이고, 거기서
-- SUPABASE_SERVICE_ROLE_KEY 로 별도 클라이언트를 만들어 쓴다(getSupabaseAdmin).
-- service_role 은 RLS 를 우회하고, 아래 회수 대상(anon/authenticated/public)에도
-- 들어 있지 않다. 브라우저 코드(lib/store.ts → lib/supabase.ts 의 anon 클라이언트)는
-- 이 테이블을 건드리지 않는다.
--
-- ── 1차 실행에서 무슨 일이 있었나 (2026-09-29) ─────────────────────────────
-- 실행 결과가 rls_on=true, policy_count=0 이었으므로 do 블록은 정상 실행됐다.
-- 그런데 anon 에 SELECT/INSERT/DELETE/TRUNCATE/REFERENCES/TRIGGER 권한이 그대로
-- 남아 있었다. revoke 만 아무 일도 하지 않은 것이다.
--
-- 원인: PostgreSQL 의 revoke 는 "자기가 부여한 권한"만 회수한다. Supabase 에서
-- public 스키마의 테이블 권한은 보통 supabase_admin 이 부여하는데, SQL Editor 는
-- postgres 로 실행된다. 부여자가 다르면 revoke 는 ERROR 가 아니라 WARNING
-- ("no privileges could be revoked for ...") 만 내고 조용히 통과한다 — 그래서
-- 실행은 성공한 것처럼 보이고 권한은 그대로 남는다.
--
-- 그래서 이번 판은 ① 실행 역할·소유자·부여자를 먼저 찍고 ② 회수한 뒤
-- ③ 정말 사라졌는지 다시 세어서, 남아 있으면 이유와 다음 수단을 알려 준다.
--
-- ── 지금도 읽기는 이미 막혀 있다 ───────────────────────────────────────────
-- RLS 가 켜져 있고 정책이 0개면 anon 은 어떤 행도 읽거나 쓸 수 없다(RLS 거부는
-- 오류가 아니라 빈 결과로 나온다). 즉 토큰 유출은 이미 차단된 상태다.
-- 그럼에도 권한을 회수하려는 이유는 두 가지다:
--   · TRUNCATE 는 RLS 의 적용을 받지 않는다. anon 에게 TRUNCATE 가 남아 있으면
--     토큰 캐시를 통째로 비울 수 있다(유출은 아니지만 방해는 된다).
--   · 나중에 누군가 이 테이블에 정책을 하나 추가하는 순간 다시 열린다.
--     권한까지 닫아 두면 그 사고가 나지 않는다.
--
-- ── 이 파일이 하지 않는 것 ──────────────────────────────────────────────────
-- 테이블·행을 지우지 않는다. drop 은 정책 이름에만 쓴다 — Postgres 에서 정책을
-- 교체하려면 drop policy 외의 방법이 없다. 데이터 DROP/DELETE/TRUNCATE 는 없다.
-- 고객 데이터 테이블(parties·consultations·client_holdings 등)은 손대지 않는다.
-- 그쪽은 브라우저가 anon 으로 직접 읽고 쓰기 때문에, 좁히면 앱이 멈춘다.
-- "본인 데이터만" 정책은 DB 수준의 신원(Supabase Auth 또는 서버 세션)이 생긴
-- 뒤에야 가능하다 — auth.uid() 가 지금은 항상 NULL 이다.
--
-- 멱등하다. 여러 번 실행해도 결과가 같다.

begin;

do $$
declare
  r          record;
  v_owner    text;
  v_grantors text;
  v_before   int;
  v_after    int;
  v_left     text;
begin
  if to_regclass('public.kis_token_cache') is null then
    raise notice 'kis_token_cache 테이블이 없다 — 건너뛴다(KIS 캐시를 쓰지 않는 환경).';
    return;
  end if;

  -- ── ① 진단: 누가 실행 중이고, 누가 소유자이며, 누가 권한을 줬는가 ────────
  select tableowner into v_owner
    from pg_tables where schemaname = 'public' and tablename = 'kis_token_cache';

  select string_agg(distinct grantor, ', ') into v_grantors
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'kis_token_cache'
     and grantee in ('anon', 'authenticated', 'PUBLIC');

  select count(*) into v_before
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'kis_token_cache'
     and grantee in ('anon', 'authenticated', 'PUBLIC');

  raise notice '실행 역할=% / 테이블 소유자=% / 권한 부여자=% / 회수 대상 권한 %건',
    current_user, v_owner, coalesce(v_grantors, '(없음)'), v_before;

  -- ── ② RLS 를 켜고 정책을 모두 제거한다 (이미 됐으면 그대로) ──────────────
  execute 'alter table public.kis_token_cache enable row level security';

  for r in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'kis_token_cache'
  loop
    execute format('drop policy %I on public.kis_token_cache', r.policyname);
    raise notice '정책 제거: %', r.policyname;
  end loop;

  -- ── ③ 권한 회수 ─────────────────────────────────────────────────────────
  -- public 을 함께 넣는다. PUBLIC 에 부여돼 있으면 anon 만 회수해서는 뚫린 채 남는다.
  -- 권한 종류를 나열하지 않고 all 로 한 번에 회수한다(TRUNCATE·REFERENCES·TRIGGER 포함).
  execute 'revoke all on table public.kis_token_cache from anon';
  execute 'revoke all on table public.kis_token_cache from authenticated';
  execute 'revoke all on table public.kis_token_cache from public';

  -- ── ④ 검증: 정말 사라졌는가 ─────────────────────────────────────────────
  select count(*), string_agg(distinct grantee || ':' || privilege_type, ', ')
    into v_after, v_left
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'kis_token_cache'
     and grantee in ('anon', 'authenticated', 'PUBLIC');

  if v_after = 0 then
    raise notice '✓ 회수 완료 — anon/authenticated/PUBLIC 권한 0건. RLS 와 권한 두 겹 모두 닫혔다.';
  else
    raise warning '⚠ 권한이 %건 남았다: %', v_after, v_left;
    raise warning '  실행 역할(%)이 부여자(%)가 아니어서 revoke 가 무시된 것이다.',
      current_user, coalesce(v_grantors, '(확인 불가)');
    raise warning '  → 읽기·쓰기는 RLS(정책 0개)로 이미 막혀 있으니 유출 위험은 없다.';
    raise warning '  → 권한까지 닫으려면 부여자 역할로 실행해야 한다. 파일 하단 "부여자가 다를 때" 참고.';
  end if;
end $$;

commit;

-- PostgREST 스키마 캐시 갱신.
notify pgrst, 'reload schema';

-- ── 부여자가 다를 때 (위에서 ⚠ 가 떴다면) ──────────────────────────────────
-- 아래를 순서대로 시도한다. 한 줄씩 따로 실행해도 된다.
--
-- 1) 부여자 역할로 바꿔서 회수 — postgres 가 그 역할의 멤버면 된다.
--    begin;
--      set local role supabase_admin;   -- 위 notice 에 찍힌 부여자 이름으로
--      revoke all on table public.kis_token_cache from anon, authenticated, public;
--    commit;
--
-- 2) 1 이 "permission denied to set role" 로 막히면, 소유자를 옮긴 뒤 회수한다.
--    소유자는 자기 테이블의 모든 권한을 회수할 수 있다.
--    begin;
--      alter table public.kis_token_cache owner to postgres;
--      revoke all on table public.kis_token_cache from anon, authenticated, public;
--    commit;
--
-- 3) 둘 다 막히면 그대로 두어도 된다. RLS 가 정책 0개로 켜져 있는 한 anon 은
--    행을 읽지도 쓰지도 못한다. 남는 위험은 TRUNCATE 뿐이고, 그건 토큰 캐시를
--    비우는 것이라 다음 호출에서 재발급된다. 이 경우 Supabase 지원에 문의하거나
--    2단계(서버 라우트를 service_role 로 전환)와 함께 처리한다.

-- ── 적용 후 확인 (따로 실행) ────────────────────────────────────────────────
-- 1) RLS 켜짐 + 정책 0개
-- select c.relrowsecurity as rls_on,
--        (select count(*) from pg_policies p
--          where p.schemaname='public' and p.tablename='kis_token_cache') as policy_count
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname='public' and c.relname='kis_token_cache';
--
-- 2) anon/authenticated/PUBLIC 권한 0건 기대
-- select grantee, grantor, privilege_type
--   from information_schema.table_privileges
--  where table_schema='public' and table_name='kis_token_cache'
--  order by grantee, privilege_type;
--
-- 3) service_role 경로는 살아 있어야 한다 — 앱 티커분석에서 005930 을 조회해
--    시세가 나오면 정상이다(KIS 토큰 발급·캐시가 이 테이블을 쓴다).

-- ── 롤백 ────────────────────────────────────────────────────────────────────
-- begin;
--   grant all on table public.kis_token_cache to anon, authenticated;
--   create policy kis_token_cache_all on public.kis_token_cache
--     for all using (true) with check (true);
-- commit;
-- notify pgrst, 'reload schema';
