# Athlete Quiz Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GoHighLevel Athlete Quiz with a branching, server-scored quiz that Darren builds and edits inside the funnel builder, and that routes every completion into the Lead Engine already running here.

**Architecture:** A quiz is a database entity with its own admin editor; a funnel canvas block references it by id. The browser walks the questions client-side from a definition with the weights stripped out, writes partial answers to an attempt row as it goes, and submits only answers — the server re-reads the quiz and computes the score, tier and profile, so a result cannot be forged and a scoring change never needs a re-publish.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (service-role DAL), Zod 4, Vitest, Tailwind v4, @dnd-kit, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md`

## Global Constraints

- **Migration numbers claimed: `00228` (tables), `00229` (sequence rows).** Verified unclaimed across every branch at plan time. Re-verify before writing the file — two branches taking one number merges clean and breaks the database.
- **RLS is enabled in the same migration that creates each table.** Service-role-only policies. A schema test asserts the privilege boundary, not just columns.
- **`business_id` defaults to `'00000000-0000-0000-0000-000000000001'`** on every new table.
- **tsc baseline is 251** on this branch's base (`ec3acb16`), re-measured in this worktree. Attribute errors by file; never trust the count alone.
- **Pre-existing test failures, not ours:** `__tests__/lib/funnels/sections/leadgen.test.ts` (1 — `djp-test-run`, fixed by Task 12) and `bookkeeping/SetupPanel` (7).
- **Tables in admin UI use `components/ui/data-table.tsx`.** Never a hand-rolled `<table>`.
- **Admin UI is light-only.** This app has no working dark mode; do not add `dark:` utilities.
- **No brand literals in lib code** — `__tests__/lib/lead-engine/no-brand-literals.test.ts` enforces it. Business name comes from `business_settings.display_name`.
- **Never log a raw PostgREST error.** `error.details` embeds the literal email on a unique violation. Log `code` and `message` only, plus correlating ids.
- **Every test is mutated before it is believed.** `toContainEqual` / `toMatchObject` cannot catch a mutation that ADDS a result; `toHaveBeenCalled()` cannot catch a change in WHEN. A test for a fix must exercise the module the fix is in.
- **Targeted test runs only.** `npx vitest run <path>`. Full suite only if asked.

---

### Task 1: Schema — seven tables and the privilege boundary

**Files:**
- Create: `supabase/migrations/00228_athlete_quiz.sql`
- Test: `__tests__/lib/quizzes/quiz-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `quizzes`, `quiz_branches`, `quiz_questions`, `quiz_options`, `quiz_tiers`, `quiz_profiles`, `quiz_attempts`.

- [ ] **Step 1: Re-verify the migration number is still free**

```bash
git log --all --name-only --pretty=format: -- 'supabase/migrations/*' | sort -u | grep 00228
```
Expected: no output.

- [ ] **Step 2: Write the failing schema test**

Mirror `__tests__/lib/lead-engine/chat-schema.test.ts` — read the SQL off disk and assert its shape. Suites:

1. `creates all seven tables with a business_id defaulting to the singleton` — seven `CREATE TABLE IF NOT EXISTS public.quiz*` matches, and exactly seven singleton-default matches.
2. `a quiz key is unique per business` — `UNIQUE (business_id, key)` on `quizzes`.
3. `status is constrained` — `CHECK` containing `'draft'`, `'active'`, `'archived'`.
4. `a question with no branch is asked of everyone` — `branch_id uuid REFERENCES public.quiz_branches(id) ON DELETE CASCADE` with **no** `NOT NULL`.
5. `an option's three optional columns are all nullable` — `weight numeric NOT NULL DEFAULT 0`, and `routes_to_branch_id` / `profile_id` nullable.
6. `tier bands are integers bounded 0..100` — `CHECK (min_score >= 0 AND min_score <= 100)` and the same for `max_score`.
7. `an attempt keeps its own max_score so a past result cannot be restated` — `max_score integer`, `score integer`, `raw_score numeric`.
8. `an attempt has no abandoned status` — `CHECK` on `status` contains `'in_progress'` and `'completed'` and **not** `'abandoned'`.
9. `children cascade with their quiz` — `ON DELETE CASCADE` count matches the number of child FKs.
10. **`closes every table to the public key`** — seven `ALTER TABLE public.quiz… ENABLE ROW LEVEL SECURITY` matches and seven service-role policies. Carry the comment explaining why: `00227` shipped without RLS and the anon key is in the browser bundle.

- [ ] **Step 3: Run it, confirm it fails**

`npx vitest run __tests__/lib/quizzes/quiz-schema.test.ts` — fails, migration absent.

- [ ] **Step 4: Write the migration**

Follow `00227`'s house style: `CREATE TABLE IF NOT EXISTS`, `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY "Service role full access on <table>" … FOR ALL TO service_role USING (true) WITH CHECK (true)`.

Columns exactly as spec §1.1–§1.7, plus on `quiz_attempts`: `alert_status text NOT NULL DEFAULT 'not_needed' CHECK (alert_status IN ('not_needed','sent','failed'))` and `alerted_at timestamptz`.

