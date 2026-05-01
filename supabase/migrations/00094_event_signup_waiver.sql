-- Migration: Event Signup Liability Waiver
-- Records the parent/guardian's acceptance of the liability waiver at the
-- moment they sign their athlete up for a clinic or performance camp.
-- Event signups are anonymous (no users row), so we cannot reuse the
-- user_consents table; the acceptance metadata lives on event_signups itself.

ALTER TABLE event_signups
  ADD COLUMN IF NOT EXISTS waiver_accepted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS waiver_document_id  uuid REFERENCES legal_documents(id),
  ADD COLUMN IF NOT EXISTS waiver_ip_address   text,
  ADD COLUMN IF NOT EXISTS waiver_user_agent   text;

CREATE INDEX IF NOT EXISTS idx_event_signups_waiver_document
  ON event_signups (waiver_document_id);
