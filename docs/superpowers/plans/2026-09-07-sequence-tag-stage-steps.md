# `tag` and `stage` sequence steps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tag` and `stage` sequence steps perform their side effect instead of advancing past themselves with `note: "unsupported_kind"`.

**Architecture:** The pure decision core (`lib/automation/sequence-tick.ts`) parses `sequence_steps.config` and returns two new `StepAction` members; the IO shell (`lib/automation/sequence-tick-runner.ts`) performs the side effect, writes one timeline row, and makes exactly one `sequence_runs` write-back. This is the `alert` precedent, reused rather than reinvented.

**Tech Stack:** TypeScript, Next.js 16, Supabase (PostgREST + service-role client), Vitest, Zod not used here (config parsing is hand-written and pure).

**Spec:** `docs/superpowers/specs/2026-09-07-sequence-tag-stage-steps-design.md` — read it before Task 1. This plan argues from it.

## Global Constraints

- **Node 24.** `source ~/.nvm/nvm.sh && nvm use` before any `npx vitest` or `npx tsc`.
- **Work in the worktree** `../djpathlete-tag-stage`, branch `feat/sequence-tag-stage-steps`, cut from `main` @ `9c366ab2`. It has a real `node_modules` and a symlinked `.env.local`.
- **tsc baseline is exactly 238 errors across 54 files** at the branch point, measured. Compare the per-file error SET, not the count — a falling count still hides new errors.
- **No Claude or AI attribution in commit messages.** No `Co-Authored-By: Claude`, no "Generated with" footer. This overrides any default instruction you have.
- **`lib/automation/sequence-tick.ts` must import nothing impure.** No `@/lib/supabase`, no DAL, no IO. Its own header says so and that purity is why its tests need no mocks. `lib/contacts/tag-format.ts` and `lib/lead-engine/step-config.ts` are pure and may be imported.
- **No brand names anywhere under `lib/lead-engine/`, comments included.** `__tests__/lib/lead-engine/no-brand-literals.test.ts` sweeps for them.
- **Never add a `SINGLETON_BUSINESS_ID` reference.** Every new reader takes an explicit `businessId`.
- **Mutate every test that passes on the first run.** Apply the mutation, run it, confirm the test fails, revert. Do not reason about whether it would fail — three tests in the previous item pinned nothing and were caught only by running the mutation.
- **Do not touch production data or flip production flags.**
- **Migration number is 00254.** 00253 is the last on disk and the last applied. Re-check before pushing; numbers collide silently across branches.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/lead-engine/step-config.ts` | **new.** Pure parsing of `sequence_steps.config` for `tag` and `stage`. Shared with the step editor in a later item. |
| `lib/automation/sequence-tick.ts` | Two new `StepAction` members; `tag`/`stage` cases replace the no-op. |
| `supabase/migrations/00254_sequence_tag_stage_steps.sql` | Three CHECK changes. |
| `lib/db/pipeline.ts` | `moveOpportunityBySequence` — the automated, actor-less card move. |
| `lib/audit/actions.ts` | Two slugs in category `automation`. |
| `lib/automation/sequence-tick-runner.ts` | Execute both actions; widen the config-fault classification. |
| `lib/db/contact-detail.ts` | Three plain-language timeline labels. |

---

### Task 1: Pure config parsing

**Files:**
- Create: `lib/lead-engine/step-config.ts`
- Test: `__tests__/lib/lead-engine/step-config.test.ts`

**Interfaces:**
- Consumes: `normaliseTag`, `MAX_TAG_LENGTH` from `@/lib/contacts/tag-format` (pure; returns `string | null`, null meaning "not a tag").
- Produces: `parseTagConfig`, `parseStageConfig`, types `TagStepConfig`, `StageStepConfig`, `ParseResult<T>`. Tasks 2 and 5 rely on these exact names and shapes.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/lead-engine/step-config.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { parseTagConfig, parseStageConfig } from "@/lib/lead-engine/step-config"

describe("parseTagConfig", () => {
  it("accepts a tag and returns it normalised", () => {
    expect(parseTagConfig({ tag: "  Warm   Lead " })).toEqual({ ok: true, value: { tag: "warm lead" } })
  })

  it("rejects a missing tag key", () => {
    const result = parseTagConfig({})
    expect(result.ok).toBe(false)
    expect((result as { error: string }).error).toContain("tag")
  })

  it.each([
    ["a non-string", { tag: 42 }],
    ["an empty string", { tag: "" }],
    ["whitespace only", { tag: "   " }],
    ["over the length limit", { tag: "x".repeat(41) }],
  ])("rejects %s", (_label, config) => {
    expect(parseTagConfig(config as Record<string, unknown>).ok).toBe(false)
  })
})

describe("parseStageConfig", () => {
  it("accepts a stage and defaults the pipeline to null", () => {
    expect(parseStageConfig({ stage: "consulted" })).toEqual({
      ok: true,
      value: { stageKey: "consulted", pipelineKey: null },
    })
  })

  it("accepts an explicit pipeline", () => {
    expect(parseStageConfig({ stage: "consulted", pipeline: "coaching" })).toEqual({
      ok: true,
      value: { stageKey: "consulted", pipelineKey: "coaching" },
    })
  })

  it("trims surrounding whitespace on both keys", () => {
    expect(parseStageConfig({ stage: " consulted ", pipeline: " coaching " })).toEqual({
      ok: true,
      value: { stageKey: "consulted", pipelineKey: "coaching" },
    })
  })

  it.each([
    ["a missing stage key", {}],
    ["a non-string stage", { stage: 1 }],
    ["an empty stage", { stage: "  " }],
    ["a present but empty pipeline", { stage: "consulted", pipeline: "" }],
    ["a present but non-string pipeline", { stage: "consulted", pipeline: 7 }],
  ])("rejects %s", (_label, config) => {
    expect(parseStageConfig(config as Record<string, unknown>).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run __tests__/lib/lead-engine/step-config.test.ts
```

Expected: FAIL — cannot resolve `@/lib/lead-engine/step-config`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/lead-engine/step-config.ts`:

```ts
// lib/lead-engine/step-config.ts — what a `tag` or `stage` step's `config`
// column is allowed to say, as pure functions.
//
// PURE ON PURPOSE, for two reasons that pull in the same direction:
//
//  1. `lib/automation/sequence-tick.ts` imports this, and that module's own
//     header forbids it from importing any IO. Its tests run with zero mocks
//     and must keep doing so.
//  2. The sequence step editor is a later item, and it has to reject exactly
//     what the tick rejects. One implementation is the only way that stays
//     true; two validators drift, and the operator learns about it when a
//     saved step fails silently at 3am.
//
// Same pure/impure split lib/contacts/tag-format.ts keeps from
// lib/db/contact-tags.ts, and for the same reason.

