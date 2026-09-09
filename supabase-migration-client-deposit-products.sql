-- 예·적금 상품 (고객별). parties 와 분리된 테이블.
-- 실행: Supabase SQL Editor. 파괴적 삭제 없음.

create table if not exists public.client_deposit_products (
  id text primary key,
  client_id text not null,
  institution text not null default '',
  product_name text not null default '',
  product_type text not null check (product_type in ('deposit', 'installment')),
  currency text not null default 'KRW',
  principal_won numeric,
  annual_rate_pct numeric,
  opened_at date,
  matures_at date,
  interest_schedule text,
  convention text not null default 'simple',
  tax_status text not null default 'taxable',
  contribution_amount_won numeric,
  contribution_frequency text,
  contribution_dates jsonb,
  include_in_managed_preview boolean not null default true,
  identified_in_cash_balance boolean not null default false,
  source text,
  as_of date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_deposit_products_client_id_idx
  on public.client_deposit_products (client_id);

alter table public.client_deposit_products enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'client_deposit_products' and policyname = 'client_deposit_products_all'
  ) then
    create policy client_deposit_products_all on public.client_deposit_products
      for all using (true) with check (true);
  end if;
end $$;

comment on table public.client_deposit_products is
  '예·적금 상품. principal_won null = 미입력(0과 구분). identified_in_cash_balance 시 AUM 이중계상 금지.';
