-- supabase/migrations/00281_chat_follow_up_and_camp_countdown.sql
--
-- Two of the owner's answers of 2026-09-27 (docs/superpowers/specs/
-- 2026-09-27-lead-engine-owner-answers-design.md, sections 1 and 2), in one
-- file because both have to re-issue the same function.
--
-- 1. G18 -- A CHAT LEAD GETS A FOLLOW-UP. `POST /api/ask/capture` saves a
--    contact and records a timeline event with source `ai_chat`, and until now
--    no sequence had that trigger: nobody followed up, AND nothing told the
--    coach (the capture writes no notification and sends no email) -- while
--    the visitor had just been told "someone has your details now". A twelfth
--    starter sequence, `chat_lead_follow_up`, answers both: its first step is
--    an `alert` to the coach, then two emails and a text to the lead.
--
-- 2. G11 -- THE CAMP COUNTDOWN BECOMES 14 / 7 / 3 / 1. `camp_clinic_deadline`
--    ended: wait until 3 days before, "Last one about this", stop. That email
--    says "I will not keep bringing it up" and the owner approved it, so a
--    fourth email AFTER it would break the promise the owner signed off (the
--    reasoning 00272 used to place the camp text). The approved email therefore
--    stays LAST and moves to 1 day before, and one new email, "Three days to
--    go", takes the 3-day moment. With p the position of the 3-day wait:
--
--           before                             after
--      p    wait until 3 days before           wait until 3 days before     (same row)
--      p+1  email "Last one about this"        email "Three days to go"     (NEW)
--      p+2  stop                               wait until 1 day before      (NEW)
--      p+3                                     email "Last one about this"  (same row, moved)
--      p+4                                     stop                         (same row, moved)
--
-- WHICH BUSINESSES THIS TOUCHES (00279's FUTURE COPY MIGRATIONS paragraph asks
-- every copy migration to say so in its own header):
--
--   * EVERY business gets a DRAFT `chat_lead_follow_up`, the platform business
--     included, through the backfill at the end.
--   * EVERY business's `camp_clinic_deadline` whose steps still END in the
--     "before" shape above is converted, whatever its status. A copy whose tail
--     a coach has changed -- a different last wait, a step after the stop, a
--     branch anywhere, a 1-day reminder of their own -- is SKIPPED with a
--     NOTICE and left exactly as it is. One tenant's edit never blocks the
--     conversion for the others.
--   * A NEW business gets both through `seed_business_starter_set`, re-issued
--     below WHOLE from 00279 with exactly two changes: the camp literal (the
--     new tail, and one clause of its description) and one appended
--     `seed_starter_sequence` call for the chat sequence. The test for this
--     file pins that nothing else in the function moved, against 00279's text.
--
-- WHY THE CHAT FOLLOW-UP IS A DRAFT EVERYWHERE, the platform included. 00229's
-- rule: the gate on a sequence reaching the public is a human reading it. The
-- owner switches it on at Sequences -> Chat Lead Follow-Up with one confirmed
-- click. Nothing in this file sets any sequence's status.
--
-- WHY THE COACH ALERT IS STEP 1. It is the only thing that makes "someone has
-- your details now" true. An alert is never held by quiet hours or the daily
-- cap and never consumes the lead's allowance (G12), so the lead's own email
-- still goes out on the next tick. The text sits behind a one-day wait, like
-- every text since 00272: straight after an email, a daily cap of 1 would land
-- it the next morning anyway. The text follows 00272's four rules (plain ASCII,
-- no merge field, no STOP line of its own, one segment with the opt-out
-- appended), counted by the test through the project's own `countSmsSegments`.
--
-- WHY THE CAMP'S DESCRIPTION CHANGES TOO. It is rendered on /admin/sequences,
-- and 00270 exists because it once said the opposite of what the sequence
-- did. "The next three count down ... (14, 7 and 3 days before)" is false the
-- moment a fourth reminder exists. Only that clause is rewritten, only on a
-- copy this file actually converts, and only where it still reads exactly as
-- 00279 or 00270 wrote it -- a description a coach rewrote is left alone.
--
-- IN-FLIGHT RUNS. `sequence_runs.current_position` names the NEXT step to run.
--   * a run at p (waiting for the 3-day moment) is untouched;
--   * a run at p+1 was due "Last one about this" at the 3-day moment. It now
--     gets the NEW "Three days to go" there instead, then waits for the 1-day
--     moment and gets "Last one about this", which it has never had;
--   * a run at p+2 HAS already had "Last one about this" and was about to stop.
--     Left alone it would now wait for the 1-day moment and get that email
--     AGAIN, so it moves to p+4 -- the stop, the same row it pointed at. Any
--     active run past the old end moves by the same two slots, and stays past
--     the end.
-- Only ACTIVE runs move, as in 00271, 00272 and the step editor itself
-- (`planStepSave` is only ever handed active runs): a finished run's position
-- is the record of where it ended. Production had ZERO active runs on
-- 2026-09-27; the rule still has to be right wherever it runs.
--
-- EXISTING ROWS KEEP THEIR IDS, so `sequence_messages` history and its
-- cascading FK (`sequence_messages_step_id_fkey`) are untouched: nothing is
-- deleted, the email and the stop are renumbered through the +1000 park
-- (`sequence_steps_position_uniq` is unique on (sequence_id, position)), and
-- the two new rows go into the gap. The new wait carries no minutes -- it says
-- WHEN, not how long, which 00268 widened `sequence_steps_wait_needs_minutes`
-- to allow.
--
-- RE-RUNNING THIS FILE CHANGES NOTHING. A converted copy already waits until 1
-- day before, so it is skipped; the backfill adds only missing keys; the
-- function is replaced by itself. The verification is scoped to what THIS run
-- converted, and converting nothing is not an error (unlike 00272, whose
-- "converted nothing" exception made it unrepeatable).
--
-- WHAT THE BACKFILL CAN ADD BESIDES THE CHAT SEQUENCE. It calls the whole
-- starter set, which adds any of its keys a business lacks. The product has no
-- way to delete a sequence or a board (they are archived, and an archived one
-- still holds its key), so a key can only be missing if someone removed the
-- row by hand; such a key comes back as a draft, exactly as 00279's own
-- backfill would have added it.
--
-- EVERY INSERT NAMES business_id, for the reason 00279 gives: the column
-- DEFAULTS to the platform's id, so leaving it out files a tenant's row under
-- the platform silently.

