-- Trade & strategy persistence for KIS live trading + KR_THREE_BULL_TWO_BEAR
-- RLS: all tables scoped by auth.uid() = user_id unless noted.

-- ── Order intents (client preview → submit pipeline) ───────────────────────
CREATE TABLE IF NOT EXISTS trade_order_intents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity        INTEGER NOT NULL CHECK (quantity >= 1),
  price           NUMERIC(18, 4) NOT NULL CHECK (price > 0),
  ord_dvsn        TEXT NOT NULL CHECK (ord_dvsn IN ('00', '06')),
  strategy_id     TEXT,
  status          TEXT NOT NULL DEFAULT 'preview',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

COMMENT ON TABLE trade_order_intents IS 'RLS: enable row level security; policy trade_order_intents_select_own FOR SELECT USING (auth.uid() = user_id); policy trade_order_intents_insert_own FOR INSERT WITH CHECK (auth.uid() = user_id); policy trade_order_intents_update_own FOR UPDATE USING (auth.uid() = user_id);';

-- ── Submitted orders (KIS ack) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  intent_id         UUID REFERENCES trade_order_intents(id) ON DELETE SET NULL,
  symbol            TEXT NOT NULL,
  side              TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity          INTEGER NOT NULL CHECK (quantity >= 1),
  price             NUMERIC(18, 4) NOT NULL CHECK (price > 0),
  ord_dvsn          TEXT NOT NULL CHECK (ord_dvsn IN ('00', '06')),
  status            TEXT NOT NULL DEFAULT 'submitted',
  kis_order_no      TEXT,
  kis_org_order_no  TEXT,
  filled_quantity   INTEGER NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
  strategy_id       TEXT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_orders_user_created ON trade_orders (user_id, created_at DESC);

COMMENT ON TABLE trade_orders IS 'RLS: enable row level security; policy trade_orders_select_own FOR SELECT USING (auth.uid() = user_id); policy trade_orders_insert_own FOR INSERT WITH CHECK (auth.uid() = user_id); policy trade_orders_update_own FOR UPDATE USING (auth.uid() = user_id);';

-- ── Fill events ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_executions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id     UUID NOT NULL REFERENCES trade_orders(id) ON DELETE CASCADE,
  fill_qty     INTEGER NOT NULL CHECK (fill_qty >= 1),
  fill_price   NUMERIC(18, 4) NOT NULL CHECK (fill_price > 0),
  executed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  kis_exec_no  TEXT
);

CREATE INDEX IF NOT EXISTS idx_trade_executions_order ON trade_executions (order_id);

COMMENT ON TABLE trade_executions IS 'RLS: enable row level security; policy trade_executions_select_own FOR SELECT USING (auth.uid() = user_id); policy trade_executions_insert_own FOR INSERT WITH CHECK (auth.uid() = user_id);';

-- ── Strategy registry ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy_definitions (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  config_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO strategy_definitions (id, name, description, config_json)
VALUES (
  'KR_THREE_BULL_TWO_BEAR',
  '3 Bull / 2 Bear KR',
  'Enter on 3 consecutive bullish daily bars; exit on 2 consecutive bearish bars.',
  '{"max_positions":3,"exit_fallback":"MANUAL"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE strategy_definitions IS 'RLS: read-only for authenticated users; writes restricted to service role. policy strategy_definitions_select_auth FOR SELECT TO authenticated USING (true);';

-- ── Symbols watched by strategy instance ───────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy_symbols (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id     TEXT NOT NULL REFERENCES strategy_definitions(id) ON DELETE CASCADE,
  symbol          TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'WATCHING',
  allocated_won   NUMERIC(18, 2),
  is_enabled      BOOLEAN NOT NULL DEFAULT true,
  last_signal_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, strategy_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_strategy_symbols_user_strategy ON strategy_symbols (user_id, strategy_id);

COMMENT ON TABLE strategy_symbols IS 'RLS: enable row level security; policy strategy_symbols_own FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);';

-- ── Signal log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy_signals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id   TEXT NOT NULL REFERENCES strategy_definitions(id) ON DELETE CASCADE,
  symbol        TEXT NOT NULL,
  signal_type   TEXT NOT NULL CHECK (signal_type IN ('buy', 'sell')),
  bar_date      DATE NOT NULL,
  streak        INTEGER NOT NULL,
  payload_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategy_signals_user_date ON strategy_signals (user_id, bar_date DESC);

COMMENT ON TABLE strategy_signals IS 'RLS: enable row level security; policy strategy_signals_select_own FOR SELECT USING (auth.uid() = user_id); policy strategy_signals_insert_own FOR INSERT WITH CHECK (auth.uid() = user_id);';

-- ── Open / closed strategy positions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy_positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id     TEXT NOT NULL REFERENCES strategy_definitions(id) ON DELETE CASCADE,
  symbol          TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'OPEN',
  quantity        INTEGER NOT NULL CHECK (quantity >= 0),
  avg_entry_price NUMERIC(18, 4),
  opened_at       TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategy_positions_open ON strategy_positions (user_id, strategy_id, state);

COMMENT ON TABLE strategy_positions IS 'RLS: enable row level security; policy strategy_positions_own FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);';

-- ── Strategy ↔ order linkage ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id     TEXT NOT NULL REFERENCES strategy_definitions(id) ON DELETE CASCADE,
  position_id     UUID REFERENCES strategy_positions(id) ON DELETE SET NULL,
  trade_order_id  UUID REFERENCES trade_orders(id) ON DELETE SET NULL,
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategy_orders_user ON strategy_orders (user_id, strategy_id, created_at DESC);

COMMENT ON TABLE strategy_orders IS 'RLS: enable row level security; policy strategy_orders_own FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);';
