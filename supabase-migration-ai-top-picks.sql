-- AI Top Picks / market intelligence (PostgreSQL + pgvector)
-- Supabase SQL Editor에서 코드 배포 전에 실행한다.
create extension if not exists vector;

create table if not exists research_documents (
  id uuid primary key default gen_random_uuid(),
  source_report_id text,
  source text not null,
  broker text,
  analyst text,
  published_at timestamptz not null,
  title text not null,
  document_type text not null check (document_type in ('STOCK','MARKET','INDUSTRY','MACRO')),
  raw_text text not null,
  cleaned_text text not null,
  source_url text,
  content_hash text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists stock_research (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references research_documents(id) on delete cascade,
  ticker text,
  company_name text,
  market text,
  sector text,
  rating text,
  previous_rating text,
  rating_change text,
  target_price numeric,
  previous_target_price numeric,
  target_price_change_pct numeric,
  eps_revision_pct numeric,
  earnings_revision_direction text,
  earnings_revision_details text,
  sentiment_score numeric check (sentiment_score between -1 and 1),
  investment_thesis text,
  investment_points jsonb not null default '[]'::jsonb,
  catalysts jsonb not null default '[]'::jsonb,
  risk_factors jsonb not null default '[]'::jsonb,
  themes jsonb not null default '[]'::jsonb,
  analyst_stance text,
  catalyst_specificity text,
  risk_level text,
  published_at timestamptz not null,
  extraction_model text not null,
  extraction_confidence numeric,
  created_at timestamptz not null default now()
);

create table if not exists market_research (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references research_documents(id) on delete cascade,
  report_id text,
  broker text,
  published_at timestamptz not null,
  report_type text,
  market text,
  topic text,
  sentiment_score numeric check (sentiment_score between -1 and 1),
  summary text,
  market_stance text,
  market_drivers jsonb not null default '[]'::jsonb,
  positive_factors jsonb not null default '[]'::jsonb,
  negative_factors jsonb not null default '[]'::jsonb,
  rates_view text,
  fx_view text,
  foreign_flow_view text,
  earnings_view text,
  preferred_sectors jsonb not null default '[]'::jsonb,
  avoided_sectors jsonb not null default '[]'::jsonb,
  key_catalysts jsonb not null default '[]'::jsonb,
  key_risks jsonb not null default '[]'::jsonb,
  investment_horizon text,
  confidence numeric,
  key_points jsonb not null default '[]'::jsonb,
  affected_sectors jsonb not null default '[]'::jsonb,
  themes jsonb not null default '[]'::jsonb,
  extraction_model text not null,
  created_at timestamptz not null default now()
);

create table if not exists research_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references research_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(768),
  ticker text,
  published_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(document_id, chunk_index)
);

create table if not exists daily_stock_signals (
  id uuid primary key default gen_random_uuid(),
  trade_date date not null,
  ticker text not null,
  company_name text not null,
  market text not null,
  sector text,
  themes jsonb not null default '[]'::jsonb,
  research_score numeric not null check (research_score between 0 and 100),
  fundamental_score numeric not null check (fundamental_score between 0 and 100),
  price_score numeric not null check (price_score between 0 and 100),
  consensus_score numeric not null check (consensus_score between 0 and 100),
  regime_score numeric not null check (regime_score between 0 and 100),
  total_score numeric not null check (total_score between 0 and 100),
  confidence_score numeric not null check (confidence_score between 0 and 100),
  rank integer,
  pick_type text not null check (pick_type in ('CORE','GROWTH','MOMENTUM','DEFENSIVE')),
  score_breakdown jsonb not null,
  input_snapshot jsonb not null,
  source_document_ids jsonb not null default '[]'::jsonb,
  scoring_version text not null default 'top-picks-v1',
  created_at timestamptz not null default now(),
  unique(trade_date, ticker)
);

create table if not exists daily_market_briefs (
  id uuid primary key default gen_random_uuid(),
  trade_date date not null unique,
  as_of timestamptz,
  data_window jsonb not null default '{}'::jsonb,
  stance text,
  headline text not null,
  market_summary text not null,
  narrative_timeline jsonb not null default '{}'::jsonb,
  key_issues jsonb not null default '[]'::jsonb,
  themes jsonb not null default '[]'::jsonb,
  key_drivers jsonb not null default '[]'::jsonb,
  key_risks jsonb not null default '[]'::jsonb,
  watch_points jsonb not null default '[]'::jsonb,
  supporting_brokers jsonb not null default '[]'::jsonb,
  asset_view jsonb not null default '{}'::jsonb,
  indicators jsonb not null default '[]'::jsonb,
  source_document_ids jsonb not null default '[]'::jsonb,
  model text not null,
  created_at timestamptz not null default now()
);

alter table daily_market_briefs add column if not exists narrative_timeline jsonb not null default '{}'::jsonb;
alter table daily_market_briefs add column if not exists watch_points jsonb not null default '[]'::jsonb;

