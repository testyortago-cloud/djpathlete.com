-- Phase 3: track Stripe Product id separately from Price id on events.
-- Stripe Prices are immutable, so price changes rotate Price ids while the
-- Product stays stable. Tracking both lets us archive-and-create-new-price
-- without orphaning Stripe Products.

alter table events add column if not exists stripe_product_id text;
create index if not exists idx_events_stripe_product_id on events (stripe_product_id);
