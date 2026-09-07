-- supabase/migrations/00255_sequence_content_and_branching.sql
-- Gaps #5, #6 and #7 of docs/full-engine-scope-vs-built.md, in one migration
-- because they share this file and the same body of copy.
--
-- Design: docs/superpowers/specs/2026-09-08-sequence-content-and-branching-design.md
--
-- WHAT IS NEW HERE, beyond copy:
--   * The FIRST sequence_steps.config write in this repository's history.
--     Migration 00254 gave the column a reader and its constraints; nothing
--     has ever written it. The tag step in abandoned_checkout is the first.
--   * The FIRST branch steps in production. branch_condition,
--     on_true_position and on_false_position have existed and worked since
--     00216 and no sequence has ever used them.
--
-- SEEDED AS 'draft', for the reason 00218, 00229 and 00253 all state: nothing
-- enrols and no copy reaches a real person until a human has read the wording
-- and flipped one row. THE COPY BELOW WAS DRAFTED, NOT AUTHORED BY DARREN.
-- Read it, change whatever does not sound like you, then activate. Do not
-- "helpfully" seed these active.
--
-- BRANCH ARMS MUST TERMINATE. A branch target is the only jump this engine
-- has; every other step advances to position + 1. An arm that runs off its own
-- end falls through into the OTHER arm's steps and the person receives both.
-- Each arm below therefore ends in its own 'stop'.
--
-- NO MERGE FIELDS BEYOND {{name}}. renderSequenceEmail substitutes exactly
-- {{name}} and {{sms_consent_url}}. There is no variable for a camp's name,
-- date or price, so the camp copy says "the camp you asked about" rather than
-- naming one. Using {{sms_consent_url}} in a body with no URL supplied makes
-- renderSequenceEmail THROW, so no body below uses it.

INSERT INTO public.sequences (business_id, key, name, description, trigger_source, trigger_filter, status)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'abandoned_checkout',
    'Abandoned checkout',
    'Follows someone who started paying for coaching or a program and did not finish. Stripe only reports an abandoned checkout when the session expires, about 24 hours later, so the first message here is a day behind the event by construction. Excludes shop orders, event tickets and card-on-file setups.',
    'checkout_abandoned',
    '{}'::jsonb,
    'draft'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'service_application_received',
    'Service application received',
    'Follows someone who submitted the enquiry form on a service page. They land on /application-received and, until this sequence is switched on, receive nothing at all -- the existing notification goes to the sales inbox, not to them. Step-Up submissions are excluded: those record a different source.',
    'inquiry',
    '{}'::jsonb,
    'draft'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'camp_clinic_deadline',
    'Camp or clinic deadline',
    'Chases someone who registered interest in a camp or clinic and has not paid. Runs on relative waits from the moment they registered interest, not on the camp start date -- a run cannot know which camp it belongs to, so the copy never names one.',
    'event_signup',
    '{"signup_type": "interest"}'::jsonb,
    'draft'
  )
ON CONFLICT (business_id, key) DO NOTHING;

-- abandoned_checkout: 0 email, 1 wait 2d, 2 tag, 3 branch,
--   texted arm 4 sms -> 5 stop; emailed arm 6 email -> 7 stop.
INSERT INTO public.sequence_steps
  (business_id, sequence_id, position, kind, wait_minutes, subject, body, config, branch_condition, on_true_position, on_false_position)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   0, 'email', NULL,
   $subj$You left something half-finished$subj$,
   $body$Hi {{name}}

You started to pay for something and it did not go through. That happens — it is usually a question that did not have an obvious answer.

If it was the price, the commitment, or whether it is the right thing right now, tell me which and I will give you a straight answer. If it was just the timing, that is fine too.

Reply to this email and let me know.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   1, 'wait', 2880, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   2, 'tag', NULL, NULL, NULL,
   $cfg${"tag": "abandoned-checkout"}$cfg$::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   3, 'branch', NULL, NULL, NULL, '{}'::jsonb,
   $cond${"kind": "has_consent", "channel": "sms"}$cond$::jsonb, 4, 6),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   4, 'sms', NULL, NULL,
   $body$Hi {{name}} — you started to pay for something and it did not go through. If something was unclear, text back and a real person answers.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   5, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   6, 'email', NULL,
   $subj$Still worth a conversation$subj$,
   $body$Hi {{name}}

