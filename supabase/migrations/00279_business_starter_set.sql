-- supabase/migrations/00279_business_starter_set.sql
--
-- G32: today `create_business()` seeds one board and nothing else -- a new
-- coach starts with an empty pipeline list and an empty sequences list, and
-- has to build both by hand before the Lead Engine does anything for them.
-- This migration gives every business the three pipeline boards and a
-- starter set of eleven sequences, all `draft`, the moment the business
-- exists, plus a backfill for businesses created before today.
--
-- The eleven are the platform's own approved copy, lightly edited: every
-- {{name}} greeting becomes {{first_name}} (so a lead reads "Hi Jane", not
-- "Hi Jane Smith"), and a short list of lines that named this platform's own
-- product, tooling or policies is reworded to say only what is universally
-- true of any coach. `sms_repermission` is left out on purpose -- it answers
-- one platform's own one-off consent campaign, not a starter sequence any
-- new business should get.
--
-- EVERY INSERT BELOW NAMES business_id EXPLICITLY. `sequences.business_id`,
-- `sequence_steps.business_id`, `pipelines.business_id` and
-- `pipeline_stages.business_id` all DEFAULT to the platform's own id, so an
-- insert that leaves the column out would file the row under the platform
-- silently -- it would still tick and send (the tick reads by sequence_id,
-- not business_id), but the owning business would never see it in its own
-- editor, and the next save from that screen would collide with a row it
-- does not know about.
--
-- FUTURE COPY MIGRATIONS, READ THIS FIRST. A migration that rewrites a
-- sequence's wording by key, the way earlier ones have, now reaches every
-- business's draft of that sequence, not just one platform row -- and a
-- business may already have edited its own copy of that draft by the time it
-- runs. Such a migration must say, in its own header, which businesses it
-- touches, and if a NEW business should also start with that changed
-- wording, it must update `seed_starter_sequence`'s JSON literal below in
-- the same migration. Nothing enforces that automatically; this paragraph is
-- the only thing that will.
--
-- The three boards' keys, names and stages are read back from the
-- migrations that first defined them for the platform (the board-seeding
-- half of `create_business()`, and the migration that added the other two
-- boards), not invented here, because `kind` is load-bearing: the pipeline
-- move route decides whether a move closes a deal from `kind in ('won',
-- 'lost')`, and a board with no `won` stage could never close one.
--
-- WHAT THIS DOES NOT DO. A new business still cannot switch any of these
-- sequences on and have it actually reach anyone: nothing yet writes the
-- domain a public form would need to resolve to this business, only an
-- admin can edit or activate a sequence, and sending needs a sender email
-- and postal address this migration does not set. Those gaps are recorded
-- elsewhere and are deliberately not this migration's job -- this migration
-- only gives every business the same starting shelf of drafts the platform
-- itself starts from.

-- ---------------------------------------------------------------------------
-- 1. seed_starter_board -- adds one board and its stages, unless the business
--    already has a board with that key.
-- ---------------------------------------------------------------------------

create or replace function public.seed_starter_board(
  p_business_id uuid,
  p_board       jsonb,
  p_created_at  timestamptz
) returns void
language plpgsql
set search_path = public
as $function$
declare
  v_pipeline uuid;
begin
  if exists (select 1 from public.pipelines where business_id = p_business_id and key = p_board->>'key') then return; end if;

  insert into public.pipelines (business_id, key, name, status, created_at)
  values (p_business_id, p_board->>'key', p_board->>'name', 'active', p_created_at)
  returning id into v_pipeline;

  insert into public.pipeline_stages (business_id, pipeline_id, key, name, position, kind, amber_after_days, red_after_days)
  select p_business_id, v_pipeline, s->>'key', s->>'name', (s->>'position')::int, s->>'kind',
         (s->>'amber_after_days')::int, (s->>'red_after_days')::int
    from jsonb_array_elements(p_board->'stages') as s;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. seed_starter_sequence -- adds one sequence and its steps as a draft,
--    unless the business already has a sequence with that key.
-- ---------------------------------------------------------------------------

create or replace function public.seed_starter_sequence(
  p_business_id uuid,
  p_sequence    jsonb
) returns void
language plpgsql
set search_path = public
as $function$
declare
  v_sequence uuid;
begin
  if exists (select 1 from public.sequences where business_id = p_business_id and key = p_sequence->>'key') then return; end if;

  insert into public.sequences (business_id, key, name, description, status, trigger_source, trigger_filter, reenrol_cooldown_days)
  values (p_business_id, p_sequence->>'key', p_sequence->>'name', p_sequence->>'description', 'draft',
          p_sequence->>'trigger_source', coalesce(p_sequence->'trigger_filter', '{}'::jsonb),
          (p_sequence->>'reenrol_cooldown_days')::smallint)
  returning id into v_sequence;

  insert into public.sequence_steps
    (business_id, sequence_id, position, kind, wait_minutes, subject, body,
     branch_condition, on_true_position, on_false_position, config)
  select p_business_id, v_sequence, (e.ord - 1)::int, e.value->>'kind',
         (e.value->>'wait_minutes')::int, e.value->>'subject', e.value->>'body',
         case when e.value->'branch_condition' is null or e.value->'branch_condition' = 'null'::jsonb
              then null else e.value->'branch_condition' end,
         (e.value->>'on_true_position')::int, (e.value->>'on_false_position')::int,
         coalesce(e.value->'config', '{}'::jsonb)
    from jsonb_array_elements(p_sequence->'steps') with ordinality as e(value, ord);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. seed_business_starter_set -- the whole shelf for one business: three