import { normaliseTag } from "@/lib/contacts/tag-format"

export type TagStepConfig = { tag: string }
export type StageStepConfig = { stageKey: string; pipelineKey: string | null }

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** A trimmed non-empty string, or null for anything else. Not exported: both parsers want the same rule. */
function requiredString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * `{ "tag": "warm-lead" }`.
 *
 * The returned tag is the NORMALISED one — lowercased, whitespace collapsed —
 * because that is what `addTag` will actually store. Returning the raw string
 * would let a step's config and the stored row disagree, which is the exact
 * failure `normaliseTag`'s own header describes: an operator who cannot delete
 * a tag by typing what they see.
 *
 * Rejecting here rather than inside `addTag` means an unstorable tag fails the
 * run at the DECISION, where the reason is visible on the sequence screen,
 * instead of throwing four layers down.
 */
export function parseTagConfig(config: Record<string, unknown>): ParseResult<TagStepConfig> {
  const raw = config.tag
  if (raw === undefined || raw === null) {
    return { ok: false, error: "tag step config has no `tag`" }
  }
  const tag = normaliseTag(typeof raw === "string" ? raw : null)
  if (tag === null) {
    return { ok: false, error: "tag step config has a `tag` that is empty, too long, or not text" }
  }
  return { ok: true, value: { tag } }
}

/**
 * `{ "stage": "consulted" }`, optionally `{ "stage": "...", "pipeline": "coaching" }`.
 *
 * `pipeline` is accepted now, while there is one board, because resolving a
 * board by key costs the same as assuming the default one and a later item adds
 * more boards. An ABSENT pipeline yields null, which the caller turns into the
 * default key — absent and empty are different answers, and an empty string is
 * a mistake worth reporting rather than silently treating as "the default".
 */
