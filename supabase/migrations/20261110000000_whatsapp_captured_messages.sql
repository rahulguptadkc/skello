create table if not exists public.whatsapp_captured_messages (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  message_id text not null,
  group_id text not null,
  sender_name text,
  sender_phone text,
  intent text,
  confidence numeric,
  configuration text,
  budget_or_price text,
  project_name text,
  location text,
  timestamp_label text,
  raw_timestamp bigint not null,
  code text,
  property_type text,
  deal_type text,
  size_display text,
  price_basis text,
  price_flag text,
  price_note text,
  localities text[] not null default '{}',
  tags text[] not null default '{}',
  contact_name text,
  contact_numbers text[] not null default '{}',
  message_text text,
  is_active boolean not null default true,
  converted_to_lead boolean not null default false,
  message_payload jsonb not null,
  captured_at timestamptz not null default now(),
  primary key (organisation_id, message_id)
);

create index if not exists whatsapp_captured_messages_org_timestamp_idx
  on public.whatsapp_captured_messages (organisation_id, raw_timestamp desc, message_id);

create index if not exists whatsapp_captured_messages_org_group_timestamp_idx
  on public.whatsapp_captured_messages (organisation_id, group_id, raw_timestamp desc, message_id);

alter table public.whatsapp_captured_messages enable row level security;

comment on table public.whatsapp_captured_messages is
  'WhatsApp property inquiries captured for an organisation. Access is through authenticated server routes using the service role.';
