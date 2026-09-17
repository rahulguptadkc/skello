-- =============================================================================
-- 20260917000000 — Add the 'maisha_tiered_offer' WhatsApp recovery template layout.
-- =============================================================================
-- Adds the Maisha tiered offer layout (4 variables: customer_name, top_product,
-- cart_total, discount_link) with static copy for the Buy 1/2/3 discount ladder
-- (MAISHA10 / MAISHA20 / MAISHA30).
-- =============================================================================

alter table public.shopify_recovery_settings
  drop constraint if exists shopify_recovery_settings_whatsapp_template_layout_check;

alter table public.shopify_recovery_settings
  add constraint shopify_recovery_settings_whatsapp_template_layout_check
    check (whatsapp_template_layout in ('classic', 'coupon_link', 'rakhi_offer', 'maisha_tiered_offer'));

comment on column public.shopify_recovery_settings.whatsapp_template_layout is
  'Which WhatsApp recovery template body the org uses: classic (6 vars), '
  'coupon_link (4 vars), rakhi_offer (4 vars), or maisha_tiered_offer (4 vars). '
  'Drives positional variable mapping in the send pipeline.';
