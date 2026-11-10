alter table public.whatsapp_captured_messages
  add column if not exists sender_name text,
  add column if not exists sender_phone text,
  add column if not exists intent text,
  add column if not exists confidence numeric,
  add column if not exists configuration text,
  add column if not exists budget_or_price text,
  add column if not exists project_name text,
  add column if not exists location text,
  add column if not exists timestamp_label text,
  add column if not exists code text,
  add column if not exists property_type text,
  add column if not exists deal_type text,
  add column if not exists size_display text,
  add column if not exists price_basis text,
  add column if not exists price_flag text,
  add column if not exists price_note text,
  add column if not exists localities text[] not null default '{}',
  add column if not exists tags text[] not null default '{}',
  add column if not exists contact_name text,
  add column if not exists contact_numbers text[] not null default '{}',
  add column if not exists message_text text,
  add column if not exists is_active boolean not null default true,
  add column if not exists converted_to_lead boolean not null default false;

create index if not exists whatsapp_captured_messages_org_intent_idx
  on public.whatsapp_captured_messages (organisation_id, intent, raw_timestamp desc);

create index if not exists whatsapp_captured_messages_org_group_timestamp_idx
  on public.whatsapp_captured_messages (organisation_id, group_id, raw_timestamp desc, message_id);

create or replace function public.search_whatsapp_captured_messages(
  p_organisation_id uuid,
  p_query text,
  p_group_ids text[] default null,
  p_since bigint default null,
  p_code_prefix text default null,
  p_limit integer default 500,
  p_offset integer default 0
)
returns setof public.whatsapp_captured_messages
language sql
stable
security invoker
set search_path = public
as $$
  with search_term as (
    select replace(
      replace(
        replace(coalesce(p_query, ''), E'\\', E'\\\\'),
        '%', E'\\%'
      ),
      '_', E'\\_'
    ) as escaped
  )
  select messages.*
  from public.whatsapp_captured_messages as messages
  cross join search_term
  where messages.organisation_id = p_organisation_id
    and (p_group_ids is null or cardinality(p_group_ids) = 0 or messages.group_id = any(p_group_ids))
    and (p_since is null or messages.raw_timestamp >= p_since)
    and (p_code_prefix is null or messages.code like p_code_prefix || '%')
    and (
      search_term.escaped = ''
      or concat_ws(
        ' ',
        messages.sender_name,
        messages.sender_phone,
        messages.intent,
        messages.configuration,
        messages.budget_or_price,
        messages.project_name,
        messages.location,
        messages.timestamp_label,
        messages.code,
        messages.property_type,
        messages.deal_type,
        messages.size_display,
        messages.price_basis,
        messages.price_flag,
        messages.price_note,
        messages.localities::text,
        messages.tags::text,
        messages.contact_name,
        messages.contact_numbers::text,
        messages.message_text,
        messages.group_id,
        messages.message_payload::text
      ) ilike '%' || search_term.escaped || '%' escape E'\\'
    )
  order by messages.raw_timestamp desc, messages.message_id desc
  limit greatest(1, least(coalesce(p_limit, 500), 500))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.search_whatsapp_captured_messages(uuid, text, text[], bigint, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.search_whatsapp_captured_messages(uuid, text, text[], bigint, text, integer, integer)
  to service_role;

notify pgrst, 'reload schema';
