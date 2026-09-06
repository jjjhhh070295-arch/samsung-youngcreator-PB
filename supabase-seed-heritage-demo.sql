-- ################################################################
-- ##                                                            ##
-- ##            ⚠  데모 전용 — 프로덕션 실행 금지  ⚠            ##
-- ##                                                            ##
-- ##  이 파일은 실데이터가 아니다. 실행하면 가짜 가족 10명,      ##
-- ##  가짜 부동산 325억, 가짜 증여 2건이 DB에 들어간다.          ##
-- ##  고객에게 보이는 환경에서는 절대 실행하지 말 것.            ##
-- ##                                                            ##
-- ##  용도: 헤리티지 수요 점수의 다섯 축(자산·나이·자녀·부동산·  ##
-- ##        증여)이 실제로 작동하는지 확인하기 위한 개발용 시드. ##
-- ##                                                            ##
-- ################################################################
--
-- ================================================================
-- 데모 시드 — 헤리티지 신호 검증용 가족관계·부동산·증여 데이터
-- Supabase SQL Editor에서 전체 실행. 기존 데이터를 지우지 않는다(추가·조정만).
--
-- 배경: 헤리티지 수요 점수는 자산·나이·자녀·부동산·증여 다섯 축으로 설계돼 있는데,
-- 실제 DB에는 party_relationships 0건, transfer_events 0건, client_real_estate_debt
-- 0건, 부동산 2건뿐이라 자산 축 하나만 작동하고 있었다. 게다가 개인 고객 5명이
-- 전원 24~41세라 나이 축도 전부 0점이었다. 그래서 점수 순위가 자산 순위와
-- 똑같아져, 재설계의 핵심인 "다른 신호가 자산 차이를 뒤집는다"를 확인할 수 없었다.
--
-- 이 스크립트는 그 다섯 축이 모두 켜지도록 데모 값을 넣는다. 실데이터가 아니다.
--
-- 재실행 안전: 모든 insert 가 code 유일키 또는 not exists 가드를 쓴다.
--
-- ⚠️ 가족 구성원 party 는 pb_id = null, is_client = false 로 넣는다.
--    PB 고객 북은 assignedPbId(=pb_id)로 거르므로 목록에 뜨지 않는다.
--    다만 lib/store.ts 의 listClients() 는 아직 is_client 를 거르지 않는다 —
--    담당 PB 가 없어 실질적으로는 안 보이지만, 나중에 is_client 필터를 넣는 편이 안전하다.
-- ================================================================

-- 대상 고객 party id (참고용)
--   박서준  6e11dbb0-c5e7-4c27-b1ed-c2f5cefb820c   214억
--   김민재  9079c157-1b9c-41b3-ac67-fc410755bcb2    30억
--   이재용  58e76a63-02c3-4350-b271-6b0a40f3776f  1000억(1조)
--   김석진  6d8af0a3-888a-4cf3-b277-61b9168eaa90   150억
--   이기량  3b793a4c-825a-4103-9344-48648e6dd8c2   350억

begin;

-- ── ① 가족 구성원 party 생성 ──────────────────────────────────────────────
-- code 에 유일 제약이 있어 on conflict 로 재실행을 막는다. 'FAM-' 접두사는
-- 고객 코드 체계(C-YYYY-NNNN)와 겹치지 않아 nextClientCode() 채번에도 영향이 없다.
insert into parties (party_type, display_name, is_client, pb_id, code, asset_size)
values
  ('individual', '이기량 배우자',  false, null, 'FAM-1105-SP',  0),
  ('individual', '이기량 자녀1',   false, null, 'FAM-1105-CH1', 0),
  ('individual', '이기량 자녀2',   false, null, 'FAM-1105-CH2', 0),
  ('individual', '이기량 자녀3',   false, null, 'FAM-1105-CH3', 0),
  ('individual', '김석진 배우자',  false, null, 'FAM-0020-SP',  0),
  ('individual', '김석진 자녀1',   false, null, 'FAM-0020-CH1', 0),
  ('individual', '김석진 자녀2',   false, null, 'FAM-0020-CH2', 0),
  ('individual', '김석진 자녀3',   false, null, 'FAM-0020-CH3', 0),
  ('individual', '박서준 자녀1',   false, null, 'FAM-0008-CH1', 0),
  ('individual', '김민재 배우자',  false, null, 'FAM-0014-SP',  0)
on conflict (code) do nothing;

