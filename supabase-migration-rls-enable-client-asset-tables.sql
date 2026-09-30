-- RLS 가 꺼져 있던 고객 자산 테이블 3개에 RLS 를 켠다 (전면 허용 정책 동반).
--
-- ── 왜 ──────────────────────────────────────────────────────────────────────
-- Supabase 린터가 rls_disabled_in_public 경고를 보냈다. SQL Editor 조회 결과
-- public 스키마에서 relrowsecurity = false 인 테이블은 다음 3개였다:
--
--   테이블                      정책 수   anon 권한
--   client_holdings                0        14
--   client_real_estate             0        14
--   client_real_estate_debt        0        14
--
-- 세 테이블은 저장소에 create table 정의도, enable row level security 문장도
-- 없다 — DB 에서 직접 만들어졌다. 그래서 나머지 26개 테이블과 달리 RLS 가 꺼진
-- 채로 남아 있었다. RLS 가 꺼져 있으면 정책과 무관하게 GRANT 만으로 접근이
-- 결정되고, anon 에 14개 권한이 있으니 사실상 전면 개방 상태다.
-- (research_signals 는 이미 relrowsecurity = true 여서 대상이 아니다.)
--
-- ── 왜 "전면 허용" 정책을 함께 만드는가 ─────────────────────────────────────
-- RLS 만 켜고 정책을 두지 않으면 anon 은 어떤 행도 보지 못한다. 이 세 테이블은
-- 브라우저가 anon 키로 직접 읽고 쓰는 곳이라 곧바로 앱이 깨진다:
--   client_holdings        AssetAllocationBar, HoldingsExtractor, ManualPortfolioBuilder,
--                          lib/advisory/holdingsStore, lib/advisory/ipsHoldingsSync, lib/store
--   client_real_estate     RealEstateModule, AssetAllocationBar, ManualPortfolioBuilder, lib/store
--   client_real_estate_debt RealEstateModule, lib/realestate/handoffDetail, lib/store
-- 읽기뿐 아니라 쓰기(보유종목 추출 저장, 부동산 추가·수정)도 이 경로로 나간다.
--
-- 그래서 이 파일은 "경고를 없애되 동작은 그대로"를 목표로 한다. 기존 26개
-- 테이블과 똑같은 형태(for all using (true) with check (true))를 붙인다.
-- 실질적인 접근 제어는 이 단계에서 할 수 없다 — 이 앱은 Supabase Auth 를 쓰지
-- 않아 auth.uid() 가 항상 NULL 이고, "본인 데이터만" 정책은 DB 수준 신원이
-- 생긴 뒤에야 성립한다. 그 작업은 별도 단계로 잡아 둔 상태다.
--
-- ── 영향이 없는 근거 ────────────────────────────────────────────────────────
-- · service_role(서버 라우트)은 RLS 를 우회한다 — 영향 없음.
-- · record_holding_sale RPC 는 security definer 다(함수 소유자 권한으로 실행).
--   client_holdings 를 읽고 수정하지만 RLS 를 우회하므로 영향 없음.
-- · 이 세 테이블을 참조하는 뷰는 저장소에 없다.
-- · GRANT 는 건드리지 않는다. anon 권한 14개는 그대로 둔다.
--
-- ── 이 파일이 하지 않는 것 ──────────────────────────────────────────────────
-- 테이블·행을 지우지 않는다. drop 은 정책 이름에만 쓴다(같은 이름이 이미 있을
-- 때의 멱등성 확보용). 데이터 DROP/DELETE/TRUNCATE 는 없다.
-- 컬럼·인덱스·제약도 건드리지 않는다.
--
-- 멱등하다. 여러 번 실행해도 결과가 같다.

begin;

do $$
declare
  t            text;
  v_tables     text[] := array['client_holdings', 'client_real_estate', 'client_real_estate_debt'];
  v_rls_before boolean;
  v_rls_after  boolean;
  v_policies   int;
  v_grants     int;
