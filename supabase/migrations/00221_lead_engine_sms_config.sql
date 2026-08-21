-- supabase/migrations/00221_lead_engine_sms_config.sql
-- Lead Engine Stage 2: SMS sender configuration + delivery statuses.
-- Design: docs/superpowers/specs/2026-08-21-lead-engine-stage2-sms-design.md §3, §5.
--
-- Both columns default '' (not NULL) to match 00212's identity columns:
-- assertSmsSendable treats blank as unconfigured. Filling them is a human
-- act on the day Twilio clears — scripts/configure-lead-engine-sms.mjs.

ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS sms_messaging_service_sid text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sms_sender_phone          text NOT NULL DEFAULT '';

-- An sms step without a body is unrunnable; 00216 guarded email but not sms.
ALTER TABLE public.sequence_steps
  DROP CONSTRAINT IF EXISTS sequence_steps_sms_body_check;
ALTER TABLE public.sequence_steps
  ADD CONSTRAINT sequence_steps_sms_body_check
  CHECK (kind <> 'sms' OR body IS NOT NULL);

-- Twilio status callbacks report a delivery lifecycle email never had.
-- 'delivered' is TERMINAL: application code enforces that no later callback
-- (they arrive out of order) downgrades it. 'undelivered' is Twilio's
-- carrier-rejection outcome, distinct from 'failed' (we never handed it off).
ALTER TABLE public.sequence_messages
  DROP CONSTRAINT IF EXISTS sequence_messages_status_check;
ALTER TABLE public.sequence_messages
  ADD CONSTRAINT sequence_messages_status_check
  CHECK (status IN ('queued','sent','failed','skipped','delivered','undelivered'));