Indexes: `quiz_attempts (quiz_id, status, updated_at DESC)`, `quiz_attempts (contact_id)`, `quiz_questions (quiz_id, position)`, `quiz_options (question_id, position)`.

**Do NOT put a `DROP POLICY` guard in the .sql** — `CREATE POLICY` has no `IF NOT EXISTS`, and the guard belongs in the applier, not the migration.

- [ ] **Step 5: Run the test, confirm it passes**

- [ ] **Step 6: Apply to the dev clone**

`scripts/migrations/apply.mjs` CANNOT be used — the clone has no `public.repo_migrations` and the applier hard-stops. Apply through the Management API `/database/query` endpoint, as `00227` was. Read the response; do not assume.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/00228_athlete_quiz.sql __tests__/lib/quizzes/quiz-schema.test.ts
git commit -m "feat(quiz): seven tables, and RLS in the same migration that creates them"
```

---

### Task 2: Types and the data layer

**Files:**
- Modify: `types/database.ts`
- Create: `lib/db/quizzes.ts`
- Test: `__tests__/lib/quizzes/quiz-dal.test.ts`

**Interfaces:**
- Consumes: Task 1's tables.
- Produces:

```ts
export type QuizStatus = "draft" | "active" | "archived"
export type QuizAttemptStatus = "in_progress" | "completed"
export type QuizAlertStatus = "not_needed" | "sent" | "failed"

export interface QuizOption {
  id: string; questionId: string; position: number; label: string
  weight: number; routesToBranchId: string | null; profileId: string | null
}
export interface QuizQuestion {
  id: string; quizId: string; branchId: string | null; position: number
  prompt: string; helpText: string | null; isActive: boolean; options: QuizOption[]
}
export interface QuizBranch { id: string; quizId: string; key: string; name: string; description: string | null; position: number }
export interface QuizTier { id: string; quizId: string; key: string; position: number; minScore: number; maxScore: number; headline: string; body: string; ctaLabel: string | null; ctaHref: string | null }
export interface QuizProfile { id: string; quizId: string; key: string; name: string; description: string; position: number }

/** Everything needed to render, walk and score a quiz. The ONE shape the pure modules take. */
export interface QuizDefinition {
  id: string; key: string; name: string; status: QuizStatus
  introHeadline: string; introBody: string
  gateHeadline: string; gateBody: string
  resultHeadline: string
  branches: QuizBranch[]; questions: QuizQuestion[]; tiers: QuizTier[]; profiles: QuizProfile[]
}

