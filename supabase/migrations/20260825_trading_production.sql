-- kis-signal-trader dedicated schema (do NOT mix with PB Insight tables)
-- Apply on a trader-only Supabase/Postgres project.

CREATE TABLE IF NOT EXISTS trading_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  average_entry_price NUMERIC(18,4) NOT NULL,
  current_state TEXT NOT NULL,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  buy_signal_date DATE,
  consecutive_bearish_days INTEGER NOT NULL DEFAULT 0,
  stop_loss_price NUMERIC(18,4),
  take_profit_price NUMERIC(18,4),
  exchange TEXT,
  kis_order_number TEXT,
  strategy_version TEXT NOT NULL DEFAULT 'KR_THREE_BULL_TWO_BEAR@1',
  dry_run BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_positions_open
  ON trading_positions (current_state, ticker);

CREATE TABLE IF NOT EXISTS trading_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  trading_day DATE NOT NULL,
  ticker TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  signal_kind TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price NUMERIC(18,4) NOT NULL,
  exchange_requested TEXT NOT NULL,
  exchange_effective TEXT NOT NULL,
  ord_dvsn TEXT NOT NULL,
  status TEXT NOT NULL,
  kis_order_no TEXT,
  kis_org_order_no TEXT,
  filled_quantity INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_orders_day_ticker
  ON trading_orders (trading_day, ticker, side);

CREATE TABLE IF NOT EXISTS trading_fills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES trading_orders(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  side TEXT NOT NULL,
  fill_quantity INTEGER NOT NULL,
  fill_price NUMERIC(18,4) NOT NULL,
  kis_fill_no TEXT,
  filled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_strategy_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_cycle_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok BOOLEAN,
  dry_run BOOLEAN NOT NULL DEFAULT true,
  session TEXT,
  summary TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS trading_worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  last_heartbeat_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS trading_market_calendar (
  date DATE PRIMARY KEY,
  is_trading_day BOOLEAN NOT NULL,
  reason TEXT,
  open_minutes INTEGER,
  close_minutes INTEGER,
  source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS trading_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level TEXT NOT NULL,
  code TEXT,
  message TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_admin_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  live_armed BOOLEAN NOT NULL DEFAULT false,
  emergency_stop BOOLEAN NOT NULL DEFAULT true,
  exchange_mode TEXT NOT NULL DEFAULT 'SOR',
  max_daily_loss_won BIGINT NOT NULL DEFAULT 0,
  max_order_won BIGINT NOT NULL DEFAULT 10000000,
  max_daily_orders INT NOT NULL DEFAULT 20,
  confirm_phrase TEXT NOT NULL DEFAULT '실주문',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO trading_admin_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
