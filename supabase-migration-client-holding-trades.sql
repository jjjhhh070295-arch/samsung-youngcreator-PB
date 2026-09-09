-- 보유종목 거래 이력 (매수·매도). client_holdings 와 분리된 append-only 장부.
-- 실행: Supabase SQL Editor. 파괴적 삭제 없음. 새 테이블만 추가한다.
--
-- ── 왜 별도 테이블인가 ──────────────────────────────────────────────────────
-- client_holdings 는 "현재 잔고 스냅샷"이다. 행 하나가 종목 하나의 현재 상태만 담고,
-- 매수 때마다 avg_price 가 가중평균으로 병합돼(lib/advisory/ipsHoldingsSync.ts) 개별
-- 취득 건이 소멸한다. 그래서 그 테이블만으로는 "얼마에 사서 얼마에 팔았나"를 알 수 없고,
-- 매도하면 그 종목을 보유했다는 사실 자체가 사라진다(하드 DELETE, 소프트 삭제 없음).
--
-- 실현손익·취득가액 추적·세무 신고는 전부 거래 단위 기록을 요구한다. 그래서 잔고와
-- 별개로 장부를 둔다. 이 테이블은 append-only 로 다룬다 — 정정은 반대 거래로 하고,
-- 과거 행을 고치지 않는다.
--
-- ── 매수도 함께 적는 이유 ───────────────────────────────────────────────────
-- 매도만 적으면 부분 매도 시 어느 로트를 판 것인지 알 수 없고, 전량 매도 후 재매수하면
-- client_holdings 행이 사라졌다 새로 생겨 연속성이 끊긴다. side 로 양쪽을 담는다.
--
-- ── 1단계 범위 ─────────────────────────────────────────────────────────────
-- 이 마이그레이션과 짝이 되는 코드(lib/holdings/trades.ts)는 이력 기록과 잔고 차감까지만
-- 한다. parties.asset_size(AUM)는 건드리지 않는다 — 2단계 사안이다.

create table if not exists public.client_holding_trades (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.parties(id) on delete cascade,

  -- 체결 당시의 client_holdings 행. 전량 매도로 그 행이 사라지면 남은 값은 고아가 되므로
  -- FK 를 걸지 않는다. 장부는 잔고보다 오래 살아야 한다.
  holding_id    uuid,

  ticker        text,
  name          text not null,
  market        text,
  currency      text not null default 'KRW',

  side          text not null check (side in ('buy', 'sell')),
  quantity      numeric not null check (quantity > 0),
  unit_price    numeric not null check (unit_price >= 0),

  -- 외화 종목의 원화 환산율. 체결 시점 값을 박아 둔다 — 나중 환율로 과거 손익이
  -- 흔들리면 안 된다. KRW 는 null(=1 로 취급).
  fx_rate       numeric,

  traded_at     date not null,
  fee_won       numeric not null default 0 check (fee_won >= 0),
  tax_won       numeric not null default 0 check (tax_won >= 0),

  -- 매도에만 채운다. 체결 시점의 평균매입단가를 그대로 박아 둔다. avg_price 가 이후
  -- 재매수로 바뀌어도 과거 실현손익이 재계산되지 않게 하려는 것이다.
  cost_basis_unit_price numeric,
  realized_pnl_won      numeric,

  source        text,
  memo          text,
  created_at    timestamptz not null default now()
);

create index if not exists client_holding_trades_client_traded_idx
  on public.client_holding_trades (client_id, traded_at desc);

create index if not exists client_holding_trades_holding_idx
  on public.client_holding_trades (holding_id);

alter table public.client_holding_trades enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'client_holding_trades' and policyname = 'client_holding_trades_all'
  ) then
    create policy client_holding_trades_all on public.client_holding_trades
      for all using (true) with check (true);
  end if;
end $$;

comment on table public.client_holding_trades is
  '보유종목 거래 이력(append-only). 매도 시 cost_basis_unit_price·realized_pnl_won 을 체결 시점 값으로 고정한다. 1단계에서는 AUM(parties.asset_size)에 반영하지 않는다.';
