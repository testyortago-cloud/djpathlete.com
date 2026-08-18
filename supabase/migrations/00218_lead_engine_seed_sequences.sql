-- supabase/migrations/00218_lead_engine_seed_sequences.sql
-- Lead Engine Stage 1b: the four sequences, seeded as data (spec §11).
--
-- Design: docs/superpowers/specs/2026-08-18-lead-engine-stage1b-sequence-engine-design.md
--
-- SEEDED AS 'draft', NOT 'active'. enrollIfTriggered() (lib/lead-engine/enroll.ts)
-- only reads sequences with status = 'active', so nothing enrols and no copy
-- reaches a real person until a human reviews the wording below and flips one
-- row. Do not "helpfully" seed these active.
--
-- =============================================================================
-- THE DOUBLE-SEND AUDIT (spec §11) — what each entry point already emails the
-- lead, checked against the code on 2026-08-18 before any trigger_source below
-- was chosen. A source that already auto-replies opens its sequence with a
-- `wait` step instead of an immediate `email`, so the lead never gets two
-- emails inside the same second.
--
-- | Source        | Already emails the lead?                                    | Evidence                                                              | Immediate first step OK? |
-- |---------------|--------------------------------------------------------------|------------------------------------------------------------------------|---------------------------|
-- | funnel_form   | No — goes to the coach, not the lead                          | sendNewFunnelLeadEmail sends `to: recipients` = ADMIN_CC (+ extras), replyTo the lead; lib/email.ts:2758-2761, called from app/api/funnels/submit/route.ts:310 | Yes |
-- | contact_form  | Yes                                                            | sendContactAutoReply({ to: email, ... }); app/api/contact/route.ts:94  | No — opens with `wait`   |
-- | newsletter    | No                                                             | app/api/newsletter/route.ts calls addSubscriberWithAttribution (lib/db/newsletter.ts, DB write only) and a fire-and-forget ghlCreateContact tag sync — neither sends the subscriber an email | Yes |
-- | lead_magnet   | Yes — the download delivery IS the immediate email             | sendFreeDownloadEmail({ to: email, ... }) fires synchronously in the same request that captures the lead; app/api/shop/leads/route.ts:48 | No — opens with `wait`   |
-- | event_signup  | Yes                                                             | sendEventSignupReceivedEmail sends `to: signup.parent_email`; lib/email.ts:1971-1976, called from app/api/events/[id]/signup/route.ts:61 | No — opens with `wait`   |
-- | assessment    | No — and not a fresh-lead entry point at all                  | app/api/assessment/submit/route.ts only calls recordAudit(); no email is sent. The route also requires auth() — it is an existing, logged-in user retaking an assessment, not an anonymous lead — so it is not used as a sequence trigger here | Yes, but unused |
--
-- Of the six, three (contact_form, lead_magnet, event_signup) already reach the
-- lead's inbox at the moment of capture and are excluded from immediate sends;
-- assessment is excluded because it is not a lead-capture event at all.
--
-- THE FOUR SEQUENCES SEEDED BELOW:
--   1. new_lead_nurture        — trigger_source 'funnel_form'   (audited: safe immediate)
--   2. lead_magnet_delivery    — trigger_source 'lead_magnet'   (audited: opens with wait)
--   3. newsletter_welcome      — trigger_source 'newsletter'    (audited: safe immediate)
--   4. cold_lead_re_engagement — trigger_source NULL (manual enrolment only; per
--      migration 00216's own comment, NULL means nothing auto-enrols into it, so
--      the double-send question does not apply — a human chooses when to put a
--      contact in this one, and no other code path fires synchronously with a
--      manual enrolment).
-- contact_form and event_signup are audited above but not used as a Stage 1b
-- sequence trigger; nothing here overlaps with their existing auto-reply.
--
-- WHICH OF THE FOUR CAN ACTUALLY FIRE TODAY (checked 2026-08-18):
-- Seeding a trigger_source only matters once something calls
-- recordContactEvent() with that exact source string — enrollIfTriggered()
-- (lib/lead-engine/enroll.ts) is only reached from inside
-- recordContactEvent() (lib/db/contacts.ts). `grep -rn "recordContactEvent("
-- app/ lib/` finds exactly one call site in the whole repo:
-- lib/funnels/capture-contact.ts, always with source: "funnel_form". Nothing
-- emits "newsletter" or "lead_magnet" — the newsletter route
-- (app/api/newsletter/route.ts) and the lead-magnet route
-- (app/api/shop/leads/route.ts) never touch the contact spine at all.
--
-- | key                     | trigger_source | anything emits this source today?           | flipping to 'active' enrols anyone today? |
-- |--------------------------|-----------------|-----------------------------------------------|----------------------------------------------|
-- | new_lead_nurture        | funnel_form     | Yes — lib/funnels/capture-contact.ts           | Yes                                           |
-- | lead_magnet_delivery    | lead_magnet     | No — nothing in the repo emits this source     | No — enrols nobody until wired                |
-- | newsletter_welcome      | newsletter      | No — nothing in the repo emits this source     | No — enrols nobody until wired                |
-- | cold_lead_re_engagement | NULL (manual)   | N/A — enrolment is manual by design            | No — no manual-enrol surface exists yet       |
--
-- Wiring the newsletter and lead-magnet routes to call recordContactEvent()
-- with those sources is Stage 4 work (per the parent spec), not this task,
-- and is correctly out of scope here. Until it lands, flipping
-- lead_magnet_delivery or newsletter_welcome to 'active' is harmless — the
-- CHECK constraints and RLS still hold, and nothing sends because nothing
-- enrols — but it also does not do anything: the copy is ready and
-- reviewed, the trigger source it is waiting on is not wired yet. Review
-- and sign-off on their copy can happen now; there is nothing to observe in
-- production until Stage 4 wires the source.
-- =============================================================================