export async function getQuizDefinition(quizId: string): Promise<QuizDefinition | null>
export async function getQuizDefinitionByKey(key: string): Promise<QuizDefinition | null>
export async function listQuizzes(): Promise<QuizListRow[]>   // + attempt counts
export async function createAttempt(input: { quizId: string; attributionSessionId: string | null }): Promise<string>
export async function saveAttemptProgress(input: { attemptId: string; branchId: string | null; answers: unknown[] }): Promise<void>
export async function completeAttempt(input: { attemptId: string; branchId: string; answers: unknown[]; rawScore: number; maxScore: number; score: number; tierKey: string; profileKey: string | null; contactId: string | null }): Promise<void>
export async function setAttemptAlert(input: { attemptId: string; status: QuizAlertStatus }): Promise<void>
```

- [ ] **Step 1: Write the failing DAL test**

Mock `@/lib/supabase`'s `createServiceRoleClient` with a builder that **records the filters it was asked for and applies them to canned rows**, not one that returns canned rows regardless. A mock that ignores `.eq()` passes with the bug present — that is the whole failure mode, and it is how a privacy filter goes missing.

Assertions:
- `getQuizDefinition` nests options under questions in `position` order, and questions in `position` order.
- A question whose `is_active` is false is excluded.
- `getQuizDefinition` returns `null`, not a partial object, when the quiz row is missing.
- `completeAttempt` writes `status: "completed"` and a `completed_at`.

- [ ] **Step 2: Run it, confirm it fails**
- [ ] **Step 3: Implement `lib/db/quizzes.ts` and the type additions**

House convention: `createServiceRoleClient()` via a local `getClient()`, `if (error) throw error`. One read per table, assembled in memory — five small selects beat a nested PostgREST embed that silently drops rows when a child table's RLS bites.

- [ ] **Step 4: Run the test, confirm it passes**
- [ ] **Step 5: `npx tsc --noEmit` — confirm no new errors in `lib/db/quizzes.ts` or `types/database.ts`**
- [ ] **Step 6: Commit** — `feat(quiz): the data layer, whose test mock applies the filters it is asked for`

---

### Task 3: Scoring — a pure module

**Files:**
- Create: `lib/quizzes/score.ts`
- Test: `__tests__/lib/quizzes/score.test.ts`

**Interfaces:**
- Consumes: `QuizDefinition` (Task 2).
- Produces:

```ts
export interface QuizAnswer { questionId: string; optionId: string }
export interface QuizScoreResult {
  branchKey: string | null
  rawScore: number
  maxScore: number
  score: number            // 0..100, rounded
  tierKey: string | null
  profileKey: string | null
  unanswered: string[]     // question ids the walk asked and got no answer for
}
export function scoreQuiz(definition: QuizDefinition, answers: QuizAnswer[]): QuizScoreResult
export function walkedQuestions(definition: QuizDefinition, branchId: string | null): QuizQuestion[]
```

**This module imports nothing but types.** No `@/lib/supabase`, no DAL, no I/O — the same contract as `lib/lead-engine/pipeline-move.ts`. Its tests use zero mocks.

- [ ] **Step 1: Write the failing tests**

Build fixtures in the test file as plain `QuizDefinition` literals. Cases:

1. `walks only the router plus the branch the router chose` — a question on another branch is not in `walkedQuestions`.
2. `orders the walk by global position, interleaving branch and shared questions` — proves position is global, not per branch.
3. `normalises to 0..100 against the branch maximum` — two branches with different question counts and identical relative performance score the same.
4. `a question whose options are all weight 0 cannot move the score` — adds 0 to both raw and max.
5. `an all-zero branch does not divide by zero` — `maxScore === 0` yields `score: 0` and the lowest tier.
6. `an answer to a question outside the walk is ignored`.
7. `an option id belonging to a different question is ignored`.
8. `a duplicate answer to one question counts once` — the last one wins.
9. `tier boundaries are inclusive on both ends` — a score exactly equal to `minScore` and one exactly equal to `maxScore` both land in that band.
10. `the profile is the most-voted, ties broken by profile position`.
11. `no votes at all yields the position-0 profile`.
12. `unanswered lists what the walk asked and did not get`.

- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Mutate and prove**

Apply each, run, confirm RED, revert:
- Change `Math.round` to `Math.floor` → test 9 or 3 must fail.
- Remove the `maxScore === 0` guard → test 5 must throw or produce `NaN`.
- Change tier matching from `>= min && <= max` to `>= min && < max` → test 9 must fail.
- Drop the tie-break on profile position → test 10 must fail.

Record the outcome of each in the commit message. **A mutation table is a claim about a test; run it rather than reasoning about it.**

- [ ] **Step 6: Commit** — `feat(quiz): scoring, pure and mutation-proven`

---

### Task 4: `quizGate` — the activation gate

**Files:**
- Create: `lib/quizzes/gate.ts`
- Test: `__tests__/lib/quizzes/gate.test.ts`

**Interfaces:**
- Produces:

```ts
export interface QuizGateResult { ok: boolean; blockers: string[]; warnings: string[] }
export function quizGate(definition: QuizDefinition): QuizGateResult
```

Pure, zero mocks, same contract as Task 3.

- [ ] **Step 1: Write the failing tests — one per blocker, each with a fixture that trips exactly that blocker**

Blockers (spec §2.2):
1. no router question
2. a router option that routes nowhere
3. a branch no router option reaches
4. a branch with no questions
5. tier bands with a gap
6. tier bands that overlap
7. an option whose `profileId` names a profile on another quiz
8. a question with fewer than two options

Warnings:
9. every weight on a question identical **and non-zero**
10. a profile no option votes for

Plus: `an all-zero question produces no warning` — all-zero is the documented segmentation marker and the gate stays quiet about it.

- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Mutate** — delete each blocker's check in turn; the matching test must go red. A blocker whose deletion changes nothing is a blocker that was never running.
- [ ] **Step 6: Commit** — `feat(quiz): the gate a quiz must pass before it can take an answer`

---

### Task 5: `publicQuizDefinition` — the weights never reach the browser

**Files:**
- Create: `lib/quizzes/public-definition.ts`
- Test: `__tests__/lib/quizzes/public-definition.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PublicQuizOption { id: string; label: string; routesToBranchId: string | null }
export interface PublicQuizQuestion { id: string; branchId: string | null; position: number; prompt: string; helpText: string | null; options: PublicQuizOption[] }
export interface PublicQuizDefinition {
  id: string; key: string
  introHeadline: string; introBody: string
  gateHeadline: string; gateBody: string
  resultHeadline: string
  branches: { id: string; key: string; name: string }[]
  questions: PublicQuizQuestion[]
}
export function publicQuizDefinition(definition: QuizDefinition): PublicQuizDefinition
```

`routesToBranchId` **does** ship — the browser has to know which branch to walk. `weight`, `profileId`, `tiers` and `profiles` do not.

- [ ] **Step 1: Write the failing test**

```ts
/** Walks the whole serialised object rather than checking three known paths. */
function keysAnywhere(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) { value.forEach((v) => keysAnywhere(v, found)); return found }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { found.add(k); keysAnywhere(v, found) }
  }
  return found
}

