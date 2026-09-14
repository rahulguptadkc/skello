-- Add industry classification to organisations.
-- Values: 'real_estate' | 'ecommerce' | 'general'
-- Default: 'real_estate'

alter table public.organisations
  add column if not exists industry text not null default 'real_estate'
  check (industry in ('real_estate', 'ecommerce', 'general'));

create index if not exists organisations_industry_idx
  on public.organisations (industry);
