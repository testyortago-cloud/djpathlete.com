# The Athlete Quiz, rebuilt in the funnel builder — design

**Date:** 2026-08-23
**Status:** approved through §1 in chat; §2–§8 written under the autonomous
trigger ("lgtm goodnight") and flagged for review on return.
**Parent:** `docs/superpowers/specs/2026-08-18-lead-engine-design.md`
**Supersedes nothing.** This is the last unbuilt piece the Lead Engine status
report names as blocking the GoHighLevel switch-over.

---

## 0. Why this exists

The Athlete Quiz produces most of this business's leads and it still lives in
GoHighLevel. Everything downstream of it — contacts, sequences, pipeline,
campaign revenue — has already been rebuilt here and is running. The quiz is
the last thing keeping GHL alive, and the status report names it "the single
biggest remaining piece of work."

### What is actually recoverable

`ghl-export/2026-08-17T02-41-39/` does NOT contain the quiz. GHL's API exports
form definitions, but the quiz is a *survey*, and all twelve quiz-related
workflows (`quiz workflow`, `RPI scoring`, `Master Scoring`, `Routing (RR)`,
`Rebuilder v2`, `routing cb v3`, …) exported as bare metadata — id, name,
status, timestamps, and nothing else. No steps, no conditions, no scoring.

What DID export is the 201 custom-field definitions, and they leak the shape:

- **A router question with four options** (found verbatim on thirteen
  duplicated fields):
  - A. *I'm an athlete looking to push my performance to a higher level*
  - B. *I'm an athlete coming back from injury or recurring breakdown*
  - C. *I'm a young athlete building toward something serious*
  - D. *I'm a parent or coach looking for the right system for an athlete*
- **Four branch score fields**: `score_aspiring_pro`, `score_rebuilder`,
  `score_rotational`, `score_ceiling_breaker`.
- **~12 questions per branch**, 4 options each. The `_copy_copy_copy` field
  keys are GHL's duplication marks — the same question re-asked per branch,
  sometimes re-voiced in the third person for the parent/coach path
  (*"Has the athlete had a foundational performance assessment?"*).
- **Two independent outputs**: `rpi_tier` (Green/Yellow/Orange/Red) and
  `rpi_profile`, a RADIO with five descriptions that exported in full:
  - *Explosive but tight ─ The power's there, but stiffness limits it*
  - *Mobile but weak ─ Flexibility is fine, force transfer isn't*
  - *Struggle in transitions ─ Direction changes and rotation feels disconnected*
  - *Strong but slow ─ Strength is there but it doesn't translate*
  - *Not sure where it's leaking ─ Something's off but hard to pinpoint*
- Plus `rpi_score`, `gap_score`, `movement_score`, `total_score`,
  `quiz_completed`, `quiz_funnel`.

**The weights, the tier cutoffs, and the routing rules are gone.** They lived
in the workflow steps. Per the decision in chat, we seed a documented,
defensible scheme and Darren corrects it in the editor — nothing blocks on
recovering the originals.

### The five decisions taken in chat

1. **Full RPI rebuild** — router → four branches → ~12 questions → weighted
   score → tier → profile → result. Not a simplified qualification quiz.
2. **The quiz is a database entity; the funnel block references it by id.**
   Editing a weight takes effect everywhere immediately, with no re-publish.
3. **Seed a draft scoring scheme; Darren corrects it in the editor.**
4. **Answer everything, then gate the result.** Partial answers are still
   saved, so a drop-off at Q8 is a known lead with eight answers.
5. **One sequence per archetype; the tier drives urgency.**
6. **It lives at `/go/<slug>`**, like every other funnel.

And the approach, chosen after the sections above:

7. **Client-side walk, background progress writes, server-side scoring.**
   The browser never receives a weight and never sends a score.

---

## 1. Data model

Seven tables, all `quiz_*`, on the singleton `business_id`
(`00000000-0000-0000-0000-000000000001`).