it("no weight, profile vote, tier or profile survives anywhere in the public shape", () => {
  const keys = keysAnywhere(JSON.parse(JSON.stringify(publicQuizDefinition(FIXTURE))))
  expect([...keys].filter((k) => /weight|profile|tier|minScore|maxScore/i.test(k))).toEqual([])
})
```

Plus: `keeps routesToBranchId, because the browser must walk the branch`.

- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Implement — build the public object explicitly, field by field. Never `delete` keys off a clone; a field added later would then leak by default.**
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Mutate** — add `weight` back onto the mapped option; the walk test must fail. This proves the walk, not a three-path check.
- [ ] **Step 6: Commit** — `feat(quiz): the shape the browser is allowed to see`

---

### Task 6: The seeded RPI quiz

**Files:**
- Create: `lib/quizzes/seed/rpi-athlete-quiz.ts`
- Create: `scripts/seed-athlete-quiz.mjs`
- Test: `__tests__/lib/quizzes/seed-rpi.test.ts`

**Interfaces:**
- Consumes: `QuizDefinition` (Task 2), `quizGate` (Task 4), `scoreQuiz` (Task 3).
- Produces: `export const RPI_ATHLETE_QUIZ: SeedQuiz` — the definition keyed by stable string keys rather than uuids, plus `export const SEED_MARKER = "reconstructed-from-ghl-export-2026-08-23"`.

**Content — reconstructed from the GHL custom-field export, verbatim where it exported cleanly.**

Router, position 10, `branchId: null`, all weights 0:

> **Which describes you best?**
> - I'm an athlete looking to push my performance to a higher level → `ceiling_breaker`
> - I'm an athlete coming back from injury or recurring breakdown → `rebuilder`
> - I'm a young athlete building toward something serious → `aspiring_pro`
> - I'm a parent or coach looking for the right system for an athlete → `parent_coach`

Shared questions, `branchId: null`, all weights 0 (segmentation):

- position 20 — **What's your sport's primary physical demand?** Rotational / multi-directional (golf, tennis, baseball, hockey, MMA, throwing) · Repeated sprint and change of direction (soccer, rugby, field sports) · Contact and collision · Endurance dominant
- position 30 — **What are you working toward in the next 6 months?** A defined competition, selection, or performance target · General improvement and consistency · Returning to full performance after injury or setback · Building long-term foundation
- position 40 — **Which of these sounds most like you?** — carries the five **profile votes**, weight 0 on every option:
  - Explosive but tight ─ The power's there, but stiffness limits it → `explosive_but_tight`
  - Mobile but weak ─ Flexibility is fine, force transfer isn't → `mobile_but_weak`
  - Struggle in transitions ─ Direction changes and rotation feels disconnected → `struggle_in_transitions`
  - Strong but slow ─ Strength is there but it doesn't translate → `strong_but_slow`
  - Not sure where it's leaking ─ Something's off but hard to pinpoint → `not_sure`
- position 85 — **Where are you based?** Tampa area · Within reasonable travel distance to Tampa area · Outside region but can travel · Remote only / can't travel
- position 90 — **If we could identify the single biggest factor silently limiting your performance right now, would you want to know what it is?** Yes — and I'm ready to act on it · Yes — but I'd want to understand the process first · Maybe — depends on cost or timing · Not right now

Branch questions occupy positions 50–80. Weights are `3 / 2 / 1 / 0` in the order listed unless stated.

**`ceiling_breaker`:**
- How do you feel about your current performance trajectory? — Hitting new ceilings consistently · Stalled at the same level for a while · Inconsistent — high and low days · Frustrated and unable to identify why
- When competition gets long or fatigue sets in, what tends to drop first? — Nothing — I hold output throughout · Decision-making and focus · Speed and explosiveness · Multiple things — the wheels come off
- How would you describe the structure behind your current training? — Built around individual diagnostics with a clear system · Programmed by a coach but generic · Self-directed / pieced together from multiple sources · Inconsistent or no real structure
- How specific is your training to the actual physical demands of your sport? — Highly specific — built around my sport's profile · Sport-aware but largely generic · General athletic training · Not sport-specific at all
- When were you last formally assessed for performance — not a movement screen or rehab clearance? — Within the last 6 months — full system assessment · Within the last 2 years · Movement screen / rehab clearance only · Never
- How confident are you in your rotational power and control — cutting, throwing, twisting, change of direction? — Strong, refined, and tested · Adequate but never specifically trained · A weak point I haven't addressed · Never trained or assessed it
- Do you know how asymmetric your body is — left vs. right — in strength and power? — Yes, measured and addressed · Roughly aware, not tested · Assume there's a difference but never quantified · Never thought about it

**`rebuilder`:**
- How recent is your injury or breakdown? — weights `0 / 2 / 1 / 0`: Currently still recovering / not cleared · Recently cleared (within 3 months) · Cleared 3–12 months ago but still hesitant · Multiple cycles or chronic recurrence
- How confident do you feel during high-speed or explosive movements? — Very confident · Some hesitation · Quite hesitant · Avoiding them due to injury concern
- When you decelerate or change direction at full speed, how does your body respond? — Stable and aggressive · In control but tentative · Cautious — I don't trust the brakes · I avoid full-speed deceleration
- How confident are you that the underlying cause of the injury has been addressed? — Fully confident · Mostly confident · Doubtful · The cause was never properly identified
- What was your rehab focused on? — Both clearance and return to performance · Clearance and basic strength · Mostly mobility / pain management · Not sure / it ended early
- Have you ever had a full performance assessment after rehab — separate from medical clearance? — Yes, comprehensive · Brief screening only · No · No — and I didn't know that was a thing

**`aspiring_pro`:**
- How would you describe the structure behind your current training? (as above)
- How specific is your training to the actual physical demands of your sport? (as above)
- When were you last formally assessed for performance — not a movement screen or rehab clearance? (as above)
- How confident are you that current training will hold up over the next 3–5 years? — Very — there's a clear long-term plan · Hopeful but unsure · Doubtful — currently short-term focused · No long-term plan in place
- Do you know how asymmetric your body is — left vs. right — in strength and power? (as above)
- How confident are you in your rotational power and control? (as above)

**`parent_coach`:**
- What stage of development is the athlete at? — weight 0 (segmentation): Under 13 — early development · 13–16 — adolescent · 17–19 — late development / academy stage · Adult amateur / college pathway
- What pathway is the athlete aiming for? — weight 0 (segmentation): Pro / elite competition · Scholarship or academy selection · High-level club competition · Still developing the goal
- How specific is the athlete's current training to their sport's demands? — Highly specific and individualised · Sport-related but generic · General gym / fitness · Inconsistent or no formal training
- How would you describe the coaching structure around the athlete? — Integrated — sport coach, strength coach, recovery all coordinated · Sport coach plus one other (S&C or physio) · Sport coach only · Limited or fragmented
- Has the athlete had a foundational performance assessment — separate from sport-skill testing? — Yes — full physical profile completed · Some testing, not comprehensive · School / club basic testing only · Never
- What's the biggest concern about the athlete's development right now? — weight 0 (segmentation): Pushing to the next level · Avoiding overtraining or burnout · Reducing injury risk during growth · Not sure where they actually stand physically
- How confident are you that current training will hold up over the next 3–5 years? (as above)

**Two GHL typos are corrected in the seed and the correction is noted in the file:** `". Cleared 3–12 months ago"` and `". Sport-related but generic"` both carried a stray leading period.

Tiers (spec §6.2): red `0–39`, orange `40–59`, yellow `60–79`, green `80–100`.

Profiles: the five above, `not_sure` at position 0 so it is the no-vote fallback.

- [ ] **Step 1: Write the failing test**

1. `the seed passes its own activation gate` — `expect(quizGate(toDefinition(RPI_ATHLETE_QUIZ)).ok).toBe(true)` with `blockers` asserted `[]` so a failure names the reason.
2. `every branch is reachable from the router`.
3. `the tier bands cover 0..100 with no gap and no overlap`.
4. `a perfect walk of each branch scores 100 and a worst walk scores 0` — run `scoreQuiz` over generated best/worst answer sets, per branch. This is the test that catches a weight typo.
5. `every question has at least two options and every option belongs to its question`.
6. `the profile question carries exactly five votes, one per profile`.
7. `the seed is marked unverified` — `SEED_MARKER` is present, so the editor can show its banner.

- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Write the seed module**
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Write `scripts/seed-athlete-quiz.mjs`**

Idempotent and **additive**: upsert the quiz on `(business_id, key)`, then every child on its stable key, `ON CONFLICT DO NOTHING`. Existing rows are left untouched so a re-run cannot destroy Darren's copy edits. Prints what it inserted and what it skipped. Takes an env file path argument like the other scripts; **defaults to the dev clone and requires an explicit argument to touch anything else.**

- [ ] **Step 6: Run it against the dev clone and read the output**
- [ ] **Step 7: Commit** — `feat(quiz): the RPI quiz as a typed seed its own gate validates`

---

### Task 7: The seventh island

**Files:**
- Modify: `lib/funnels/islands.ts`, `lib/funnels/island-fields.ts`
- Test: `__tests__/lib/funnels/islands.test.ts`

**Interfaces:**
- Produces: `ISLAND_NAMES` includes `"quiz"`; `quizIslandSchema`; `ISLAND_TRAITS.quiz`.

```ts
export const quizIslandSchema = z.object({
  quizId: z.string().uuid(),
  submitLabel: z.string().min(1).max(60).optional().default("See my result"),
  consentText: z.string().max(300).optional(),
})
```

- [ ] **Step 1: Write the failing tests** — the schema accepts a valid props object, rejects a non-uuid `quizId`, defaults `submitLabel`; `ISLAND_TRAITS.quiz` names every settable prop (the existing `Record<IslandName, …>` invariant makes a missing entry a compile error, which is the point of adding to the enum).
- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Add `"quiz"` to `ISLAND_NAMES`, write the schema and the traits**
- [ ] **Step 4: `npx tsc --noEmit`** — expect NEW errors at `components/funnels/islands/index.tsx` (non-exhaustive switch) and anywhere else that enumerates islands. **That is the enum doing its job.** List them; Task 12 closes the renderer one. Any other site must be closed here.
- [ ] **Step 5: Run the island tests, confirm pass**
- [ ] **Step 6: Commit** — `feat(quiz): the seventh island, and the compile errors that proves the registry works`

---

### Task 8: Publish refuses a funnel whose quiz cannot score

**Files:**
- Modify: `lib/funnels/sections/resolve.ts`
- Test: `__tests__/lib/funnels/sections/resolve.test.ts` (or the existing publish-gate suite)

**Interfaces:**
- Consumes: `quizGate` (Task 4), `getQuizDefinition` (Task 2).
- Produces: `ResolveResult.unresolvedQuizzes: { quizId: string; reason: "missing" | "not_active" | "gate_failed"; detail?: string }[]`, and `publishGate` treats every entry as a **blocker**.

- [ ] **Step 1: Write the failing tests**
  - a funnel whose quiz block names an unknown id blocks publish, and the message names the id
  - a `draft` quiz blocks publish
  - a quiz failing `quizGate` blocks publish and the message carries the gate's own first blocker
  - an `active` quiz passing the gate does not block
- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Implement — extend `loadCatalogues` with a quiz catalogue, walk the doc for quiz islands the same generic way CTAs are walked (never a hardcoded path list), populate `unresolvedQuizzes`, and add it to `publishGate`'s blockers**
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Mutate** — move `unresolvedQuizzes` from `blockers` to `warnings`; the three blocking tests must go red.
- [ ] **Step 6: Commit** — `feat(quiz): a page that cannot score the answers it collects does not publish`

---

### Task 9: `POST /api/quiz/progress`

**Files:**
- Create: `app/api/quiz/progress/route.ts`
- Test: `__tests__/api/quiz-progress.test.ts`

**Interfaces:**
- Request: `{ quizId: string; attemptId?: string; branchId?: string | null; answers: QuizAnswer[] }`
- Response: `{ attemptId: string }`

- [ ] **Step 1: Write the failing tests**
  1. a first call with no `attemptId` creates a row and returns its id
  2. a second call carrying that id updates the same row — asserted by the update filter, not by "it did not throw"
  3. an option id that is not on the named question is dropped and never stored
  4. an answer to a question not in this quiz is dropped
  5. a completed attempt refuses further progress — a finished result cannot be edited after the fact
  6. the route 404s when the quiz is not `active`
  7. per-IP throttling refuses the 6th call in a window
- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Implement.** Validate answers against the real definition. Never trust `branchId` from the client — derive it from the router answer. Rate limit as `/api/funnels/submit` does.
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Mutate** — remove the option-belongs-to-question check; test 3 must go red.
- [ ] **Step 6: Commit** — `feat(quiz): progress writes, so a drop-off at Q8 is eight real answers`

---

### Task 10: `POST /api/quiz/submit`

**Files:**
- Create: `app/api/quiz/submit/route.ts`
- Test: `__tests__/api/quiz-submit.test.ts`

**Interfaces:**
- Request: `{ quizId, attemptId, answers, name, email, phone?, marketingConsent?, smsConsent?, website, elapsedMs }`
- Response: `{ score, tier: {...}, profile: {...}, branch: {...} }`

- [ ] **Step 1: Write the failing tests**
  1. **a `score` in the request body changes nothing** — send `score: 100` with worst-case answers; the response and the persisted row both carry the computed value
  2. the honeypot (`website` non-empty) refuses
  3. `elapsedMs` below `MIN_ELAPSED_MS` refuses
  4. a valid submission persists `completed` with score, tier, profile and `max_score`
  5. `recordContactEvent` is called with `source: "quiz"` and metadata `{ quiz_key, branch, tier, profile, score, attempt_id }` — assert the ARGUMENTS, not that it was called
  6. **a throwing `recordContactEvent` still returns the visitor's result** — they answered twelve questions; our plumbing is not their problem
  7. the SMS consent row's `wording_shown` equals `renderSmsConsentWording(displayName)` byte-for-byte
  8. a blank `display_name` files no SMS consent row and the response is still 200
  9. the route 404s for a non-active quiz
  10. no raw PostgREST error object reaches `console.error` — assert the logged payload has `code`/`message` and no `details`
- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Implement in the order of spec §4.3**
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Mutate** — make the route read `body.score` instead of computing; test 1 must go red. Remove the try/catch around `recordContactEvent`; test 6 must go red.
- [ ] **Step 6: Commit** — `feat(quiz): the turn that scores, where the browser's number is not consulted`

