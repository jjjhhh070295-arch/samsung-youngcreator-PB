-- 승인 해시 초기화 — buildBasicApprovalPayload 에서 assetRevision 을 뺀 뒤 1회 실행
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ⚠️ 실행 순서: 코드 배포 → **그다음에** 이 SQL. 순서를 지키지 않으면 소용이 없다.
--
--    이 SQL 을 먼저 실행하면, 아직 배포되지 않은 구버전 코드가 각 고객을 여는 순간
--    옛 payload(assetRevision 포함)로 해시를 다시 심는다. 그 값은 그 기기의
--    localStorage 카운터에 묶여 있으므로, 우리가 없애려던 상태로 그대로 되돌아간다.
--    신버전이 배포된 뒤에 실행해야 새 payload 로 다시 스탬핑된다.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- ── 왜 필요한가 ──────────────────────────────────────────────────────────────
-- 기본정보 승인 해시(stages.__approvalHashes.basic)는 승인 시점 입력을 djb2 로 묶은
-- 값이다. 그 payload 에 assetRevision(localStorage 카운터)이 들어 있었는데, 기기마다
-- 값이 달라 다른 기기에서 열면 해시가 어긋났다. 그러면 로드 직후 스테일 판정이 나고
-- 승인이 해제되며 그 결과가 DB 에 기록된다 — 자산을 건드리지 않아도 기기만 바꾸면
-- basic 이 풀리고 portfolio·stress·ips 까지 연쇄 해제됐다.
--
-- 코드에서 그 필드를 제거하면 payload 모양이 달라져 저장된 해시와는 어차피 전부
-- 불일치한다. 남겨 두면 배포 직후 전 고객이 한 번씩 스테일로 판정되어 승인이 날아간다.
-- 그래서 해시만 비워 둔다.
--
-- ── 왜 해시 "재계산"이 아니라 "삭제"인가 ────────────────────────────────────
-- 해시 계산은 클라이언트 TS(stableJsonStringify + djb2)에 있고 payload 에 ips·cashFlows
-- jsonb 원본 구조가 들어가서 SQL 로 재현할 수 없다. 대신 앱에 이미 스탬핑 경로가 있다 —
-- app/pb/[pbId]/[clientId]/page.tsx 의 로드 직후 useEffect 가 "승인은 됐는데 해시가
-- 없으면 지금 값으로 계산해 저장"한다. 해시를 비워 두면 각 고객을 처음 여는 시점에
-- 새 payload 로 다시 심긴다. **승인 플래그는 건드리지 않으므로 재승인이 필요 없다.**
--
-- ── 감수해야 할 한계 ────────────────────────────────────────────────────────
-- 스탬핑은 "승인은 유지하되 그 시점 상태를 정답으로 간주"한다. 해시가 비어 있는 사이에
-- 실제로 내용이 바뀌었더라도 스테일로 잡히지 않는다. 이 한 번의 공백이 마음에 걸리면
-- 아래 [대안] 블록을 대신 실행해 전 고객 재승인을 받는다.
--
-- 참고: 2026-09-07 기준 승인 상태인 고객은 7명 중 4명이라 재승인도 현실적인 선택지다.

begin;

-- ── 0. 사전 확인 ────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.parties') is null then
    raise exception 'public.parties 테이블이 없다';
  end if;
end $$;

-- ── 1. 실행 전 상태 ─────────────────────────────────────────────────────────
select
  count(*) filter (where stages ? '__approvalHashes')            as 해시있음,
  count(*) filter (where coalesce((stages->>'basic')::bool, false)) as basic승인,
  count(*)                                                        as 전체
from public.parties
where is_client = true;

-- ── 2. 해시만 제거 ──────────────────────────────────────────────────────────
-- '-' 연산자는 jsonb 에서 키 하나를 빼며 나머지 승인 플래그(basic/portfolio/ips 등)는
-- 그대로 둔다. 승인 상태는 유지되고 해시만 비어 다음 접속 때 다시 심긴다.
update public.parties
   set stages = stages - '__approvalHashes'
 where stages ? '__approvalHashes';

commit;

-- ── 3. 결과 확인 ────────────────────────────────────────────────────────────
-- 해시있음이 0 이고 basic승인 수가 1번과 같아야 한다(승인은 그대로, 해시만 사라짐).
select
  count(*) filter (where stages ? '__approvalHashes')            as 해시있음,
  count(*) filter (where coalesce((stages->>'basic')::bool, false)) as basic승인,
  count(*)                                                        as 전체
from public.parties
where is_client = true;


-- ══════════════════════════════════════════════════════════════════════════════
-- [대안] 승인까지 전부 초기화해 재승인을 받는 경우 — 위 2번 대신 실행한다.
-- 해시 공백 구간의 미검출을 감수하지 않으려면 이쪽이다. PB 가 고객마다 3단계를
-- 다시 승인해야 하므로 사전 공지가 필요하다.
--
-- begin;
-- update public.parties
--    set stages = '{}'::jsonb
--  where is_client = true
--    and stages is not null
--    and stages <> '{}'::jsonb;
-- commit;
-- ══════════════════════════════════════════════════════════════════════════════
