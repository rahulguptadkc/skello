-- =============================================================================
-- Performance Indexes Migration
--
-- Adds high-cardinality indexes to eliminate sequential full-table scans
-- across webhooks, real-time polling, and CRM list queries.
-- =============================================================================

-- 1. WhatsApp BSP Webhook correlation:
-- KwikEngage delivery webhooks query solely on provider_message_id.
-- This index eliminates sequential scans on shopify_recovery_messages.
create index if not exists idx_shopify_recovery_messages_provider_msg_id
  on public.shopify_recovery_messages (provider_message_id)
  where provider_message_id is not null;

-- 2. Conversations / Calls query acceleration:
-- Speeds up listConversations and date-range filters scoped by tenant.
create index if not exists idx_calls_org_started_at
  on public.calls (organisation_id, started_at desc);

-- 3. Inbound/Outbound Telephony Webhooks:
-- Bolna status and extraction webhooks match on bolna_call_id.
create index if not exists idx_calls_bolna_call_id
  on public.calls (bolna_call_id)
  where bolna_call_id is not null;

-- 4. Leads sorting and pipeline tabs:
-- Speeds up listLeadsWithCallActivity and getLeadStatusCounts queries.
create index if not exists idx_leads_org_created_at
  on public.leads (organisation_id, created_at desc);

create index if not exists idx_leads_org_status
  on public.leads (organisation_id, status)
  where deleted_at is null;
