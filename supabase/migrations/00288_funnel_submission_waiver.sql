-- Migration: Liability waiver on a funnel form submission
--
-- A funnel form can carry a waiver tick (`role: "waiver_accepted"`) on any
-- form, not only a checkout one: the pre-visit onboarding form asks for it
-- before a first in-person session. The checkout path already files its
-- evidence on event_signups (00094); a plain form has no event signup, so the
-- evidence lives on its funnel_submissions row.
--
-- Two columns, not 00094's four: funnel_submissions has carried ip_address and
-- user_agent on every row since 00202, so only WHICH document was in force and
-- WHEN it was accepted are new. waiver_document_id is NULL with
-- waiver_accepted_at set when the visitor ticked it while no waiver document
-- was active, the same choice lib/events/checkout.ts makes.
--
-- READER: components/admin/funnels/LeadsBoard.tsx ("Accepted the liability
-- waiver ...") via lib/db/funnel-leads.ts, whose select is "*".
--
-- Both columns are written only when the form has a waiver tick, so an
-- ordinary lead never names them (see createSubmission's deploy-race retry).

ALTER TABLE funnel_submissions
  ADD COLUMN IF NOT EXISTS waiver_accepted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS waiver_document_id  uuid REFERENCES legal_documents(id);

CREATE INDEX IF NOT EXISTS idx_funnel_submissions_waiver_document
  ON funnel_submissions (waiver_document_id)
  WHERE waiver_document_id IS NOT NULL;
