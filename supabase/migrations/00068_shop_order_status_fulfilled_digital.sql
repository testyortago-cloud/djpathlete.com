-- supabase/migrations/00068_shop_order_status_fulfilled_digital.sql
-- Phase 2: digital-only orders skip POD states and terminate at 'fulfilled_digital'.
-- shop_orders.status is a text column gated by a CHECK constraint (see 00065),
-- not an ENUM, so we rewrite the constraint rather than ALTER TYPE.

alter table public.shop_orders drop constraint shop_orders_status_check;

alter table public.shop_orders add constraint shop_orders_status_check
  check (status in (
    'pending', 'paid', 'draft', 'confirmed', 'in_production',
    'shipped', 'canceled', 'refunded', 'fulfilled_digital'
  ));