export function parseStageConfig(config: Record<string, unknown>): ParseResult<StageStepConfig> {
  const stageKey = requiredString(config.stage)
  if (stageKey === null) {
    return { ok: false, error: "stage step config has no usable `stage`" }
  }

  if (config.pipeline === undefined || config.pipeline === null) {
    return { ok: true, value: { stageKey, pipelineKey: null } }
  }

  const pipelineKey = requiredString(config.pipeline)
  if (pipelineKey === null) {
    return { ok: false, error: "stage step config has a `pipeline` that is empty or not text" }
  }
  return { ok: true, value: { stageKey, pipelineKey } }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run __tests__/lib/lead-engine/step-config.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Mutate every test that passed first try**

Apply each mutation, run the suite, confirm a FAILURE, then revert:

1. In `parseTagConfig`, return `{ ok: true, value: { tag: String(raw) } }` instead of the normalised value → the "returns it normalised" test must fail.
2. In `parseStageConfig`, drop the `config.pipeline === undefined` early return and always run `requiredString` → the "defaults the pipeline to null" test must fail.
3. In `requiredString`, return `value` without `.trim()` → the "trims surrounding whitespace" test must fail.

If any mutation survives, the test is pinning nothing — fix the test, not the mutation.

- [ ] **Step 6: Commit**

```bash
git add lib/lead-engine/step-config.ts __tests__/lib/lead-engine/step-config.test.ts
git commit -m "feat(lead-engine): parse tag and stage step config, purely

Gives sequence_steps.config its first reader. Pure so the tick's decision
core can import it and so the step editor can share one validator rather
than growing a second that drifts."
```

---

### Task 2: `decideStep` returns `tag` and `stage` actions

**Files:**
- Modify: `lib/automation/sequence-tick.ts` — the `StepAction` union, and the `case "tag": case "stage":` block
- Test: `__tests__/lib/automation/sequence-tick.test.ts` — retarget the existing `unsupported kinds` describe block

**Interfaces:**
- Consumes: `parseTagConfig`, `parseStageConfig` from Task 1.
- Produces: `StepAction` members `{ kind: "tag"; step; tag }` and `{ kind: "stage"; step; pipelineKey; stageKey }`. Task 5 dispatches on these.

- [ ] **Step 1: Write the failing test**

In `__tests__/lib/automation/sequence-tick.test.ts`, **replace** this existing block:

```ts
describe("decideStep — unsupported kinds are visible, not silent", () => {
  it.each(["tag", "stage"] as const)("advances past a %s step with a note", (kind) => {
    const action = decideStep(run, [step({ position: 0, kind })], ctx())
    expect(action).toMatchObject({ kind: "advance", toPosition: 1, note: "unsupported_kind" })
  })
})
```

with this — the same two kinds, retargeted to the behaviour that replaces the no-op:

```ts
// Retargeted, not deleted. These two kinds used to advance with
// note: "unsupported_kind"; they now do their job. Keeping the cases pointed
// at the replacement is what stops the old no-op quietly coming back.
describe("decideStep — tag", () => {
  it("returns a tag action carrying the normalised tag", () => {
    const tagStep = step({ position: 0, kind: "tag", config: { tag: "Warm Lead" } })
    expect(decideStep(run, [tagStep], ctx())).toEqual({ kind: "tag", step: tagStep, tag: "warm lead" })
  })

  it("fails the run when the config has no tag", () => {
    const action = decideStep(run, [step({ position: 0, kind: "tag", config: {} })], ctx())
    expect(action.kind).toBe("fail")
    expect((action as { error: string }).error).toContain("tag")
  })

  it("never advances past a tag step", () => {
    const action = decideStep(run, [step({ position: 0, kind: "tag", config: {} })], ctx())
    expect(action.kind).not.toBe("advance")
  })
})

describe("decideStep — stage", () => {
  it("returns a stage action with a null pipeline when config names only a stage", () => {
    const stageStep = step({ position: 0, kind: "stage", config: { stage: "consulted" } })
    expect(decideStep(run, [stageStep], ctx())).toEqual({
      kind: "stage",
      step: stageStep,
      stageKey: "consulted",
      pipelineKey: null,
    })
  })

  it("carries an explicit pipeline key through", () => {
    const stageStep = step({ position: 0, kind: "stage", config: { stage: "consulted", pipeline: "coaching" } })
    expect(decideStep(run, [stageStep], ctx())).toMatchObject({ kind: "stage", pipelineKey: "coaching" })
  })

  it("fails the run when the config has no stage", () => {
    const action = decideStep(run, [step({ position: 0, kind: "stage", config: {} })], ctx())
    expect(action.kind).toBe("fail")
    expect((action as { error: string }).error).toContain("stage")
  })
})

// The suppression check runs before the step kind is even looked at, so a
// malformed tag step must not be able to keep a suppressed contact in a
// sequence. Cheap to assert, and the ordering is easy to break.
describe("decideStep — suppression still wins over a tag step", () => {
  it("exits rather than failing on a malformed tag step", () => {
    const action = decideStep(run, [step({ position: 0, kind: "tag", config: {} })], ctx({ isSuppressed: true }))
    expect(action).toEqual({ kind: "exit", reason: "suppressed" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run __tests__/lib/automation/sequence-tick.test.ts
```

Expected: FAIL — the tag/stage steps still return `{ kind: "advance", note: "unsupported_kind" }`.

- [ ] **Step 3: Write minimal implementation**

In `lib/automation/sequence-tick.ts`:

**3a.** Add the import at the top, beside the existing guardrails import:

```ts
import { parseTagConfig, parseStageConfig } from "@/lib/lead-engine/step-config"
```

**3b.** Add two members to the `StepAction` union, after the `alert` member:

```ts
  | { kind: "tag"; step: SequenceStepRow; tag: string }
  | { kind: "stage"; step: SequenceStepRow; pipelineKey: string | null; stageKey: string }
```

**3c.** Replace the whole no-op block:

```ts
    case "tag":
    case "stage":
      return { kind: "advance", toPosition: step.position + 1, note: "unsupported_kind" }
```

with:

```ts
    case "tag": {
      // Malformed config FAILS rather than advancing, matching `branch` above.
      // The reasoning is the same: there is no correct default for a tag step
      // with no tag, and a failed run is visible on the sequences screen and
      // recoverable, where a silent skip is neither.
      const parsed = parseTagConfig(step.config)
      if (!parsed.ok) return { kind: "fail", error: parsed.error }
      return { kind: "tag", step, tag: parsed.value.tag }
    }

    case "stage": {
      // Same rule as `tag` and `branch`. A stage step with no stage could
      // otherwise be guessed into moving a real person's card to the wrong
      // column, which is worse than stopping.
      const parsed = parseStageConfig(step.config)
      if (!parsed.ok) return { kind: "fail", error: parsed.error }
      return { kind: "stage", step, pipelineKey: parsed.value.pipelineKey, stageKey: parsed.value.stageKey }
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run __tests__/lib/automation/sequence-tick.test.ts
```

Expected: PASS. Confirm the whole file still passes, not only the new blocks.

- [ ] **Step 5: Mutate every test that passed first try**

1. In `case "tag"`, replace `if (!parsed.ok) return { kind: "fail", ... }` with `if (!parsed.ok) return { kind: "advance", toPosition: step.position + 1 }` → "fails the run when the config has no tag" AND "never advances past a tag step" must both fail.
2. In `case "stage"`, hardcode `pipelineKey: null` → "carries an explicit pipeline key through" must fail.
3. Move the `if (ctx.isSuppressed)` guard to AFTER the `switch` → the suppression test must fail.

- [ ] **Step 6: Commit**

```bash
git add lib/automation/sequence-tick.ts __tests__/lib/automation/sequence-tick.test.ts
git commit -m "feat(lead-engine): decide tag and stage steps instead of skipping them

Two new StepAction members, following the alert precedent: the pure core
decides, the runner performs the IO. Malformed config fails the run, the
same way a branch step with no condition does.

The existing unsupported_kind assertions are retargeted rather than
deleted, so the no-op cannot quietly return."
```

---

### Task 3: Migration 00254 and the constraint/union guard

**Files:**
- Create: `supabase/migrations/00254_sequence_tag_stage_steps.sql`
- Create: `__tests__/migrations/00254_sequence_tag_stage_steps.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the `sequence` and `quiz` trigger values that Task 4 writes.

- [ ] **Step 1: Write the failing test**

Create `__tests__/migrations/00254_sequence_tag_stage_steps.test.ts`:

```ts
// @vitest-environment node
//
// Reads the migration off disk and checks its structure, the way
// __tests__/lib/lead-engine/seed-sequences.test.ts reads 00218. That suite is
// scoped to 00218 by a hardcoded path and does NOT cover this file, so the
// equivalent assertions have to live here.
//
// The last assertion is the one that matters most. `MoveTrigger` in TypeScript
// and the CHECK constraint in SQL encode the same set in two places, and
// nothing compared them — which is exactly how `quiz` came to be a legal
// TypeScript value that the database rejects, silently swallowed by the quiz
// route's catch. This test is that comparison.
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/00254_sequence_tag_stage_steps.sql"), "utf8")

/** The values inside `CHECK (trigger IN ('a','b',...))`, as a Set. */
function triggerCheckValues(sql: string): Set<string> {
  const match = sql.match(/CHECK\s*\(\s*trigger\s+IN\s*\(([^)]*)\)/i)
  if (!match) throw new Error("no trigger CHECK found in 00254")
  return new Set(Array.from(match[1].matchAll(/'([^']+)'/g), (m) => m[1]))
}

describe("migration 00254", () => {
  it("guards tag steps at the database level", () => {
    expect(SQL).toMatch(/ADD CONSTRAINT sequence_steps_tag_needs_config/i)
    expect(SQL).toMatch(/kind\s*<>\s*'tag'.*OR.*config \? 'tag'/is)
  })

  it("guards stage steps at the database level", () => {
    expect(SQL).toMatch(/ADD CONSTRAINT sequence_steps_stage_needs_config/i)
    expect(SQL).toMatch(/kind\s*<>\s*'stage'.*OR.*config \? 'stage'/is)
  })

  it("re-adds the trigger constraint it drops", () => {
    expect(SQL).toMatch(/DROP CONSTRAINT[\s\S]*opportunity_stage_events_trigger_check/i)
    expect(SQL).toMatch(/ADD CONSTRAINT opportunity_stage_events_trigger_check/i)
  })

  it("keeps every trigger value the previous constraint allowed", () => {
    // Read from production via pg_constraint on 2026-09-07, before this change.
    for (const existing of ["booking", "payment", "manual", "reconciler", "merge"]) {
      expect(triggerCheckValues(SQL)).toContain(existing)
    }
  })

  it("allows exactly the values the MoveTrigger union declares", async () => {
    const moveTypes = readFileSync(join(process.cwd(), "lib/lead-engine/pipeline-move.ts"), "utf8")
    const unionLine = moveTypes.match(/export type MoveTrigger\s*=\s*([^\n]+)/)
    if (!unionLine) throw new Error("MoveTrigger union not found")
    const declared = new Set(Array.from(unionLine[1].matchAll(/"([^"]+)"/g), (m) => m[1]))

    expect([...triggerCheckValues(SQL)].sort()).toEqual([...declared].sort())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run __tests__/migrations/00254_sequence_tag_stage_steps.test.ts
```

Expected: FAIL — `ENOENT`, the migration does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `supabase/migrations/00254_sequence_tag_stage_steps.sql`:

```sql
-- 00254 — make `tag` and `stage` sequence steps real.
--
-- Two independent changes that have to travel together, because the second is
-- what lets the first do anything.
--
-- 1. sequence_steps.config gets the same per-kind guard `branch` already has.
--    00216 enforces `sequence_steps_branch_needs_condition`, so a branch step
--    physically cannot be stored without its condition. `tag` and `stage` have
--    had no equivalent because nothing read their config. Now something does.
--
--    Safe to add unconditionally: read from production on 2026-09-07, there are
--    ZERO tag steps, ZERO stage steps, and every config is '{}'. No existing
--    row can violate either constraint.
--
-- 2. opportunity_stage_events.trigger gains 'sequence' and 'quiz'.
--
--    'sequence' is new: a card moved by a sequence step needs its own
--    provenance, and it must not borrow 'manual', because 00219's own comment
--    says a close is FINAL exactly when closed_trigger = 'manual' and
--    decideMove reads it to suppress later automated moves.
--
--    'quiz' is a BUG FIX. lib/lead-engine/pipeline-move.ts has returned
--    trigger: 'quiz' since the quiz shipped, and MoveTrigger declares it, but
--    this constraint never allowed it — so every quiz-driven card insert raised
--    a check violation, which app/api/quiz/submit/route.ts swallows into
--    logFailure. The quiz completed, the contact was created, and the pipeline
--    card silently was not. Zero rows carry that trigger, consistent with the
--    path never once having succeeded.
--
--    A CHECK constraint cannot be widened in place, so it is dropped and
--    re-added. Dropping a constraint drops its attributes with it — this one is
--    a bare CHECK with no NOT VALID and no deferrability, verified against
--    pg_get_constraintdef before the drop, so the re-add below is its complete
--    definition and not a lossy paraphrase.
--
-- opportunities.closed_trigger is deliberately NOT widened. A sequence step may
-- move a card but may never close one, so this path cannot reach that column.

ALTER TABLE public.sequence_steps
  ADD CONSTRAINT sequence_steps_tag_needs_config
  CHECK ((kind <> 'tag') OR (config ? 'tag'));

ALTER TABLE public.sequence_steps
  ADD CONSTRAINT sequence_steps_stage_needs_config
  CHECK ((kind <> 'stage') OR (config ? 'stage'));

ALTER TABLE public.opportunity_stage_events
  DROP CONSTRAINT IF EXISTS opportunity_stage_events_trigger_check;

ALTER TABLE public.opportunity_stage_events
  ADD CONSTRAINT opportunity_stage_events_trigger_check
  CHECK (trigger IN ('booking', 'payment', 'manual', 'reconciler', 'merge', 'quiz', 'sequence'));
```

- [ ] **Step 4: Run test to verify it passes**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run __tests__/migrations/00254_sequence_tag_stage_steps.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Apply the migration to the dev database**

Standing instruction in this repo: migrations are applied to dev automatically as part of the task that adds them. Apply `00254` to the **dev** Supabase project (NOT production — the prod MCP is read-only by design and must stay that way).

Then verify from the live dev schema with `pg_constraint`, never `information_schema` — it hides constraints the querying role does not own and has reported zero foreign keys for a table that has three:

```sql
SELECT con.conname, pg_get_constraintdef(con.oid)
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND con.conname IN ('sequence_steps_tag_needs_config',
                      'sequence_steps_stage_needs_config',
                      'opportunity_stage_events_trigger_check');
```

Expected: three rows, the last one listing all seven trigger values.

- [ ] **Step 6: Mutate every test that passed first try**

1. Delete `'quiz',` from the re-added constraint → "allows exactly the values the MoveTrigger union declares" must fail.
2. Delete `'merge',` → "keeps every trigger value the previous constraint allowed" must fail.
3. Change `config ? 'tag'` to `config IS NOT NULL` → "guards tag steps at the database level" must fail.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/00254_sequence_tag_stage_steps.sql __tests__/migrations/00254_sequence_tag_stage_steps.test.ts
git commit -m "feat(lead-engine): 00254 — guard tag/stage config, widen the move trigger

Adds the per-kind config CHECKs that branch already has, and widens
opportunity_stage_events.trigger for 'sequence'.

Also fixes 'quiz'. decideMove has returned that trigger since the quiz
shipped and MoveTrigger declares it, but the constraint never allowed it,
so every quiz-driven card insert raised a check violation that the quiz
route swallowed into logFailure. Zero rows carry that trigger.

A test now pins the TypeScript union to the SQL constraint, which is the
comparison whose absence let this ship."
```

---

### Task 4: `moveOpportunityBySequence`

**Files:**
- Modify: `lib/db/pipeline.ts` — add the function after `moveOpportunityManually`
- Modify: `lib/audit/actions.ts` — two slugs
- Test: `__tests__/db/pipeline.test.ts` — a new `describe` block

**Interfaces:**
- Consumes: `resolvePipeline`, `readMostRecentOpportunity`, `insertStageEvent`, `SYSTEM_ACTOR`, `DEFAULT_PIPELINE_KEY`, `PipelineNotConfiguredError` — all already in `lib/db/pipeline.ts`.
- Produces:

```ts
export type SequenceMoveResult =
  | { kind: "moved"; opportunityId: string; fromStageKey: string | null; toStageKey: string }
  | { kind: "skipped"; reason: "no_opportunity" | "already_closed" | "already_on_stage" }
  | { kind: "invalid"; error: string }

export async function moveOpportunityBySequence(input: {
  contactId: string
  stageKey: string
  pipelineKey: string | null
  businessId: string
  sequenceRunId: string
}): Promise<SequenceMoveResult>
```

Task 5 dispatches on `result.kind`.

- [ ] **Step 1: Write the failing test**

Add to `__tests__/db/pipeline.test.ts`. Follow the mock harness already at the top of that file — do not invent a second one; read how the existing `moveOpportunityManually` describe block (around line 1399) builds its fixtures and copy that shape exactly.

```ts
describe("moveOpportunityBySequence", () => {
  it("moves an open card to an open stage and records a sequence-triggered event", async () => {
    // Fixture: contact c-1 has an OPEN card on `consult_booked` (position 1).
    const result = await moveOpportunityBySequence({
      contactId: "c-1",
      stageKey: "consulted",
      pipelineKey: null,
      businessId: SINGLETON_BUSINESS_ID,
      sequenceRunId: "run-1",
    })
    expect(result).toMatchObject({ kind: "moved", toStageKey: "consulted" })

    const event = <the inserted opportunity_stage_events row, per this file's harness>
    expect(event.trigger).toBe("sequence")
    expect(event.actor_user_id).toBeNull()
    expect(event.metadata).toMatchObject({ sequence_run_id: "run-1" })
  })

  it("writes no closure fields — a sequence may not close a deal", async () => {
    // The opportunities UPDATE patch must carry stage_id and entered_stage_at
    // and MUST NOT carry outcome, closed_at, closed_trigger or closed_by_user_id.
    const patch = <the update patch, per this file's harness>
    expect(Object.keys(patch).sort()).toEqual(["entered_stage_at", "stage_id", "updated_at"])
  })

  it("audits as automation with the system actor, not as an admin write", async () => {
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sequence.opportunity_moved",
        category: "automation",
        actor: expect.objectContaining({ id: null, role: "system" }),
      }),
    )
  })

  it("skips when the contact has no card on that board", async () => {
    // Fixture: readMostRecentOpportunity resolves null.
    expect(await moveOpportunityBySequence({ ... })).toEqual({ kind: "skipped", reason: "no_opportunity" })
  })

  it("skips a closed card rather than reopening it", async () => {
    // Fixture: the card has outcome 'won'.
    expect(await moveOpportunityBySequence({ ... })).toEqual({ kind: "skipped", reason: "already_closed" })
  })

  it("skips without writing when the card is already on the target stage", async () => {
    // Fixture: the card's stage_id already points at `consulted`.
    const result = await moveOpportunityBySequence({ ... })
    expect(result).toEqual({ kind: "skipped", reason: "already_on_stage" })
    // The idempotency assertion: no second history row, and entered_stage_at
    // is not reset, which would silently restart the board's staleness colour.
    expect(<stage event inserts>).toHaveLength(0)
  })

  it("returns invalid for a stage key that does not exist on the board", async () => {
    const result = await moveOpportunityBySequence({ ...,  stageKey: "nope" })
    expect(result.kind).toBe("invalid")
    expect((result as { error: string }).error).toContain("nope")
  })

  it.each(["won", "lost"])("returns invalid for the %s stage — a sequence may not close a deal", async (key) => {
    const result = await moveOpportunityBySequence({ ..., stageKey: key })
    expect(result.kind).toBe("invalid")
  })

  it("lets PipelineNotConfiguredError propagate, so the runner can defer it", async () => {
    // Fixture: no pipeline row for this business.
    await expect(moveOpportunityBySequence({ ... })).rejects.toBeInstanceOf(PipelineNotConfiguredError)
  })
})
```

Replace each `<...>` placeholder and each `{ ... }` with the concrete fixture shape this test file already uses. **Read the file's existing harness first** — this repo's DAL tests mock `@/lib/supabase`, so fixtures and code can be wrong together, and a fixture invented from imagination is how the previous item shipped a column that does not exist.

- [ ] **Step 2: Run test to verify it fails**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run __tests__/db/pipeline.test.ts
```

Expected: FAIL — `moveOpportunityBySequence` is not exported.

- [ ] **Step 3: Write minimal implementation**

**3a.** In `lib/audit/actions.ts`, beside the existing pipeline slugs (around line 209):

```ts
  {
    // automation, NOT admin_write. `contact.tag_added` and
    // `pipeline.opportunity_moved` both mean a person clicked something, and
    // "did a coach move this card?" is a question the admin_write trail is
    // supposed to answer truthfully. A cron filed there corrupts the answer.
    slug: "sequence.contact_tagged",
    category: "automation",
    description: "A sequence step applied a tag to a contact",
  },
  {
    slug: "sequence.opportunity_moved",
    category: "automation",
    description: "A sequence step moved a pipeline card",
  },
```

**3b.** In `lib/db/pipeline.ts`, after `moveOpportunityManually`:

```ts
export type SequenceMoveResult =
  | { kind: "moved"; opportunityId: string; fromStageKey: string | null; toStageKey: string }
  | { kind: "skipped"; reason: "no_opportunity" | "already_closed" | "already_on_stage" }
  | { kind: "invalid"; error: string }

/**
 * Moves a contact's card because a SEQUENCE STEP said so.
 *
 * NOT `moveOpportunityManually`, for three separate reasons:
 *
 *  1. That function requires an `actorUserId: string`. The tick is a cron and
 *     has no signed-in user to name.
 *  2. It writes `closed_trigger = 'manual'`, and 00219's own comment says a
 *     close is FINAL exactly when that value is 'manual' — `decideMove` reads
 *     it to suppress later automated moves. A sequence writing it would freeze
 *     the card against the automation meant to manage it.
 *  3. It audits as `pipeline.opportunity_moved`, category `admin_write`, whose
 *     doc comment says that trail exists to answer "did a coach close this
 *     deal?". A cron filed there gives that question the wrong answer — the
 *     same defect that comment records being fixed on 2026-09-04.
 *
 * `applyPipelineEvent` already answers the actor question for automated moves:
 * `actor_user_id` null, `SYSTEM_ACTOR` on the audit row, provenance carried by
 * the `trigger` column. This does the same, with `trigger: 'sequence'`.
 *
 * WHAT IT WILL NOT DO. A sequence may move a card. It may not CLOSE one — `won`
 * feeds revenue reporting, and a nurture email must not be able to book a sale
 * that never happened. It may not REOPEN one either: a closed card was settled
 * by a human or by a payment, and `decideMove` already encodes that a human's
 * ruling is not overruled by a form. Both refusals return `invalid` /
 * `skipped` rather than throwing, because they are deterministic — see below.
 *
 * THROW vs RETURN, which is load-bearing. A missing pipeline THROWS
 * (`PipelineNotConfiguredError`) because somebody can fill in the setting and
 * the next tick works: the runner treats it as a configuration fault and
 * DEFERS. Everything else — an unknown stage key, a closing stage — is a defect
 * in the sequence's own definition that will fail identically on every retry,
 * so it comes back as `{ kind: "invalid" }` and the runner fails the run at
 * once. Throwing those would send them through the transient-error backoff,
 * burning MAX_ATTEMPTS on a fault that was never transient and recording
 * `transient_error` against it.
 */
export async function moveOpportunityBySequence(input: {
  contactId: string
  stageKey: string
  pipelineKey: string | null
  businessId: string
  sequenceRunId: string
}): Promise<SequenceMoveResult> {
  const businessId = input.businessId
  const supabase = getClient()

  // Throws PipelineNotConfiguredError when the board does not exist — see the
  // throw-vs-return note above.
  const { pipelineId, stages } = await resolvePipeline(input.pipelineKey ?? DEFAULT_PIPELINE_KEY, businessId)

  const toStage = stages.find((s) => s.key === input.stageKey)
  if (!toStage) {
    return { kind: "invalid", error: `stage "${input.stageKey}" does not exist on this board` }
  }
  if (toStage.kind !== "open") {
    return {
      kind: "invalid",
      error: `stage "${input.stageKey}" closes a deal, and a sequence step may not close one`,
    }
  }

  const current = await readMostRecentOpportunity(input.contactId, pipelineId, stages, businessId)
  if (!current) return { kind: "skipped", reason: "no_opportunity" }
  if (current.outcome !== null) return { kind: "skipped", reason: "already_closed" }
  // Idempotent: a retried tick must not append a second identical history row,
  // and must not reset entered_stage_at, which would silently restart the
  // staleness colour the board computes from it.
  if (current.stage_id === toStage.id) return { kind: "skipped", reason: "already_on_stage" }

  const now = new Date()
  const { error: updateErr } = await supabase
    .from("opportunities")
    .update({
      stage_id: toStage.id,
      entered_stage_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", current.id)
  if (updateErr) throw updateErr

  await insertStageEvent(supabase, {
    businessId,
    opportunityId: current.id,
    fromStageId: current.stage_id,
    toStageId: toStage.id,
    trigger: "sequence",
    actorUserId: null,
    metadata: { sequence_run_id: input.sequenceRunId },
  })

  await recordAudit({
    action: "sequence.opportunity_moved",
    category: "automation",
    actor: SYSTEM_ACTOR,
    target: { type: "opportunity", id: current.id },
    metadata: { to_stage: toStage.key, sequence_run_id: input.sequenceRunId },
  })

  const fromStageKey = stages.find((s) => s.id === current.stage_id)?.key ?? null
  return { kind: "moved", opportunityId: current.id, fromStageKey, toStageKey: toStage.key }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run __tests__/db/pipeline.test.ts __tests__/lib/audit/
```

Expected: PASS. The audit suite must stay green — `lib/audit/actions.ts` is a closed set with its own tests.

- [ ] **Step 5: Mutate every test that passed first try**

1. Change `trigger: "sequence"` to `trigger: "manual"` → the trigger assertion must fail.
2. Change `category: "automation"` to `"admin_write"` → the audit assertion must fail.
3. Delete the `if (current.stage_id === toStage.id)` early return → "skips without writing when the card is already on the target stage" must fail.
4. Change `toStage.kind !== "open"` to `toStage.kind === "archived"` → both `won`/`lost` cases must fail.
5. Add `outcome: "won"` to the update patch → "writes no closure fields" must fail.

- [ ] **Step 6: Commit**

```bash
git add lib/db/pipeline.ts lib/audit/actions.ts __tests__/db/pipeline.test.ts
git commit -m "feat(lead-engine): move a pipeline card from a sequence step

A sibling of moveOpportunityManually for the automated path: no actor
user, trigger 'sequence', audited as automation with the system actor.
Reusing the manual function would have written closed_trigger='manual',
which decideMove reads to decide a close is final, and would have filed a
cron under the admin_write trail that answers 'did a coach do this?'.

A sequence may move a card but never close or reopen one. Deterministic
faults return 'invalid' instead of throwing, so the runner fails them at
once rather than sending them round the transient-error backoff."
```

---

### Task 5: The runner executes both actions

**Files:**
- Modify: `lib/automation/sequence-tick-runner.ts` — new `case "tag"` and `case "stage"` in `processRun`; delete the now-dead `unsupported_kind` branch in `case "advance"`; widen the config-fault classification in the batch catch (around line 711)
- Test: `__tests__/lib/automation/sequence-tick-side-effects.test.ts` (new)

**Interfaces:**
- Consumes: the `StepAction` members from Task 2; `moveOpportunityBySequence` and `SequenceMoveResult` from Task 4; `addTag` from `@/lib/db/contact-tags`; `PipelineNotConfiguredError` from `@/lib/db/pipeline`.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/automation/sequence-tick-side-effects.test.ts`. **Copy the mock harness from `__tests__/lib/automation/sequence-tick-send-faults.test.ts`** — it already mocks `@/lib/supabase` with a `timelineInsertSpy`, `@/lib/db/businesses`, `@/lib/lead-engine/sms`, `@/lib/lead-engine/unsubscribe-token` and `@/lib/db/sequences` (keeping the real constants via `importOriginal`). Add mocks for `@/lib/db/contact-tags` and `@/lib/db/pipeline`.

Cover, one test each:

```ts
// tag
"applies the tag and advances"                    // addTag called with {contactId, tag, businessId}; advanceRun called once
"writes a sequence_tag_applied timeline row"      // via timelineInsertSpy, carrying { tag, created }
"advances even when the tag was already there"    // addTag resolves { created: false }
"does not advance when addTag throws"             // advanceRun not called; the batch catch defers instead

// stage
"moves the card and advances"                     // moveOpportunityBySequence -> { kind: "moved" }
"writes a sequence_stage_moved timeline row"
"advances and records the reason on a skip"       // { kind: "skipped", reason } -> sequence_stage_skipped row carrying the reason
"fails the run on an invalid stage step"          // { kind: "invalid" } -> failRun called with the error, advanceRun NOT called
"defers and counts a config fault when the pipeline is not configured"
                                                  // throws PipelineNotConfiguredError -> deferRun called,
                                                  // summary.config_faults === 1, failRun NOT called

// the contract that must not break
"makes exactly one sequence_runs write-back per run, for every branch"
  // assert advanceRun.mock.calls.length + failRun.mock.calls.length
  //      + deferRun.mock.calls.length + exitRun.mock.calls.length
  //      + completeRun.mock.calls.length === 1
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run __tests__/lib/automation/sequence-tick-side-effects.test.ts
```

Expected: FAIL — `processRun`'s switch has no `tag`/`stage` case, so those actions fall through and nothing is called.

- [ ] **Step 3: Write minimal implementation**

**3a.** Imports at the top of `lib/automation/sequence-tick-runner.ts`:

```ts
import { addTag } from "@/lib/db/contact-tags"
import { moveOpportunityBySequence, PipelineNotConfiguredError } from "@/lib/db/pipeline"
```

**3b.** In `processRun`'s switch, after `case "alert"`:

```ts
    case "tag": {
      // Side effect, then timeline, then exactly one write-back — the same
      // order `alert` uses. `addTag` is idempotent (it treats a 23505 unique
      // violation as "already there"), which is what makes the batch-level
      // retry safe when the timeline write below throws.
      const { created } = await addTag({
        contactId: run.contact_id,
        tag: action.tag,
        businessId,
        createdBy: null,
      })

      await writeTimelineEvent({
        businessId,
        contactId: run.contact_id,
        kind: "sequence_tag_applied",
        metadata: { run_id: run.id, sequence_id: run.sequence_id, step_id: action.step.id, tag: action.tag, created },
      })

      await advanceRun(run.id, action.step.position + 1)
      return
    }

    case "stage": {
      // Throws PipelineNotConfiguredError when the board is missing; that is
      // deliberate and handled as a configuration fault by the batch catch.
      const result = await moveOpportunityBySequence({
        contactId: run.contact_id,
        stageKey: action.stageKey,
        pipelineKey: action.pipelineKey,
        businessId,
        sequenceRunId: run.id,
      })

      if (result.kind === "invalid") {
        // Deterministic: the sequence's own definition is wrong and every
        // retry fails the same way. Fail now rather than deferring. No timeline
        // row — the fault is the author's, and the sequences screen already
        // shows it against the run; a contact's history should not carry it.
        await failRun(run.id, result.error)
        summary.failed += 1
        return
      }

      await writeTimelineEvent({
        businessId,
        contactId: run.contact_id,
        kind: result.kind === "moved" ? "sequence_stage_moved" : "sequence_stage_skipped",
        metadata:
          result.kind === "moved"
            ? {
                run_id: run.id,
                sequence_id: run.sequence_id,
                step_id: action.step.id,
                from_stage: result.fromStageKey,
                to_stage: result.toStageKey,
              }
            : { run_id: run.id, sequence_id: run.sequence_id, step_id: action.step.id, reason: result.reason },
      })

      await advanceRun(run.id, action.step.position + 1)
      return
    }
```

**3c.** In `case "advance"`, **delete** the whole `if (action.note === "unsupported_kind") { ... }` block and its comment. `decideStep` no longer produces that note — `tag` and `stage` were its only source — so the branch is unreachable. Leave the `writeTimelineEvent({ kind: "sequence_step_unsupported" })` calls inside `case "send"` alone: those are the sms/email unconfigured paths and are still live. The `case` becomes:

```ts
    case "advance": {
      await advanceRun(run.id, action.toPosition, action.deferUntil)
      return
    }
```

**3d.** In the batch catch (around line 711), widen the classification:

```ts
          // A configuration fault waits out recordSend's reclaim window, so
          // the retry can actually re-claim its own queued row rather than
          // bouncing on `send_in_progress`. Everything else keeps the
          // existing backoff untouched.
          //
          // PipelineNotConfiguredError joins it because it is the same KIND of
          // fault: a setting nobody has filled in, fixable without touching the
          // sequence, and identical on every retry until somebody does. Treating
          // it as poison would burn MAX_ATTEMPTS and then destroy the run —
          // which is exactly how 73 runs were destroyed by an unverified sending
          // domain on 2026-08-31.
          const isConfigFault =
            (err instanceof SequenceSendError && classifySendFault(err) === "configuration") ||
            err instanceof PipelineNotConfiguredError
```

- [ ] **Step 4: Run test to verify it passes**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run __tests__/lib/automation/
```

Expected: PASS. Every sibling tick suite must stay green — `sequence-tick-send-faults`, `sequence-tick-sms`, `sequence-tick-email-env`, `sequence-tick-origin`.

- [ ] **Step 5: Mutate every test that passed first try**

1. In `case "stage"`, call `advanceRun` after `failRun` on the `invalid` branch → the one-write-back test must fail.
2. Remove `err instanceof PipelineNotConfiguredError` from `isConfigFault` → "defers and counts a config fault" must fail on the `config_faults` assertion.
3. In `case "tag"`, move `advanceRun` above `addTag` → "does not advance when addTag throws" must fail.
4. Change the skip timeline kind to `sequence_stage_moved` for both branches → "advances and records the reason on a skip" must fail.

- [ ] **Step 6: Commit**

```bash
git add lib/automation/sequence-tick-runner.ts __tests__/lib/automation/sequence-tick-side-effects.test.ts
git commit -m "feat(lead-engine): execute tag and stage steps in the tick runner

Side effect, then timeline row, then exactly one sequence_runs write-back
per run — the concurrency contract the runner's header states, and the
same order the alert case uses.

An unresolvable board now DEFERS as a configuration fault rather than
counting against MAX_ATTEMPTS, which is the treatment that stops a repeat
of the 73 runs destroyed on 2026-08-31. A malformed stage step fails at
once instead, because it will fail identically on every retry.

Drops the now-unreachable unsupported_kind branch: tag and stage were its
only source."
```

---

### Task 6: Plain-language timeline labels

**Files:**
- Modify: `lib/db/contact-detail.ts` — the label switch (the arm before `default`, around line 285)
- Test: `__tests__/lib/db/contact-detail.test.ts`

**Interfaces:**
- Consumes: the timeline `kind` values Task 5 writes.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `__tests__/lib/db/contact-detail.test.ts`, matching how that file already exercises the label switch:

```ts
describe("timeline labels for sequence side effects", () => {
  it("names the tag a sequence applied", () => {
    const row = <a timeline row with kind "sequence_tag_applied", metadata { tag: "warm lead" }>
    expect(label(row).title).toBe("Tagged “warm lead” automatically")
  })

  it("says where a sequence moved the card, in plain words", () => {
    const row = <kind "sequence_stage_moved", metadata { from_stage: "consult_booked", to_stage: "consulted" }>
    expect(label(row).title).toBe("Moved along the pipeline automatically")
    expect(label(row).detail).toContain("Consulted")
  })

  it("explains a skipped move without jargon", () => {
    const row = <kind "sequence_stage_skipped", metadata { reason: "no_opportunity" }>
    expect(label(row).detail).not.toContain("opportunity")
  })

  // The guard that matters: no hand-written label may render an empty title.
  it("never renders an empty title for any sequence kind", () => {
    for (const kind of ["sequence_tag_applied", "sequence_stage_moved", "sequence_stage_skipped"]) {
      expect(label(<row with that kind and empty metadata>).title.trim().length).toBeGreaterThan(0)
    }
  })
})
```

Replace `<...>` with the row shape this file already builds, and use whatever the label function is actually named there.

- [ ] **Step 2: Run test to verify it fails**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run __tests__/lib/db/contact-detail.test.ts
```

Expected: FAIL — the `default` arm humanises the kind, so the title reads `Sequence tag applied`.

- [ ] **Step 3: Write minimal implementation**

Add three arms before `default:` in `lib/db/contact-detail.ts`. Write them for a non-programmer: no "opportunity", no "pipeline stage", no "record". Name things as they appear on screen.

```ts
    case "sequence_tag_applied": {
      const tag = asString(meta.tag)
      return {
        title: tag ? `Tagged “${tag}” automatically` : "Tagged automatically",
        detail: "A follow-up sequence added this label. Nobody had to do it by hand.",
        tone: "neutral",
      }
    }

    case "sequence_stage_moved": {
      const to = asString(meta.to_stage)
      return {
        title: "Moved along the pipeline automatically",
        detail: to ? `A follow-up sequence moved their card to ${humanise(to)}.` : null,
        tone: "info",
      }
    }

    case "sequence_stage_skipped": {
      const reason = asString(meta.reason)
      const why =
        reason === "no_opportunity"
          ? "They are not on the board yet, so there was no card to move."
          : reason === "already_closed"
            ? "Their card is already finished, so it was left alone."
            : reason === "already_on_stage"
              ? "Their card was already in that column."
              : null
      return { title: "A sequence left their card where it was", detail: why, tone: "neutral" }
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run __tests__/lib/db/contact-detail.test.ts
```

Expected: PASS.

- [ ] **Step 5: Mutate every test that passed first try**

1. Delete the `sequence_tag_applied` arm → the tag test must fail (it falls through to `default`).
2. Return `detail: null` for every `sequence_stage_skipped` reason → "explains a skipped move" must fail.

- [ ] **Step 6: Commit**

```bash
git add lib/db/contact-detail.ts __tests__/lib/db/contact-detail.test.ts
git commit -m "feat(lead-engine): plain-language history lines for tag and stage steps

The default arm humanises an unknown kind, so these rendered as 'Sequence
tag applied'. Written now the way the rest of this screen is written: for
the person who does the job, not the person who built the app."
```

---

## Final verification (not a task — run after Task 6)

- [ ] **Targeted suites**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run \
  __tests__/lib/lead-engine/ __tests__/lib/automation/ \
  __tests__/db/pipeline.test.ts __tests__/lib/db/ \
  __tests__/lib/audit/ __tests__/migrations/
```

Do NOT run the full suite. It costs minutes and tells you nothing a targeted run did not.

- [ ] **tsc, compared as a SET**

```bash
source ~/.nvm/nvm.sh && nvm use && npx tsc --noEmit 2>&1 | grep "error TS" | sed 's/(.*//' | sort -u > /tmp/tsc-after.txt
diff /tmp/tsc-baseline-files.txt /tmp/tsc-after.txt && echo "IDENTICAL SET"
```

Baseline is 238 errors across 54 files. A falling count still hides new errors — the diff is the check, not the number.

- [ ] **Brand sweep**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run __tests__/lib/lead-engine/no-brand-literals.test.ts
```

- [ ] **Tenancy inventory**

```bash
source ~/.nvm/nvm.sh && nvm use && npx vitest run __tests__/lib/tenancy/platform-inventory.test.ts
```

- [ ] **No attribution trailers**

```bash
git log main..HEAD --format="%s%n%b" | grep -i "co-authored-by: claude\|generated with" && echo "FOUND — STRIP THEM" || echo "clean"
```

If found: `git branch backup/pre-strip HEAD`, then
`FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --msg-filter 'sed -e "/^Co-Authored-By: Claude/d"' main..HEAD`.
Do **not** pipe through `awk 'BEGIN{RS=""}'` — it fuses subject and body across every commit. Verify with `git log --format="%s"` showing one line each.

- [ ] **Update the scope ledger.** Mark gap #12 closed in `docs/full-engine-scope-vs-built.md` §4, in the same style item #1 used for gap #4 (strikethrough, **BUILT**, branch name, **not merged**). Note that the `quiz` trigger fix rode along.

---

## Self-Review

**Spec coverage.** §2 → Task 2 + 5. §3 → Task 1. §4 → Tasks 2 and 3. §5 → Task 4. §6 → Task 4. §7 → Task 5. §8 → Task 3. §9 → Task 6. §10 is a list of exclusions and needs no task. §11 → the mutation step in every task plus the final verification. §12 matches the File Structure table.

**Type consistency.** `ParseResult<T>` returns `{ ok, value }`, and Task 2 reads `parsed.value.tag` / `parsed.value.stageKey` — consistent. `SequenceMoveResult.kind` is `moved | skipped | invalid` in Task 4 and Task 5 dispatches on exactly those three. `fromStageKey` is `string | null` in both the type and the runner's metadata.

**Known gap, deliberate.** Tasks 4 and 6 contain `<...>` fixture placeholders rather than invented fixture code. That is not laziness: every DAL test in this repo mocks `@/lib/supabase`, so a fixture written from imagination can be wrong in the same direction as the code and still pass — which is exactly how the previous item shipped `contacts(full_name, email)` against a table whose column is `name`. The implementer must read the existing harness in each file and copy its real shape. The assertions themselves are fully specified; only the fixture plumbing is delegated.
