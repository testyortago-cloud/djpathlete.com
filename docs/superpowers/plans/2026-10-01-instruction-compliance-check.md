# Instruction Compliance Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After Generate Day / Generate Week builds a day, check it against the coach's own instructions (code for exact facts, Opus 5.5 for the rest), rebuild once if anything is unmet and time allows, save, and show the coach a ✓/✗ checklist.

**Architecture:** `generateWeekSync` is split into `buildWeekAttempt` (today's code up to the save, unchanged, returning a `save()` closure and the facts the checker needs) and a wrapper that runs attempt → `checkInstructions` → maybe one rebuild with feedback → `save()` of the better attempt. The checker lives in its own module; the attempt/check/rebuild loop lives in a small pure module with injected functions so it is unit-testable without the 1,700-line orchestrator.

**Tech Stack:** TypeScript (Firebase Functions, `functions/` — cannot import `lib/`), Vitest, Zod, `callAgent` (functions/src/ai/anthropic.ts, routes to OpenRouter), React + Testing Library for the admin panel.

**Spec:** `docs/superpowers/specs/2026-10-01-instruction-compliance-check-design.md`

## Global Constraints

- Scope: Generate Day / Generate Week only (`functions/src/ai/week-orchestrator.ts`). Do NOT touch `functions/src/ai/orchestrator.ts` (full programs) or program chat.
- AI judge model: `MODEL_OPUS_5_5` from `./anthropic.js`, `allowHaikuFallback: false`, `effort: "low"`, own timeout 30 000 ms, inside the generation deadline. The generation's own deadline aborting is RETHROWN (same rule as `instruction-enrich.ts`).
- At most ONE rebuild. Only when the check has an unmet item AND `deadline.remainingMs() >= 1.3 × attempt-1 duration` (no deadline passed → allowed). Cancellation (`checkCancelled`) is respected before the rebuild.
- Compliance feedback reaches only the ARCHITECT and the SELECTOR (and the analyzer, which reads `agentInstructions`). It must NEVER reach `extractInstructionIntent` (unlock/ban) or `enrichCoachInstructions`.
- A failed check never blocks the save. A failing AI judge keeps the code items and sets `note`.
- Result field name on the job doc: `instruction_check`. Type `InstructionCheck` (below). Checklist heading copy: `Your instructions, checked`. Warning copy: `${n} of your instructions weren't fully met — see “Your instructions, checked”.` (n = unmet count; "1 of your instructions wasn't fully met" when n === 1).
- Admin UI is light-only; use semantic tokens (`text-success`, `text-error`, `text-muted-foreground`), never hex.
- Tests: run ONLY the files named in each task (targeted). Functions: `cd functions && ~/.nvm/versions/node/v24.20.0/bin/node node_modules/vitest/vitest.mjs run <files>`. Root: `~/.nvm/versions/node/v24.20.0/bin/node node_modules/vitest/vitest.mjs run <files>`. Functions typecheck: `cd functions && ~/.nvm/versions/node/v24.20.0/bin/node node_modules/typescript/bin/tsc --noEmit -p .`
- RED before GREEN: run each new test and paste the failing output before implementing. Never use `git stash`.
- Commits: no `Co-Authored-By`, no "Generated with Claude" lines. Format only files you created or that were Prettier-clean before you touched them (`node_modules/prettier/bin/prettier.cjs --check <file>` on main's copy first).

## Shared types (defined in Task 2, used everywhere)

```ts
// functions/src/ai/instruction-check.ts
export interface InstructionCheckItem {
  instruction: string // the coach's words this line is about, short
  met: boolean
  detail: string // plain-language evidence
  source: "code" | "ai"
}
export interface InstructionCheck {
  status: "passed" | "failed" | "unchecked"
  items: InstructionCheckItem[]
  rebuilt: boolean
  rebuild_reason: string | null
  note: string | null
}
export interface CheckDayRow {
  day_of_week: number
  order: number
  exercise_id: string
  name: string
  movement_pattern: string | null
  primary_muscles: string[]
  role: string
  sets: number | null
  reps: string | null
  rest_seconds: number | null
  tempo: string | null
}
export interface CheckInput {
  scope: "day" | "week"
  instructions: string | null // the coach's ORIGINAL words
  rows: CheckDayRow[] // the finished day/week, in order
  pool: { ids: string[]; mode: "preferred" | "strict"; offeredIds: string[] } | null
  namedMatches: Array<{ phrase: string; exercise_ids: string[] }> // IntentResolution.matched
  bannedIds: string[]
  nameById: Record<string, string>
}
```

## Review Focus

1. Instructions with a SECOND, conflicting prescription for one field (Darren 2026-09-30: "4-8 reps … Power: Low reps (3-5)") — the code reps line must NOT be produced (else power work is "failed" and the rebuild pushes it to 4-8). Pinned in Task 1 (`parsePrescription` returns no reps) and Task 2.
2. Holds and warm-up/cool-down rows ("30s hold", role `cool_down`) — never fail a sets/reps/rest/tempo line. Pinned in Task 2.
3. Tempo written differently ("4-2-4" vs stored "4.2.4") — same tempo, met. Pinned in Task 2.
4. A Preferred pool larger than the day ("6 pool, 4-slot day, all 4 are pool") — met, not a miss. Pinned in Task 2.
5. The AI judge returning an item already decided by code, or nothing at all — no duplicate line, no crash; empty instructions with no pool → `unchecked`, no AI call. Pinned in Task 3.

---

### Task 1: Count and prescription parsing

**Files:**
- Modify: `functions/src/ai/instruction-count.ts`
- Test: `functions/src/ai/__tests__/instruction-count.test.ts`

**Interfaces:**
- Produces: `statedExerciseTotal(text: string | null | undefined): number | null`; `parsePrescription(text: string | null | undefined): CoachPrescription` with `export interface CoachPrescription { sets?: [number, number]; reps?: [number, number]; restSeconds?: [number, number]; tempo?: string }`.

- [ ] **Step 1: Write the failing tests** (append to the existing file; keep the existing `statesExerciseCount` tests)

```ts
import { statedExerciseTotal, parsePrescription } from "../instruction-count.js"

describe("statedExerciseTotal", () => {
  it.each([
    ["12 exercises\n2-4 sets", 12],
    ["12 exercises that are shoulder focused", 12],
    ["• 12 exercises total\nHINGE BLOCK (3 exercises):\nUPPER (3 exercises):", 12],
    ["8 movements, mostly lower body", 8],
  ])("reads the total in %j", (text, n) => {
    expect(statedExerciseTotal(text)).toBe(n)
  })

  it.each([
    "using the exercise pool\n2-4 sets\n4-8 reps",
    "HINGE BLOCK (3 exercises):\nPOWER BLOCK (2 exercises):", // per-area only, no total line
    "10-12 exercises", // a range is not one total
    "",
  ])("returns null for %j", (text) => {
    expect(statedExerciseTotal(text)).toBeNull()
  })
})

describe("parsePrescription", () => {
  it("reads Darren's usual block", () => {
    expect(parsePrescription("12 exercises\n2-4 sets\n4-8 reps\n30-90sec rest\n4-2-4 tempo")).toEqual({
      sets: [2, 4],
      reps: [4, 8],
      restSeconds: [30, 90],
      tempo: "4-2-4",
    })
  })

  it("reads single values, minutes and the 'rest 60 seconds' order", () => {
    expect(parsePrescription("3 sets\n10 reps\nrest 2 min")).toEqual({
      sets: [3, 3],
      reps: [10, 10],
      restSeconds: [120, 120],
    })
    expect(parsePrescription("Tempo: 3.1.1")).toEqual({ tempo: "3-1-1" })
  })

  it("leaves a field out when the coach mentions it more than once (a second prescription)", () => {
    const p = parsePrescription(
      "12 exercises\n2-4 sets\n4-8 reps\n30-90sec rest\nPOWER: Low reps (3-5), full recovery (120-180s rest)",
    )
    expect(p.sets).toEqual([2, 4])
    expect(p.reps).toBeUndefined()
    expect(p.restSeconds).toBeUndefined()
  })

  it("returns nothing for prose with no prescription", () => {
    expect(parsePrescription("Focus on shoulders")).toEqual({})
    expect(parsePrescription(undefined)).toEqual({})
  })
})
```

- [ ] **Step 2: Run to verify RED** — `cd functions && ~/.nvm/versions/node/v24.20.0/bin/node node_modules/vitest/vitest.mjs run src/ai/__tests__/instruction-count.test.ts` → FAIL (`statedExerciseTotal is not a function`). Paste the output.

- [ ] **Step 3: Implement** (append to `instruction-count.ts`)

```ts
const COUNT_LINE = /(\d+)(?!\s*[-–—]\s*\d)\s+(?:[a-z_-]+\s+){0,3}?(?:exercises?|movements?|drills?)\b/i

/**
 * The ONE total exercise count the coach stated, or null. A line that says
 * "total" wins; otherwise exactly one count line in the text is the total;
 * several per-area counts with no total line, or a range ("10-12"), are not a
 * single number and are left to the AI judge.
 */
export function statedExerciseTotal(text: string | null | undefined): number | null {
  if (!text) return null
  const counts: Array<{ n: number; total: boolean }> = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(COUNT_LINE)
    if (m && !/\d\s*[-–—]\s*\d+\s+(?:[a-z_-]+\s+){0,3}?(?:exercises?|movements?|drills?)/i.test(line)) {
      counts.push({ n: Number(m[1]), total: /\btotal\b/i.test(line) })
    }
  }
  const totals = counts.filter((c) => c.total)
  if (totals.length === 1) return totals[0].n
  if (counts.length === 1 && statesExerciseCount(text)) return counts[0].n
  return null
}

export interface CoachPrescription {
  sets?: [number, number]
  reps?: [number, number]
  restSeconds?: [number, number]
  tempo?: string
}

const RANGE = String.raw`(\d+)(?:\s*(?:-|–|—|to)\s*(\d+))?`

function oneRange(text: string, word: RegExp, patterns: RegExp[], scale = (n: number) => n): [number, number] | undefined {
  // Mentioned more than once → a second prescription exists; leave it to the AI.
  if ((text.match(word) ?? []).length !== 1) return undefined
  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      const unit = (m[3] ?? "").toLowerCase()
      const k = unit.startsWith("m") ? 60 : 1
      const lo = scale(Number(m[1])) * k
      const hi = scale(Number(m[2] ?? m[1])) * k
      return [lo, hi]
    }
  }
  return undefined
}

/**
 * The single sets / reps / rest / tempo prescription the coach wrote, per field.
 * A field the coach mentions more than once ("4-8 reps … Low reps (3-5)") is
 * omitted: that is two prescriptions for different work, and only the AI judge
 * can tell which exercise each applies to.
 */
export function parsePrescription(text: string | null | undefined): CoachPrescription {
  if (!text) return {}
  const out: CoachPrescription = {}
  const sets = oneRange(text, /\bsets?\b/gi, [new RegExp(String.raw`${RANGE}\s*sets?\b`, "i")])
  if (sets) out.sets = sets
  const reps = oneRange(text, /\breps?\b/gi, [new RegExp(String.raw`${RANGE}\s*reps?\b`, "i")])
  if (reps) out.reps = reps
  const rest = oneRange(text, /\brest\b/gi, [
    new RegExp(String.raw`${RANGE}\s*(sec|secs|seconds|s|min|mins|minutes)\b\s*(?:of\s+)?rest`, "i"),
    new RegExp(String.raw`rest\s*(?:of\s+|:\s*)?${RANGE}\s*(sec|secs|seconds|s|min|mins|minutes)\b`, "i"),
  ])
  if (rest) out.restSeconds = rest
  if ((text.match(/\btempo\b/gi) ?? []).length === 1) {
    const t = text.match(/(\d+(?:[-.]\d+){2,3})\s*tempo/i) ?? text.match(/tempo\s*[:\s]\s*(\d+(?:[-.]\d+){2,3})/i)
    if (t) out.tempo = t[1].replace(/\./g, "-")
  }
  return out
}
```

Note for the implementer: in `oneRange` the capture groups are `m[1]` (low), `m[2]` (high), `m[3]` (unit, rest only). Rest patterns put the unit in group 3; sets/reps patterns have no group 3, so `k` is 1. Adjust the regexes if a test shows otherwise — the tests are the contract.

- [ ] **Step 4: Run to verify GREEN** — same command → all pass (existing `statesExerciseCount` tests included).
- [ ] **Step 5: Commit** — `git add functions/src/ai/instruction-count.ts functions/src/ai/__tests__/instruction-count.test.ts && git commit -m "feat(ai): read the coach's stated exercise total and prescription ranges"`

---

### Task 2: Code checks, status and rebuild feedback

**Files:**
- Create: `functions/src/ai/instruction-check.ts`
- Test: `functions/src/ai/__tests__/instruction-check.test.ts`

**Interfaces:**
- Consumes: `statedExerciseTotal`, `parsePrescription` (Task 1).
- Produces: the shared types above; `runCodeChecks(input: CheckInput): InstructionCheckItem[]`; `checkStatus(items: InstructionCheckItem[]): InstructionCheck["status"]`; `buildComplianceFeedback(items: InstructionCheckItem[]): string`; `unmetCount(check: InstructionCheck): number`; `buildInstructionCheckWarning(check: InstructionCheck): string[]`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest"
import {
  runCodeChecks,
  checkStatus,
  buildComplianceFeedback,
  buildInstructionCheckWarning,
  type CheckDayRow,
  type CheckInput,
} from "../instruction-check.js"

const row = (i: number, o: Partial<CheckDayRow> = {}): CheckDayRow => ({
  day_of_week: 1,
  order: i,
  exercise_id: `ex${i}`,
  name: `Exercise ${i}`,
  movement_pattern: "push",
  primary_muscles: ["shoulders"],
  role: "accessory",
  sets: 3,
  reps: "6",
  rest_seconds: 60,
  tempo: "4-2-4",
  ...o,
})
const base = (o: Partial<CheckInput> = {}): CheckInput => ({
  scope: "day",
  instructions: "12 exercises\n2-4 sets\n4-8 reps\n30-90sec rest\n4-2-4 tempo",
  rows: Array.from({ length: 12 }, (_, i) => row(i)),
  pool: null,
  namedMatches: [],
  bannedIds: [],
  nameById: {},
  ...o,
})
const find = (items: ReturnType<typeof runCodeChecks>, s: string) => items.find((i) => i.instruction.includes(s))

describe("runCodeChecks", () => {
  it("passes Darren's usual block on a matching day", () => {
    const items = runCodeChecks(base())
    expect(items.map((i) => i.instruction)).toEqual(["12 exercises", "2-4 sets", "4-8 reps", "30-90 sec rest", "4-2-4 tempo"])
    expect(items.every((i) => i.met && i.source === "code")).toBe(true)
    expect(find(items, "12 exercises")!.detail).toBe("12 in the day")
  })

  it("fails the count and names the actual number", () => {
    const it2 = find(runCodeChecks(base({ rows: [row(0), row(1)] })), "12 exercises")!
    expect(it2.met).toBe(false)
    expect(it2.detail).toBe("the day has 2")
  })

  it("does not check a count in week scope", () => {
    expect(find(runCodeChecks(base({ scope: "week" })), "exercises")).toBeUndefined()
  })

  it("names the first exercise outside a range", () => {
    const items = runCodeChecks(base({ rows: [...Array.from({ length: 11 }, (_, i) => row(i)), row(11, { name: "Banded press", rest_seconds: 120 })] }))
    const rest = find(items, "rest")!
    expect(rest.met).toBe(false)
    expect(rest.detail).toBe("“Banded press” rests 120 s")
  })

  it("treats 4.2.4 as the same tempo as 4-2-4", () => {
    const items = runCodeChecks(base({ rows: Array.from({ length: 12 }, (_, i) => row(i, { tempo: "4.2.4" })) }))
    expect(find(items, "tempo")!.met).toBe(true)
  })

  it("never fails holds or warm-up / cool-down rows on a prescription", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => row(i)),
      row(10, { reps: "30s hold", sets: 1, rest_seconds: 10, tempo: null }),
      row(11, { role: "cool_down", reps: "12", sets: 1, rest_seconds: 0, tempo: "slow" }),
    ]
    const items = runCodeChecks(base({ rows }))
    expect(items.filter((i) => !i.met)).toEqual([])
  })

  it("produces no reps line when the coach wrote a second reps prescription", () => {
    const items = runCodeChecks(base({ instructions: "12 exercises\n2-4 sets\n4-8 reps\nPOWER: Low reps (3-5)" }))
    expect(find(items, "reps")).toBeUndefined()
  })

  describe("Exercise Pool", () => {
    const pool = (o: Partial<NonNullable<CheckInput["pool"]>> = {}) => ({
      ids: ["p1", "p2", "p3"],
      mode: "preferred" as const,
      offeredIds: ["p1", "p2", "p3"],
      ...o,
    })
    const nameById = { p1: "Ab squats", p2: "Bench hip abductions", p3: "Ballerina bulgarians" }

    it("passes when every offered pool exercise is used", () => {
      const rows = [row(0, { exercise_id: "p1" }), row(1, { exercise_id: "p2" }), row(2, { exercise_id: "p3" })]
      const item = find(runCodeChecks(base({ instructions: null, rows, pool: pool(), nameById })), "Exercise Pool")!
      expect(item).toMatchObject({ met: true, detail: "all 3 used" })
    })

    it("fails and names the unused ones", () => {
      const rows = [row(0, { exercise_id: "p1" }), row(1)]
      const item = find(runCodeChecks(base({ instructions: null, rows, pool: pool(), nameById })), "Exercise Pool")!
      expect(item.met).toBe(false)
      expect(item.detail).toBe("not used: Bench hip abductions, Ballerina bulgarians")
    })

    it("passes when the day is smaller than the pool and every slot is a pool exercise", () => {
      const rows = [row(0, { exercise_id: "p1" }), row(1, { exercise_id: "p3" })]
      const item = find(runCodeChecks(base({ instructions: null, rows, pool: pool(), nameById })), "Exercise Pool")!
      expect(item.met).toBe(true)
    })

    it("does not count pool exercises that were never offered (blocked, injury)", () => {
      const rows = [row(0, { exercise_id: "p1" }), row(1, { exercise_id: "p2" })]
      const item = find(
        runCodeChecks(base({ instructions: null, rows, pool: pool({ offeredIds: ["p1", "p2"] }), nameById })),
        "Exercise Pool",
      )!
      expect(item.met).toBe(true)
    })

    it("strict: fails on any exercise outside the pool", () => {
      const rows = [row(0, { exercise_id: "p1" }), row(1, { name: "Other" })]
      const item = find(runCodeChecks(base({ instructions: null, rows, pool: pool({ mode: "strict" }), nameById })), "Exercise Pool")!
      expect(item).toMatchObject({ met: false, detail: "not from your pool: Other" })
    })
  })

  it("checks named and ruled-out exercises", () => {
    const rows = [row(0, { exercise_id: "lm1", name: "Landmine press" }), row(1, { exercise_id: "bad", name: "Burpee" })]
    const items = runCodeChecks(
      base({
        instructions: "include landmine press, no burpees",
        rows,
        namedMatches: [{ phrase: "landmine press", exercise_ids: ["lm1", "lm2"] }],
        bannedIds: ["bad"],
      }),
    )
    expect(find(items, "landmine press")).toMatchObject({ met: true, detail: "Landmine press is in" })
    expect(find(items, "ruled out")).toMatchObject({ met: false, detail: "Burpee is in" })
  })
})