---

### Task 11: The preview sibling that writes nothing

**Files:**
- Create: `app/api/quiz/preview-submit/route.ts`
- Test: `__tests__/api/quiz-preview-submit.test.ts`

- [ ] **Step 1: Write the failing tests**
  1. it scores against the DRAFT definition — a quiz still `draft` returns a real result here and 404s on the live route
  2. **the route's source contains no write path** — read the file and assert no `.insert(`, `.update(`, `.upsert(`, `recordContactEvent`, `recordConsent`, `applyPipelineEvent` or `send…Email`. Mirrors the existing `preview-submit` test.
  3. admin/staff only — an anonymous request 404s
- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Commit** — `feat(quiz): a test run that scores and writes nothing`

---

### Task 12: The visitor's screen

**Files:**
- Create: `components/funnels/islands/QuizIsland.tsx`, `components/funnels/islands/QuizRunner.tsx`
- Modify: `components/funnels/islands/index.tsx`, `lib/funnels/sections/styles.ts`, `__tests__/lib/funnels/sections/leadgen.test.ts`
- Test: `__tests__/components/funnels/QuizRunner.test.tsx`

- [ ] **Step 1: Write the failing tests**
  1. renders one question at a time; question two is not in the document until question one is answered
  2. the back button returns to the previous question with the previous answer still selected
  3. the gate form appears only after the last walked question
  4. answering the router changes which questions follow
  5. **`testRun` makes zero progress calls** — assert `fetch` was not called with the progress path
  6. the result renders tier headline, profile name and the CTA the server returned
  7. no `dangerouslySetInnerHTML` anywhere in the component source
- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Implement `QuizRunner` (client) and `QuizIsland` (async server wrapper)**

`QuizIsland` mirrors `FormIsland`: read the definition, strip it with `publicQuizDefinition`, fetch `business_settings.display_name` **only when the gate shows a phone field**, and degrade a blank name to no SMS checkbox — never to a checkbox that cannot name the business.

- [ ] **Step 4: Add the `quiz` case to `renderIsland`** — this closes the exhaustiveness error Task 7 created.
- [ ] **Step 5: Style it, and fix the invariant that is already red**

Add a `quiz` entry to `SECTION_CSS` defining every `djp-quiz-*` class the runner emits. **Also add a rule for `djp-test-run`** — that class has been emitted by `FunnelForm.tsx` with no stylesheet behind it since the draft-preview work, which is why `leadgen.test.ts` has been failing on `main`. Add `"QuizRunner.tsx"` to that test's `ISLAND_FILES`.

- [ ] **Step 6: Run `npx vitest run __tests__/lib/funnels/sections/leadgen.test.ts`** — expect it GREEN, including the `FunnelForm.tsx` case that was failing at baseline.
- [ ] **Step 7: Run the component tests, confirm pass**
- [ ] **Step 8: Commit** — `feat(quiz): the visitor's screen, and the island CSS invariant back to green`