INSERT INTO public.sequences (business_id, key, name, description, trigger_source, status)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'new_lead_nurture',
    'New Lead Nurture',
    'Follows up with a lead captured through a funnel landing page. sendNewFunnelLeadEmail only notifies the coach, so this sequence is the only automated message the lead itself receives; its first step sends immediately.',
    'funnel_form',
    'draft'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'lead_magnet_delivery',
    'Lead Magnet Follow-Up',
    'Follows a free digital download. sendFreeDownloadEmail already delivers the file to the lead the instant they request it, so this sequence opens with a wait rather than a second immediate email.',
    'lead_magnet',
    'draft'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'newsletter_welcome',
    'Newsletter Welcome',
    'Welcomes a new newsletter subscriber. The subscribe endpoint only syncs to GHL in the background and sends no email to the subscriber itself, so this sequence''s first step sends immediately.',
    'newsletter',
    'draft'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'cold_lead_re_engagement',
    'Cold Lead Re-engagement',
    'Manual enrolment only (trigger_source is NULL) — for leads who have gone quiet, enrolled by a human decision rather than a live event. No auto-reply audit applies because nothing else fires synchronously with a manual enrolment.',
    NULL,
    'draft'
  )
ON CONFLICT (business_id, key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 1. new_lead_nurture — immediate email is safe (audited above).
-- -----------------------------------------------------------------------------

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'new_lead_nurture'),
  0, 'email', NULL,
  $subj$Thanks for reaching out about training$subj$,
  $body$Hi {{name}}

Thanks for filling out the form — that's the first step toward a program built around your actual goals, not a generic template.

Over the next few days you'll hear a bit more about how we work and what to expect. In the meantime, if you have a specific question, just reply to this email and it'll land in a real inbox.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'new_lead_nurture'),
  1, 'wait', 4320, NULL, NULL
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'new_lead_nurture'),
  2, 'email', NULL,
  $subj$What working together actually looks like$subj$,
  $body$Hi {{name}}