-- individuals 서브테이블(생년월일). rowToClient 가 개인 판정에 쓴다.
insert into individuals (party_id, birth_date, sub_type)
select p.id, v.birth_date, 'individual'
from (values
  ('FAM-1105-SP',  date '1957-06-02'),
  ('FAM-1105-CH1', date '1983-03-11'),
  ('FAM-1105-CH2', date '1986-09-24'),
  ('FAM-1105-CH3', date '1990-01-30'),
  ('FAM-0020-SP',  date '1960-11-15'),
  ('FAM-0020-CH1', date '1988-05-07'),
  ('FAM-0020-CH2', date '1991-12-19'),
  ('FAM-0020-CH3', date '1995-08-03'),
  ('FAM-0008-CH1', date '1979-04-21'),
  ('FAM-0014-SP',  date '2001-07-09')
) as v(code, birth_date)
join parties p on p.code = v.code
on conflict (party_id) do nothing;

-- ── ② 고객 생년월일 조정 — 나이 축이 실제로 갈리게 ────────────────────────
-- 현재 전원 24~41세라 나이 가산(45세부터)이 전부 0이었다. 60~70대를 섞는다.
-- 이재용(36세)·김민재(26세)는 그대로 둔다 — "나이 가산 0" 대조군이 필요하다.
update individuals set birth_date = date '1948-02-01' where party_id = '6e11dbb0-c5e7-4c27-b1ed-c2f5cefb820c'; -- 박서준 만78세
update individuals set birth_date = date '1957-03-03' where party_id = '6d8af0a3-888a-4cf3-b277-61b9168eaa90'; -- 김석진 만69세
update individuals set birth_date = date '1953-04-18' where party_id = '3b793a4c-825a-4103-9344-48648e6dd8c2'; -- 이기량 만73세

-- ── ③ 가족관계 ────────────────────────────────────────────────────────────
-- 방향 규칙: from = 고객, to = 가족. child 는 from=부모 → to=자녀.
-- resolveHeritageInputsBulk 는 valid_to is null 인 행만 읽는다.
-- 구성을 일부러 다르게 둔다 — 배우자 유무와 자녀 수가 점수에 어떻게 다르게 박히는지
-- 보려면 같은 구성이면 안 된다.
--   이기량 : 배우자 O, 자녀 3  (자녀 가산 +6 대상)
--   김석진 : 배우자 O, 자녀 3  (자녀 가산 +6 대상)
--   박서준 : 배우자 미등록,    자녀 1  (3명 미만 → 자녀 가산 없음)
--   김민재 : 배우자 O,         자녀 미등록(→ 2명 가정, 가산 없음)
--   이재용 : 전부 미등록       (→ 전부 가정, 가산 없음)
insert into party_relationships (from_party_id, to_party_id, relation_type)
select v.from_id::uuid, p.id, v.rel
from (values
  ('3b793a4c-825a-4103-9344-48648e6dd8c2', 'FAM-1105-SP',  'spouse'),
  ('3b793a4c-825a-4103-9344-48648e6dd8c2', 'FAM-1105-CH1', 'child'),
  ('3b793a4c-825a-4103-9344-48648e6dd8c2', 'FAM-1105-CH2', 'child'),
  ('3b793a4c-825a-4103-9344-48648e6dd8c2', 'FAM-1105-CH3', 'child'),
  ('6d8af0a3-888a-4cf3-b277-61b9168eaa90', 'FAM-0020-SP',  'spouse'),
  ('6d8af0a3-888a-4cf3-b277-61b9168eaa90', 'FAM-0020-CH1', 'child'),
  ('6d8af0a3-888a-4cf3-b277-61b9168eaa90', 'FAM-0020-CH2', 'child'),
  ('6d8af0a3-888a-4cf3-b277-61b9168eaa90', 'FAM-0020-CH3', 'child'),
  ('6e11dbb0-c5e7-4c27-b1ed-c2f5cefb820c', 'FAM-0008-CH1', 'child'),
  ('9079c157-1b9c-41b3-ac67-fc410755bcb2', 'FAM-0014-SP',  'spouse')
) as v(from_id, to_code, rel)
join parties p on p.code = v.to_code
where not exists (
  select 1 from party_relationships r
  where r.from_party_id = v.from_id::uuid
    and r.to_party_id   = p.id
    and r.relation_type = v.rel
);

-- ── ④ 부동산 추가 — 부동산 비중 70% 문턱을 넘기는 케이스를 만든다 ─────────
-- 현재 부동산은 박서준 29.6억(비중 14%), 김석진 33.5억(비중 22%) 둘뿐이라
-- realEstateHighWeightPct(70%)에 아무도 못 닿았다.
--   이기량 : 250억 추가 → 250/350 = 71.4%  (+6, 긴급도도 한 단계 상향)
--   김석진 :  75억 추가 → (33.5+75)/150 = 72.3%  (+6)
-- 박서준은 일부러 그대로 둔다(부동산 신호 없는 고령 고객 대조군).
insert into client_real_estate (
  client_id, owner_party_id, property_type, address, ownership_type, ownership_share,
  usage, market_value, market_source, market_confidence, source
)
select v.owner::uuid, v.owner::uuid, v.ptype, v.addr, 'sole', 1,
       v.usage, v.mv, 'manual', 'medium', 'manual'
