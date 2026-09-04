-- Task 11 fix round 1, Minor 1: two businesses must not be able to claim the
-- same SMS number. getBusinessBySmsNumber (lib/db/businesses.ts) resolves the
-- inbound Twilio webhook's tenant by looking up
-- business_settings.sms_sender_phone -- if two rows shared a number, that
-- query's .maybeSingle() would answer PGRST116 ("multiple rows returned"),
-- which the caller now correctly treats as a read error (throw, not a silent
-- fallback to the platform business -- see that function's own doc comment).
-- Structural prevention is better than a runtime error path: this index
-- makes the ambiguous state unreachable in the first place.
--
-- Partial (WHERE sms_sender_phone <> ''), not a plain unique constraint:
-- sms_sender_phone is NOT NULL DEFAULT '' (00221), and every business that
-- has not yet configured a number holds that same empty-string default. A
-- plain unique index would let only ONE unconfigured business exist at a
-- time, which is not the invariant wanted -- only a real, non-empty number
-- must be exclusive to one business.
CREATE UNIQUE INDEX IF NOT EXISTS business_settings_sms_sender_phone_unique
  ON public.business_settings (sms_sender_phone) WHERE sms_sender_phone <> '';
