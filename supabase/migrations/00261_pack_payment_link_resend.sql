-- supabase/migrations/00261_pack_payment_link_resend.sql
-- State for the automatic re-send of an EXPIRED pack payment link.
--
-- WHY THIS NEEDS STORED STATE AT ALL. A Stripe Checkout session lives 24 hours.
-- When an auto-renewal falls back to a payment link (no card on file), the payer
-- gets exactly one email; if they miss it, the URL dies and nothing ever tells
-- them. resolvePackPaymentLink already re-mints a fresh session on a verified
-- "expired", so the missing piece is only "who decides to do that again, and
-- when does it stop". Neither answer can be derived: re-minting REPLACES
-- stripe_session_id, so the row keeps no history of how many links it has
-- already burned through.
--
-- resent_count is the stopping rule. Read by the cron block in
-- app/api/admin/internal/pack-renewals/route.ts, which skips any pack at or
-- above PACK_LINK_RESEND_MAX. Without it an unpaid pack emails its payer every
-- single day forever.
--
-- resent_at is the throttle, and it is NOT redundant with a daily cron. A
-- session minted at 09:00 expires at 09:00 the next day — exactly when the cron
-- next runs — so "is it expired yet" is a coin flip on every run. The throttle
-- makes the decision deterministic instead of racing Stripe's clock.
--
-- Both default to "never re-sent", which is true of every existing row: this
-- feature did not exist, so nothing has been re-sent. No backfill is needed and
-- none is safe -- guessing a count would silently consume a real payer's budget.
ALTER TABLE public.client_packages
  ADD COLUMN IF NOT EXISTS payment_link_resent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_link_resent_at    timestamptz;

ALTER TABLE public.client_packages
  DROP CONSTRAINT IF EXISTS client_packages_payment_link_resent_count_nonneg;
ALTER TABLE public.client_packages
  ADD CONSTRAINT client_packages_payment_link_resent_count_nonneg
  CHECK (payment_link_resent_count >= 0);

COMMENT ON COLUMN public.client_packages.payment_link_resent_count IS
  'How many times the expired payment link has been automatically re-minted and re-emailed. Stopping rule for the pack-renewals cron.';
COMMENT ON COLUMN public.client_packages.payment_link_resent_at IS
  'When the last automatic re-send went out. Throttle, so a daily cron cannot race a 24h Stripe session expiry.';