A quick look at how this usually starts: we talk about where you are now, where you want to be, and what's gotten in the way so far. From there we build a training plan around your schedule and your goals — not the other way around.

If that sounds like something you want to explore, reply to this email and we'll find a time to talk.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'new_lead_nurture'),
  3, 'wait', 10080, NULL, NULL
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'new_lead_nurture'),
  4, 'email', NULL,
  $subj$Still thinking it over?$subj$,
  $body$Hi {{name}}

No pressure — just wanted to check in. If now isn't the right time, that's completely fine. If you're still weighing it, the easiest next step is a short call to talk through what you're working with and whether this is a good fit.

Reply any time and we'll get something on the calendar.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'new_lead_nurture'),
  5, 'stop', NULL, NULL, NULL
)
ON CONFLICT (sequence_id, position) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. lead_magnet_delivery — opens with a wait; sendFreeDownloadEmail already
--    sent the download the instant the lead requested it (audited above).
-- -----------------------------------------------------------------------------

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'lead_magnet_delivery'),
  0, 'wait', 2880, NULL, NULL
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'lead_magnet_delivery'),
  1, 'email', NULL,
  $subj$Did the guide answer what you were looking for?$subj$,
  $body$Hi {{name}}

Hope the guide was useful. A lot of people read something like it and still have questions specific to their own situation — different sport, different schedule, coming back from an injury, whatever it is.

If that's you, reply and tell me what you're working with. Happy to point you in the right direction.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'lead_magnet_delivery'),
  2, 'wait', 5760, NULL, NULL
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'lead_magnet_delivery'),
  3, 'email', NULL,
  $subj$A next step, if you want one$subj$,
  $body$Hi {{name}}

If you found the guide helpful and you're curious what a full training plan built around your goals would look like, the next step is a short call — no pressure, just a conversation about where you are and what would actually move the needle.

Reply to this email and we'll set something up.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'lead_magnet_delivery'),
  4, 'stop', NULL, NULL, NULL
)
ON CONFLICT (sequence_id, position) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. newsletter_welcome — immediate email is safe (audited above).
-- -----------------------------------------------------------------------------

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'newsletter_welcome'),
  0, 'email', NULL,
  $subj$You're on the list$subj$,
  $body$Hi {{name}}

Thanks for signing up. You'll get training tips, program updates, and the occasional idea worth trying — nothing you didn't ask for.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'newsletter_welcome'),
  1, 'wait', 4320, NULL, NULL
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'newsletter_welcome'),
  2, 'email', NULL,
  $subj$One thing worth trying this week$subj$,
  $body$Hi {{name}}

Since you're on the list, here's something concrete: pick one part of your training you've been putting off — mobility work, a weak lift, recovery — and give it real focus for the next two weeks. Small, consistent attention beats a big overhaul almost every time.

If you want help figuring out where to focus, just reply and let us know what you're working with.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'newsletter_welcome'),
  3, 'stop', NULL, NULL, NULL
)
ON CONFLICT (sequence_id, position) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. cold_lead_re_engagement — manual enrolment only; no double-send concern.
-- -----------------------------------------------------------------------------

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'cold_lead_re_engagement'),
  0, 'email', NULL,
  $subj$Checking back in$subj$,
  $body$Hi {{name}}

It's been a while since we last talked, and a lot can change — new season, new schedule, new goals. Wanted to check in and see where things stand for you now.

If training is something you're thinking about again, reply and let us know what's changed.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'cold_lead_re_engagement'),
  1, 'wait', 10080, NULL, NULL
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'cold_lead_re_engagement'),
  2, 'email', NULL,
  $subj$Last check-in for now$subj$,
  $body$Hi {{name}}

Just one more note — if the timing still isn't right, no worries at all, and we'll leave it here for now. If something has shifted and you'd like to pick things back up, reply any time and we'll go from there.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'cold_lead_re_engagement'),
  3, 'stop', NULL, NULL, NULL
)
ON CONFLICT (sequence_id, position) DO NOTHING;
