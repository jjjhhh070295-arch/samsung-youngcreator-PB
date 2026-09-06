-- 현금흐름 입력 주기 (월별/분기별/반기별/연도별)
alter table parties
  add column if not exists cashflow_period_type text;

comment on column parties.cashflow_period_type is '현금흐름 입력 주기: monthly|quarterly|semiAnnual|yearly';
