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

You started to pay for something and it did not go through. That happens — it's usually a question that didn't have an obvious answer.

If it was the price, the commitment, or whether it is the right thing right now, tell me which and I'll give you a straight answer. If it was just the timing, that's fine too.

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
   $body$Hi {{name}} — you started to pay for something and it didn't go through. If something was unclear, text back and a real person answers.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   5, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   6, 'email', NULL,
   $subj$Still worth a conversation$subj$,
   $body$Hi {{name}}

I'll leave this one here.

If you want to talk it through before deciding anything, reply to this email. No commitment, and no follow-up after this if you'd rather leave it.$body$,
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

Thanks for sending this through. It's landed and a real person reads every one.

What happens next: I go through what you wrote, and if it looks like something we can genuinely help with, I'll reply to set up a time to talk. If it is not a good fit, I'll tell you that too rather than leave you waiting.

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

While you're waiting, here is what the first conversation actually is, so it's not a mystery.

It is a straight talk about what you are training for, what has and hasn't worked, and anything that keeps breaking down. No assessment to prepare for and nothing to bring.

By the end of it you should know whether this is worth doing. If it's not, I'll say so.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'service_application_received'),
   3, 'wait', 5760, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'service_application_received'),
   4, 'email', NULL,
   $subj$Still want to talk?$subj$,
   $body$Hi {{name}}

I haven't heard back, so this is the last one about your application.

If you still want to go through it, reply and we'll find a time. If your plans changed, no reply needed — I will leave you alone.$body$,
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

Thanks for putting your name down. Your place isn't held yet — that happens when you register properly — but here is what it covers so you can decide.

It's a small group, coached in person, working on the things that actually limit an athlete rather than a general session everyone gets. If you have a specific problem you want looked at, bring it.

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

The day's mostly work, not talking. We look at how an athlete moves under load, fix the things that are cheap to fix on the spot, and give them the two or three things worth taking home. Nobody's standing around.

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

A quick heads up: places are capped so the coaching stays hands-on, and registering interest doesn't hold one.

If you want the spot, register properly and it's yours. If you've decided against it, that is completely fine — you can ignore this.

Reply if there's anything you still need to know first.$body$,
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

If the timing is wrong, tell me and I'll let you know when the next one is instead. If you want a place, register and you're set.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   7, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL)
ON CONFLICT (sequence_id, position) DO NOTHING;

-- -----------------------------------------------------------------------------
-- The four Athlete Quiz sequences (gaps #6, #7). Each has exactly one step
-- today -- position 0, kind email, live copy from 00253 -- and no stop step,
-- so positions 1-7 append cleanly with nothing to renumber.
--
-- Position 0 is UNTOUCHED here. That is reviewed, production copy from
-- 00253; rewriting it would discard the owner's own pass over the wording.
--
-- Shape, identical across all four: 1 wait 2d, 2 email, 3 branch has_user
-- (true 6 / false 4), prospect arm 4 email -> 5 stop, client arm 6 email ->
-- 7 stop. The reader who already has an account gets the client arm; nobody
-- who already bought is asked to book a call.
--
-- Same reason as abandoned_checkout's branch above: each arm ends in its
-- own stop, or a prospect falls through into the client email (or the
-- reverse) and the reader gets both endings.
-- -----------------------------------------------------------------------------

-- quiz_ceiling_breaker: already performing, looking for the next level.
INSERT INTO public.sequence_steps
  (business_id, sequence_id, position, kind, wait_minutes, subject, body, config, branch_condition, on_true_position, on_false_position)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
   1, 'wait', 2880, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
   2, 'email', NULL,
   $subj$The part most people train around$subj$,
   $body$Hi {{name}}

A quick follow-up to your result.

When someone is already working hard and the numbers stop moving, it's rarely a work-rate problem. One or two specific qualities have usually stopped feeding into the thing you actually do, and everything built on top of them is capped by that.

It's a specific problem, and it is fixable — just not by training harder around it.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
   3, 'branch', NULL, NULL, NULL, '{}'::jsonb,
   $cond${"kind": "has_user"}$cond$::jsonb, 6, 4),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
   4, 'email', NULL,
   $subj$Which one is holding you back$subj$,
   $body$Hi {{name}}

If you want to know which of those qualities is actually costing you output, that's a short conversation, not a long assessment.

Reply to this email and tell me what you are training for and what has plateaued. I'll tell you where I would start.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
   5, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
   6, 'email', NULL,
   $subj$Worth raising at your next session$subj$,
   $body$Hi {{name}}

You're already training with us, so there is nothing to sign up for here.

Bring what the quiz flagged to your next session and we'll look at it directly — it's more useful in front of someone than on a screen.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
   7, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL)
ON CONFLICT (sequence_id, position) DO NOTHING;

-- quiz_rebuilder: coming back from injury or recurring breakdown. Tone
-- matters most here -- must never read as a sales push at someone hurt.
INSERT INTO public.sequence_steps
  (business_id, sequence_id, position, kind, wait_minutes, subject, body, config, branch_condition, on_true_position, on_false_position)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_rebuilder'),
   1, 'wait', 2880, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_rebuilder'),
   2, 'email', NULL,
   $subj$Where the load is actually going$subj$,
   $body$Hi {{name}}

A short follow-up to your result.