> **AMENDMENT to §1 as approved in chat.** The chat version said six tables and
> carried the branch as a free-text tag on `quiz_questions`. It is now a real
> table, `quiz_branches`. Two reasons: a branch needs a display name and a
> stable key that four seeded sequences filter on, and a free-text tag
> duplicated across two tables has to be cross-validated by a bespoke checker —
> which is strictly worse than a foreign key. Recorded here as an amendment
> rather than ruled in passing, because a ruling is not a spec amendment.

**RLS is enabled in the same migration that creates every table.** Migration
`00227` shipped the chat tables without it, and Supabase grants the public
`anon` key — which is in the browser bundle — full DML on any RLS-off table in
the public schema. These tables hold what strangers type about their injuries.
Service-role-only policies, and a schema test that asserts the privilege
boundary, not just the columns.

### 1.1 `quizzes`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `business_id` | uuid → businesses | default singleton |
| `key` | text | stable slug, e.g. `rpi-athlete-quiz`. Unique per business |
| `name` | text | admin-facing |
| `status` | text | `draft \| active \| archived`. CHECK constrained |
| `intro_headline`, `intro_body` | text | shown before question one |
| `gate_headline`, `gate_body` | text | shown above the details form |
| `result_headline` | text | shown above the tier card |
| `created_at`, `updated_at` | timestamptz | |

### 1.2 `quiz_branches`

`id`, `quiz_id`, `key` (`ceiling_breaker`), `name` (*Ceiling Breaker*),
`description`, `position`. Unique on `(quiz_id, key)`.

The `key` is the contract with the Lead Engine: it is what a sequence's
`trigger_filter` matches on. Renaming `name` is free; renaming `key` breaks
enrolment, and the editor says so.

### 1.3 `quiz_questions`

`id`, `quiz_id`, `branch_id` (**nullable — null means asked of everyone**,
which is how the router question is stored), `position`, `prompt`,
`help_text`, `is_active`.

One question kind: single choice. Nothing in the export is anything else, and
a `kind` column with one legal value is a column that lies about its options.

### 1.4 `quiz_options`

`id`, `question_id`, `position`, `label`, `weight` (numeric, default 0),
`routes_to_branch_id` (nullable), `profile_id` (nullable).

Three nullable columns, each meaningful on a different kind of question:

- `weight` — contributes to the score. Every option has one.
- `routes_to_branch_id` — only on a question whose `branch_id` is null. This
  is what makes the router the router; there is no `is_router` flag, because a
  flag and the routing data could disagree.
- `profile_id` — a **vote**. See §1.9.

### 1.5 `quiz_tiers`

`id`, `quiz_id`, `key` (`green|yellow|orange|red`), `position`, `min_score`,
`max_score` (integers, 0–100 inclusive), `headline`, `body`, `cta_label`,
`cta_href`.

### 1.6 `quiz_profiles`

`id`, `quiz_id`, `key`, `name`, `description`, `position`. Seeded with the
five that exported, verbatim.

### 1.7 `quiz_attempts`

| column | notes |
|---|---|
| `id` | uuid pk — the attempt token the client carries |
| `quiz_id` | |
| `attribution_session_id` | text, nullable — ties the attempt to first touch |
| `branch_id` | nullable until the router is answered |
| `answers` | jsonb: `[{questionId, optionId, at}]` |
| `status` | `in_progress \| completed`. No `abandoned` — see below |
| `score`, `raw_score`, `max_score` | integers, null until completed |
| `tier_key`, `profile_key` | text, null until completed |
| `contact_id` | null until the gate is passed |
| `alert_status` | `not_needed \| sent \| failed`, default `not_needed` — see §5.4 |
| `alerted_at` | timestamptz, null unless an alert was actually accepted |
| `started_at`, `completed_at`, `updated_at` | |

**There is no `abandoned` status.** Nothing observes the moment someone gives
up, so a row claiming to know is a row that is guessing. An attempt that is
`in_progress` and whose `updated_at` is old IS the abandonment, and a report
can say so without a writer having to invent the event.

### 1.8 The score normalises to 0–100