--    boards (Coaching first, by created_at -- see the comment on the two
--    later timestamps below), then the eleven sequences. Safe to call on any
--    business any number of times: each call below is a no-op once that key
--    already exists.
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
      "description": "Chases someone who registered interest in a camp or clinic and has not paid. The first email goes out straight away. The next three count down to the camp's own start date (14, 7 and 3 days before), so everyone gets them at the same moment, whenever they signed up. Someone who signs up late skips the reminders whose moment has passed. Someone added by hand has no camp date, so their follow-up stops after the first email. The copy never names a particular camp.",
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
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. create_business -- same six arguments as before, so lib/db/businesses.ts
--    is unchanged and the deploy order does not matter. It now provisions
--    through the helper above instead of inserting the coaching board
--    itself, so the coaching board is defined in exactly one place.
-- ---------------------------------------------------------------------------

create or replace function public.create_business(
  p_name              text,
  p_slug              text,
  p_timezone          text,
  p_host_display_name text,
  p_host_email        text,
  p_created_by        uuid
) returns public.businesses
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_business public.businesses;
begin
  insert into public.businesses (name, slug, status, booking_provider, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), 'active', 'calendly', p_created_by)
  returning * into v_business;

  -- Only business_id is named: every other column has a DEFAULT (00212), and
  -- naming display_name/timezone here keeps the new tenant's identity from
  -- being the empty string on its first screen.
  insert into public.business_settings (business_id, display_name, timezone)
  values (v_business.id, btrim(p_name), p_timezone);

  insert into public.booking_hosts (business_id, user_id, display_name, email, timezone)
  values (v_business.id, null, btrim(p_host_display_name), coalesce(btrim(p_host_email), ''), p_timezone);

  -- p_created_by may be null (a system-created business), in which case there
  -- is no membership row to write. The operator still reaches it: role='admin'
  -- is an implicit owner of every business.
  if p_created_by is not null then
    insert into public.business_members (business_id, user_id, role)
    values (v_business.id, p_created_by, 'owner');
  end if;

  -- The three boards and the eleven starter sequences, all in one call, so a
  -- business can never be left half-provisioned.
  perform public.seed_business_starter_set(v_business.id);

  return v_business;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. The grants. NOT redundant, and NOT copy-paste noise.
-- ---------------------------------------------------------------------------
-- `create or replace` above re-fires the per-project default privilege every
-- Supabase project carries (`alter default privileges ... grant execute on
-- functions to anon, authenticated, service_role`), which grants anon and
-- authenticated EXECUTE again on every NEW function even though an earlier
-- migration revoked it from the old one. Privileges do not survive a replace
-- on their own.
--
-- create_business is `security definer` and PostgREST auto-exposes anything
-- carrying an EXECUTE grant at /rest/v1/rpc/create_business -- so omitting
-- these lines for it would silently reopen an unauthenticated write path
-- that can create arbitrary tenants and name any existing user id as
-- 'owner'. The three new functions are not `security definer` and nothing
-- calls them over PostgREST, but the same default-privilege re-grant fires
-- for them too, so each is revoked from public/anon/authenticated and given
-- no grant at all.
revoke all      on function public.create_business(text, text, text, text, text, uuid) from public;
revoke execute  on function public.create_business(text, text, text, text, text, uuid) from anon, authenticated;
grant  execute  on function public.create_business(text, text, text, text, text, uuid) to service_role;

revoke all      on function public.seed_business_starter_set(uuid) from public;
revoke execute  on function public.seed_business_starter_set(uuid) from anon, authenticated;

revoke all      on function public.seed_starter_board(uuid, jsonb, timestamptz) from public;
revoke execute  on function public.seed_starter_board(uuid, jsonb, timestamptz) from anon, authenticated;

revoke all      on function public.seed_starter_sequence(uuid, jsonb) from public;
revoke execute  on function public.seed_starter_sequence(uuid, jsonb) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Backfill every business that predates this migration.
-- ---------------------------------------------------------------------------
-- Keyed on ABSENCE inside the helper, not on a list of ids, so it is correct
-- on any database it runs against and a no-op on a second run.
do $$
declare
  b record;
begin
  for b in select id from public.businesses loop
    perform public.seed_business_starter_set(b.id);
  end loop;
end $$;
