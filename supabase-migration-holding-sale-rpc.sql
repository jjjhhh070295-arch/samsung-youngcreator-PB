-- 매도 처리 RPC — 이력·잔고·AUM 을 한 트랜잭션으로 묶는다 (2단계).
-- 실행: Supabase SQL Editor. 파괴적 삭제 없음. 함수만 추가한다.
-- 선행: supabase-migration-client-holding-trades.sql
--
-- ── 왜 RPC 인가 ────────────────────────────────────────────────────────────
-- 1) assetSize += 실현손익 은 읽고-더하고-쓰는 연산이다. PostgREST 는 컬럼 상대 갱신을
--    지원하지 않아 REST 로 하면 "조회 → 합산 → 쓰기"가 되고, 매도가 겹치거나 클라이언트가
--    쥔 값이 오래되면 한쪽 손익이 통째로 사라진다(lost update). SQL 안에서
--    asset_size = asset_size + delta 로 해야 원자적이다.
-- 2) 이력·잔고·AUM 세 쓰기가 부분 적용되면 안 된다. 하나라도 실패하면 전부 되돌린다.
-- 3) 취득원가를 서버에서 읽는다. 클라이언트가 넘긴 평단을 믿지 않는다 —
--    화면이 오래된 값을 쥐고 있으면 틀린 실현손익이 장부에 확정값으로 남는다.
--
-- ── AUM 이 음수가 되면 거부한다 ─────────────────────────────────────────────
-- 0 으로 눌러 막지 않는다. 조용히 0 이 되면 "왜 자산이 0 인가"의 근거가 사라지고, 그건
-- 이 프로젝트에서 반복해 겪은 조용한 실패다. 예외를 던져 트랜잭션 전체를 되돌리고 PB 에게
-- 알린다 — 아무것도 기록되지 않은 상태가 되므로 자산규모를 정정한 뒤 다시 시도하면 된다.
--
-- ── 멱등성 ─────────────────────────────────────────────────────────────────
-- p_trade_id 가 PK 라 같은 id 로 재시도하면 23505 로 전체가 롤백된다. 응답이 유실된 뒤
-- 재시도해도 AUM 이 두 번 더해지지 않는다.

create or replace function public.record_holding_sale(
  p_trade_id   uuid,
  p_client_id  uuid,
  p_holding_id uuid,
  p_quantity   numeric,
  p_unit_price numeric,
  p_fx_rate    numeric,
  p_traded_at  date,
  p_fee_won    numeric,
  p_tax_won    numeric,
  p_memo       text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_holding     public.client_holdings%rowtype;
  v_cost        numeric;
  v_fx          numeric := coalesce(p_fx_rate, 1);
  v_realized    numeric;
  v_remaining   numeric;
  v_asset_before numeric;
  v_asset_after  numeric;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception '매도 수량은 0보다 커야 합니다.';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception '매도 단가는 0 이상이어야 합니다.';
  end if;
  if v_fx <= 0 then
    raise exception '환율은 0보다 커야 합니다.';
  end if;

  -- 잔고를 잠근다. 같은 종목을 동시에 매도해도 수량이 어긋나지 않는다.
  select * into v_holding
    from public.client_holdings
   where id = p_holding_id and client_id = p_client_id
     for update;
  if not found then
    raise exception '보유종목을 찾을 수 없습니다. 화면을 새로고침한 뒤 다시 시도하세요.';
  end if;

  if p_quantity > v_holding.quantity then
    raise exception '매도 수량이 보유수량(%)을 초과합니다.', v_holding.quantity;
  end if;

  v_cost := v_holding.avg_price;
  if v_cost is null then
    raise exception '평균매입단가가 없어 실현손익을 계산할 수 없습니다. 보유종목의 매입단가를 먼저 채워 주세요.';
  end if;

  v_realized := round(
    p_quantity * (p_unit_price - v_cost) * v_fx
      - coalesce(p_fee_won, 0)
      - coalesce(p_tax_won, 0)
  );

  select asset_size into v_asset_before
    from public.parties
   where id = p_client_id
     for update;
  if not found then
    raise exception '고객을 찾을 수 없습니다.';
  end if;

  v_asset_after := coalesce(v_asset_before, 0) + v_realized;
  if v_asset_after < 0 then
    raise exception
      '실현손실 %원을 반영하면 자산규모가 음수(%원)가 됩니다. 0으로 막지 않고 거부합니다. 자산규모를 먼저 확인·정정한 뒤 다시 시도하세요.',
      v_realized, v_asset_after;
  end if;

  insert into public.client_holding_trades (
    id, client_id, holding_id, ticker, name, market, currency,
    side, quantity, unit_price, fx_rate, traded_at,
    fee_won, tax_won, cost_basis_unit_price, realized_pnl_won, source, memo
  ) values (
    p_trade_id, p_client_id, p_holding_id,
    v_holding.ticker, v_holding.name, v_holding.market, v_holding.currency,
    'sell', p_quantity, p_unit_price, p_fx_rate, p_traded_at,
    coalesce(p_fee_won, 0), coalesce(p_tax_won, 0),
    v_cost, v_realized, 'manual', p_memo
  );

  v_remaining := v_holding.quantity - p_quantity;
  if v_remaining <= 0 then
    -- 전량 매도. 장부(client_holding_trades)에는 남으므로 근거가 사라지지 않는다.
    delete from public.client_holdings where id = p_holding_id;
  else
    -- avg_price 는 건드리지 않는다. 매도는 평단을 바꾸지 않는다 — 남은 수량의 취득원가는
    -- 그대로다. 평단이 바뀌는 것은 매수(가중평균)뿐이다.
    update public.client_holdings set quantity = v_remaining where id = p_holding_id;
  end if;

  update public.parties
     set asset_size = coalesce(asset_size, 0) + v_realized
   where id = p_client_id;

  return jsonb_build_object(
    'tradeId',           p_trade_id,
    'realizedPnlWon',    v_realized,
    'grossProceedsWon',  round(p_quantity * p_unit_price * v_fx),
    'remainingQuantity', greatest(v_remaining, 0),
    'holdingRemoved',    v_remaining <= 0,
    'assetSizeBefore',   coalesce(v_asset_before, 0),
    'assetSizeAfter',    v_asset_after
  );
end;
$$;

comment on function public.record_holding_sale is
  '매도 1건을 이력·잔고·AUM 에 원자적으로 반영한다. 취득원가는 서버가 client_holdings.avg_price 에서 읽는다. AUM 이 음수가 되면 0 으로 막지 않고 예외로 거부한다.';

grant execute on function public.record_holding_sale(
  uuid, uuid, uuid, numeric, numeric, numeric, date, numeric, numeric, text
) to anon, authenticated;
