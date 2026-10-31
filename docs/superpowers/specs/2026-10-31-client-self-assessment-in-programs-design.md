# A client's self-assessment reaches their program — design

2026-10-31. Owner skipped the design questions ("skip"); every call below is mine unless marked.

## Why

Darren, 2026-10-30 call, 08:18–10:23: "the recent kind of landing page kind of self-assessment that you did…
I'm presuming if I'm wanting to integrate that because one of the guys who's already a client… into the
assessments… and then input that information… the training and the … profile". The owner ruled that this
part is about **programs**, and chose the full chain: an existing client's self-assessment shows on the
client, and AI Generate uses it.

The self-assessment is the Rotational Performance Index quiz (dev: quiz `rpi_athlete_quiz`, funnel
"Rotational Performance Index").

## What is true today

- `POST /api/quiz/submit` completes the attempt with `contact_id: null` (before the contact exists, on
  purpose) and never fills it in. `quiz_attempts.contact_id` has no writer and no reader.
- The only link from an attempt to a person is `contact_timeline_events.metadata.attempt_id`, and the
  retention cron empties `metadata` after `contact_timeline_retention_days` (default 365).
- AI Generate reads no quiz result. Its client inputs are the profile, the coach's instructions, the
  previous program, and (only from the client's own onboarding questionnaire) movement levels.

## What gets built

1. **The link.** Quiz submit stamps `quiz_attempts.contact_id` right after `recordContactEvent` returns a
   contact (new DAL `setAttemptContact`, guarded like every other handoff step). Migration `00297`
   backfills it from the timeline for attempts whose event is not yet scrubbed.
2. **The reader.** `lib/quizzes/client-result.ts`:
   - `getClientQuizResult(businessId, userId)` — the business's contacts linked to the client
     (`contacts.user_id = client`, or `contacts.email = client's normalised email`), then the newest
     completed attempt of any quiz in that business, then its definition, then `buildReport` (already used
     for the visitor's own results page). Null when there is none. Every read carries `business_id`.
   - `formatClientQuizResult(result, now)` — the prompt section: quiz name, date and age, score, tier,
     profile, branch, then each scored area with left/right points and its status (gap / leak / watch /
     solid), then every other answer the client gave, scored or not (buildReport's own `mirror` keeps only
     unscored ones for the visitor, which would drop "do you ever feel it when you rotate?"). It says plainly this is the client's own report,
     not a measured test, and that it never overrides the coach's instructions or the injury list.
3. **Generation.** `POST /api/admin/programs/generate` builds the section when there is a `client_id` and
   `ignore_profile` is off, and puts it on the job's request as `self_assessment`. It is set by the server
   after Zod parsing, which strips any client-sent key of that name. A failed read means no section, never
   a failed generation. The orchestrator adds it next to the previous-program section for agents 1, 2 and 3.
4. **Screens.**
   - Client > Performance > Tests: a "Self-assessment" card (quiz, date, score, tier, profile, the
     left/right areas with status pills).
   - AI Generate, step 1: under "Follows on from…", a note "Uses the <quiz> self-assessment" with its date,
     from `GET /api/admin/clients/[id]/self-assessment` (the same reader the route uses).

## Not built (and why)

- **Typing results in by hand.** Not asked; the client takes the quiz on the landing page.
- **Week generation and continuation weeks.** Same scope as the previous-program section, which only the
  full-program run reads. Continuation weeks follow the skeleton agent 2 already built with it.
- **Contact merges.** `merge_contacts` does not carry `quiz_attempts.contact_id` (00238 says so and leaves
  it). A merged-away contact's attempt loses its link. Rare; needs its own decision.
- **Client-facing display.** The client already saw their result when they took the quiz.

## Calls I made

- Any quiz in the business, newest completed attempt. Not RPI-only: the white-label direction says no
  per-tenant quiz names in code.
- No age cutoff; the section states the date and how long ago, and the model weighs it.
- Match by `user_id` OR email: `contacts.user_id` is fill-only and stays null for a lead who became a
  client through another path.