When something keeps coming back, the spot that hurts usually isn't where the problem started. Load has been going somewhere it shouldn't, and the pain is just where it shows up first.

That's worth knowing before you push volume again, not after.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_rebuilder'),
   3, 'branch', NULL, NULL, NULL, '{}'::jsonb,
   $cond${"kind": "has_user"}$cond$::jsonb, 6, 4),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_rebuilder'),
   4, 'email', NULL,
   $subj$If you want to talk through what recurs$subj$,
   $body$Hi {{name}}

No pressure here — if you'd like to talk through what keeps recurring, reply to this email and tell me what's been happening and when it shows up.

I won't chase this if you'd rather sit with it for now.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_rebuilder'),
   5, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_rebuilder'),
   6, 'email', NULL,
   $subj$Worth telling your coach$subj$,
   $body$Hi {{name}}

You're already training with us, so this isn't about booking anything.

If what the quiz flagged is still showing up, tell your coach directly — the plan can only account for it if we know it's there.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_rebuilder'),
   7, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL)
ON CONFLICT (sequence_id, position) DO NOTHING;

-- quiz_aspiring_pro: young athlete building toward something serious.
-- Reader may be the athlete or a parent, so this stays in second person
-- and reads fine at a kitchen table -- matching how 00253 already voices it.
INSERT INTO public.sequence_steps
  (business_id, sequence_id, position, kind, wait_minutes, subject, body, config, branch_condition, on_true_position, on_false_position)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_aspiring_pro'),
   1, 'wait', 2880, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_aspiring_pro'),
   2, 'email', NULL,
   $subj$The base that gets built early$subj$,
   $body$Hi {{name}}

A follow-up to your result.

At this stage the gap between good and serious usually isn't talent. It's whether the physical base gets built before the sport starts demanding it — strength, movement, the boring stuff.

Skip it now and it doesn't disappear. It just gets more expensive to fix later.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_aspiring_pro'),
   3, 'branch', NULL, NULL, NULL, '{}'::jsonb,
   $cond${"kind": "has_user"}$cond$::jsonb, 6, 4),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_aspiring_pro'),
   4, 'email', NULL,
   $subj$What to prioritise first$subj$,
   $body$Hi {{name}}

If you want to know what to prioritise first, reply to this email and tell me what you're training for and how the season is shaping up.

I'll tell you where I would start.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_aspiring_pro'),
   5, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_aspiring_pro'),
   6, 'email', NULL,
   $subj$Worth keeping in during the season$subj$,
   $body$Hi {{name}}

You're already training with us, so there's nothing to sign up for here.

When the season gets busy, the base work is usually the first thing that gets dropped — and the easiest to lose without noticing. Keep it in, even if it is just maintenance volume.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_aspiring_pro'),
   7, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL)
ON CONFLICT (sequence_id, position) DO NOTHING;

-- quiz_parent_coach: a parent or coach enquiring on an athlete's behalf.
-- Third person about the athlete throughout, same as 00253's position 0 --
-- never "you" or "your body" for the athlete's own qualities.
INSERT INTO public.sequence_steps
  (business_id, sequence_id, position, kind, wait_minutes, subject, body, config, branch_condition, on_true_position, on_false_position)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_parent_coach'),
   1, 'wait', 2880, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_parent_coach'),
   2, 'email', NULL,
   $subj$Why group programs don't fit here$subj$,
   $body$Hi {{name}}

A follow-up on the athlete's result.

Most group programs are built for the average kid in the room, not the one you're asking about. What the quiz flagged is specific to them, and it's easy for a general session to miss it entirely.

That gap doesn't close on its own — it usually shows up later, at a worse time.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_parent_coach'),
   3, 'branch', NULL, NULL, NULL, '{}'::jsonb,
   $cond${"kind": "has_user"}$cond$::jsonb, 6, 4),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_parent_coach'),
   4, 'email', NULL,
   $subj$Happy to go through it with you$subj$,
   $body$Hi {{name}}

If you'd like to go through what the quiz flagged together, reply to this email and tell me what the athlete is working on and what you are seeing day to day.

I'll tell you what I'd focus on first.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_parent_coach'),
   5, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_parent_coach'),
   6, 'email', NULL,
   $subj$How to support what's already working$subj$,
   $body$Hi {{name}}

The athlete is already training with us, so there's nothing here to sign up for.

The best thing you can do is keep doing what you're already doing: get them there, ask how it's going, and leave the programming to us. If something specific is nagging them, mention it to their coach directly.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_parent_coach'),
   7, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL)
ON CONFLICT (sequence_id, position) DO NOTHING;

-- The four quiz sequences are ACTIVE in production and one email long. Adding
-- steps to a live sequence means the next person who takes the quiz receives
-- copy nobody has read -- which defeats the gate 00218, 00229 and 00253 all
-- describe. The owner's decision on 2026-09-08 was to pause them here and
-- re-activate after reading.
--
-- Safe mid-flight: enrollIfTriggered only reads status = 'active', so no NEW
-- run starts, and no run exists to strand (zero quiz runs, ever).
--
-- To switch them back on after reading the copy:
--     UPDATE public.sequences SET status = 'active' WHERE key LIKE 'quiz_%';
UPDATE public.sequences
SET status = 'paused', updated_at = now()
WHERE business_id = '00000000-0000-0000-0000-000000000001'
  AND key LIKE 'quiz_%'
  AND status = 'active';