-- ---------------------------------------------------------------------------
-- 1. seed_business_starter_set, re-issued whole: 00279's, plus the camp's new
--    tail and the chat follow-up. Safe to call on any business any number of
--    times: each call inside it is a no-op once that key already exists.
-- ---------------------------------------------------------------------------

create or replace function public.seed_business_starter_set(p_business_id uuid) returns void
language plpgsql
set search_path = public
as $function$
begin
  perform public.seed_starter_board(
    p_business_id,
    $board$
    {
      "key": "coaching",
      "name": "Coaching",
      "stages": [
        {
          "key": "consult_booked",
          "name": "Consult Booked",
          "position": 1,
          "kind": "open",
          "amber_after_days": 3,
          "red_after_days": 7
        },
        {
          "key": "consulted",
          "name": "Consulted",
          "position": 2,
          "kind": "open",
          "amber_after_days": 5,
          "red_after_days": 14
        },
        {
          "key": "won",
          "name": "Won",
          "position": 3,
          "kind": "won",
          "amber_after_days": null,
          "red_after_days": null
        },
        {
          "key": "lost",
          "name": "Lost",
          "position": 4,
          "kind": "lost",
          "amber_after_days": null,
          "red_after_days": null
        }
      ]
    }
    $board$::jsonb,
    now()
  );

  -- Stamped one millisecond after Coaching, deliberately, not concurrently
  -- with it. `listPipelines` orders by (created_at, key), and every row this
  -- function writes in one call would otherwise share the same `now()` --
  -- which would list Assessment and Camps & Clinics ahead of Coaching, since
  -- "assessment" and "camps_clinics" sort before "coaching". The one
  -- millisecond offset is enough to break that tie without being visible
  -- anywhere a person reads a timestamp.
  perform public.seed_starter_board(
    p_business_id,
    $board$
    {
      "key": "assessment",
      "name": "Assessment",
      "stages": [
        {
          "key": "assessment_booked",
          "name": "Assessment Booked",
          "position": 1,
          "kind": "open",
          "amber_after_days": 3,
          "red_after_days": 7
        },
        {
          "key": "assessment_completed",
          "name": "Assessment Completed",
          "position": 2,
          "kind": "open",
          "amber_after_days": 5,
          "red_after_days": 14
        },
        {
          "key": "won",
          "name": "Won",
          "position": 3,
          "kind": "won",
          "amber_after_days": null,
          "red_after_days": null
        },
        {
          "key": "lost",
          "name": "Lost",
          "position": 4,
          "kind": "lost",
          "amber_after_days": null,
          "red_after_days": null
        }
      ]
    }
    $board$::jsonb,
    now() + interval '1 millisecond'
  );

  perform public.seed_starter_board(
    p_business_id,
    $board$
    {
      "key": "camps_clinics",
      "name": "Camps & Clinics",
      "stages": [
        {
          "key": "interested",
          "name": "Interested",
          "position": 1,
          "kind": "open",
          "amber_after_days": 3,
          "red_after_days": 7
        },
        {
          "key": "registered",
          "name": "Registered",
          "position": 2,
          "kind": "open",
          "amber_after_days": 5,
          "red_after_days": 14
        },
        {
          "key": "won",
          "name": "Won",
          "position": 3,
          "kind": "won",
          "amber_after_days": null,
          "red_after_days": null
        },
        {
          "key": "lost",
          "name": "Lost",
          "position": 4,
          "kind": "lost",
          "amber_after_days": null,
          "red_after_days": null
        }
      ]
    }
    $board$::jsonb,
    now() + interval '1 millisecond'
  );

  perform public.seed_starter_sequence(
    p_business_id,
    $seq$
    {
      "key": "new_lead_nurture",
      "name": "New Lead Nurture",
      "description": "Follows up with someone who fills in a form on one of your funnel pages. It is the only automatic message they get from you, so the first email goes out straight away.",
      "trigger_source": "funnel_form",
      "trigger_filter": {},
      "reenrol_cooldown_days": 30,
      "steps": [
        {
          "kind": "email",
          "subject": "Thanks for reaching out about training",
          "body": "Hi {{first_name}}\n\nThanks for filling out the form — that's the first step toward a program built around your actual goals, not a generic template.\n\nOver the next few days you'll hear a bit more about how we work and what to expect. In the meantime, if you have a specific question, just reply to this email and it'll land in a real inbox."
        },
        {
          "kind": "wait",
          "wait_minutes": 4320
        },
        {
          "kind": "email",
          "subject": "What working together actually looks like",
          "body": "Hi {{first_name}}\n\nA quick look at how this usually starts: we talk about where you are now, where you want to be, and what's gotten in the way so far. From there we build a training plan around your schedule and your goals — not the other way around.\n\nIf that sounds like something you want to explore, reply to this email and we'll find a time to talk."
        },
        {
          "kind": "wait",
          "wait_minutes": 10080
        },
        {
          "kind": "email",
          "subject": "Still thinking it over?",
          "body": "Hi {{first_name}}\n\nNo pressure — just wanted to check in. If now isn't the right time, that's completely fine. If you're still weighing it, the easiest next step is a short call to talk through what you're working with and whether this is a good fit.\n\nReply any time and we'll get something on the calendar."
        },
        {
          "kind": "stop"
        }
      ]
    }
    $seq$::jsonb
  );

  perform public.seed_starter_sequence(
    p_business_id,
    $seq$
    {
      "key": "lead_magnet_delivery",
      "name": "Lead Magnet Follow-Up",
      "description": "Follows someone who downloads one of your free guides. The guide itself is emailed the moment they ask for it, so this starts with a two-day wait instead of a second email.",
      "trigger_source": "lead_magnet",
      "trigger_filter": {},
      "reenrol_cooldown_days": 30,
      "steps": [
        {
          "kind": "wait",
          "wait_minutes": 2880
        },
        {
          "kind": "email",
          "subject": "Did the guide answer what you were looking for?",
          "body": "Hi {{first_name}}\n\nHope the guide was useful. A lot of people read something like it and still have questions specific to their own situation — different sport, different schedule, coming back from an injury, whatever it is.\n\nIf that's you, reply and tell me what you're working with. Happy to point you in the right direction."
        },
        {
          "kind": "wait",
          "wait_minutes": 5760
        },
        {
          "kind": "email",
          "subject": "A next step, if you want one",
          "body": "Hi {{first_name}}\n\nIf you found the guide helpful and you're curious what a full training plan built around your goals would look like, the next step is a short call — no pressure, just a conversation about where you are and what would actually move the needle.\n\nReply to this email and we'll set something up."
        },
        {
          "kind": "wait",
          "wait_minutes": 1440
        },
        {
          "kind": "sms",
          "body": "Did the download land? If anything in it raises a question, text back and a real person answers."
        },
        {
          "kind": "stop"
        }
      ]
    }
    $seq$::jsonb
  );

  perform public.seed_starter_sequence(
    p_business_id,
    $seq$
    {
      "key": "newsletter_welcome",
      "name": "Newsletter Welcome",
      "description": "Welcomes a new newsletter subscriber. Nothing else emails them when they sign up, so the first message goes out straight away.",
      "trigger_source": "newsletter",
      "trigger_filter": {},
      "reenrol_cooldown_days": 30,
      "steps": [
        {
          "kind": "email",
          "subject": "You're on the list",
          "body": "Hi {{first_name}}\n\nThanks for signing up. You'll get training tips, program updates, and the occasional idea worth trying — nothing you didn't ask for."
        },
        {
          "kind": "wait",
          "wait_minutes": 4320
        },
        {
          "kind": "email",
          "subject": "One thing worth trying this week",
          "body": "Hi {{first_name}}\n\nSince you're on the list, here's something concrete: pick one part of your training you've been putting off — mobility work, a weak lift, recovery — and give it real focus for the next two weeks. Small, consistent attention beats a big overhaul almost every time.\n\nIf you want help figuring out where to focus, just reply and let us know what you're working with."
        },
        {
          "kind": "wait",
          "wait_minutes": 1440
        },
        {
          "kind": "sms",
          "body": "Thanks for joining the newsletter. Expect useful training ideas, no filler. Save this number so you know it's us."
        },
        {
          "kind": "stop"
        }
      ]
    }
    $seq$::jsonb
  );

  perform public.seed_starter_sequence(
    p_business_id,
    $seq$
    {
      "key": "cold_lead_re_engagement",
      "name": "Cold Lead Re-engagement",
      "description": "For leads who have gone quiet. Nobody is added automatically: you choose who to add, from their contact page.",
      "trigger_source": null,
      "trigger_filter": {},
      "reenrol_cooldown_days": 30,
      "steps": [
        {
          "kind": "email",
          "subject": "Checking back in",
          "body": "Hi {{first_name}}\n\nIt's been a while since we last talked, and a lot can change — new season, new schedule, new goals. Wanted to check in and see where things stand for you now.\n\nIf training is something you're thinking about again, reply and let us know what's changed."
        },
        {
          "kind": "wait",
          "wait_minutes": 10080
        },
        {
          "kind": "email",
          "subject": "Last check-in for now",
          "body": "Hi {{first_name}}\n\nJust one more note — if the timing still isn't right, no worries at all, and we'll leave it here for now. If something has shifted and you'd like to pick things back up, reply any time and we'll go from there."
        },
        {
          "kind": "wait",
          "wait_minutes": 4320
        },
        {
          "kind": "sms",
          "body": "No pressure. If getting back to training is still on your mind, reply here and we'll find a time to talk."
        },
        {
          "kind": "stop"
        }
      ]
    }
    $seq$::jsonb
  );

  perform public.seed_starter_sequence(
    p_business_id,
    $seq$
    {
      "key": "abandoned_checkout",
      "name": "Abandoned checkout",
      "description": "Follows someone who started paying for coaching or a program and did not finish. The payment provider only reports this when the checkout expires, about a day later, so the first message is a day behind. Shop orders, event tickets and saved-card setups are not included.",
      "trigger_source": "checkout_abandoned",
      "trigger_filter": {},
      "reenrol_cooldown_days": 30,
      "steps": [
        {
          "kind": "email",
          "subject": "You left something half-finished",
          "body": "Hi {{first_name}}\n\nYou started to pay for something and it did not go through. That happens — it's usually a question that didn't have an obvious answer.\n\nIf it was the price, the commitment, or whether it is the right thing right now, tell me which and I'll give you a straight answer. If it was just the timing, that's fine too.\n\nReply to this email and let me know."
        },
        {
          "kind": "wait",
          "wait_minutes": 2880
        },
        {
          "kind": "tag",
          "config": {
            "tag": "abandoned-checkout"
          }
        },
        {
          "kind": "branch",
          "branch_condition": {
            "kind": "has_consent",
            "channel": "sms"
          },
          "on_true_position": 4,
          "on_false_position": 6
        },
        {
          "kind": "sms",
          "body": "You started to pay for something and it didn't go through. If something was unclear, text back and a real person answers."
        },
        {
          "kind": "stop"
        },
        {
          "kind": "email",
          "subject": "Still worth a conversation",
          "body": "Hi {{first_name}}\n\nI'll leave this one here.\n\nIf you want to talk it through before deciding anything, reply to this email. No commitment, and no follow-up after this if you'd rather leave it."
        },
        {
          "kind": "stop"
        }
      ]
    }
    $seq$::jsonb
  );

  perform public.seed_starter_sequence(
    p_business_id,
    $seq$
    {
      "key": "service_application_received",
      "name": "Service application received",
      "description": "Follows someone who sends the enquiry form on one of your service pages. Two days in, you get a reminder to check that someone has replied to them.",
      "trigger_source": "inquiry",
      "trigger_filter": {},
      "reenrol_cooldown_days": 30,
      "steps": [
        {
          "kind": "wait",
          "wait_minutes": 2880
        },
        {
          "kind": "alert",
          "subject": "{{name}} applied two days ago — have you replied?",
          "body": "{{name}} sent a service application two days ago.\n\nThe follow-up emails are still going out on schedule. This is only a nudge to check that a person has actually come back to them.\n\nWe cannot see your inbox, so if you have already replied there is nothing to do here.\n\nYou will not get another reminder about this one."
        },
        {
          "kind": "email",
          "subject": "What the first conversation covers",
          "body": "Hi {{first_name}}\n\nWhile you're waiting, here is what the first conversation actually is, so it's not a mystery.\n\nIt is a straight talk about what you are training for, what has and hasn't worked, and anything that keeps breaking down. No assessment to prepare for and nothing to bring.\n\nBy the end of it you should know whether this is worth doing. If it's not, I'll say so."
        },
        {
          "kind": "wait",
          "wait_minutes": 5760
        },
        {
          "kind": "email",
          "subject": "Still want to talk?",
          "body": "Hi {{first_name}}\n\nI haven't heard back, so this is the last one about your application.\n\nIf you still want to go through it, reply and we'll find a time. If your plans changed, no reply needed — I will leave you alone."
        },
        {
          "kind": "wait",
          "wait_minutes": 1440
        },
        {
          "kind": "sms",
          "body": "If the timing is wrong, say so and I will close this off. Otherwise reply here and we will find a slot."
        },
        {
          "kind": "stop"
        }
      ]
    }
    $seq$::jsonb
  );

  perform public.seed_starter_sequence(
    p_business_id,
    $seq$
    {
      "key": "camp_clinic_deadline",
      "name": "Camp or clinic deadline",
      "description": "Chases someone who registered interest in a camp or clinic and has not paid. The first email goes out straight away. The next four count down to the camp's own start date (14, 7 and 3 days before, and the day before), so everyone gets them at the same moment, whenever they signed up. Someone who signs up late skips the reminders whose moment has passed. Someone added by hand has no camp date, so their follow-up stops after the first email. The copy never names a particular camp.",
      "trigger_source": "event_signup",
      "trigger_filter": {
        "signup_type": "interest"
      },
      "reenrol_cooldown_days": 30,
      "steps": [
        {
          "kind": "email",
          "subject": "About the camp you asked about",
          "body": "Hi {{first_name}}\n\nThanks for putting your name down. Your place isn't held yet — that happens when you register properly — but here is what it covers so you can decide.\n\nIt's a small group, working on the things that actually limit an athlete rather than a general session everyone gets. If you have a specific problem you want looked at, bring it.\n\nIf you want the details again or have a question first, reply to this email."
        },
        {
          "kind": "wait",
          "config": {
            "wait_until": {
              "days_before_anchor": 14
            }
          }
        },
        {
          "kind": "email",
          "subject": "What a day there looks like",
          "body": "Hi {{first_name}}\n\nIn case it helps you decide.\n\nThe day's mostly work, not talking. We look at how an athlete moves under load, fix the things that are cheap to fix on the spot, and give them the two or three things worth taking home. Nobody's standing around.\n\nAthletes usually leave knowing exactly what to work on, which is the part that lasts after the day ends.\n\nReply if you want to know whether it suits the athlete you have in mind."
        },
        {
          "kind": "wait",
          "config": {
            "wait_until": {
              "days_before_anchor": 7
            }
          }
        },
        {
          "kind": "email",
          "subject": "Places are limited",
          "body": "Hi {{first_name}}\n\nA quick heads up: places are capped so the coaching stays hands-on, and registering interest doesn't hold one.\n\nIf you want the spot, register properly and it's yours. If you've decided against it, that is completely fine — you can ignore this.\n\nReply if there's anything you still need to know first."
        },
        {
          "kind": "wait",
          "wait_minutes": 1440
        },
        {
          "kind": "sms",
          "body": "Places at the camp are capped, and registering interest does not hold one. Reply here if you want yours."
        },
        {
          "kind": "wait",
          "config": {
            "wait_until": {
              "days_before_anchor": 3
            }
          }
        },
        {
          "kind": "email",
          "subject": "Three days to go",
          "body": "Hi {{first_name}}\n\nThe camp is three days away. If you're still deciding, the thing worth knowing is that registering interest doesn't hold a place — registering properly does.\n\nIf something's in the way, such as the date, the cost, or whether it's the right level, reply and tell me. I'd rather sort it out than have you miss it."
        },
        {
          "kind": "wait",
          "config": {
            "wait_until": {
              "days_before_anchor": 1
            }
          }
        },
        {
          "kind": "email",
          "subject": "Last one about this",
          "body": "Hi {{first_name}}\n\nLast message about the camp — I will not keep bringing it up.\n\nIf the timing is wrong, tell me and I'll let you know when the next one is instead. If you want a place, register and you're set."
        },
        {
          "kind": "stop"
        }
      ]
    }
    $seq$::jsonb
  );

  perform public.seed_starter_sequence(
    p_business_id,
    $seq$
    {
      "key": "quiz_ceiling_breaker",
      "name": "Quiz — Ceiling Breaker",
      "description": "Follows an athlete whose quiz result was Ceiling Breaker: already performing, looking for the next level. Their result is on screen before this arrives, so the first step sends immediately. It only runs for a quiz copied from the built-in quiz, whose results carry these names.",
      "trigger_source": "quiz",
      "trigger_filter": {
        "branch": "ceiling_breaker"
      },
      "reenrol_cooldown_days": 0,
      "steps": [
        {
          "kind": "email",
          "subject": "Your quiz result",
          "body": "Hi {{first_name}}\n\nYour results are in the link you just saw — worth reading properly rather than skimming.\n\nThe pattern with athletes at your level is rarely a lack of work. It's that one or two specific qualities have stopped translating into output, and training harder around them doesn't fix it.\n\nIf you want to know which ones, reply to this email and tell me what you're training for."
        },
        {
          "kind": "wait",
          "wait_minutes": 1440
        },
        {
          "kind": "sms",
          "body": "Your quiz result went to your email yesterday. Cannot see it? Check your spam folder. Reply here with any question."
        },
        {
          "kind": "wait",
          "wait_minutes": 2880
        },
        {
          "kind": "email",
          "subject": "The part most people train around",
          "body": "Hi {{first_name}}\n\nA quick follow-up to your result.\n\nWhen someone is already working hard and the numbers stop moving, it's rarely a work-rate problem. One or two specific qualities have usually stopped feeding into the thing you actually do, and everything built on top of them is capped by that.\n\nIt's a specific problem, and it is fixable — just not by training harder around it."
        },
        {
          "kind": "branch",
          "branch_condition": {
            "kind": "has_user"
          },
          "on_true_position": 8,
          "on_false_position": 6
        },
        {
          "kind": "email",
          "subject": "Which one is holding you back",
          "body": "Hi {{first_name}}\n\nIf you want to know which of those qualities is actually costing you output, that's a short conversation, not a long assessment.\n\nReply to this email and tell me what you are training for and what has plateaued. I'll tell you where I would start."
        },
        {
          "kind": "stop"
        },
        {
          "kind": "email",
          "subject": "Worth raising at your next session",
          "body": "Hi {{first_name}}\n\nYou already have an account with us, so there is nothing to sign up for here.\n\nBring what the quiz flagged to your next session and we'll look at it directly — it's more useful in front of someone than on a screen."
        },
        {
          "kind": "stop"
        }
      ]
    }
    $seq$::jsonb
  );

  perform public.seed_starter_sequence(
    p_business_id,
    $seq$
    {
      "key": "quiz_rebuilder",
      "name": "Quiz — Rebuilder",
      "description": "Follows an athlete whose quiz result was Rebuilder: coming back from injury or recurring breakdown. Tone matters most here: this sequence must never read as a sales push at someone who is hurt. It only runs for a quiz copied from the built-in quiz, whose results carry these names.",
      "trigger_source": "quiz",
      "trigger_filter": {
        "branch": "rebuilder"
      },
      "reenrol_cooldown_days": 0,
      "steps": [
        {
          "kind": "email",
          "subject": "Your quiz result",
          "body": "Hi {{first_name}}\n\nYour results are in the link you just saw.\n\nWhen something keeps breaking down, the site of the pain is usually not the cause. What the quiz points at is where load is going that shouldn't be — which is the part worth fixing before you push volume again.\n\nIf you want to talk through what's been recurring, reply to this email."
        },
        {
          "kind": "wait",
          "wait_minutes": 1440
        },
        {
          "kind": "sms",
          "body": "Your quiz result went to your email yesterday. Cannot see it? Check your spam folder. Reply here with any question."
        },
        {
          "kind": "wait",
          "wait_minutes": 2880
        },
        {
          "kind": "email",
          "subject": "Where the load is actually going",
          "body": "Hi {{first_name}}\n\nA short follow-up to your result.\n\nWhen something keeps coming back, the spot that hurts usually isn't where the problem started. Load has been going somewhere it shouldn't, and the pain is just where it shows up first.\n\nThat's worth knowing before you push volume again, not after."
        },
        {
          "kind": "branch",
          "branch_condition": {
            "kind": "has_user"
          },
          "on_true_position": 8,
          "on_false_position": 6
        },
        {
          "kind": "email",
          "subject": "If you want to talk through what recurs",
          "body": "Hi {{first_name}}\n\nNo pressure here — if you'd like to talk through what keeps recurring, reply to this email and tell me what's been happening and when it shows up.\n\nI won't chase this if you'd rather sit with it for now."
        },
        {
          "kind": "stop"
        },
        {
          "kind": "email",
          "subject": "Worth telling your coach",
          "body": "Hi {{first_name}}\n\nYou already have an account with us, so this isn't about booking anything.\n\nIf what the quiz flagged is still showing up, tell your coach directly — the plan can only account for it if we know it's there."
        },
        {
          "kind": "stop"
        }
      ]
    }
    $seq$::jsonb
  );

  perform public.seed_starter_sequence(
    p_business_id,
    $seq$
    {
      "key": "quiz_aspiring_pro",
      "name": "Quiz — Aspiring Pro",
      "description": "Follows a young athlete building toward something serious. The reader may be the athlete or a parent, so the copy should work read aloud at a kitchen table. It only runs for a quiz copied from the built-in quiz, whose results carry these names.",
      "trigger_source": "quiz",
      "trigger_filter": {
        "branch": "aspiring_pro"
      },
      "reenrol_cooldown_days": 0,
      "steps": [
        {
          "kind": "email",
          "subject": "Your quiz result",
          "body": "Hi {{first_name}}\n\nYour results are in the link you just saw.\n\nAt your stage the gap between good and serious is rarely talent — it's whether the physical base gets built before the sport demands it. The things the quiz flagged are the ones that get expensive later if they're left.\n\nIf you want to know what to prioritise first, reply to this email."
        },
        {
          "kind": "wait",
          "wait_minutes": 1440
        },
        {
          "kind": "sms",
          "body": "Your quiz result went to your email yesterday. Cannot see it? Check your spam folder. Reply here with any question."
        },
        {
          "kind": "wait",
          "wait_minutes": 2880
        },
        {
          "kind": "email",
          "subject": "The base that gets built early",
          "body": "Hi {{first_name}}\n\nA follow-up to your result.\n\nAt this stage the gap between good and serious usually isn't talent. It's whether the physical base gets built before the sport starts demanding it — strength, movement, the boring stuff.\n\nSkip it now and it doesn't disappear. It just gets more expensive to fix later."
        },
        {
          "kind": "branch",
          "branch_condition": {
            "kind": "has_user"
          },
          "on_true_position": 8,
          "on_false_position": 6
        },
        {
          "kind": "email",
          "subject": "What to prioritise first",
          "body": "Hi {{first_name}}\n\nIf you want to know what to prioritise first, reply to this email and tell me what you're training for and how the season is shaping up.\n\nI'll tell you where I would start."
        },
        {
          "kind": "stop"
        },
        {
          "kind": "email",
          "subject": "Worth keeping in during the season",
          "body": "Hi {{first_name}}\n\nYou already have an account with us, so there's nothing to sign up for here.\n\nWhen the season gets busy, the base work is usually the first thing that gets dropped — and the easiest to lose without noticing. Keep it in, even if it is just maintenance volume."
        },
        {
          "kind": "stop"
        }
      ]
    }
    $seq$::jsonb
  );

  perform public.seed_starter_sequence(
    p_business_id,
    $seq$
    {
      "key": "quiz_parent_coach",
      "name": "Quiz — Parent or Coach",
      "description": "Follows a parent or coach enquiring on an athlete's behalf. The quiz asks its questions in the third person for this result, and the follow-up does too: the reader is not the athlete. It only runs for a quiz copied from the built-in quiz, whose results carry these names.",
      "trigger_source": "quiz",
      "trigger_filter": {
        "branch": "parent_coach"
      },
      "reenrol_cooldown_days": 0,
      "steps": [
        {
          "kind": "email",
          "subject": "The athlete's quiz result",
          "body": "Hi {{first_name}}\n\nThe results are in the link you just saw.\n\nMost programs an athlete this age lands in are built for a group, not for them. What the quiz flags is specific to the athlete you answered for — and it's the difference between training that holds up and training that just adds load.\n\nIf you'd like to go through it, reply to this email."
        },
        {
          "kind": "wait",
          "wait_minutes": 1440
        },
        {
          "kind": "sms",
          "body": "The athlete's quiz result went to your email yesterday. Cannot see it? Check your spam. Reply here with a question."
        },
        {
          "kind": "wait",
          "wait_minutes": 2880
        },
        {
          "kind": "email",
          "subject": "Why group programs don't fit here",
          "body": "Hi {{first_name}}\n\nA follow-up on the athlete's result.\n\nMost group programs are built for the average kid in the room, not the one you're asking about. What the quiz flagged is specific to them, and it's easy for a general session to miss it entirely.\n\nThat gap doesn't close on its own — it usually shows up later, at a worse time."
        },
        {
          "kind": "branch",
          "branch_condition": {
            "kind": "has_user"
          },
          "on_true_position": 8,
          "on_false_position": 6
        },
        {
          "kind": "email",
          "subject": "Happy to go through it with you",
          "body": "Hi {{first_name}}\n\nIf you'd like to go through what the quiz flagged together, reply to this email and tell me what the athlete is working on and what you are seeing day to day.\n\nI'll tell you what I'd focus on first."
        },
        {
          "kind": "stop"
        },
        {
          "kind": "email",
          "subject": "How to support what's already working",
          "body": "Hi {{first_name}}\n\nThe athlete already has an account with us, so there's nothing here to sign up for.\n\nThe best thing you can do is keep doing what you're already doing: get them there, ask how it's going, and leave the programming to us. If something specific is nagging them, mention it to their coach directly."
        },
        {
          "kind": "stop"
        }
      ]
    }
    $seq$::jsonb
  );

  -- 00281 (G18). A draft like every sequence above: 00229's rule is that a
  -- human reads copy before it reaches the public.
  perform public.seed_starter_sequence(
    p_business_id,
    $seq$
    {
      "key": "chat_lead_follow_up",
      "name": "Chat Lead Follow-Up",
      "description": "Follows someone who leaves their details in the chat on your website. It tells you straight away so a person can reply, confirms to them that their question reached you, then checks in two days later.",
      "trigger_source": "ai_chat",
      "trigger_filter": {},
      "reenrol_cooldown_days": 30,
      "steps": [
        {
          "kind": "alert",
          "subject": "{{name}} left their details in your website chat",
          "body": "{{name}} asked a question in the chat on your website and left their details so someone can get back to them.\n\nThey were told a person would be in touch. Open the chat assistant in your admin to read what they asked, then reply by email or text.\n\nThey also get a short automatic email saying their question reached you."
        },
        {
          "kind": "email",
          "subject": "Your question reached us",
          "body": "Hi {{first_name}}\n\nThanks for leaving your details in the chat. Your question has been passed on, and a real person will get back to you.\n\nIf there's anything you'd like to add in the meantime, such as the sport, the athlete's age, or what you're hoping to fix, just reply to this email. It helps us give you a proper answer rather than a general one."
        },
        {
          "kind": "wait",
          "wait_minutes": 2880
        },
        {
          "kind": "email",
          "subject": "Did you get what you needed?",
          "body": "Hi {{first_name}}\n\nJust checking your question got answered. If it didn't, or if it raised new ones, reply here and it comes straight to us.\n\nIf you're weighing up whether training with us is the right fit, the easiest next step is a short call. Reply with a couple of times that suit you and we'll set it up."
        },
        {
          "kind": "wait",
          "wait_minutes": 1440
        },
        {
          "kind": "sms",
          "body": "Checking your question from the website chat got answered. Reply here if you still need anything."
        },
        {
          "kind": "stop"
        }
      ]
    }
    $seq$::jsonb
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. The grants, restated exactly as 00279 section 5 restates them for this
--    function. `create or replace` keeps a replaced function's ACL, so on a
--    database that ran 00279 these change nothing; they are here so the grant
--    is explicit in the file that last defined the function, and idempotent.
--    service_role keeps EXECUTE through the project's default privilege, and
--    that is deliberately not revoked: 00279's live test and this file's call
--    the function over PostgREST as service_role.
-- ---------------------------------------------------------------------------
revoke all      on function public.seed_business_starter_set(uuid) from public;
revoke execute  on function public.seed_business_starter_set(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Convert every existing camp_clinic_deadline of the recognised shape.
--    Quoted with its own tag so the live test can find this block exactly and
--    run it again, scoped to a throwaway business.
-- ---------------------------------------------------------------------------
DO $convert$
DECLARE
  seq RECORD;
  n int;
  lo int;
  hi int;
  p int;
  converted_ids uuid[] := '{}';

  three_days_subject CONSTANT text := 'Three days to go';
  three_days_body CONSTANT text := E'Hi {{first_name}}\n\nThe camp is three days away. If you''re still deciding, the thing worth knowing is that registering interest doesn''t hold a place — registering properly does.\n\nIf something''s in the way, such as the date, the cost, or whether it''s the right level, reply and tell me. I''d rather sort it out than have you miss it.';

  -- The one clause of the description that stops being true, in the two
  -- wordings it is known to carry: 00279's starter copy, and 00270's (the
  -- platform's own row).
  starter_clause_from CONSTANT text := 'The next three count down to the camp''s own start date (14, 7 and 3 days before)';
  starter_clause_to CONSTANT text := 'The next four count down to the camp''s own start date (14, 7 and 3 days before, and the day before)';
  platform_clause_from CONSTANT text := 'The three after it count down to the camp''s own start date -- 14, 7 and 3 days before --';
  platform_clause_to CONSTANT text := 'The four after it count down to the camp''s own start date -- 14, 7 and 3 days before, and the day before --';
BEGIN
  FOR seq IN
    SELECT s.id, s.business_id
      FROM public.sequences s
     WHERE s.key = 'camp_clinic_deadline'
     ORDER BY s.id
  LOOP
    -- Already converted, or a coach added a 1-day reminder of their own.
    -- Checked FIRST, so a re-run skips before any other guard is read.
    IF EXISTS (
      SELECT 1 FROM public.sequence_steps
       WHERE sequence_id = seq.id AND kind = 'wait'
         AND config->'wait_until'->>'days_before_anchor' = '1'
    ) THEN
      RAISE NOTICE 'camp_clinic_deadline (sequence %) already waits until 1 day before; nothing to do.', seq.id;
      CONTINUE;
    END IF;

    SELECT count(*), min(position), max(position) INTO n, lo, hi
      FROM public.sequence_steps
     WHERE sequence_id = seq.id;

    -- "The last three steps" means nothing over a gap in the positions.
    IF n < 3 OR lo <> 0 OR hi <> n - 1 THEN
      RAISE NOTICE 'camp_clinic_deadline (sequence %) has % step(s) at positions %..%, not contiguous from 0; skipping.', seq.id, n, lo, hi;
      CONTINUE;
    END IF;

    -- A branch points at POSITIONS, and the renumber below would silently
    -- repoint it. The seeded camp has none.
    IF EXISTS (
      SELECT 1 FROM public.sequence_steps
       WHERE sequence_id = seq.id
         AND (on_true_position IS NOT NULL OR on_false_position IS NOT NULL)
    ) THEN
      RAISE NOTICE 'camp_clinic_deadline (sequence %) carries branch targets; skipping rather than repointing them.', seq.id;
      CONTINUE;
    END IF;

    -- THE SHAPE, by structure and never by wording: the last three steps are
    -- a wait until 3 days before, an email, and a stop.
    p := hi - 2;
    IF NOT EXISTS (
         SELECT 1 FROM public.sequence_steps
          WHERE sequence_id = seq.id AND position = p AND kind = 'wait'
            AND config->'wait_until'->>'days_before_anchor' = '3')
       OR NOT EXISTS (
         SELECT 1 FROM public.sequence_steps
          WHERE sequence_id = seq.id AND position = p + 1 AND kind = 'email')
       OR NOT EXISTS (
         SELECT 1 FROM public.sequence_steps
          WHERE sequence_id = seq.id AND position = p + 2 AND kind = 'stop')
    THEN
      RAISE NOTICE 'camp_clinic_deadline (sequence %) does not end wait-until-3-days-before / email / stop; skipping.', seq.id;
      CONTINUE;
    END IF;

    -- IN-FLIGHT RUNS FIRST, while the OLD numbering is still in force. A run
    -- at p+2 has had "Last one about this"; it follows the stop to p+4. A run
    -- at p+1 stays, and gets the new 3-day email. See the header.
    UPDATE public.sequence_runs
       SET current_position = current_position + 2, updated_at = now()
     WHERE sequence_id = seq.id AND status = 'active' AND current_position >= p + 2;

    -- The email and the stop keep their rows and ids; only their positions
    -- move, out to the park and back down two slots later.
    UPDATE public.sequence_steps
       SET position = position + 1000, updated_at = now()
     WHERE sequence_id = seq.id AND position IN (p + 1, p + 2);
    UPDATE public.sequence_steps SET position = p + 3 WHERE sequence_id = seq.id AND position = p + 1001;
    UPDATE public.sequence_steps SET position = p + 4 WHERE sequence_id = seq.id AND position = p + 1002;

    INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, subject, body)
    VALUES (seq.business_id, seq.id, p + 1, 'email', three_days_subject, three_days_body);

    INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, config)
    VALUES (seq.business_id, seq.id, p + 2, 'wait', NULL,
            jsonb_build_object('wait_until', jsonb_build_object('days_before_anchor', 1)));

    converted_ids := converted_ids || seq.id;
  END LOOP;

  -- The description, on converted copies only, and only where the clause
  -- still reads exactly as 00279 or 00270 wrote it.
  UPDATE public.sequences
     SET description = replace(replace(description, starter_clause_from, starter_clause_to),
                               platform_clause_from, platform_clause_to),
         updated_at = now()
   WHERE id = ANY (converted_ids)
     AND (strpos(description, starter_clause_from) > 0 OR strpos(description, platform_clause_from) > 0);

  -- VERIFICATION, scoped to what this run CONVERTED, so a skipped tenant can
  -- never fail it for everybody else. Contiguous positions first: a dropped
  -- renumber strands a step at 1000-something, and `decideStep` finds nothing
  -- in the gap and quietly completes the run. Then the tail itself.
  FOR seq IN
    SELECT s.id,
           count(*) AS steps,
           min(st.position) AS lo,
           max(st.position) AS hi
      FROM public.sequences s
      JOIN public.sequence_steps st ON st.sequence_id = s.id
     WHERE s.id = ANY (converted_ids)
     GROUP BY s.id
  LOOP
    IF seq.lo <> 0
       OR seq.hi <> seq.steps - 1
       OR NOT EXISTS (
         SELECT 1 FROM public.sequence_steps
          WHERE sequence_id = seq.id AND position = seq.hi - 4 AND kind = 'wait'
            AND config->'wait_until'->>'days_before_anchor' = '3')
       OR NOT EXISTS (
         SELECT 1 FROM public.sequence_steps
          WHERE sequence_id = seq.id AND position = seq.hi - 3 AND kind = 'email'
            AND subject = three_days_subject)
       OR NOT EXISTS (
         SELECT 1 FROM public.sequence_steps
          WHERE sequence_id = seq.id AND position = seq.hi - 2 AND kind = 'wait'
            AND wait_minutes IS NULL
            AND config->'wait_until'->>'days_before_anchor' = '1')
       OR NOT EXISTS (
         SELECT 1 FROM public.sequence_steps
          WHERE sequence_id = seq.id AND position = seq.hi - 1 AND kind = 'email')
       OR NOT EXISTS (
         SELECT 1 FROM public.sequence_steps
          WHERE sequence_id = seq.id AND position = seq.hi AND kind = 'stop')
    THEN
      RAISE EXCEPTION
        'camp_clinic_deadline (sequence %) ended up with % steps at positions %..%, not contiguous from 0 or not ending wait-3 / "Three days to go" / wait-1 / email / stop.',
        seq.id, seq.steps, seq.lo, seq.hi;
    END IF;
  END LOOP;

  RAISE NOTICE '00281: converted % camp_clinic_deadline copy/copies to 14/7/3/1.', cardinality(converted_ids);
END $convert$;

-- ---------------------------------------------------------------------------
-- 4. Backfill: every business gains a draft chat_lead_follow_up. Keyed on
--    ABSENCE inside the helper, never on a list of ids, so it is correct on any
--    database it runs against, leaves every existing key alone (edited or
--    not), and is a no-op on a second run.
-- ---------------------------------------------------------------------------
do $$
declare
  b record;
begin
  for b in select id from public.businesses loop
    perform public.seed_business_starter_set(b.id);
  end loop;
end $$;