begin
  foreach t in array v_tables loop
    if to_regclass('public.' || t) is null then
      raise notice '[%] 테이블이 없다 — 건너뛴다.', t;
      continue;
    end if;

    -- 적용 전 상태
    select c.relrowsecurity into v_rls_before
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = t;

    select count(*) into v_policies
      from pg_policies where schemaname = 'public' and tablename = t;

    select count(*) into v_grants
      from information_schema.table_privileges
     where table_schema = 'public' and table_name = t
       and grantee in ('anon', 'authenticated', 'PUBLIC');

    raise notice '[%] 적용 전 — rls=% / 정책 %개 / anon·authenticated·PUBLIC 권한 %건',
      t, v_rls_before, v_policies, v_grants;

    -- ① RLS 켜기
    execute format('alter table public.%I enable row level security', t);

    -- ② 같은 이름의 정책이 이미 있으면 지우고 다시 만든다(멱등).
    --    예전 관례인 p_<table> 도 함께 지운다. 정책은 OR 로 합쳐지므로 중복이
    --    남으면 나중에 좁힐 때 조용히 무력화되는 함정이 된다(pbs 의 p_pbs 사례).
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('drop policy if exists %I on public.%I', 'p_' || t, t);

    -- ③ 기존 26개 테이블과 동일한 전면 허용 정책
    execute format(
      'create policy %I on public.%I for all using (true) with check (true)',
      t || '_all', t
    );

    -- 적용 후 상태
    select c.relrowsecurity into v_rls_after
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = t;

    select count(*) into v_policies
      from pg_policies where schemaname = 'public' and tablename = t;

    if v_rls_after and v_policies = 1 then
      raise notice '[%] 적용 후 — rls=% / 정책 %개 (%_all) ✓ 경고 해소, 동작 변화 없음',
        t, v_rls_after, v_policies, t;
    else
      raise warning '[%] 예상과 다르다 — rls=% / 정책 %개. 확인이 필요하다.',
        t, v_rls_after, v_policies;
    end if;
  end loop;
end $$;

commit;

-- PostgREST 스키마 캐시 갱신.
notify pgrst, 'reload schema';

-- ── 적용 후 확인 ①: DB 상태 (SQL Editor) ───────────────────────────────────
-- 세 테이블 모두 rls_enabled = true, policies = 1 이어야 한다.
-- select c.relname as table_name,
--        c.relrowsecurity as rls_enabled,
--        (select count(*) from pg_policies p
--          where p.schemaname='public' and p.tablename=c.relname) as policies,
--        (select string_agg(p.policyname, ', ') from pg_policies p
--          where p.schemaname='public' and p.tablename=c.relname) as policy_names
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname='public'
--    and c.relname in ('client_holdings','client_real_estate','client_real_estate_debt');
--
-- 그리고 public 스키마 전체에 rls_enabled = false 가 남지 않아야 한다(0행 기대).
-- select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity;

-- ── 적용 후 확인 ②: 행이 그대로 보이는지 (SQL Editor) ──────────────────────
-- 적용 전 실측값은 client_holdings 6행, client_real_estate 7행,
-- client_real_estate_debt 2행이었다. anon 역할로 바꿔도 같은 수가 나와야 한다.
-- set role anon;
--   select count(*) from public.client_holdings;          -- 6 기대
--   select count(*) from public.client_real_estate;       -- 7 기대
--   select count(*) from public.client_real_estate_debt;  -- 2 기대
-- reset role;
--
-- 0 이 나오면 정책이 붙지 않은 것이다 — 즉시 아래 롤백을 실행할 것.

-- ── 적용 후 확인 ③: 앱 (화면에서) ──────────────────────────────────────────
-- 읽기
--   · 고객 상세 → 기본 정보: 상단 자산 비중 바에 보유종목·부동산 금액이 뜨는지
--   · 고객 상세 → 기본 정보 → 부동산 자산: 등록된 부동산과 대출이 보이는지
--   · Portfolio Customizing: 보유종목이 표에 뜨는지
-- 쓰기 (읽기보다 이쪽이 중요하다 — with check 가 빠지면 읽기는 되고 쓰기만 깨진다)
--   · 부동산 자산에서 항목 하나를 추가하거나 금액을 수정해 저장
--   · 보유종목에서 매도 1건 처리(record_holding_sale — security definer 라 RLS 무관이지만
--     같은 화면의 목록 재조회가 anon 경로다)
-- 콘솔에 42501 이나 "new row violates row-level security policy" 가 뜨면 실패다.

-- ── 롤백 ────────────────────────────────────────────────────────────────────
-- 적용 전 상태(RLS 꺼짐, 정책 0개)로 되돌린다. 데이터는 건드리지 않는다.
-- begin;
--   alter table public.client_holdings         disable row level security;
--   alter table public.client_real_estate      disable row level security;
--   alter table public.client_real_estate_debt disable row level security;
--   drop policy if exists client_holdings_all         on public.client_holdings;
--   drop policy if exists client_real_estate_all      on public.client_real_estate;
--   drop policy if exists client_real_estate_debt_all on public.client_real_estate_debt;
-- commit;
-- notify pgrst, 'reload schema';
