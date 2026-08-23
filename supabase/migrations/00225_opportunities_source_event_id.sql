-- 00225_opportunities_source_event_id.sql
-- Closes the double-Won race on the create-with-outcome branch of
-- applyPipelineEvent (lib/db/pipeline.ts).
--
-- THE RACE. Stripe delivers checkout.session.completed at-least-once and
-- app/api/stripe/webhook/route.ts has no event-id dedupe. That branch is a
-- SELECT (has this source id been seen?), then an INSERT into opportunities,
-- then an INSERT into opportunity_stage_events -- three PostgREST round-trips
-- with no transaction around them. Two deliveries that interleave inside that
-- gap both read "no prior deal, no duplicate" and both create a card: two Won
-- opportunities for one sale, double-counted by lib/automation/campaign-revenue.ts.
--
-- WHY THE INDEX WE ALREADY HAVE CANNOT CATCH IT. 00219's
-- opportunities_one_open_per_contact_pipeline is `WHERE outcome IS NULL`, and
-- this branch inserts a row that is already closed (an instant Won), so the
-- predicate never matches it.
--
-- WHY A COLUMN AND NOT A LEDGER TABLE. A separate table would have to be
-- claimed BEFORE the opportunity insert to be a lock, and 00208's header
-- explains what that costs: funnel_checkout_grants deliberately records AFTER
-- the grant, because recording first makes a failed grant permanently
-- unretryable. Here it would be worse -- lib/automation/pipeline-reconcile.ts
-- can only WIN a card that already exists and is open, so a burned source id
-- whose insert then threw would leave a FIRST sale with no card and no way to
-- repair it. Putting the claim ON the inserted row makes claim and effect the
-- same statement: an insert that fails claims nothing.
--
-- SCOPE. Nullable and opt-in. Only callers that hand applyPipelineEvent a
-- source id in `metadata` populate it, so the partial index constrains
-- exactly those rows and every card created without one behaves as before.

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS source_event_id text;

COMMENT ON COLUMN public.opportunities.source_event_id IS
  'The external event that created this card (Stripe checkout session id, or the reconciler''s booking/payment id). The idempotency claim for creation only -- never re-stamped by a later advance, close or amend.';

-- Scoped by business_id to match how every other read in lib/db/pipeline.ts
-- is scoped. It changes nothing today (all three id kinds are unique
-- system-wide, and this repo runs one business) but it keeps a second tenant
-- from ever being refused a card by another tenant's id.
CREATE UNIQUE INDEX IF NOT EXISTS opportunities_source_event_uniq
  ON public.opportunities (business_id, source_event_id)
  WHERE source_event_id IS NOT NULL;
