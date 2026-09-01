-- ================================================================
-- client_real_estate / client_holdings: owner_party_id 백필
-- Supabase SQL Editor에서 실행 (기존 값은 건드리지 않음, NULL만 채움)
-- ================================================================
--
-- 목적: owner_party_id 가 비어 있어 부동산·보유종목이 "0"으로 조회되는 문제를 고친다.
--
-- 왜 비어 있나:
--   supabase-migration-parties.sql 의 7번에서 두 테이블에 owner_party_id 컬럼을 추가하고
--   8번에서 client_id 를 그대로 복사하는 백필을 넣어 뒀는데, 그 8번이 실행되지 않았거나
--   실행 이후에 만들어진 행들이 남아 있다. 2026-09-01 확인 시점에
--   client_real_estate 5행 전체가 owner_party_id IS NULL 이었다.
--   components/RealEstateModule.tsx 는 신규 저장 시 client_id 와 owner_party_id 를 함께
--   채우므로 앞으로 만드는 행은 정상이다 — 문제는 그 코드 이전에 쌓인 기존 행들이다.
--
-- 무엇이 깨지고 있나:
--   lib/store.ts 의 listRealEstateWithDebtBulk() 는 client_real_estate 를 owner_party_id
--   로 조회한다(.in("owner_party_id", ...)). 컬럼이 NULL 이면 아무 행도 매칭되지 않아
--   부동산 평가액과 담보대출이 0원으로 계산된다.
--   반면 components/AssetAllocationBar.tsx 와 components/PortfolioPanel.tsx 는 client_id
--   로 조회해서 정상 값을 얻는다 — 그래서 화면마다 부동산 값이 다르게 나온다.
--   (예: 박기만 고객 — 화면 상단 비중 바는 부동산 182.8억, 헤리티지 판정은 0원)
--
-- ⚠️ 헤리티지에 미치는 영향 — 이게 가장 중요하다.
--   lib/heritage/resolveBulk.ts 가 위 함수를 그대로 쓴다. 따라서 현재 모든 고객의
--   헤리티지 판정이 "부동산 0%, 담보대출 0원"으로 계산되고 있다:
--     · realEstateWeightPct = 0
--       → lib/heritage/demand.ts 의 부동산 과다 가산(비중 70% 이상, +6점)이 절대 발동하지 않는다.
--       → lib/heritage/urgency.ts 의 긴급도 1단계 상향(비중 70% 이상)도 절대 발동하지 않는다.
--         부동산이 많아 납부재원이 부족한 고객일수록 상담이 급한데, 정작 그 신호가 꺼져 있다.
--     · debtWon = 0
--       → lib/heritage/tax.ts 가 순자산(총자산 − 채무)을 계산할 때 담보대출을 빼지 못해
--         상속세 구간이 과대 추정된다. (client_real_estate_debt 는 현재 0행이라 당장은
--         차이가 없지만, 채무 데이터를 넣기 시작하면 즉시 문제가 된다.)
--   즉 이 백필 한 번으로 자산 화면과 헤리티지 판정이 함께 정상화된다.
--
-- 안전성:
--   · WHERE owner_party_id IS NULL 이라 이미 채워진 행은 건드리지 않는다. 재실행해도 안전하다.
--   · client_id 와 parties.id 는 같은 UUID 를 쓴다(supabase-migration-parties.sql 4번에서
--     clients.id 를 그대로 parties.id 로 복사했다). 그래서 단순 복사로 충분하다.
--   · owner_party_id 는 parties(id) 를 참조하는 FK 다. client_id 에 대응하는 parties 행이
--     없으면 이 UPDATE 가 실패한다 — 아래 0번 사전 점검으로 먼저 확인한다.

-- ── 0. 사전 점검 — parties 에 없는 client_id 가 있으면 여기서 먼저 걸린다 ──
--    행수가 0이 아니면 UPDATE 를 실행하지 말고 해당 행을 먼저 정리할 것.
select '⓪ parties 에 없는 client_id (real_estate)' as 항목, count(*) as 행수
from client_real_estate re
where re.owner_party_id is null
  and not exists (select 1 from parties p where p.id = re.client_id)
union all
select '⓪ parties 에 없는 client_id (holdings)', count(*)
from client_holdings h
where h.owner_party_id is null
  and not exists (select 1 from parties p where p.id = h.client_id);

-- ── 1. 백필 ──
update client_real_estate set owner_party_id = client_id where owner_party_id is null;
update client_holdings     set owner_party_id = client_id where owner_party_id is null;

-- ── 2. 결과 확인 ──
--    ②④ 가 0이 되어야 정상이다.
select '① real_estate 전체'                as 항목, count(*) as 행수 from client_real_estate
union all
select '② real_estate - owner_party_id NULL',        count(*) from client_real_estate where owner_party_id is null
union all
select '③ holdings 전체',                            count(*) from client_holdings
union all
select '④ holdings - owner_party_id NULL',           count(*) from client_holdings where owner_party_id is null
union all
select '⑤ real_estate - client_id 와 불일치',        count(*) from client_real_estate where owner_party_id is distinct from client_id
union all
select '⑥ holdings - client_id 와 불일치',           count(*) from client_holdings where owner_party_id is distinct from client_id
order by 항목;
