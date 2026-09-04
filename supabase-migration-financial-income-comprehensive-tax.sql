-- 금융소득 종합과세 플래그 + 원천징수영수증 기반 금융소득 프로파일
alter table parties
  add column if not exists financial_income_comprehensive_tax boolean not null default false;

alter table parties
  add column if not exists financial_income_profile jsonb;

comment on column parties.financial_income_comprehensive_tax is '금융소득 종합과세 대상 여부';
comment on column parties.financial_income_profile is '이자·배당 추출/수동입력 프로파일(json)';