---

### Task 13: Red and Orange open a card

**Files:**
- Modify: `lib/lead-engine/pipeline-move.ts`, `lib/db/pipeline.ts`
- Test: `__tests__/lib/lead-engine/pipeline-move.test.ts`

**Interfaces:**
- Produces: `PipelineEvent` gains `{ kind: "quiz_result"; tier: string; occurredAt: Date }`; `MoveTrigger` gains `"quiz"`; `SOURCE_EVENT_ID_KEYS` gains `"quiz_attempt_id"`.

- [ ] **Step 1: Write the failing tests**
  1. `green` yields `noop`
  2. `yellow` yields `noop`
  3. `red` with no existing card yields `create` in the first open stage with `trigger: "quiz"`
  4. `orange` with an existing OPEN card yields `noop` — the quiz does not disturb a live deal
  5. `red` inside the Lost suppression window yields `refuse`, reusing the existing rule
  6. `red` after the suppression window has expired yields `create`
- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Implement in `decideMove`, then add `"quiz_attempt_id"` to `SOURCE_EVENT_ID_KEYS`**
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Mutate** — remove the tier check so every completion creates; tests 1 and 2 must go red.
- [ ] **Step 6: Commit** — `feat(quiz): a Red result is a deal, a Green one is a newsletter subscriber`

---

### Task 14: The contact event, the alert, and an honest send

**Files:**
- Modify: `lib/db/contacts.ts` (`ContactEventSource`), `app/api/quiz/submit/route.ts`, `lib/email.ts`
- Create: `lib/quizzes/alert.ts`
- Test: `__tests__/lib/quizzes/alert.test.ts`, extend `__tests__/api/quiz-submit.test.ts`

**Interfaces:**
- Produces: `ContactEventSource` gains `"quiz"`; `sendQuizAlert(input): Promise<{ delivered: boolean }>`.

**No migration.** `contact_timeline_events.source` is plain `text NOT NULL` with no CHECK — verified in `00214`.

- [ ] **Step 1: Write the failing tests**
  1. a `red` result calls the alert; a `green` one does not
  2. **an unconfigured mailer records `alert_status: "failed"`, not `"sent"`** — `lib/email.ts` returns a success shape when `RESEND_API_KEY` is unset, so "the send did not throw" is not "somebody was told"
  3. a delivered alert records `"sent"` with an `alerted_at`
  4. an alert failure does not change the visitor's response
- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Implement.** `sendQuizAlert` must return real delivery, which means checking the configuration explicitly rather than trusting the shared helper's return.
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Mutate** — make `sendQuizAlert` always return `{delivered: true}`; test 2 must go red.
- [ ] **Step 6: Commit** — `feat(quiz): the alert, and the difference between sending and not throwing`

---

### Task 15: Four sequences, seeded as drafts

**Files:**
- Create: `supabase/migrations/00229_athlete_quiz_sequences.sql`
- Test: `__tests__/lib/lead-engine/quiz-sequences.test.ts`

- [ ] **Step 1: Write the failing test**
  1. four sequences with `trigger_source = 'quiz'` and one `trigger_filter` per branch key
  2. **every one seeds as `draft`** — `00218`'s header sets this precedent and states the reason: a sequence that is `active` on the day its trigger starts firing sends mail nobody reviewed
  3. the four filter keys match `RPI_ATHLETE_QUIZ`'s four branch keys exactly — asserted against the seed module, not against a copy of the list
- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Write the migration in `00218`'s style, `ON CONFLICT (business_id, key) DO NOTHING`, with placeholder step copy clearly marked as needing Darren's pass**
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Apply to the dev clone via the Management API**
- [ ] **Step 6: Commit** — `feat(quiz): four archetype sequences, off until the copy is Darren's`

---

### Task 16: The admin list

**Files:**
- Create: `app/(admin)/admin/funnels/quizzes/page.tsx`, `app/api/admin/quizzes/route.ts`
- Test: `__tests__/app/admin-quizzes-list.test.tsx`

- [ ] **Step 1: Write the failing tests** — renders a `DataTableCard`; shows status as a `DataTableBadge`; shows completed/total attempts; an empty state uses `DataTableEmpty`; a quiz still carrying `SEED_MARKER` shows the unverified banner.
- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Implement using `components/ui/data-table.tsx` — `DataTableCard` → `DataTableToolbar` → `DataTable` → `DataTableRow` → `DataTableCell`. Never a hand-rolled `<table>`; that is how `/admin/team` ended up looking like a different app.**
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Commit** — `feat(quiz): the quizzes list, in the house table`

---

### Task 17: The editor

**Files:**
- Create: `app/(admin)/admin/funnels/quizzes/[id]/page.tsx`, `components/admin/quizzes/QuizEditor.tsx` (+ one child component per panel), `app/api/admin/quizzes/[id]/route.ts`
- Test: `__tests__/components/admin/QuizEditor.test.tsx`, `__tests__/api/admin-quiz-save.test.ts`

**Five panels** (spec §2.1): details, branches, questions (tab per branch plus "Everyone"), tiers, profiles.

- [ ] **Step 1: Write the failing tests**
  1. the questions panel shows a tab per branch plus "Everyone"
  2. an option row edits label, weight, routes-to and profile vote
  3. **"Activate" is disabled while `quizGate` reports a blocker, and the blockers are listed on screen** — the gate is the reason, shown, not a silent disable
  4. reordering questions writes new `position` values
  5. the save API rejects a payload that would fail `quizGate` with `status: "active"` — the gate is enforced server-side, because a disabled button is not a control
  6. the save API is admin-only
- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Implement. Reorder via `@dnd-kit`, matching the funnel step builder's existing usage.**
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Mutate** — remove the server-side gate check; test 5 must go red. A gate that lives only in the button is not a gate.
- [ ] **Step 6: Commit** — `feat(quiz): the editor, whose activate button and whose API enforce the same gate`

---

### Task 18: Drive it, shoot it, hand it over

**Files:**
- Create: `screenshots/athlete-quiz/*.png` + `index.html`
- Create: `docs/athlete-quiz-handover.md`

- [ ] **Step 1: Seed the dev clone and build a real funnel** — create a funnel with a quiz block pointing at the seeded quiz, publish it, and reach it at `/go/<slug>`.
- [ ] **Step 2: Drive the real app with Playwright on the real routes.** Not a harness, not a storybook, not a scratch page. Screens: the intro, the router question, a mid-branch question, the gate, a Red result, a Green result, the admin list, the editor's questions panel, the editor's activate-blocked state.
- [ ] **Step 3: Annotate the PNGs themselves** — numbered markers and captions burned in, composed at the capture's exact pixel width. Light only: this app has no working dark mode.
- [ ] **Step 4: Look at every PNG.** Stage 3 found two real defects this way under a fully green suite — a validator blocking the assistant for refusing to promise, and a visitor's own number read as invented. Unit tests written from a guard's perspective see true positives and structurally cannot see false ones.
- [ ] **Step 5: Write the handover** — what it does, the three steps to serve a request, what is enforced and how, what was found in passing, and the five open items from spec §8.
- [ ] **Step 6: Full verification** — targeted suites across everything touched, `npx tsc --noEmit` (expect **251**, attributed by file), `npm run build` green.
- [ ] **Step 7: Commit** — `docs(quiz): nine screens driven through the real funnel, and the handover`

---

## Self-review

**Spec coverage:** §1 → Tasks 1–2. §2 → Tasks 4, 16, 17. §3 → Tasks 7, 8, 12. §4 → Tasks 3, 5, 9, 10, 11, 12. §5 → Tasks 13, 14, 15. §6 → Task 6. §7 → every task's mutation step plus Task 18 Step 6. §8 → Task 18.

**Gaps found and closed while reviewing:** the spec's §2.3 preview promise needed its own route (Task 11) rather than being folded into Task 10; the pre-existing `leadgen.test.ts` failure needed an owner (Task 12 Step 5) or it would have been mistaken for ours at the end.

**Type consistency:** `QuizDefinition` is defined once in Task 2 and consumed by name in Tasks 3, 4, 5, 6, 8. `QuizAnswer` is defined in Task 3 and used in Tasks 9, 10. `quizGate` returns `QuizGateResult` in Task 4 and is consumed under that name in Tasks 6, 8, 17.
