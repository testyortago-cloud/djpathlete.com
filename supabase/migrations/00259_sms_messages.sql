-- supabase/migrations/00259_sms_messages.sql
-- Two-way SMS: the conversation's record.
--
-- `sequence_messages` stays the ENGINE's record — it is about a run. This
-- table is about a PERSON, and is keyed on the phone number rather than the
-- contact, because a text can arrive from a number nobody has on file and
-- that conversation still has to exist. `contact_id` is the enrichment;
-- `sequence_message_id` points at the engine's row so the two cannot
-- disagree about one send.

CREATE TABLE IF NOT EXISTS public.sms_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone         text NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('inbound','outbound')),
  body          text NOT NULL,
  twilio_sid    text,
  status        text NOT NULL DEFAULT 'queued',
  error_code    text,
  sent_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sequence_message_id uuid REFERENCES public.sequence_messages(id) ON DELETE SET NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_twilio_sid_key
  ON public.sms_messages (twilio_sid) WHERE twilio_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_messages_contact_idx
  ON public.sms_messages (contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS sms_messages_phone_idx
  ON public.sms_messages (business_id, phone, occurred_at DESC);

ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on sms_messages"
  ON public.sms_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