alter table research_documents add column if not exists source_report_id text;
alter table stock_research add column if not exists rating_change text;
alter table stock_research add column if not exists target_price_change_pct numeric;
alter table stock_research add column if not exists earnings_revision_direction text;
alter table stock_research add column if not exists earnings_revision_details text;
alter table stock_research add column if not exists investment_thesis text;
alter table stock_research add column if not exists catalysts jsonb not null default '[]'::jsonb;
alter table stock_research add column if not exists analyst_stance text;
alter table stock_research add column if not exists catalyst_specificity text;
alter table stock_research add column if not exists risk_level text;
alter table market_research add column if not exists report_id text;
alter table market_research add column if not exists broker text;
alter table market_research add column if not exists published_at timestamptz;
alter table market_research add column if not exists report_type text;
alter table market_research add column if not exists market_stance text;
alter table market_research add column if not exists market_drivers jsonb not null default '[]'::jsonb;
alter table market_research add column if not exists positive_factors jsonb not null default '[]'::jsonb;
alter table market_research add column if not exists negative_factors jsonb not null default '[]'::jsonb;
alter table market_research add column if not exists rates_view text;
alter table market_research add column if not exists fx_view text;
alter table market_research add column if not exists foreign_flow_view text;
alter table market_research add column if not exists earnings_view text;
alter table market_research add column if not exists preferred_sectors jsonb not null default '[]'::jsonb;
alter table market_research add column if not exists avoided_sectors jsonb not null default '[]'::jsonb;
alter table market_research add column if not exists key_catalysts jsonb not null default '[]'::jsonb;
alter table market_research add column if not exists key_risks jsonb not null default '[]'::jsonb;
alter table market_research add column if not exists investment_horizon text;
alter table market_research add column if not exists confidence numeric;
alter table daily_market_briefs add column if not exists as_of timestamptz;
alter table daily_market_briefs add column if not exists data_window jsonb not null default '{}'::jsonb;
alter table daily_market_briefs add column if not exists stance text;
alter table daily_market_briefs add column if not exists key_drivers jsonb not null default '[]'::jsonb;
alter table daily_market_briefs add column if not exists key_risks jsonb not null default '[]'::jsonb;
alter table daily_market_briefs add column if not exists supporting_brokers jsonb not null default '[]'::jsonb;

create table if not exists daily_top_picks (
  id uuid primary key default gen_random_uuid(),
  trade_date date not null,
  as_of timestamptz,
  ticker text not null,
  rank integer,
  previous_rank integer,
  rank_change integer,
  is_new boolean not null default false,
  is_dropped boolean not null default false,
  total_score numeric not null,
  confidence_score numeric not null,
  pick_type text not null check (pick_type in ('CORE','GROWTH','MOMENTUM','DEFENSIVE')),
  summary text,
  key_reasons jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  signal_changes jsonb not null default '{}'::jsonb,
  source_document_ids jsonb not null default '[]'::jsonb,
  supporting_brokers jsonb not null default '[]'::jsonb,
  broker_count integer,
  data_window jsonb not null default '{}'::jsonb,
  target_price numeric,
  target_price_change_pct numeric,
  confidence_label text,
  created_at timestamptz not null default now(),
  unique(trade_date, ticker)
);

alter table daily_top_picks add column if not exists supporting_brokers jsonb not null default '[]'::jsonb;
alter table daily_top_picks add column if not exists as_of timestamptz;
alter table daily_top_picks add column if not exists broker_count integer;
alter table daily_top_picks add column if not exists data_window jsonb not null default '{}'::jsonb;
alter table daily_top_picks add column if not exists target_price numeric;
alter table daily_top_picks add column if not exists target_price_change_pct numeric;
alter table daily_top_picks add column if not exists confidence_label text;

create index if not exists research_documents_published_idx on research_documents(published_at desc, document_type);
create index if not exists stock_research_ticker_date_idx on stock_research(ticker, published_at desc);
create index if not exists market_research_created_idx on market_research(created_at desc);
create index if not exists research_chunks_ticker_date_idx on research_chunks(ticker, published_at desc);
create index if not exists research_chunks_embedding_idx on research_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists daily_stock_signals_date_rank_idx on daily_stock_signals(trade_date desc, rank);
create index if not exists daily_top_picks_date_rank_idx on daily_top_picks(trade_date desc, rank);

-- 최근 날짜 필터와 cosine distance를 함께 쓰는 검색 RPC.
create or replace function match_research_chunks(
  query_embedding vector(768), match_count integer default 20,
  published_after timestamptz default null, filter_ticker text default null
) returns table(id uuid, document_id uuid, content text, ticker text, published_at timestamptz, similarity float)
language sql stable as $$
  select rc.id, rc.document_id, rc.content, rc.ticker, rc.published_at,
         1 - (rc.embedding <=> query_embedding) as similarity
  from research_chunks rc
  where rc.embedding is not null
    and (published_after is null or rc.published_at >= published_after)
    and (filter_ticker is null or rc.ticker = filter_ticker)
  order by rc.embedding <=> query_embedding
  limit greatest(1, least(match_count, 100));
$$;

alter table research_documents enable row level security;
alter table stock_research enable row level security;
alter table market_research enable row level security;
alter table research_chunks enable row level security;
alter table daily_stock_signals enable row level security;
alter table daily_market_briefs enable row level security;
alter table daily_top_picks enable row level security;

-- 기존 앱은 anon Supabase client를 서버에서도 사용한다. 읽기는 허용하고 쓰기는
-- cron/API 서버 경로에서만 수행하도록 배포 환경에서 service-role 전환을 권장한다.
do $$ declare t text; begin
  foreach t in array array['research_documents','stock_research','market_research','research_chunks','daily_stock_signals','daily_market_briefs','daily_top_picks'] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (true)', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all using (true) with check (true)', t || '_write', t);
  end loop;
end $$;