Branches will not have equal question counts — the parent/coach path is
already differently voiced and may be shorter. A raw total makes "Red" mean
one thing for a Rebuilder and another for a Ceiling Breaker.

So: `raw_score` is the sum of chosen options' weights; `max_score` is the sum
of the highest-weighted option on every question the visitor was actually
asked; `score` is `round(raw / max * 100)`, and the tier bands read `score`.
One band set stays honest across all four branches, and `rpi_score` remains
the familiar-looking number it is today.

`max_score` is stored, not recomputed, so a later weight change cannot restate
what a past attempt's percentage meant.

### 1.9 The profile is a vote, not a second scoring system

Each option may carry a `profile_id`. On completion the profile with the most
votes wins; ties break by `quiz_profiles.position`; no votes at all yields the
profile flagged as the fallback (position 0 — seeded as *"Not sure where it's
leaking"*, which is exactly what a no-signal answer means).

One mechanism covers both readings of the GHL data — whether the athlete
literally picked "Explosive but tight" on a single question (put all five
votes on that question's five options) or it was inferred across several (
scatter the votes). Darren configures which, in the editor, with no schema
change and no second code path.

### 1.10 Results freeze at completion

An attempt stores its own `score`, `max_score`, `tier_key`, `profile_key` AND
the raw answers. Editing a weight next month changes future attempts only. A
result you emailed someone in March still says in September what it said in
March.

### 1.11 What is deliberately not reused

`funnel_submissions` — quiz answers are a different shape, and that table has
seven read sites plus the attribution join. The draft-preview work rejected an
`is_test` column on it for the same reason.

`assessment_questions` / `assessment_results` — that is the signed-in client
assessment, a different audience with a different lifecycle. Sharing tables
between an anonymous public funnel and an authenticated client record is how a
privacy boundary gets crossed by accident.

---

## 2. Authoring — the quiz editor

Lives under the funnel builder, because that is where Darren said it belongs:

- `/admin/funnels/quizzes` — the list.
- `/admin/funnels/quizzes/[id]` — the editor.

The list uses `components/ui/data-table.tsx` — `DataTableCard` → `DataTable` →
`DataTableRow`, with `DataTableBadge` for status. That is the house standard
for every list in this app and a page that invents its own variant reads as a
different app.

Columns: name, key, status, branches, questions, attempts (completed / total),
last edited.

### 2.1 The editor's five panels

1. **Details** — name, key, status, and the four copy blocks (intro, gate,
   result headline).
2. **Branches** — the four archetypes: key, name, description, order.
3. **Questions** — a tab per branch plus an "Everyone" tab holding the router.
   Each question expands to its options; each option row is
   `label / weight / routes to / profile vote`. Reorder via `@dnd-kit`, which
   the repo already uses.
4. **Tiers** — four rows: band, headline, body, CTA.
5. **Profiles** — five rows: key, name, description.

### 2.2 `quizGate` — a pure activation gate

A quiz cannot be set `active`, and a funnel cannot publish a block pointing at
one, unless `quizGate(definition)` returns `ok`. It is a **pure function with
no I/O**, tested with zero mocks — the same contract as
`lib/lead-engine/pipeline-move.ts` and `lib/automation/sequence-tick.ts`.

Blockers:

1. No router question (no question with `branch_id` null carrying
   `routes_to_branch_id` on its options).
2. A router option that routes nowhere.
3. A branch no router option reaches — an archetype nobody can be sorted into.
4. A branch with no questions.
5. Tier bands that do not cover 0–100 exactly: any gap, any overlap. A gap is
   a score with no tier, which is a result page with a hole in it.
6. An option whose `profile_id` names a profile on another quiz.
7. Fewer than two options on any question.

Warnings (do not block):

- Every weight on a question is identical — the question cannot affect the
  score, which is legal but is probably a mistake.
- A profile no option votes for.

### 2.3 Preview

The editor links to the funnel's own draft preview (`/preview/<slug>`), which
already renders drafts through the same `loadCatalogues → resolveDoc →
publishGate → reassemble → compileFunnelStep` sequence publish runs. The quiz
inherits `FunnelRenderContext.testRun`, so a preview run scores normally and
**writes nothing** — no attempt row, no contact, no consent, no enrolment.

That takes two things, not one, and the second is the one that gets forgotten:

1. `QuizRunner` is handed `testRun` and **makes no progress calls at all**. A
   client that posts progress in a preview writes `quiz_attempts` rows from a
   page whose whole promise is that it does not write.
2. Submission goes to `POST /api/funnels/preview-submit`'s quiz sibling, which
   validates against the DRAFT (the live route cannot — the quiz may not be
   published yet), scores, and returns the result having performed zero writes.
   A test asserts that route's source contains no write path, exactly as the
   existing preview-submit route's test does.

`isPreview` without `testRun` — the builder's iframe, `/go?preview=1` — refuses
the submission outright, as it does for every other island.

---

## 3. The funnel island

The island registry in `lib/funnels/islands.ts` is the one place the set is
defined: the editor builds its palette from it, the compiler validates against
it, and the renderer switches on it. Adding `quiz` to `ISLAND_NAMES` therefore
offers it in the builder automatically, and turns every exhaustive switch into
a compile error until it is handled — which is the point.

### 3.1 `quizIslandSchema`

```ts
{
  quizId: z.string().uuid(),
  submitLabel: z.string().max(60).optional().default("See my result"),
  consentText: z.string().max(300).optional(),
}
```

Three props and no field repeater. The gate collects a fixed set — name, email,
phone (optional) — because a configurable field list on the gate would be a
second copy of `funnelFormFieldSchema` with none of its role machinery, and
the roles do not apply here.

`quizId` is a uuid the **owner** supplies through `island-fields.ts`, exactly
as `eventId` is. `UUID_FIELD_PATHS` is generated from the schemas, so the page
builder's prompt is told to omit it — and per the standing note on
`leadMagnetId`, that is necessary and **not sufficient**: a prompt is a
request, not a validator. What makes it safe is the publish gate.

### 3.2 The publish gate

`ResolveResult` grows `unresolvedQuizzes`, and `publishGate` treats it as a
**blocker**, alongside `unsellableCheckouts`:

- The `quizId` names no quiz → blocker.
- The quiz is not `active` → blocker.
- The quiz does not pass `quizGate` → blocker, listing the gate's own reasons.

A page that asks twelve questions and then cannot score them is worse than a
page that never asked. `loadCatalogues` grows a quiz catalogue read; it stays
the only thing in that module that touches the database.

### 3.3 Rendering

`QuizIsland.tsx` is an **async server component**, like `FormIsland`. It:

1. Reads the quiz definition through a narrow accessor.
2. Strips it — see §4.1.
3. Renders `<QuizRunner definition={public} context={…} />`.
4. Fetches `business_settings.display_name` **only when the gate shows a phone
   field**, and renders the SMS consent wording through
   `renderSmsConsentWording` — the same call the submit route re-renders from,
   so `contact_consents.wording_shown` reproduces what the visitor saw. A
   blank display name degrades to **no checkbox**, never to a checkbox whose
   sentence cannot name the business.

---

## 4. The run path

### 4.1 The browser never receives a weight

`publicQuizDefinition(definition)` returns questions, options, labels, order,
routing — and **no `weight`, no `profile_id`, no tier bands**. A test asserts
that no `weight` key survives anywhere in the serialised output, by walking
the object, not by checking three known paths.

Routing (`routes_to_branch`) DOES ship to the client: the browser has to know
which branch to walk. Knowing you are a Rebuilder reveals nothing; knowing
that option C is worth 4 points lets you drive your own tier.

### 4.2 `POST /api/quiz/progress`

Fire-and-forget from the client after every answer.

- **Request:** `{ quizId, attemptId?, answers: [{questionId, optionId}] }`
- **First call carries no `attemptId`.** The server creates the row and
  returns `{ attemptId }`; the client carries it from then on. Server-issued,
  because a client-generated token lets one visitor overwrite another's
  in-progress row by guessing.
- **Response:** `{ attemptId }`, 204 thereafter.
- Answers are validated against the real definition — an option id that is not
  on the named question is dropped, not stored.
- **Every failure is silent and non-blocking.** Losing a partial is
  recoverable; blocking the quiz on a failed analytics write is not. Same
  trade `capture-contact.ts` already makes, and its reasoning is quoted at the
  call site.
- Rate-limited per IP, same shape as `/api/funnels/submit`.

### 4.3 `POST /api/quiz/submit`

- **Request:** `{ quizId, attemptId, answers[], name, email, phone?,
  smsConsent?, website (honeypot), elapsedMs }`
- **No score is accepted from the client.** The route re-reads the quiz from
  the database and recomputes everything. A `score` key in the body is ignored,
  not trusted, and a test asserts a forged one changes nothing.
- Bot defences copied from `/api/funnels/submit`: honeypot, `MIN_ELAPSED_MS`,
  per-IP throttle.
- **Response:** `{ score, tier: {key, headline, body, ctaLabel, ctaHref},
  profile: {key, name, description}, branch: {key, name} }`

Order of writes, and it matters:

1. Score (pure, no I/O).
2. Update the attempt row → `completed`.
3. `recordContactEvent(...)` — creates or merges the contact, writes the
   timeline row, and calls `enrollIfTriggered` itself.
4. `recordConsent(...)` if the marketing or SMS tick was shown and ticked.
5. Pipeline (§5.3) and the operator alert (§5.4), both non-fatally.
6. Return the result.

The visitor's result is returned even if steps 3–5 throw. They answered
twelve questions; a failure in our marketing plumbing is not their problem.
Failures are logged with correlating ids and **never with the raw PostgREST
error object** — `error.details` embeds the literal email address on a unique
violation, and the house DAL convention of `if (error) throw error` rethrows a
raw object that is not `instanceof Error`, which the standard cron shell
writes into `cron_runs.details` as the literal string `[object Object]`.

### 4.4 Scoring is a pure module

`lib/quizzes/score.ts`, importing nothing but types. No `@/lib/supabase`, no
DAL, no I/O. Input: a definition and an answer list. Output:

```ts
{ branchKey, rawScore, maxScore, score, tierKey, profileKey, unanswered[] }
```

Every edge case is a unit test with zero mocks: an answer to a question not on
the walked branch, a duplicate answer to one question, an option id from a
different quiz, an empty answer list, a branch whose weights are all zero
(`maxScore === 0` must not divide by zero — it yields `score: 0` and the
lowest tier, and there is a test that says so).

### 4.5 `QuizRunner.tsx` — the client

One question on screen at a time. A progress bar. A back button that pops the
last answer (and does NOT re-post progress — the server keeps the fullest
answer set it has seen; a visitor going back and changing their mind rewrites
that question's entry on the next forward step).

The reply text is rendered as text nodes. No markdown pass, no
`dangerouslySetInnerHTML` — every string on this page is owner-authored today,
and the moment that stops being true the absence of an HTML sink is what
keeps it safe.

At the end: the gate form, then the result, in place. No navigation, so no
result URL to leak and no refresh to lose.

---

## 5. The Lead Engine handoff

### 5.1 The new contact source

`ContactEventSource` gains `"quiz"`. **No migration** —
`contact_timeline_events.source` is plain `text NOT NULL` with no CHECK
constraint (verified in `00214_lead_engine_timeline.sql`), so this is a
TypeScript union change only.

The event's metadata carries `{ quiz_key, branch, tier, profile, score,
attempt_id }`.

### 5.2 Four sequences, and no new routing code

`enrollIfTriggered` already selects active sequences by `trigger_source` and
matches `trigger_filter` as exact key equality against the event metadata. So:

| sequence key | trigger_source | trigger_filter |
|---|---|---|
| `quiz_ceiling_breaker` | `quiz` | `{"branch": "ceiling_breaker"}` |
| `quiz_rebuilder` | `quiz` | `{"branch": "rebuilder"}` |
| `quiz_aspiring_pro` | `quiz` | `{"branch": "aspiring_pro"}` |
| `quiz_parent_coach` | `quiz` | `{"branch": "parent_coach"}` |

That is the whole routing layer. It is why the archetype key is a contract.

**All four seed as `draft`.** Migration `00218`'s own header sets the
precedent and states the reason: seeding a `trigger_source` only matters once
something emits it, and a sequence that is `active` on the day the trigger
starts firing sends mail nobody reviewed. Darren activates them when the copy
is right.

### 5.3 The pipeline — a ruling, stated as a ruling

Darren chose the option whose description said "the RPI tier sets the pipeline
card's priority". Delivering that literally means every quiz completion opens
a deal card, and the quiz is the highest-volume lead source in the business.
The pipeline board is the *working set* — cards are created today only by a
booking or a payment, which are both real deal signals. Filling it with every
anonymous quiz-taker would destroy the thing the board is for.

**So: a card is opened only for a Red or Orange result.** Green and Yellow
nurture by email and enter the board when they book, exactly as they do now.

Mechanically: a new `PipelineEvent` kind, `{ kind: "quiz_result", tier,
occurredAt }`, handled in `decideMove` (pure, zero-mock tests):

- Tier `green` or `yellow` → `noop`.
- An existing open card → `noop`. The quiz does not disturb a live deal.
- A `lost` close inside the suppression window → `refuse`, reusing the
  existing rule verbatim. A lead Darren ruled out does not walk back in by
  retaking the quiz.
- Otherwise → `create` in the first open stage, `trigger: "quiz"`.

`MoveTrigger` gains `"quiz"`. `SOURCE_EVENT_ID_KEYS` gains `quiz_attempt_id`,
so two deliveries of one completion cannot mint two cards — the same partial
unique index that protects a double Stripe delivery.

**This overrides the plain reading of the option Darren picked, and it is
flagged in the handover for him to overrule in one line** (delete the tier
check). It is written here rather than decided in a commit message because a
ruling is not a spec amendment.

### 5.4 The operator alert

Red and Orange email Darren immediately.

`lib/email.ts` **returns a success shape when `RESEND_API_KEY` is unset** —
roughly 38 senders in this app cannot tell whether anything was delivered. So
the alert follows the chat escalation's pattern: the send's outcome is
recorded on the attempt (`alerted_at`, or a timeline row saying the alert
could not be sent), and the admin surface shows the honest state. "The send
did not throw" is not "somebody was told".

### 5.5 What the quiz deliberately does not do

- It does not create a user account. That is one of the two GHL automations
  still needing a home, and it belongs to the won-sale path, not here.
- It does not write to Airtable.
- It does not text anyone. SMS is dark until A2P clears, and a text step in a
  quiz sequence would skip as `sms_not_configured` — correct, but it would
  also mask `sms_env_missing`.

---

## 6. Seeding the RPI quiz

The seed migration (number claimed at implementation time, per §8) inserts one quiz, four branches, five
profiles, four tier bands, the router, and the per-branch questions, all
`ON CONFLICT (…) DO NOTHING` — the same idempotent style as `00218`.

### 6.1 The mapping, and the one thing that does not fit

| Router option | Branch key |
|---|---|
| A. push performance to a higher level | `ceiling_breaker` |
| B. coming back from injury or breakdown | `rebuilder` |
| C. young athlete building toward something serious | `aspiring_pro` |
| D. parent or coach looking for the right system | `parent_coach` |

**`score_rotational` has no router option.** There are four branch score
fields in the export and four router options, but "rotational" is not one of
the four things the router asks about, and this business has a
`/programs/rotational-reboot` product. The likeliest explanation is that
rotational was a separate mini-quiz or a sub-score, not an archetype. It is
seeded as a **profile vote target**, not a branch, and flagged for Darren.

### 6.2 The seeded scoring, stated as invented

Weights: each option carries 0 / 1 / 2 / 3, worst to best, in the order the
options appear in the export (which reads consistently worst-first).

Bands, on the normalised 0–100:

| tier | band | means |
|---|---|---|
| Red | 0–39 | large gaps, alert immediately |
| Orange | 40–59 | real gaps, alert immediately |
| Yellow | 60–79 | mostly holding up |
| Green | 80–100 | well-prepared |

Higher is better, so **Red is the most urgent** — which is why Red and Orange
are the ones that alert and open a card.

Every seeded number is marked in the migration and in the editor as
**unverified, reconstructed from field metadata**. The editor shows a banner
on any quiz still carrying the seed marker, so nobody mistakes a plausible
default for Darren's judgement.

---

## 7. Testing

Targeted suites, per the house rule — plus `tsc --noEmit` and `npm run build`.
The tsc baseline on clean `main` is **251**; a falling count hides new errors
too, so errors are attributed by file, never by count.

1. **`lib/quizzes/score.ts`** — pure, zero mocks. Divide-by-zero, foreign
   option ids, duplicate answers, unanswered questions, tie-breaking on both
   tier boundaries and profile votes.
2. **`quizGate`** — pure, zero mocks. One test per blocker, each proven to
   fail when its check is removed.
3. **`publicQuizDefinition`** — walks the serialised output and asserts no
   `weight` or `profile_id` key survives anywhere. Not a three-path check.
4. **Island schema** — `quizIslandSchema` accepts and rejects; `ISLAND_TRAITS`
   covers every settable prop (the existing invariant test extends for free).
5. **Publish gate** — a funnel pointing at a draft quiz, a missing quiz, and a
   quiz failing `quizGate` each block publish with a readable reason.
6. **`/api/quiz/submit`** — a forged `score` in the body changes nothing; the
   honeypot and elapsed-time guards refuse; a throwing `recordContactEvent`
   still returns the visitor's result; consent wording matches
   `renderSmsConsentWording` byte-for-byte.
7. **`/api/quiz/progress`** — an option id not on the named question is
   dropped; a second call without an `attemptId` does not orphan the first row.
8. **`decideMove`** — the four quiz_result branches, including the Lost
   suppression window.
9. **Schema test** — columns, indexes, constraints **and the privilege
   boundary**. A schema test that never asks "who can read this" is half a
   schema test; that is exactly how `00227` shipped world-readable.
10. **`QuizRunner`** — renders one question at a time, back button pops,
    gate appears only after the last question.

**Every test is mutated before it is believed.** A mutation table is a claim
about a test and the claim needs checking too: `toContainEqual` and
`toMatchObject` cannot catch a mutation that ADDS a result;
`toHaveBeenCalled()` cannot catch a change in WHEN something is called; and a
test for a fix must exercise the module the fix is in — "green after the fix"
and "red without it" are different claims.

---

## 8. Rollout, and what is explicitly not done

- Built on a branch in a worktree. **Not pushed, not merged, not deployed.**
- Migrations applied to the **dev clone** only. `scripts/migrations/apply.mjs`
  cannot be used against the clone — it has no `public.repo_migrations` and
  hard-stops — so the clone is updated through the Management API
  `/database/query` endpoint, as `00227` was.
- The migration number is claimed **after** checking for a peer session's
  claim on the same number. Two branches both taking the next number is a
  clean git merge and a broken database.
- **Screenshots driven through the real app on the real route**, annotated in
  the image file. Light only: this app has no working dark mode — `.dark` is
  declared in `globals.css` and applied nowhere, and `--surface`, `--success`,
  `--warning`, `--error` are declared on `:root` only.
- **GoHighLevel is not touched.** Its quiz keeps running. The switch-over is
  a separate decision, taken after Darren has seen this one convert.

### Open for Darren

1. The four seeded sequences are `draft` and hold placeholder copy.
2. `score_rotational` is seeded as a profile, not a branch (§6.1).
3. Every weight and band is invented (§6.2).
4. The Red/Orange-only pipeline card overrides the literal reading of the
   option chosen in chat (§5.3).
5. The eleven-or-so per-branch questions are reconstructed from field
   metadata that GHL mangled — wording will need a pass.