describe("status, feedback and warning", () => {
  const met = { instruction: "a", met: true, detail: "ok", source: "code" as const }
  const miss = { instruction: "Exercise Pool", met: false, detail: "not used: X", source: "code" as const }

  it("status", () => {
    expect(checkStatus([])).toBe("unchecked")
    expect(checkStatus([met])).toBe("passed")
    expect(checkStatus([met, miss])).toBe("failed")
  })

  it("feedback lists unmet items only", () => {
    expect(buildComplianceFeedback([met, miss])).toBe(
      "PREVIOUS ATTEMPT MISSED THESE COACH INSTRUCTIONS — fix every one:\n- Exercise Pool: not used: X",
    )
    expect(buildComplianceFeedback([met])).toBe("")
  })

  it("warning line counts unmet items", () => {
    const check = { status: "failed" as const, items: [met, miss], rebuilt: true, rebuild_reason: null, note: null }
    expect(buildInstructionCheckWarning(check)).toEqual([
      "1 of your instructions wasn't fully met — see “Your instructions, checked”.",
    ])
    expect(buildInstructionCheckWarning({ ...check, items: [met] })).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify RED** — `... vitest.mjs run src/ai/__tests__/instruction-check.test.ts` → FAIL (module not found). Paste output.

- [ ] **Step 3: Implement `functions/src/ai/instruction-check.ts`** — the shared types above, plus:

```ts
import { statedExerciseTotal, parsePrescription } from "./instruction-count.js"

const EXEMPT_ROLES = new Set(["warm_up", "cool_down"])
const fmt = (r: [number, number], unit = "") => (r[0] === r[1] ? `${r[0]}${unit}` : `${r[0]}-${r[1]}${unit}`)
const normTempo = (t: string | null) => (t ?? "").trim().replace(/\./g, "-").toLowerCase()

/** "8", "8-10", "8 each side" → [8,8] / [8,10]; a hold ("30s hold", "20 sec") → null (exempt). */
function repsRange(reps: string | null): [number, number] | null {
  if (!reps) return null
  if (/\d\s*(s|sec|secs|seconds)\b|hold/i.test(reps)) return null
  const m = reps.match(/^\s*(\d+)(?:\s*[-–]\s*(\d+))?/)
  return m ? [Number(m[1]), Number(m[2] ?? m[1])] : null
}

export function runCodeChecks(input: CheckInput): InstructionCheckItem[] {
  const items: InstructionCheckItem[] = []
  const add = (instruction: string, met: boolean, detail: string) =>
    items.push({ instruction, met, detail, source: "code" })
  // Prescriptions are for working sets: warm-up / cool-down rows and holds
  // ("30s hold" — reps written as a time) are exempt from EVERY prescription line.
  const isHold = (r: CheckDayRow) => !!r.reps && repsRange(r.reps) === null
  const working = input.rows.filter((r) => !EXEMPT_ROLES.has(r.role) && !isHold(r))

  if (input.scope === "day") {
    const total = statedExerciseTotal(input.instructions)
    if (total !== null) {
      const n = input.rows.length
      add(`${total} exercises`, n === total, n === total ? `${n} in the day` : `the day has ${n}`)
    }
  }

  const p = parsePrescription(input.instructions)
  const firstOutside = (test: (r: CheckDayRow) => boolean | null) => working.find((r) => test(r) === false)
  if (p.sets) {
    const [lo, hi] = p.sets
    const bad = firstOutside((r) => (r.sets === null ? null : r.sets >= lo && r.sets <= hi))
    add(`${fmt(p.sets)} sets`, !bad, bad ? `“${bad.name}” has ${bad.sets}` : `every exercise has ${fmt(p.sets)}`)
  }
  if (p.reps) {
    const [lo, hi] = p.reps
    const bad = firstOutside((r) => {
      const rr = repsRange(r.reps)
      return rr === null ? null : rr[0] >= lo && rr[1] <= hi
    })
    add(`${fmt(p.reps)} reps`, !bad, bad ? `“${bad.name}” is ${bad.reps}` : `every exercise is within ${fmt(p.reps)}`)
  }
  if (p.restSeconds) {
    const [lo, hi] = p.restSeconds
    const bad = firstOutside((r) => (r.rest_seconds === null ? null : r.rest_seconds >= lo && r.rest_seconds <= hi))
    add(
      `${fmt(p.restSeconds)} sec rest`,
      !bad,
      bad ? `“${bad.name}” rests ${bad.rest_seconds} s` : `every exercise rests ${fmt(p.restSeconds, " s")}`,
    )
  }
  if (p.tempo) {
    const want = normTempo(p.tempo)
    const bad = firstOutside((r) => (repsRange(r.reps) === null ? null : normTempo(r.tempo) === want))
    add(`${p.tempo} tempo`, !bad, bad ? `“${bad.name}” has ${bad.tempo ?? "no tempo"}` : `every exercise is ${p.tempo}`)
  }

  if (input.pool) {
    const used = new Set(input.rows.map((r) => r.exercise_id))
    const name = (id: string) => input.nameById[id] ?? id
    if (input.pool.mode === "strict") {
      const pool = new Set(input.pool.ids)
      const outside = input.rows.filter((r) => !pool.has(r.exercise_id))
      add(
        "Exercise Pool",
        outside.length === 0,
        outside.length === 0 ? "every exercise is from your pool" : `not from your pool: ${outside.map((r) => r.name).join(", ")}`,
      )
    } else {
      const offered = input.pool.ids.filter((id) => input.pool!.offeredIds.includes(id))
      const unused = offered.filter((id) => !used.has(id))
      const allPool = input.rows.length > 0 && input.rows.every((r) => offered.includes(r.exercise_id))
      const met = unused.length === 0 || (input.rows.length < offered.length && allPool)
      add(
        "Exercise Pool",
        met,
        unused.length === 0
          ? `all ${offered.length} used`
          : met
            ? `every exercise is from your pool (${input.rows.length} of ${offered.length} fit)`
            : `not used: ${unused.map(name).join(", ")}`,
      )
    }
  }

  const usedIds = new Set(input.rows.map((r) => r.exercise_id))
  for (const m of input.namedMatches) {
    const hit = input.rows.find((r) => m.exercise_ids.includes(r.exercise_id))
    add(m.phrase, !!hit, hit ? `${hit.name} is in` : "not in the day")
  }
  if (input.bannedIds.length > 0) {
    const banned = new Set(input.bannedIds)
    const hit = input.rows.find((r) => banned.has(r.exercise_id))
    add("Exercises you ruled out", !hit, hit ? `${hit.name} is in` : "none used")
  }
  void usedIds
  return items
}

export function checkStatus(items: InstructionCheckItem[]): InstructionCheck["status"] {
  if (items.length === 0) return "unchecked"
  return items.some((i) => !i.met) ? "failed" : "passed"
}

export function unmetCount(check: InstructionCheck): number {
  return check.items.filter((i) => !i.met).length
}

export function buildComplianceFeedback(items: InstructionCheckItem[]): string {
  const unmet = items.filter((i) => !i.met)
  if (unmet.length === 0) return ""
  return `PREVIOUS ATTEMPT MISSED THESE COACH INSTRUCTIONS — fix every one:\n${unmet
    .map((i) => `- ${i.instruction}: ${i.detail}`)
    .join("\n")}`
}

export function buildInstructionCheckWarning(check: InstructionCheck): string[] {
  const n = unmetCount(check)
  if (n === 0) return []
  return [
    n === 1
      ? "1 of your instructions wasn't fully met — see “Your instructions, checked”."
      : `${n} of your instructions weren't fully met — see “Your instructions, checked”.`,
  ]
}
```

(Remove the unused `usedIds`/`void` lines if lint complains — they are not needed.)

- [ ] **Step 4: GREEN** — same command, all pass.
- [ ] **Step 5: Commit** — `git add functions/src/ai/instruction-check.ts functions/src/ai/__tests__/instruction-check.test.ts && git commit -m "feat(ai): exact checks of a generated day against the coach's instructions"`

---

### Task 3: The AI judge and `checkInstructions`

**Files:**
- Modify: `functions/src/ai/instruction-check.ts`
- Test: `functions/src/ai/__tests__/instruction-check-ai.test.ts`

**Interfaces:**
- Consumes: Task 2; `callAgent`, `MODEL_OPUS_5_5` from `./anthropic.js`; `isAbortError` from `../lib/deadline.js`.
- Produces: `checkInstructions(input: CheckInput, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<InstructionCheck>` (always `rebuilt: false, rebuild_reason: null`; the loop sets those).

Behaviour:
- No instructions (null/blank) → code items only, NO model call.
- Otherwise one `callAgent(JUDGE_PROMPT, message, judgeSchema, { model: MODEL_OPUS_5_5, maxTokens: 2000, effort: "low", signal: own.signal, allowHaikuFallback: false })` where `judgeSchema = z.object({ items: z.array(z.object({ instruction: z.string(), met: z.boolean(), detail: z.string() })) })`.
- Message contains: `Coach's instructions:\n<original>`; `Already checked by code — do not judge these again:\n- <instruction>: <met ? "met" : "NOT met"> (<detail>)` per code item (or `(none)`); `The finished ${scope}:` then one line per row `Day ${day} #${order+1} ${name} | ${pattern} | ${muscles} | ${role} | ${sets}x${reps} | rest ${rest}s | tempo ${tempo}`.
- AI items whose `instruction` (lowercased, trimmed) equals a code item's instruction are dropped. Each kept item gets `source: "ai"`. Empty/blank instructions or details are dropped.
- Own timeout via `AbortController` + `setTimeout` (30 000 default), linked to `opts.signal` exactly like `enrichCoachInstructions`. If `opts.signal?.aborted` after an error → rethrow. Otherwise keep code items and `note = "The AI check didn't run this time, so only the exact checks are shown."` (timeout: `"The AI check took too long, so only the exact checks are shown."`).
- `status = checkStatus(items)`.

JUDGE_PROMPT (verbatim):

```
You check whether a finished training day (or week) follows a strength coach's instructions. You do not redesign anything.

1. Split the coach's instructions into separate instructions: counts, focus areas ("mainly shoulders"), order ("power first"), named exercises, restrictions, techniques, prescriptions.
2. Skip any instruction listed under "Already checked by code".
3. Judge every remaining instruction ONLY from the table of the finished day. Be literal: "mainly X" means at least half of the working exercises train X; "some Y" means at least one does; "X first" means X-role or X-pattern exercises come before the others.
4. For each, give: instruction — the coach's own words, short; met — true or false; detail — one short plain sentence with the evidence from the table (counts, names).
5. Never invent an instruction the coach did not write. If nothing is left to judge, return an empty list.
```

- [ ] **Step 1: Failing tests** (`vi.mock("../anthropic.js", ...)` with a hoisted `callAgentMock`, as in `week-orchestrator.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
const callAgentMock = vi.hoisted(() => vi.fn())
vi.mock("../anthropic.js", async () => {
  const actual = await vi.importActual<typeof import("../anthropic.js")>("../anthropic.js")
  return { ...actual, callAgent: callAgentMock }
})
import { checkInstructions, type CheckInput } from "../instruction-check.js"

const input = (o: Partial<CheckInput> = {}): CheckInput => ({
  scope: "day",
  instructions: "12 exercises, mainly shoulder",
  rows: Array.from({ length: 12 }, (_, i) => ({
    day_of_week: 1, order: i, exercise_id: `e${i}`, name: `Ex ${i}`, movement_pattern: "push",
    primary_muscles: ["shoulders"], role: "accessory", sets: 3, reps: "8", rest_seconds: 60, tempo: null,
  })),
  pool: null, namedMatches: [], bannedIds: [], nameById: {},
  ...o,
})

beforeEach(() => callAgentMock.mockReset())

describe("checkInstructions", () => {
  it("adds the AI's lines after the code lines and drops ones code already decided", async () => {
    callAgentMock.mockResolvedValue({
      content: { items: [
        { instruction: "12 exercises", met: false, detail: "dup" },
        { instruction: "mainly shoulder", met: true, detail: "12 of 12 train the shoulders" },
      ] },
      tokens_used: 10,
    })
    const check = await checkInstructions(input())
    expect(check.items.map((i) => [i.instruction, i.source])).toEqual([
      ["12 exercises", "code"],
      ["mainly shoulder", "ai"],
    ])
    expect(check.status).toBe("passed")
    const [system, message, , opts] = callAgentMock.mock.calls[0]
    expect(system).toMatch(/Skip any instruction listed under "Already checked by code"/)
    expect(message).toContain("12 exercises, mainly shoulder")
    expect(message).toContain("- 12 exercises: met (12 in the day)")
    expect(message).toContain("Day 1 #1 Ex 0 | push | shoulders | accessory | 3x8 | rest 60s")
    expect(opts).toMatchObject({ model: "claude-opus-5-5", allowHaikuFallback: false })
  })

  it("makes no model call without instructions", async () => {
    const check = await checkInstructions(input({ instructions: null }))
    expect(callAgentMock).not.toHaveBeenCalled()
    expect(check.status).toBe("unchecked")
  })

  it("keeps the code lines and says so when the AI fails", async () => {
    callAgentMock.mockRejectedValue(new Error("boom"))
    const check = await checkInstructions(input())
    expect(check.items.map((i) => i.source)).toEqual(["code"])
    expect(check.note).toBe("The AI check didn't run this time, so only the exact checks are shown.")
  })

  it("rethrows when the generation's own deadline aborts", async () => {
    const outer = new AbortController()
    callAgentMock.mockImplementation(async () => { outer.abort(); throw Object.assign(new Error("aborted"), { name: "AbortError" }) })
    await expect(checkInstructions(input(), { signal: outer.signal })).rejects.toThrow()
  })

  it("survives an AI reply with no usable items", async () => {
    callAgentMock.mockResolvedValue({ content: { items: [{ instruction: " ", met: true, detail: "" }] }, tokens_used: 1 })
    const check = await checkInstructions(input())
    expect(check.items).toHaveLength(1)
  })
})
```

Confirm the Opus model id string by reading `MODEL_OPUS_5_5` in `functions/src/ai/anthropic.ts`; if it differs from `"claude-opus-5-5"`, assert against the constant instead.

- [ ] **Step 2: RED** — run `src/ai/__tests__/instruction-check-ai.test.ts`, paste the failure.
- [ ] **Step 3: Implement** as described above.
- [ ] **Step 4: GREEN** — run `src/ai/__tests__/instruction-check-ai.test.ts src/ai/__tests__/instruction-check.test.ts`.
- [ ] **Step 5: Commit** — `feat(ai): Opus 5.5 judges the instructions code cannot measure`

---

### Task 4: The attempt / check / rebuild loop

**Files:**
- Create: `functions/src/ai/compliance-loop.ts`
- Test: `functions/src/ai/__tests__/compliance-loop.test.ts`

**Interfaces:**
- Consumes: `InstructionCheck`, `buildComplianceFeedback`, `unmetCount` (Task 2).
- Produces:

```ts
export interface ComplianceAttempt {
  /** Wall-clock the attempt took, ms. */
  durationMs: number
}
export async function runWithComplianceCheck<A extends ComplianceAttempt>(args: {
  build: (feedback: string | null) => Promise<A>
  check: (attempt: A) => Promise<InstructionCheck>
  remainingMs: () => number | null // null = no deadline
  isCancelled: () => Promise<boolean>
  log?: (msg: string) => void
}): Promise<{ attempt: A; check: InstructionCheck }>
```

Rules: build(null) → check. If `status !== "failed"` → return. If `await isCancelled()` → return attempt 1 with its check. If `remainingMs()` is not null and `< 1.3 × attempt1.durationMs` → return attempt 1 with `note` appended: `"There wasn't time to rebuild, so this is the first attempt."` (keep any existing note, joined with a space). Otherwise feedback = `buildComplianceFeedback(check1.items)`; build(feedback) → check2. Keep attempt 2 when `unmetCount(check2) <= unmetCount(check1)`, else attempt 1. The returned check is the kept one's, with `rebuilt: true` and `rebuild_reason = check1's unmet items joined as "instruction: detail; …"`. If build(feedback) throws: rethrow if it is an abort/deadline error (`isAbortError(e) || e?.name === "DeadlineExceededError"`), otherwise return attempt 1 with `note` `"A rebuild was attempted and failed, so this is the first attempt."`.

- [ ] **Step 1: Failing tests** — cover: passed → one build; failed + time → two builds, second gets the feedback string; fewer-unmet wins; tie → attempt 2; worse attempt 2 → attempt 1 kept but `rebuilt: true`; not enough time → one build + note; cancelled → one build; rebuild throws plain Error → attempt 1 + note; rebuild throws DeadlineExceededError → rethrown. Use tiny fakes: `build = vi.fn(async (fb) => ({ id: fb ? 2 : 1, durationMs: 1000 }))`, `check` returning prepared `InstructionCheck`s by `attempt.id`.
- [ ] **Step 2: RED**, paste.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: GREEN.**
- [ ] **Step 5: Commit** — `feat(ai): rebuild a day once when it misses the coach's instructions`

---

### Task 5: Wire into Generate Day / Week

**Files:**
- Modify: `functions/src/ai/week-orchestrator.ts`
- Modify: `functions/src/week-generation.ts` (result passthrough)
- Test: `functions/src/ai/__tests__/week-orchestrator-compliance.test.ts`; existing `functions/src/__tests__/week-generation.test.ts`

**Interfaces:**
- Consumes: Tasks 2-4.
- Produces: `WeekGenerationResult.instruction_check: InstructionCheck | null`; exported pure helper `appendComplianceFeedback(agentInstructions: string | undefined, feedback: string | null): string | undefined`; exported `buildCheckRows(skeleton weeks, assignments, library): CheckDayRow[]`.

Steps:

1. Rename the body of `generateWeekSync` to `async function buildWeekAttempt(request, requestedBy, firebaseJobId, deadline, complianceFeedback: string | null)`. Everything up to `// ── Step 4: Save to database` stays as is, EXCEPT:
   - right after `const agentInstructions = buildAgentInstructions(...)`, use `const plannedInstructions = appendComplianceFeedback(agentInstructions, complianceFeedback)` and replace every later use of `agentInstructions` (architect message, `analyzerInstructions`, `coachInstructionsSection`) with `plannedInstructions`. `combinedInstructions` (the parser input) keeps `request.admin_instructions` — unchanged. `enrichCoachInstructions` keeps `request.admin_instructions` — unchanged.
   - The early `checkCancelled()` returns and the existing `throw`s stay as they are.
2. Turn Step 4 (from `await updateJobProgress("saving_week"...` to the final `return {...}`) into a local `const save = async (check: InstructionCheck | null): Promise<WeekGenerationResult> => { ... }` that runs the same code and returns the same object plus `instruction_check: check`, with `warnings` extended by `buildInstructionCheckWarning(check)` when check is non-null.
3. `buildWeekAttempt` returns `{ durationMs: Date.now() - startTime, save, checkInput, earlyResult: null }`, or `{ earlyResult }` for the existing cancellation early-returns (wrap those return values). `checkInput: CheckInput` is built just before Step 4:
   - `scope: isSingleDay ? "day" : "week"`, `instructions: request.admin_instructions?.trim() || null`
   - `rows: buildCheckRows(skeleton.weeks, assignment.assignments, allExercises)` — one row per assignment in slot order: day_of_week, order (index within the day), exercise id/name, movement_pattern + primary_muscles from the library, role/sets/reps/rest_seconds/tempo from the slot.
   - `pool: poolIds?.length ? { ids: poolIds, mode: poolMode, offeredIds: filtered.map((e) => e.id) } : null`
   - `namedMatches: intentResolution.matched`, `bannedIds: [...intentResolution.bannedIds]`, `nameById: Object.fromEntries(fullLibrary.map((e) => [e.id, e.name]))`.
4. New `export async function generateWeekSync(request, requestedBy, firebaseJobId?, deadline?)` (same signature as today):

```ts
const first = await buildWeekAttempt(request, requestedBy, firebaseJobId, deadline, null)
if (first.earlyResult) return first.earlyResult
const needsCheck = !!request.admin_instructions?.trim() || !!request.pool_exercise_ids?.length
if (!needsCheck) return first.save(null)
const updateJobProgress = createJobProgressUpdater(firebaseJobId, 5)
const { attempt, check } = await runWithComplianceCheck({
  build: async (feedback) => {
    if (feedback === null) return first
    await updateJobProgress("selecting_exercises", 4, "Rebuilding to follow your instructions")
    return buildWeekAttempt(request, requestedBy, firebaseJobId, deadline, feedback)
  },
  check: async (a) => {
    if (a.earlyResult) return { status: "unchecked", items: [], rebuilt: false, rebuild_reason: null, note: null }
    await updateJobProgress("selecting_exercises", 4, "Checking the day against your instructions")
    return checkInstructions(a.checkInput, { signal: deadline?.signal })
  },
  remainingMs: () => (deadline ? deadline.remainingMs() : null),
  isCancelled: createCancellationChecker(firebaseJobId),
  log: (m) => console.log(`[week-orchestrator] ${m}`),
})
if (attempt.earlyResult) return attempt.earlyResult
return attempt.save(check)
```

   (Match the real signatures of `createJobProgressUpdater` / `createCancellationChecker` as used at the top of today's function; the total-steps number must match what the function already uses.)
5. `functions/src/week-generation.ts`: add `instruction_check: result.instruction_check ?? null,` next to `instructions_used` in the job payload.

- [ ] **Step 1: Failing tests** in `week-orchestrator-compliance.test.ts`:
  - `appendComplianceFeedback("coach words", null)` → `"coach words"`; with feedback → contains both, feedback AFTER the coach's words; `appendComplianceFeedback(undefined, "fb")` → contains `"fb"`.
  - `buildCheckRows`: two days, assignments out of order → rows ordered by day then slot order, with names/patterns from the library and sets/reps/rest/tempo from the slots; an assignment whose slot is missing is skipped.
  - Source-level guard (the parser/enricher rule cannot be exercised without the full Supabase harness): read `week-orchestrator.ts` as text and assert `extractInstructionIntent(combinedInstructions)` is present, `combinedInstructions` is built from `request.admin_instructions`, and `enrichCoachInstructions(\n    request.admin_instructions` is present — i.e. neither takes `plannedInstructions`.
  - In `week-generation.test.ts`: the job payload carries `instruction_check` from the result (follow how that file already asserts `instructions_used`).
- [ ] **Step 2: RED**, paste.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: GREEN** — run `src/ai/__tests__/week-orchestrator-compliance.test.ts src/ai/__tests__/week-orchestrator.test.ts src/__tests__/week-orchestrator-prompt.test.ts src/__tests__/week-generation.test.ts src/ai/__tests__/preferred-pool.test.ts`, then the functions typecheck.
- [ ] **Step 5: Commit** — `feat(ai): Generate Day/Week checks the result against the coach's instructions before saving`

---

### Task 6: The checklist on the finished card

**Files:**
- Modify: `components/admin/GenerationWarnings.tsx`
- Modify: `components/admin/JobsNotificationDock.tsx` (render under `InstructionsUsedPanel`)
- Modify: `components/admin/GenerationDialog.tsx` (render under `InstructionsUsedPanel`, `defaultOpen`)
- Test: `__tests__/components/admin/InstructionCheck.test.tsx`

**Interfaces:**
- Produces: `export interface InstructionCheck` (same shape as functions'), `extractInstructionCheck(result: unknown): InstructionCheck | null`, `InstructionCheckPanel({ check, defaultOpen = false })`.

Panel: `<details>` with the same chrome as `InstructionsUsedPanel` (`rounded-lg border border-border bg-surface/50 p-3 text-left`), summary `Your instructions, checked` plus, when failed, `— ${n} not met` in `text-error`. Each item: `✓` (`text-success`) or `✗` (`text-error`), the instruction in `font-medium`, then `— ${detail}` in `text-muted-foreground`, `text-xs`. Then, when `rebuilt`, a line `Rebuilt once to fix: ${rebuild_reason}`. Then `note` if present. Status `unchecked` with a note → only the note; `unchecked` with no note and no items → render nothing. `extractInstructionCheck` is defensive: returns null unless `items` is an array of objects with string `instruction`/`detail` and boolean `met`; drops malformed items; `status` must be one of the three strings.

- [ ] **Step 1: Failing tests** (`// @vitest-environment jsdom`, like `InstructionsUsed.test.tsx`): extract tolerates null / missing key / garbage / a malformed item among good ones; panel renders ✓ and ✗ lines with details, the "not met" count, the rebuild line, the note; renders nothing for `unchecked` with no items and no note.
- [ ] **Step 2: RED**, paste.
- [ ] **Step 3: Implement** + render in the dock (collapsed) and dialog (`defaultOpen`), each directly after the existing `InstructionsUsedPanel` line.
- [ ] **Step 4: GREEN** — `__tests__/components/admin/InstructionCheck.test.tsx __tests__/components/admin/InstructionsUsed.test.tsx` plus any existing suites that import `JobsNotificationDock` or `GenerationDialog` (`grep -rl "JobsNotificationDock\|GenerationDialog" __tests__`).
- [ ] **Step 5: Commit** — `feat(admin): show the coach their instructions, checked`

---

### Final verification (controller, not a subagent task)

1. Functions typecheck clean; root `tsc --noEmit` error count unchanged from main (235) with none in changed files.
2. Every suite importing a changed module (grep the module paths) passes.
3. Live, dev clone, Darren's program copy (recreate `PROBE Chris H copy` as in the 2026-10-01 journal entry; delete after): his Preferred and Strict instructions → expect `passed`, checklist lines for sets/reps/rest/tempo/pool; "12 exercises … mainly shoulder" → count line + AI line; a forced miss (instructions naming an exercise in the library that the pool/variety makes unlikely, or "12 exercises" with a tiny time budget) → observe rebuild or the no-time note. Read the exercise names of every run.
4. Whole-branch review (fresh opus reviewer) → fix wave → re-review.
5. Journal entry + memory; leave the branch committed, NOT pushed.