I will leave this one here.

If you want to talk it through before deciding anything, reply to this email. No commitment, and no follow-up after this if you would rather leave it.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   7, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL)
ON CONFLICT (sequence_id, position) DO NOTHING;

-- service_application_received: 0 email (immediate), 1 wait 2d, 2 email,
--   3 wait 4d, 4 email, 5 stop. No branch -- see the design's §6.
INSERT INTO public.sequence_steps
  (business_id, sequence_id, position, kind, wait_minutes, subject, body, config, branch_condition, on_true_position, on_false_position)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'service_application_received'),
   0, 'email', NULL,
   $subj$We have your application$subj$,
   $body$Hi {{name}}

Thanks for sending this through. It has landed and a real person reads every one.

What happens next: I go through what you wrote, and if it looks like something we can genuinely help with, I will reply to set up a time to talk. If it is not a good fit, I will tell you that too rather than leave you waiting.

If anything has changed since you sent it, reply here and let me know.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'service_application_received'),
   1, 'wait', 2880, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'service_application_received'),
   2, 'email', NULL,
   $subj$What the first conversation covers$subj$,
   $body$Hi {{name}}

While you are waiting, here is what the first conversation actually is, so it is not a mystery.

It is a straight talk about what you are training for, what has and has not worked, and anything that keeps breaking down. No assessment to prepare for and nothing to bring.

By the end of it you should know whether this is worth doing. If it is not, I will say so.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'service_application_received'),
   3, 'wait', 5760, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'service_application_received'),
   4, 'email', NULL,
   $subj$Still want to talk?$subj$,
   $body$Hi {{name}}

I have not heard back, so this is the last one about your application.

If you still want to go through it, reply and we will find a time. If your plans changed, no reply needed — I will leave you alone.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'service_application_received'),
   5, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL)
ON CONFLICT (sequence_id, position) DO NOTHING;

-- camp_clinic_deadline: 0 email, 1 wait 2d, 2 email, 3 wait 4d, 4 email,
--   5 wait 4d, 6 email, 7 stop. Relative waits, NOT anchored to the camp
--   start date -- a run cannot know which camp it belongs to.
INSERT INTO public.sequence_steps
  (business_id, sequence_id, position, kind, wait_minutes, subject, body, config, branch_condition, on_true_position, on_false_position)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   0, 'email', NULL,
   $subj$About the camp you asked about$subj$,
   $body$Hi {{name}}

Thanks for putting your name down. Your place is not held yet — that happens when you register properly — but here is what it covers so you can decide.

It is a small group, coached in person, working on the things that actually limit an athlete rather than a general session everyone gets. If you have a specific problem you want looked at, bring it.

If you want the details again or have a question first, reply to this email.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   1, 'wait', 2880, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   2, 'email', NULL,
   $subj$What a day there looks like$subj$,
   $body$Hi {{name}}

In case it helps you decide.

The day is mostly work, not talking. We look at how an athlete moves under load, fix the things that are cheap to fix on the spot, and give them the two or three things worth taking home. Nobody is standing around.

Parents are welcome to watch. Athletes usually leave knowing exactly what to work on, which is the part that lasts after the day ends.

Reply if you want to know whether it suits the athlete you have in mind.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   3, 'wait', 5760, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   4, 'email', NULL,
   $subj$Places are limited$subj$,
   $body$Hi {{name}}

A quick heads up: places are capped so the coaching stays hands-on, and registering interest does not hold one.

If you want the spot, register properly and it is yours. If you have decided against it, that is completely fine — you can ignore this.

Reply if there is anything you still need to know first.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   5, 'wait', 5760, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   6, 'email', NULL,
   $subj$Last one about this$subj$,
   $body$Hi {{name}}

Last message about the camp — I will not keep bringing it up.

If the timing is wrong, tell me and I will let you know when the next one is instead. If you want a place, register and you are set.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   7, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL)
ON CONFLICT (sequence_id, position) DO NOTHING;