from (values
  ('3b793a4c-825a-4103-9344-48648e6dd8c2', 'apartment', '서울 강남구 대치동 (데모)', 'primary_residence', 15000000000::numeric),
  ('3b793a4c-825a-4103-9344-48648e6dd8c2', 'land',      '경기 용인시 처인구 (데모)', 'investment',        10000000000::numeric),
  ('6d8af0a3-888a-4cf3-b277-61b9168eaa90', 'apartment', '서울 서초구 반포동 (데모)', 'primary_residence',  7500000000::numeric)
) as v(owner, ptype, addr, usage, mv)
where not exists (
  select 1 from client_real_estate re
  where re.owner_party_id = v.owner::uuid and re.address = v.addr
);

-- ── ⑤ 담보대출 ────────────────────────────────────────────────────────────
-- client_real_estate_debt 가 0건이라 debtWon 이 항상 0이었다. 채무는 수요 점수에는
-- 안 들어가고 세액 구간(estimateInheritanceTaxRange)에서만 차감된다 — 그 경로가
-- 실제로 도는지 보려면 값이 있어야 한다.
insert into client_real_estate_debt (property_id, lender, balance, interest_rate, rate_type, maturity_date, source, confidence)
select re.id, v.lender, v.balance, v.rate, 'fixed', v.maturity, 'manual', 'medium'
from (values
  ('6e11dbb0-c5e7-4c27-b1ed-c2f5cefb820c', '국민은행', 1200000000::numeric, 3.8::numeric, date '2031-06-30'),
  ('6d8af0a3-888a-4cf3-b277-61b9168eaa90', '신한은행', 1800000000::numeric, 4.1::numeric, date '2033-03-31')
) as v(owner, lender, balance, rate, maturity)
join lateral (
  -- 그 고객의 부동산 중 가장 먼저 등록된 1건에 붙인다.
  select id from client_real_estate where owner_party_id = v.owner::uuid order by created_at limit 1
) re on true
where not exists (
  select 1 from client_real_estate_debt d where d.property_id = re.id and d.lender = v.lender
);

-- ── ⑥ 증여 이력 — 10년 내 2건 ─────────────────────────────────────────────
-- 10년 합산과세 대상이라 수요 점수 +9, 긴급도 한 단계 상향, 세액 구간에도 가산된다.
-- 일부러 두 명에게만 넣는다 — 증여 있는 고객과 없는 고객이 갈려야 신호가 보인다.
insert into transfer_events (event_type, from_party_id, to_party_id, asset_kind, amount, event_date, note)
select 'gift', v.from_id::uuid, p.id, v.kind, v.amount, v.dt, v.note
from (values
  ('3b793a4c-825a-4103-9344-48648e6dd8c2', 'FAM-1105-CH1', 'cash',  1200000000::numeric, current_date - interval '6 years',  '데모: 장남 사업자금 증여'),
  ('6d8af0a3-888a-4cf3-b277-61b9168eaa90', 'FAM-0020-CH1', 'stock',  800000000::numeric, current_date - interval '8 years',  '데모: 장남 주식 증여')
) as v(from_id, to_code, kind, amount, dt, note)
join parties p on p.code = v.to_code
where not exists (
  select 1 from transfer_events t
  where t.from_party_id = v.from_id::uuid and t.to_party_id = p.id and t.note = v.note
);

commit;

-- ── 결과 확인 ─────────────────────────────────────────────────────────────
select '① 가족 party'      as 항목, count(*) as 행수 from parties where code like 'FAM-%'
union all
select '② 가족관계',        count(*) from party_relationships
union all
select '③ 부동산',          count(*) from client_real_estate
union all
select '④ 담보대출',        count(*) from client_real_estate_debt
union all
select '⑤ 증여이력',        count(*) from transfer_events;

-- 고객별 입력 신호 요약 — 앱의 점수와 대조할 때 쓴다.
select
  p.code,
  p.display_name                                              as 이름,
  round(p.asset_size / 100000000.0)                           as 자산억,
  date_part('year', age(i.birth_date))::int                   as 만나이,
  exists (select 1 from party_relationships r
           where r.from_party_id = p.id and r.relation_type = 'spouse'
             and r.valid_to is null)                          as 배우자,
  (select count(*) from party_relationships r
    where r.from_party_id = p.id and r.relation_type = 'child'
      and r.valid_to is null)                                 as 자녀수,
  coalesce((select round(sum(re.market_value * re.ownership_share) / 100000000.0)
              from client_real_estate re where re.owner_party_id = p.id), 0) as 부동산억,
  (select count(*) from transfer_events t
    where t.from_party_id = p.id and t.event_type = 'gift'
      and t.event_date >= current_date - interval '10 years')  as 증여건수
from parties p
left join individuals i on i.party_id = p.id
where p.party_type = 'individual' and p.is_client = true
order by p.asset_size desc;
