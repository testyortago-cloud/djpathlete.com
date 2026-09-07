# Sequence Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/admin/sequences` — a list showing, for every sequence, how many people entered it and what happened to them, plus a per-sequence detail page listing the individual runs.

**Architecture:** Two server-component pages reading through one new DAL module. The whole modelling decision lives in a single pure function, `bucketForRun`, that collapses `sequence_runs.status` and `sequence_runs.exit_reason` into one Outcome axis. No migration, no API route, no client-side state.

**Tech Stack:** Next.js 16 App Router (server components), Supabase via `createServiceRoleClient`, Tailwind v4, `components/ui/data-table.tsx`, vitest.

**Spec:** [docs/superpowers/specs/2026-09-07-sequence-reporting-design.md](../specs/2026-09-07-sequence-reporting-design.md)

## Global Constraints

- **Never add a `SINGLETON_BUSINESS_ID` reference.** Tenant comes from `resolveAdminTenant()` in pages; DAL functions take `businessId` as a required parameter. Every read carries `.eq("business_id", businessId)`.
- **Every list uses `components/ui/data-table.tsx`.** Never a bare `<table>`. `DataTable` does **not** emit a `<tbody>` — pass your own. `DataTableEmpty` renders its own `<tr>` — do **not** wrap it in a `DataTableRow`.
- **Admin UI is light-only.** No `.dark` variants, no `dark:` classes.
- **Reads are NOT wrapped in try/catch** in pages or DAL. A failed read must throw and reach `app/(admin)/admin/error.tsx`. `null` and `[]` are different answers.
- **No brand names** in any new file. Business identity comes from `getBusinessSettings()`. (This plan adds no copy that would need one.)
- **Copy is written for a non-programmer.** No "enrolled", "terminal", "trigger source", "run", "record". Say "entered", "still going", "nobody has entered this yet".
- **No migration.** This item claims no migration number.
- **Node 24:** run `source ~/.nvm/nvm.sh && nvm use 24` before any vitest or tsc command.
- **Baseline at branch point:** `tsc --noEmit` = **238 errors across 54 files**. Compare the per-file error **set**, not the count.
- **Mutate any test that passes on the first run** before believing it.

**Working directory for every command:** `/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete-seq-reporting`

---

### Task 1: `bucketForRun` — the outcome mapping

The entire modelling decision from spec §2, as one pure function. Everything else in this plan consumes it.

**Files:**
- Create: `lib/db/sequence-reporting.ts`
- Test: `__tests__/lib/db/sequence-reporting.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type OutcomeBucket =
    | "in_progress" | "bought" | "booked" | "opted_out" | "finished" | "failed" | "other"
  export const OUTCOME_BUCKETS: readonly OutcomeBucket[]
  export function bucketForRun(status: string, exitReason: string | null): OutcomeBucket
  export function emptyBuckets(): Record<OutcomeBucket, number>
  ```

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/db/sequence-reporting.test.ts`:

```ts
// __tests__/lib/db/sequence-reporting.test.ts
//
// The reporting read behind /admin/sequences.
//
// `bucketForRun` is where the whole feature lives. `sequence_runs` carries the
// outcome across TWO columns that do not line up with the four outcomes the
// screen promises: "ran to the end" is a status, "unsubscribed" is two
// different reasons, and there is a fifth reason the TypeScript union does not
// declare. Every one of those is a test below.

import { describe, expect, it } from "vitest"
import { bucketForRun, emptyBuckets, OUTCOME_BUCKETS } from "@/lib/db/sequence-reporting"

describe("bucketForRun", () => {
  it("puts a running person in progress", () => {
    expect(bucketForRun("active", null)).toBe("in_progress")
  })

  it("maps the four declared exit reasons", () => {
    expect(bucketForRun("exited", "payment")).toBe("bought")
    expect(bucketForRun("exited", "booking")).toBe("booked")
    expect(bucketForRun("exited", "unsubscribed")).toBe("opted_out")
    expect(bucketForRun("exited", "sms_stop")).toBe("opted_out")
  })

  // The reason SequenceExitReason does not declare. exitRun takes a plain
  // string and lib/automation/sequence-tick.ts:113 writes this one straight
  // past the union, so tsc cannot catch its absence — only this test can.
  it("maps 'suppressed', which the exported union omits", () => {
    expect(bucketForRun("exited", "suppressed")).toBe("opted_out")
  })

  // "Ran to the end" is a STATUS. completeRun writes no exit_reason at all,
  // so a mapping keyed only on exit_reason would lose every finisher.
  it("treats completed as finished regardless of exit_reason", () => {
    expect(bucketForRun("completed", null)).toBe("finished")
    expect(bucketForRun("completed", "payment")).toBe("finished")
  })

  it("treats failed as failed — a failure is not an exit", () => {
    expect(bucketForRun("failed", null)).toBe("failed")
  })

  // A sixth reason added later must be VISIBLE, not silently missing from the
  // totals. This is why "other" exists.
  it("puts an unknown exit reason in other rather than dropping it", () => {
    expect(bucketForRun("exited", "refunded_and_left")).toBe("other")
    expect(bucketForRun("exited", null)).toBe("other")
  })

  it("puts an unknown status in other", () => {
    expect(bucketForRun("paused_by_hand", null)).toBe("other")
  })
})

describe("emptyBuckets", () => {
  it("has a zero for every bucket in OUTCOME_BUCKETS", () => {
    const empty = emptyBuckets()
    expect(Object.keys(empty).sort()).toEqual([...OUTCOME_BUCKETS].sort())
    expect(Object.values(empty).every((n) => n === 0)).toBe(true)
  })

  it("returns a fresh object each call, so two sequences cannot share a tally", () => {
    // MUTANT: `const EMPTY = {...}; return EMPTY`. Every sequence would
    // accumulate into the same object and the first row would hold the totals
    // for all nine.
    const a = emptyBuckets()
    a.bought += 1
    expect(emptyBuckets().bought).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run __tests__/lib/db/sequence-reporting.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/db/sequence-reporting"`.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/db/sequence-reporting.ts`:

```ts
// lib/db/sequence-reporting.ts — the read behind /admin/sequences.
//
// Separate from lib/db/sequences.ts, which is the ENGINE's IO: claiming due
// runs, recording sends, advancing positions. That module is on the hot path of
// a cron that runs every five minutes. This one is a human-facing report that
// runs when somebody opens a page. Keeping them apart means a reporting change
// cannot slow the tick down, and a tick change cannot silently alter a number
// on a screen.

import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

/**
 * What happened to a person who entered a sequence.
 *
 * ONE axis, derived from TWO database columns, because neither column answers
 * the question on its own:
 *
 *   - `sequence_runs.status` is active | completed | exited | failed
 *   - `exit_reason` is only ever populated when status = 'exited'
 *
 * So "they finished the whole sequence" is a STATUS (`completed`, with no exit
 * reason at all), while "they bought" is a REASON. A screen that showed only
 * exit reasons would lose every finisher; one that showed only statuses could
 * not tell a purchase from an unsubscribe.
 *
 * `other` is not defensive padding. `exitRun` takes a plain `string`, so the
 * set of reasons that can reach the database is not closed by the type system
 * — `lib/automation/sequence-tick.ts` already writes one ("suppressed") that
 * `SequenceExitReason` does not declare. A sixth added tomorrow lands in
 * `other` and is VISIBLE on the screen, instead of quietly making the columns
 * stop adding up to the total.
 */
export type OutcomeBucket =
  | "in_progress"
  | "bought"
  | "booked"
  | "opted_out"
  | "finished"
  | "failed"
  | "other"

export const OUTCOME_BUCKETS: readonly OutcomeBucket[] = [
  "in_progress",
  "bought",
  "booked",
  "opted_out",
  "finished",
  "failed",
  "other",
] as const

/**
 * Every exit reason that can reach the database today, found by grepping the
 * helper that performs the verb rather than the function expected to call it —
 * the exits live in the event handlers, not in `decideStep`:
 *
 *   payment      app/api/stripe/webhook/route.ts:223
 *   booking      lib/bookings/ingest.ts:309
 *   unsubscribed lib/lead-engine/unsubscribe.ts:95
 *   sms_stop     app/api/webhooks/twilio/inbound/route.ts:278
 *   suppressed   lib/automation/sequence-tick.ts:113   <- not in the union
 *
 * Grouped here rather than switched on inline so that the three ways of saying
 * "stop contacting me" stay one column on the list. The detail page splits
 * them again, because an email unsubscribe, a texted STOP and "was already on
 * the do-not-contact list before we reached them" are three different things.
 */
const OPTED_OUT_REASONS = new Set(["unsubscribed", "sms_stop", "suppressed"])

export function bucketForRun(status: string, exitReason: string | null): OutcomeBucket {
  if (status === "active") return "in_progress"
  if (status === "completed") return "finished"
  if (status === "failed") return "failed"
  if (status === "exited") {
    if (exitReason === "payment") return "bought"
    if (exitReason === "booking") return "booked"
    if (exitReason && OPTED_OUT_REASONS.has(exitReason)) return "opted_out"
  }
  return "other"
}

/** A fresh zeroed tally. Fresh per call — two sequences must not share one. */
export function emptyBuckets(): Record<OutcomeBucket, number> {
  return {
    in_progress: 0,
    bought: 0,
    booked: 0,
    opted_out: 0,
    finished: 0,
    failed: 0,
    other: 0,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run __tests__/lib/db/sequence-reporting.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Mutate two of them, since they passed first time**

Run each mutation, confirm the named test FAILS, then revert:

1. In `bucketForRun`, delete the line `if (exitReason && OPTED_OUT_REASONS.has(exitReason)) return "opted_out"`.
   Expected: "maps the four declared exit reasons" and "maps 'suppressed'" both fail.
2. Remove `"suppressed"` from `OPTED_OUT_REASONS`.
   Expected: **only** "maps 'suppressed', which the exported union omits" fails. If it does not, that test is pinning nothing.

Record both results in the commit body. Revert both mutations before committing.

- [ ] **Step 6: Commit**

```bash
git add lib/db/sequence-reporting.ts __tests__/lib/db/sequence-reporting.test.ts
git commit -m "feat(lead-engine): the outcome mapping behind the sequence report

sequence_runs carries the outcome across two columns that do not line up
with the four outcomes the screen promises. bucketForRun is that
reconciliation, and it is pure so it can be tested exhaustively.

The 'other' bucket exists because exitRun takes a plain string: the set of
reasons that can reach the database is not closed by the type system, and
sequence-tick.ts already writes one ('suppressed') that SequenceExitReason
does not declare. Mutation-checked both ways."
```

---

### Task 2: `sequenceReport` — the list aggregation

**Files:**
- Modify: `lib/db/sequence-reporting.ts`
- Test: `__tests__/lib/db/sequence-reporting.test.ts` (append)

**Interfaces:**
- Consumes: `bucketForRun`, `emptyBuckets`, `OutcomeBucket` from Task 1.
- Produces:
  ```ts
  export interface SequenceReportRow {
    id: string
    key: string
    name: string
    description: string | null
    status: string
    trigger_source: string | null
    entered: number
    buckets: Record<OutcomeBucket, number>
    contactsWithoutEmailConsent: number
  }
  export async function sequenceReport(businessId: string): Promise<SequenceReportRow[]>
  ```

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/db/sequence-reporting.test.ts`. Add this mock harness **at the top of the file**, directly after the existing imports — `vi.mock` is hoisted, so it must sit above the `import { ... } from "@/lib/db/sequence-reporting"` line. Replace the existing import block with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

type Call = { table: string; select: string; ops: [string, ...unknown[]][] }
const calls: Call[] = []

/** Queued results, one per `.from(...).select(...)` in call order. */
let results: { data: unknown; error: unknown }[] = []

function makeBuilder(table: string, select: string) {
  const record: Call = { table, select, ops: [] }
  calls.push(record)
  const settle = () => results[calls.length - 1] ?? { data: [], error: null }

  const builder: Record<string, unknown> = {}
  for (const method of ["eq", "order", "limit", "in", "not", "range"]) {
    builder[method] = (...args: unknown[]) => {
      record.ops.push([method, ...args])
      return builder
    }
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(settle())
  return builder
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      select: (select: string) => makeBuilder(table, select),
    }),
  }),
}))

import {
  bucketForRun,
  emptyBuckets,
  OUTCOME_BUCKETS,
  sequenceReport,
} from "@/lib/db/sequence-reporting"

const BUSINESS = "biz-under-test"

beforeEach(() => {
  calls.length = 0
  results = []
})
```

Then append these tests:

```ts
describe("sequenceReport", () => {
  function seed(opts: {
    sequences?: unknown[]
    runs?: unknown[]
    consents?: unknown[]
  }) {
    results = [
      { data: opts.sequences ?? [], error: null },
      { data: opts.runs ?? [], error: null },
      { data: opts.consents ?? [], error: null },
    ]
  }

  const ONE_SEQUENCE = [
    {
      id: "s1",
      key: "new_lead_nurture",
      name: "New Lead Nurture",
      description: "The eight-step one",
      status: "active",
      trigger_source: "funnel_form",
    },
  ]

  it("scopes every read to the business the caller names", async () => {
    // MUTANT: change the business_id VALUE passed to .eq — not the arity. An
    // argument-blind mock tolerates a wrong predicate value happily, and has
    // done in this repo before, 91 assertions passing on a wrong tenant.
    seed({ sequences: ONE_SEQUENCE, runs: [] })
    await sequenceReport(BUSINESS)
    for (const call of calls) {
      expect(call.ops).toContainEqual(["eq", "business_id", BUSINESS])
    }
  })

  it("counts entered as every run, and buckets each one", async () => {
    seed({
      sequences: ONE_SEQUENCE,
      runs: [
        { sequence_id: "s1", contact_id: "c1", status: "active", exit_reason: null },
        { sequence_id: "s1", contact_id: "c2", status: "exited", exit_reason: "payment" },
        { sequence_id: "s1", contact_id: "c3", status: "exited", exit_reason: "sms_stop" },
        { sequence_id: "s1", contact_id: "c4", status: "completed", exit_reason: null },
        { sequence_id: "s1", contact_id: "c5", status: "failed", exit_reason: null },
      ],
    })
    const [row] = await sequenceReport(BUSINESS)
    expect(row.entered).toBe(5)
    expect(row.buckets.in_progress).toBe(1)
    expect(row.buckets.bought).toBe(1)
    expect(row.buckets.opted_out).toBe(1)
    expect(row.buckets.finished).toBe(1)
    expect(row.buckets.failed).toBe(1)
  })

  // The invariant that makes the screen believable.
  it("buckets always sum to entered", async () => {
    seed({
      sequences: ONE_SEQUENCE,
      runs: [
        { sequence_id: "s1", contact_id: "c1", status: "active", exit_reason: null },
        { sequence_id: "s1", contact_id: "c2", status: "exited", exit_reason: "who_knows" },
        { sequence_id: "s1", contact_id: "c3", status: "exited", exit_reason: "suppressed" },
        { sequence_id: "s1", contact_id: "c4", status: "weird_new_status", exit_reason: null },
      ],
    })
    const [row] = await sequenceReport(BUSINESS)
    const total = OUTCOME_BUCKETS.reduce((n, b) => n + row.buckets[b], 0)
    expect(total).toBe(row.entered)
    expect(row.entered).toBe(4)
  })

  it("gives a sequence with no runs a zero in every bucket, not a missing one", async () => {
    // MUTANT: build the tally only for sequences that appear in the runs list.
    // Eight of the nine sequences in production have never run; they would
    // render with `undefined` in every column.
    seed({ sequences: ONE_SEQUENCE, runs: [] })
    const [row] = await sequenceReport(BUSINESS)
    expect(row.entered).toBe(0)
    expect(row.buckets).toEqual(emptyBuckets())
  })

  it("does not let one sequence's runs land on another", async () => {
    seed({
      sequences: [
        ...ONE_SEQUENCE,
        { id: "s2", key: "quiz_rebuilder", name: "Quiz Rebuilder", description: null, status: "active", trigger_source: "quiz" },
      ],
      runs: [
        { sequence_id: "s2", contact_id: "c1", status: "exited", exit_reason: "payment" },
      ],
    })
    const rows = await sequenceReport(BUSINESS)
    const nurture = rows.find((r) => r.key === "new_lead_nurture")!
    const quiz = rows.find((r) => r.key === "quiz_rebuilder")!
    expect(nurture.entered).toBe(0)
    expect(quiz.buckets.bought).toBe(1)
  })

  it("throws when the runs read fails, rather than reporting zero runs", async () => {
    // "Could not read" and "nobody entered" must not look the same. A screen
    // whose entire job is to be believed cannot render a failure as an empty
    // sequence.
    results = [
      { data: ONE_SEQUENCE, error: null },
      { data: null, error: { message: "boom" } },
    ]
    await expect(sequenceReport(BUSINESS)).rejects.toThrow(/boom/)
  })

  it("throws when the sequences read fails", async () => {
    results = [{ data: null, error: { message: "sequences down" } }]
    await expect(sequenceReport(BUSINESS)).rejects.toThrow(/sequences down/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run __tests__/lib/db/sequence-reporting.test.ts
```

Expected: FAIL — `sequenceReport is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `lib/db/sequence-reporting.ts`:

```ts
export interface SequenceReportRow {
  id: string
  key: string
  name: string
  description: string | null
  status: string
  trigger_source: string | null
  entered: number
  buckets: Record<OutcomeBucket, number>
  contactsWithoutEmailConsent: number
}

/**
 * One row per sequence, with its outcome tally.
 *
 * PostgREST cannot GROUP BY and this feature takes no migration, so there is no
 * RPC to call: the counts are computed here, over one row per run.
 *
 * THE CEILING, stated honestly: that is every run of every sequence in memory
 * at once. At today's 73 it is free, and it stays comfortable into the low tens
 * of thousands. Past that this wants a database-side GROUP BY behind an RPC.
 * Written down so the next person meets a documented threshold instead of a
 * mystery.
 *
 * Every sequence gets a row whether or not anybody has entered it. Eight of the
 * nine sequences in production have never run; a report that only listed the
 * ones with runs would be a nearly empty page that looks like a broken read.
 */
export async function sequenceReport(businessId: string): Promise<SequenceReportRow[]> {
  const supabase = getClient()

  const { data: sequences, error: seqError } = await supabase
    .from("sequences")
    .select("id, key, name, description, status, trigger_source")
    .eq("business_id", businessId)
    .order("name", { ascending: true })
  // Throws rather than returning []: an empty page for a failed read would tell
  // the operator this business has no sequences, which is not true.
  if (seqError) throw new Error(`sequenceReport sequences: ${(seqError as { message?: string }).message}`)

  const { data: runs, error: runsError } = await supabase
    .from("sequence_runs")
    .select("sequence_id, contact_id, status, exit_reason")
    .eq("business_id", businessId)
  if (runsError) throw new Error(`sequenceReport runs: ${(runsError as { message?: string }).message}`)

  type RunRow = { sequence_id: string; contact_id: string; status: string; exit_reason: string | null }
  const runRows = (runs ?? []) as RunRow[]

  const tallies = new Map<string, { entered: number; buckets: Record<OutcomeBucket, number> }>()
  const contactsBySequence = new Map<string, Set<string>>()
  for (const run of runRows) {
    let tally = tallies.get(run.sequence_id)
    if (!tally) {
      tally = { entered: 0, buckets: emptyBuckets() }
      tallies.set(run.sequence_id, tally)
    }
    tally.entered += 1
    tally.buckets[bucketForRun(run.status, run.exit_reason)] += 1

    let contacts = contactsBySequence.get(run.sequence_id)
    if (!contacts) {
      contacts = new Set()
      contactsBySequence.set(run.sequence_id, contacts)
    }
    contacts.add(run.contact_id)
  }

  const allContactIds = [...new Set(runRows.map((r) => r.contact_id))]
  const consented = await contactsWithEmailConsent(businessId, allContactIds)

  type SequenceRow = {
    id: string
    key: string
    name: string
    description: string | null
    status: string
    trigger_source: string | null
  }

  return ((sequences ?? []) as SequenceRow[]).map((sequence) => {
    const tally = tallies.get(sequence.id)
    const contacts = contactsBySequence.get(sequence.id) ?? new Set<string>()
    let without = 0
    for (const contactId of contacts) if (!consented.has(contactId)) without += 1
    return {
      ...sequence,
      entered: tally?.entered ?? 0,
      buckets: tally?.buckets ?? emptyBuckets(),
      contactsWithoutEmailConsent: without,
    }
  })
}
```

Task 3 supplies `contactsWithEmailConsent`. To keep this task's tests green on its own, add this temporary stub immediately above `sequenceReport` and **delete it in Task 3**:

```ts
// TEMPORARY — replaced by the real implementation in Task 3.
async function contactsWithEmailConsent(_businessId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_consents")
    .select("contact_id, granted, occurred_at")
    .eq("business_id", _businessId)
    .eq("channel", "email")
    .in("contact_id", ids)
    .order("occurred_at", { ascending: false })
  if (error) throw new Error(`contactsWithEmailConsent: ${(error as { message?: string }).message}`)
  const seen = new Set<string>()
  const granted = new Set<string>()
  for (const row of (data ?? []) as { contact_id: string; granted: boolean }[]) {
    if (seen.has(row.contact_id)) continue
    seen.add(row.contact_id)
    if (row.granted) granted.add(row.contact_id)
  }
  return granted
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run __tests__/lib/db/sequence-reporting.test.ts
```

Expected: PASS, all tests.

- [ ] **Step 5: Mutate the tenant test**

In `sequenceReport`, change `.eq("business_id", businessId)` on the **runs** query to `.eq("business_id", "some-other-business")`. Expected: "scopes every read to the business the caller names" FAILS. Revert.

If it passes, the assertion is argument-blind and must be rewritten before continuing.

- [ ] **Step 6: Commit**

```bash
git add lib/db/sequence-reporting.ts __tests__/lib/db/sequence-reporting.test.ts
git commit -m "feat(lead-engine): tally every sequence's runs by outcome

Every sequence gets a row whether or not anybody has entered it: eight of
the nine in production have never run, and a report listing only the ones
with runs is a near-empty page that reads as a broken query.

A failed read throws rather than returning an empty tally. 'Could not read'
and 'nobody entered' must not render identically on a screen whose whole
job is to be believed. Tenant predicate mutation-checked by VALUE."
```

---

### Task 3: The email-consent count

Per the owner's decision on gap #15, email stays ungated. The screen shows the consent picture so the decision can be revisited against a number instead of an estimate.

**Files:**
- Modify: `lib/db/sequence-reporting.ts` (replace the Task 2 stub)
- Test: `__tests__/lib/db/sequence-reporting.test.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export async function contactsWithEmailConsent(businessId: string, contactIds: string[]): Promise<Set<string>>`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/db/sequence-reporting.test.ts`:

```ts
describe("contactsWithEmailConsent", () => {
  it("asks only about email, only for the ids given, scoped to the business", async () => {
    results = [{ data: [], error: null }]
    await contactsWithEmailConsent(BUSINESS, ["c1", "c2"])
    expect(calls[0].table).toBe("contact_consents")
    expect(calls[0].ops).toContainEqual(["eq", "business_id", BUSINESS])
    expect(calls[0].ops).toContainEqual(["eq", "channel", "email"])
    expect(calls[0].ops).toContainEqual(["in", "contact_id", ["c1", "c2"]])
  })

  // THE MUTATION THAT MATTERS. Consent is the most recent row per contact with
  // granted = true, NOT "a row exists". A naive `exists` implementation reports
  // a REVOKED consent as a granted one, which is exactly backwards and the more
  // dangerous of the two possible errors.
  it("takes the newest row per contact, so a later revocation wins", async () => {
    results = [
      {
        data: [
          { contact_id: "c1", granted: false, occurred_at: "2026-09-01T00:00:00Z" },
          { contact_id: "c1", granted: true, occurred_at: "2026-08-01T00:00:00Z" },
        ],
        error: null,
      },
    ]
    const granted = await contactsWithEmailConsent(BUSINESS, ["c1"])
    expect(granted.has("c1")).toBe(false)
  })

  it("keeps a contact whose newest row grants", async () => {
    results = [
      {
        data: [
          { contact_id: "c1", granted: true, occurred_at: "2026-09-01T00:00:00Z" },
          { contact_id: "c1", granted: false, occurred_at: "2026-08-01T00:00:00Z" },
        ],
        error: null,
      },
    ]
    const granted = await contactsWithEmailConsent(BUSINESS, ["c1"])
    // Presence control: without this, the revocation test above would pass just
    // as well against an implementation that returns an empty set for everything.
    expect(granted.has("c1")).toBe(true)
  })

  it("orders by occurred_at descending — the walk depends on it", async () => {
    // MUTANT: drop the .order, or make it ascending. The first row seen per
    // contact would be the OLDEST, so every revocation would be ignored. The
    // dedup and the ordering are one mechanism; neither is correct alone.
    results = [{ data: [], error: null }]
    await contactsWithEmailConsent(BUSINESS, ["c1"])
    expect(calls[0].ops).toContainEqual(["order", "occurred_at", { ascending: false }])
    expect(calls[0].ops).toContainEqual(["order", "created_at", { ascending: false }])
  })

  it("does not query at all for an empty id list", async () => {
    const granted = await contactsWithEmailConsent(BUSINESS, [])
    expect(granted.size).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it("throws on a failed read rather than reporting nobody consented", async () => {
    results = [{ data: null, error: { message: "consent read failed" } }]
    await expect(contactsWithEmailConsent(BUSINESS, ["c1"])).rejects.toThrow(/consent read failed/)
  })
})
```

Add `contactsWithEmailConsent` to the import list at the top of the test file.

- [ ] **Step 2: Run the test to verify it fails**

```bash
source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run __tests__/lib/db/sequence-reporting.test.ts -t "contactsWithEmailConsent"
```

Expected: FAIL — not exported (it is a private stub), and the `created_at` order assertion fails.

- [ ] **Step 3: Replace the stub with the real implementation**

Delete the `// TEMPORARY` stub from Task 2 and put this in its place:

```ts
/**
 * Which of these contacts have said yes to email, most recently.
 *
 * CONSENT IS THE NEWEST ROW PER CONTACT WITH `granted = true`, not "a row
 * exists". `contact_consents` is an append-only trail: granting, revoking and
 * re-granting all add rows, so an `exists` check would report a REVOKED
 * consent as a granted one. Of the two ways to get this wrong, that is the
 * dangerous one.
 *
 * The tiebreak matches `hasConsent` in lib/db/contact-consents.ts exactly —
 * `occurred_at desc, created_at desc` — so the report and the engine cannot
 * disagree about one person.
 *
 * Bulk, unlike `hasConsent`, which issues one query per contact: this is a
 * report over every contact in every sequence, and the per-contact version
 * would be 169 round trips on the current data.
 *
 * The walk KEEPS THE FIRST ROW SEEN per contact and skips the rest, which is
 * only correct because the query is ordered newest-first. The dedup and the
 * ordering are one mechanism; either alone is a bug.
 */
export async function contactsWithEmailConsent(
  businessId: string,
  contactIds: string[],
): Promise<Set<string>> {
  if (contactIds.length === 0) return new Set()

  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_consents")
    .select("contact_id, granted, occurred_at")
    .eq("business_id", businessId)
    .eq("channel", "email")
    .in("contact_id", contactIds)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
  // Throws: "could not read the consent table" must not render as "nobody has
  // consented". null and [] are different answers.
  if (error) throw new Error(`contactsWithEmailConsent: ${(error as { message?: string }).message}`)

  const seen = new Set<string>()
  const granted = new Set<string>()
  for (const row of (data ?? []) as { contact_id: string; granted: boolean }[]) {
    if (seen.has(row.contact_id)) continue
    seen.add(row.contact_id)
    if (row.granted) granted.add(row.contact_id)
  }
  return granted
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run __tests__/lib/db/sequence-reporting.test.ts
```

Expected: PASS, all tests including Tasks 1 and 2.

- [ ] **Step 5: Mutate the dedup**

Change `if (seen.has(row.contact_id)) continue` to `if (false) continue` and make the loop overwrite rather than skip (i.e. `if (row.granted) granted.add(...)` for every row). Expected: "takes the newest row per contact, so a later revocation wins" FAILS. Revert.

- [ ] **Step 6: Commit**

```bash
git add lib/db/sequence-reporting.ts __tests__/lib/db/sequence-reporting.test.ts
git commit -m "feat(lead-engine): count who in a sequence has no email consent

Consent is the NEWEST row per contact with granted = true, not 'a row
exists' — contact_consents is an append-only trail, so an exists check
reports a revoked consent as a granted one. Same occurred_at/created_at
tiebreak as hasConsent, so the report and the engine cannot disagree about
one person.

Gates nothing: the owner's decision on gap #15 is that email stays
ungated. This makes the picture visible so the decision can be revisited
against a number."
```

---

### Task 4: `sequenceDetail` — one sequence and its people

**Files:**
- Modify: `lib/db/sequence-reporting.ts`
- Test: `__tests__/lib/db/sequence-reporting.test.ts` (append)

**Interfaces:**
- Consumes: `SequenceReportRow`, `OutcomeBucket`, `bucketForRun`, `emptyBuckets`, `contactsWithEmailConsent`.
- Produces:
  ```ts
  export interface SequenceRunRowForReport {
    id: string
    contactId: string
    contactName: string | null
    contactEmail: string | null
    enteredAt: string
    completedAt: string | null
    bucket: OutcomeBucket
    exitReason: string | null
    currentPosition: number
  }
  export interface SequenceDetail extends SequenceReportRow {
    stepCount: number
    runs: SequenceRunRowForReport[]
    totalRuns: number
  }
  export async function sequenceDetail(
    businessId: string, key: string, opts?: { limit?: number; offset?: number },
  ): Promise<SequenceDetail | null>
  ```

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/db/sequence-reporting.test.ts`:

```ts
describe("sequenceDetail", () => {
  const SEQUENCE = {
    id: "s1",
    key: "new_lead_nurture",
    name: "New Lead Nurture",
    description: "Eight steps",
    status: "active",
    trigger_source: "funnel_form",
  }

  it("returns null for a key this business does not own", async () => {
    // NOT an empty report. An empty report tells the operator a sequence they
    // can name has nobody in it; null lets the page 404, which is the truth:
    // it belongs to somebody else.
    results = [{ data: null, error: null }]
    expect(await sequenceDetail(BUSINESS, "not_ours")).toBeNull()
  })

  it("looks the sequence up by key AND business", async () => {
    results = [{ data: SEQUENCE, error: null }, { data: [], error: null }, { data: [], error: null }, { data: [], error: null }]
    await sequenceDetail(BUSINESS, "new_lead_nurture")
    expect(calls[0].table).toBe("sequences")
    expect(calls[0].ops).toContainEqual(["eq", "key", "new_lead_nurture"])
    expect(calls[0].ops).toContainEqual(["eq", "business_id", BUSINESS])
  })

  it("buckets each run and flattens the joined contact", async () => {
    results = [
      { data: SEQUENCE, error: null },
      { data: [{ count: 2 }], error: null },
      {
        data: [
          {
            id: "r1",
            contact_id: "c1",
            enrolled_at: "2026-09-01T10:00:00Z",
            completed_at: "2026-09-02T10:00:00Z",
            status: "exited",
            exit_reason: "payment",
            current_position: 3,
            contacts: { full_name: "Alex Rivera", email: "alex@example.com" },
          },
          {
            id: "r2",
            contact_id: "c2",
            enrolled_at: "2026-09-01T11:00:00Z",
            completed_at: null,
            status: "active",
            exit_reason: null,
            current_position: 1,
            contacts: null,
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ]
    const detail = await sequenceDetail(BUSINESS, "new_lead_nurture")
    expect(detail!.runs[0]).toMatchObject({
      id: "r1",
      contactName: "Alex Rivera",
      contactEmail: "alex@example.com",
      bucket: "bought",
      exitReason: "payment",
    })
    // A run whose contact row did not come back must still render — a missing
    // join is not a reason to hide a person from the count.
    expect(detail!.runs[1]).toMatchObject({ id: "r2", contactName: null, bucket: "in_progress" })
  })

  it("keeps the raw exit reason, so the page can split opted-out three ways", async () => {
    // MUTANT: return only `bucket` and drop `exitReason`. The detail page could
    // no longer tell an email unsubscribe from a texted STOP from someone who
    // was already on the do-not-contact list — three different things.
    results = [
      { data: SEQUENCE, error: null },
      { data: [{ count: 1 }], error: null },
      {
        data: [
          {
            id: "r1", contact_id: "c1", enrolled_at: "2026-09-01T10:00:00Z", completed_at: null,
            status: "exited", exit_reason: "sms_stop", current_position: 2, contacts: null,
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ]
    const detail = await sequenceDetail(BUSINESS, "new_lead_nurture")
    expect(detail!.runs[0].bucket).toBe("opted_out")
    expect(detail!.runs[0].exitReason).toBe("sms_stop")
  })

  it("pages the runs and reports the true total", async () => {
    results = [
      { data: SEQUENCE, error: null },
      { data: [], error: null, count: 240 } as never,
      { data: [], error: null },
      { data: [], error: null },
    ]
    const detail = await sequenceDetail(BUSINESS, "new_lead_nurture", { limit: 100, offset: 100 })
    const runsCall = calls.find((c) => c.table === "sequence_runs" && c.select.includes("contacts"))!
    expect(runsCall.ops).toContainEqual(["range", 100, 199])
    expect(detail!.totalRuns).toBe(240)
  })

  it("throws when the sequence read fails, rather than 404ing", async () => {
    // A failed read must not be indistinguishable from "no such sequence".
    results = [{ data: null, error: { message: "sequence read failed" } }]
    await expect(sequenceDetail(BUSINESS, "new_lead_nurture")).rejects.toThrow(/sequence read failed/)
  })
})
```

Add `sequenceDetail` to the test file's import list. Add `maybeSingle` and `single` to the builder's method list in the mock harness so the lookup resolves:

```ts
  for (const method of ["eq", "order", "limit", "in", "not", "range"]) { ... }
  builder.maybeSingle = () => settle()
  builder.single = () => settle()
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run __tests__/lib/db/sequence-reporting.test.ts -t "sequenceDetail"
```

Expected: FAIL — `sequenceDetail is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `lib/db/sequence-reporting.ts`:

```ts
export interface SequenceRunRowForReport {
  id: string
  contactId: string
  contactName: string | null
  contactEmail: string | null
  enteredAt: string
  completedAt: string | null
  bucket: OutcomeBucket
  /**
   * The RAW reason, kept alongside the bucket on purpose. The list collapses
   * three reasons into "opted out"; the detail page splits them again, because
   * an email unsubscribe, a texted STOP and "was already on the do-not-contact
   * list" are three different things an operator would act on differently.
   */
  exitReason: string | null
  currentPosition: number
}

export interface SequenceDetail extends SequenceReportRow {
  stepCount: number
  runs: SequenceRunRowForReport[]
  /** May exceed `runs.length` — the pager needs the real total. */
  totalRuns: number
}

export const DETAIL_PAGE_SIZE = 100

/**
 * One sequence, its tally, and the individual people in it.
 *
 * Returns `null` — not an empty report — when no sequence with this key belongs
 * to this business, so the page can answer 404. An empty report would tell an
 * operator that a sequence they can name has nobody in it, when the truth is
 * that it is somebody else's.
 */
export async function sequenceDetail(
  businessId: string,
  key: string,
  opts?: { limit?: number; offset?: number },
): Promise<SequenceDetail | null> {
  const limit = opts?.limit ?? DETAIL_PAGE_SIZE
  const offset = opts?.offset ?? 0
  const supabase = getClient()

  const { data: sequence, error: seqError } = await supabase
    .from("sequences")
    .select("id, key, name, description, status, trigger_source")
    .eq("key", key)
    .eq("business_id", businessId)
    .maybeSingle()
  if (seqError) throw new Error(`sequenceDetail sequence: ${(seqError as { message?: string }).message}`)
  if (!sequence) return null

  const row = sequence as {
    id: string
    key: string
    name: string
    description: string | null
    status: string
    trigger_source: string | null
  }

  const { data: allRuns, error: allRunsError } = await supabase
    .from("sequence_runs")
    .select("status, exit_reason, contact_id")
    .eq("business_id", businessId)
    .eq("sequence_id", row.id)
  if (allRunsError) throw new Error(`sequenceDetail tally: ${(allRunsError as { message?: string }).message}`)

  type TallyRow = { status: string; exit_reason: string | null; contact_id: string }
  const tallyRows = (allRuns ?? []) as TallyRow[]
  const buckets = emptyBuckets()
  for (const r of tallyRows) buckets[bucketForRun(r.status, r.exit_reason)] += 1

  const { data: pageRuns, error: pageError } = await supabase
    .from("sequence_runs")
    .select(
      "id, contact_id, enrolled_at, completed_at, status, exit_reason, current_position, contacts(full_name, email)",
    )
    .eq("business_id", businessId)
    .eq("sequence_id", row.id)
    .order("enrolled_at", { ascending: false })
    .range(offset, offset + limit - 1)
  if (pageError) throw new Error(`sequenceDetail runs: ${(pageError as { message?: string }).message}`)

  type JoinedRun = {
    id: string
    contact_id: string
    enrolled_at: string
    completed_at: string | null
    status: string
    exit_reason: string | null
    current_position: number
    contacts: { full_name: string | null; email: string | null } | null
  }

  const runs: SequenceRunRowForReport[] = ((pageRuns ?? []) as JoinedRun[]).map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    // A missing join is not a reason to hide a person from the list. It renders
    // without a name rather than not at all.
    contactName: r.contacts?.full_name ?? null,
    contactEmail: r.contacts?.email ?? null,
    enteredAt: r.enrolled_at,
    completedAt: r.completed_at,
    bucket: bucketForRun(r.status, r.exit_reason),
    exitReason: r.exit_reason,
    currentPosition: r.current_position,
  }))

  const { data: steps, error: stepsError } = await supabase
    .from("sequence_steps")
    .select("id")
    .eq("business_id", businessId)
    .eq("sequence_id", row.id)
  if (stepsError) throw new Error(`sequenceDetail steps: ${(stepsError as { message?: string }).message}`)

  const contactIds = [...new Set(tallyRows.map((r) => r.contact_id))]
  const consented = await contactsWithEmailConsent(businessId, contactIds)
  let without = 0
  for (const id of contactIds) if (!consented.has(id)) without += 1

  return {
    ...row,
    entered: tallyRows.length,
    buckets,
    contactsWithoutEmailConsent: without,
    stepCount: (steps ?? []).length,
    runs,
    totalRuns: tallyRows.length,
  }
}
```

Note: `totalRuns` comes from the full tally read, which this function already performs — no separate `count` query is needed. Adjust the paging test's expectation accordingly if it asserted a `count` field: assert `totalRuns` equals the number of rows in the tally result instead.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run __tests__/lib/db/sequence-reporting.test.ts
```

Expected: PASS. If the paging test fails on `count`, fix the **test** to assert against the tally read as described above — do not add a redundant count query.

- [ ] **Step 5: Mutate the tenant predicate on the lookup**

Remove `.eq("business_id", businessId)` from the `sequences` lookup. Expected: "looks the sequence up by key AND business" FAILS. Revert.

- [ ] **Step 6: Commit**

```bash
git add lib/db/sequence-reporting.ts __tests__/lib/db/sequence-reporting.test.ts
git commit -m "feat(lead-engine): one sequence's tally and the people in it

Returns null rather than an empty report for a key this business does not
own, so the page can 404. An empty report would tell an operator that a
sequence they can name has nobody in it, when the truth is it is somebody
else's.

Keeps the raw exit_reason next to the bucket: the list collapses three
reasons into 'opted out' and the detail page splits them again, because an
email unsubscribe, a texted STOP and 'was already on the do-not-contact
list' are three different things."
```

---

### Task 5: The list page, the nav entry and the permission

**Files:**
- Create: `app/(admin)/admin/sequences/page.tsx`
- Create: `components/admin/sequences/SequenceReportTable.tsx`
- Modify: `components/admin/admin-nav.ts` (Coaching group, after Contacts)
- Modify: `lib/permissions/registry.ts` (one prefix rule)
- Test: `__tests__/lib/permissions/sequences-path.test.ts`

**Interfaces:**
- Consumes: `sequenceReport`, `SequenceReportRow`, `OUTCOME_BUCKETS` from Tasks 1–3.
- Produces: the route `/admin/sequences`.

- [ ] **Step 1: Write the failing permission test**

Create `__tests__/lib/permissions/sequences-path.test.ts`:

```ts
// The registry is DEFAULT-DENY: a path in no rule is denied to staff. A new
// admin surface that nobody registers therefore ships as a nav link that
// bounces the person who clicks it, which reads as a broken app rather than as
// a permission boundary.

import { describe, expect, it } from "vitest"
import { canAccessPath } from "@/lib/permissions/registry"

const staff = (permissions: Record<string, unknown>) =>
  ({ role: "staff", permissions }) as never

describe("/admin/sequences", () => {
  it("is reachable by staff who have the contacts permission", () => {
    expect(canAccessPath(staff({ contacts: true }), "/admin/sequences")).toBe(true)
    expect(canAccessPath(staff({ contacts: true }), "/admin/sequences/new_lead_nurture")).toBe(true)
  })

  it("is denied to staff without it", () => {
    // Presence control for the assertion above: without this, the test would
    // pass just as well against a rule that granted everybody.
    expect(canAccessPath(staff({ clients: true }), "/admin/sequences")).toBe(false)
  })

  it("is reachable by the owner", () => {
    expect(canAccessPath({ role: "admin", permissions: {} } as never, "/admin/sequences")).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run __tests__/lib/permissions/sequences-path.test.ts
```

Expected: FAIL — "is reachable by staff who have the contacts permission" returns `false` (unmapped → denied).

- [ ] **Step 3: Register the path**

In `lib/permissions/registry.ts`, immediately after the `{ prefix: "/admin/pipeline", permission: "contacts" }` line, add:

```ts
  // The report on what the sequences are doing to the people on the board.
  // Same permission as Pipeline and Contacts because it is the same subsystem:
  // the people in a sequence are the people on the board.
  //
  // Deliberately NOT paired with an /api/admin/sequences rule. Both pages are
  // server components that read through the DAL; this surface adds no route
  // handler. The API prefix would instead reach the pre-existing
  // /api/admin/sequences/enrol, which is unmapped AND self-guards on
  // role !== "admin" — registering it would let staff past the proxy into a
  // route that 403s them anyway, leaving two guards masking each other.
  { prefix: "/admin/sequences", permission: "contacts" },
```

- [ ] **Step 4: Run it to verify it passes**

```bash
source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run __tests__/lib/permissions/sequences-path.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Build the table component**

Create `components/admin/sequences/SequenceReportTable.tsx`:

```tsx
import Link from "next/link"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  type DataTableBadgeTone,
} from "@/components/ui/data-table"
import type { SequenceReportRow } from "@/lib/db/sequence-reporting"

const STATUS_TONE: Record<string, DataTableBadgeTone> = {
  active: "success",
  paused: "warning",
  draft: "neutral",
  archived: "neutral",
}

const STATUS_LABEL: Record<string, string> = {
  active: "On",
  paused: "Paused",
  draft: "Not started",
  archived: "Archived",
}

/**
 * Why nobody has entered this sequence — in words a non-programmer can act on.
 *
 * A page of zeros reads as broken. On production today eight of the nine
 * sequences have never run, and for two of them the reason is simply that they
 * are paused — which is a thirty-second fix if you can see it, and invisible if
 * you cannot.
 */
function whyEmpty(row: SequenceReportRow): string {
  if (row.status === "paused") return "Paused, so nobody new is being added."
  if (row.status === "draft") return "Not switched on yet."
  if (row.status === "archived") return "Archived."
  if (!row.trigger_source) return "Nobody yet — people are only added to this one by hand."
  if (row.trigger_source === "funnel_form") return "Nobody yet — waiting on a funnel form."
  if (row.trigger_source === "quiz") return "Nobody yet — waiting on a quiz result."
  if (row.trigger_source === "newsletter") return "Nobody yet — waiting on a newsletter sign-up."
  if (row.trigger_source === "lead_magnet") return "Nobody yet — waiting on a download."
  return "Nobody has entered this one yet."
}

export function SequenceReportTable({ rows }: { rows: SequenceReportRow[] }) {
  return (
    <DataTableCard>
      <DataTable>
        <DataTableHeader>
          <DataTableHead>Sequence</DataTableHead>
          <DataTableHead align="right">Entered</DataTableHead>
          <DataTableHead align="right">Still going</DataTableHead>
          <DataTableHead align="right">Bought</DataTableHead>
          <DataTableHead align="right">Booked a call</DataTableHead>
          <DataTableHead align="right">Opted out</DataTableHead>
          <DataTableHead align="right">Reached the end</DataTableHead>
          <DataTableHead align="right">Didn&apos;t send</DataTableHead>
        </DataTableHeader>
        <tbody>
          {rows.length === 0 ? (
            <DataTableEmpty colSpan={8}>No sequences have been set up yet.</DataTableEmpty>
          ) : (
            rows.map((row) => (
              <DataTableRow key={row.id}>
                <DataTableCell>
                  <Link href={`/admin/sequences/${row.key}`} className="font-medium text-primary hover:underline">
                    {row.name}
                  </Link>
                  <div className="mt-1 flex items-center gap-2">
                    <DataTableBadge tone={STATUS_TONE[row.status] ?? "neutral"}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </DataTableBadge>
                    {row.entered === 0 ? (
                      <span className="text-xs text-muted-foreground">{whyEmpty(row)}</span>
                    ) : null}
                  </div>
                </DataTableCell>
                <DataTableCell align="right" className="font-medium">
                  {row.entered}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.in_progress === 0}>
                  {row.buckets.in_progress}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.bought === 0}>
                  {row.buckets.bought}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.booked === 0}>
                  {row.buckets.booked}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.opted_out === 0}>
                  {row.buckets.opted_out}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.finished === 0}>
                  {row.buckets.finished}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.failed === 0}>
                  {row.buckets.failed}
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </tbody>
      </DataTable>
    </DataTableCard>
  )
}
```

Note the `other` bucket has no column. It is surfaced on the detail page and in
the sum check; a column that is zero on every row for the foreseeable future
would cost a column of width for nothing. If `other` is ever non-zero the detail
page shows it.

- [ ] **Step 6: Build the page**

Create `app/(admin)/admin/sequences/page.tsx`:

```tsx
// app/(admin)/admin/sequences/page.tsx — what the follow-up sequences are
// actually doing.
//
// `exit_reason` has been recorded faithfully since the engine shipped and read
// in exactly one place: the contact detail page, one person at a time. This is
// the view that answers "is this working" across everybody.
//
// The read is NOT wrapped in try/catch, deliberately, the same way
// app/(admin)/admin/contacts/page.tsx does it. A failed read must reach
// app/(admin)/admin/error.tsx, which is visibly not a table of zeros. On this
// screen those two would otherwise be pixel-identical, and a report that cannot
// be told apart from a broken query is worth nothing.

import { Workflow } from "lucide-react"
import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { sequenceReport } from "@/lib/db/sequence-reporting"
import { SequenceReportTable } from "@/components/admin/sequences/SequenceReportTable"

export const metadata = { title: "Sequences" }
export const dynamic = "force-dynamic"

export default async function SequencesPage() {
  await requirePermission("contacts")
  const { businessId } = await resolveAdminTenant()
  const rows = await sequenceReport(businessId)

  const withoutConsent = rows.reduce((n, r) => n + r.contactsWithoutEmailConsent, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-primary">
          <Workflow className="size-6" />
          Sequences
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your automatic follow-up. Each one is a series of emails and texts that goes out on its own after
          somebody fills in a form, finishes the quiz, or signs up. This page shows how many people entered
          each one and what happened to them.
        </p>
      </div>

      <SequenceReportTable rows={rows} />

      {withoutConsent > 0 ? (
        <p className="text-sm text-muted-foreground">
          {withoutConsent === 1 ? "1 person" : `${withoutConsent} people`} in these sequences has no recorded
          permission to email. Emails still go out to them — this is here so you can see the number.
        </p>
      ) : null}
    </div>
  )
}
```

Verify `requirePermission`'s exact signature in `lib/permissions/guard.ts` before writing this and match it — if it takes `(permission, tier)` or returns an actor, adjust the call and use the same shape the contacts page uses.

- [ ] **Step 7: Add the nav entry**

In `components/admin/admin-nav.ts`, in the Coaching group, immediately after the Contacts line:

```ts
          // The report on what those sequences did to those contacts. Beside
          // Contacts because it is the same subsystem and answers the question
          // that page raises: they are in a sequence — and then what?
          { label: "Sequences", href: "/admin/sequences", icon: Workflow },
```

Add `Workflow` to the `lucide-react` import at the top of that file if it is not already there.

- [ ] **Step 8: Verify it compiles and the suites are green**

```bash
source ~/.nvm/nvm.sh && nvm use 24 && npx tsc --noEmit 2>&1 | grep -c "error TS"
source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run __tests__/lib/db/sequence-reporting.test.ts __tests__/lib/permissions/
```

Expected: tsc error count **238 or fewer**, and no error in a file this task touched. Diff the per-file set against `/tmp/claude-501/tsc-baseline-seq-files.txt`. Suites green.

- [ ] **Step 9: Commit**

```bash
git add app/\(admin\)/admin/sequences components/admin/sequences lib/permissions/registry.ts components/admin/admin-nav.ts __tests__/lib/permissions/sequences-path.test.ts
git commit -m "feat(lead-engine): /admin/sequences — what the follow-up is doing

The registry entry is not decoration: it is default-deny, so an
unregistered admin surface ships as a nav link that bounces the person who
clicks it. Registered for the contacts permission, the same one Pipeline
and Contacts use, because it is the same subsystem.

A sequence nobody has entered says WHY in plain words — paused, not
switched on, or waiting on a form — because eight of the nine in
production have never run, and a page of zeros reads as broken."
```

---

### Task 6: The detail page

**Files:**
- Create: `app/(admin)/admin/sequences/[key]/page.tsx`
- Create: `components/admin/sequences/SequenceRunsTable.tsx`

**Interfaces:**
- Consumes: `sequenceDetail`, `SequenceDetail`, `SequenceRunRowForReport`, `DETAIL_PAGE_SIZE`.
- Produces: the route `/admin/sequences/[key]`.

- [ ] **Step 1: Build the runs table**

Create `components/admin/sequences/SequenceRunsTable.tsx`:

```tsx
import Link from "next/link"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  type DataTableBadgeTone,
} from "@/components/ui/data-table"
import type { OutcomeBucket, SequenceRunRowForReport } from "@/lib/db/sequence-reporting"

const BUCKET_TONE: Record<OutcomeBucket, DataTableBadgeTone> = {
  in_progress: "info",
  bought: "success",
  booked: "success",
  opted_out: "warning",
  finished: "neutral",
  failed: "danger",
  other: "neutral",
}

const BUCKET_LABEL: Record<OutcomeBucket, string> = {
  in_progress: "Still going",
  bought: "Bought",
  booked: "Booked a call",
  opted_out: "Opted out",
  finished: "Reached the end",
  failed: "Didn't send",
  other: "Something else",
}

/**
 * The three ways of saying "stop contacting me", separated again.
 *
 * The list page collapses them into one column. Here they stay apart, because
 * they are three different things: they clicked the link in an email, they
 * replied STOP to a text, or they were already on the do-not-contact list
 * before we reached them — which is not a decision they made about THIS
 * sequence at all.
 */
function exitDetail(run: SequenceRunRowForReport): string | null {
  switch (run.exitReason) {
    case "unsubscribed":
      return "Clicked unsubscribe in an email"
    case "sms_stop":
      return "Replied STOP to a text"
    case "suppressed":
      return "Was already on your do-not-contact list"
    case "payment":
      return "Bought something"
    case "booking":
      return "Booked a call"
    case null:
      return null
    default:
      return run.exitReason
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function SequenceRunsTable({ runs }: { runs: SequenceRunRowForReport[] }) {
  return (
    <DataTableCard>
      <DataTable>
        <DataTableHeader>
          <DataTableHead>Person</DataTableHead>
          <DataTableHead>Entered</DataTableHead>
          <DataTableHead>What happened</DataTableHead>
          <DataTableHead>Left on</DataTableHead>
        </DataTableHeader>
        <tbody>
          {runs.length === 0 ? (
            <DataTableEmpty colSpan={4}>Nobody has entered this sequence yet.</DataTableEmpty>
          ) : (
            runs.map((run) => {
              const detail = exitDetail(run)
              return (
                <DataTableRow key={run.id}>
                  <DataTableCell>
                    <Link href={`/admin/contacts/${run.contactId}`} className="text-primary hover:underline">
                      {run.contactName ?? run.contactEmail ?? "Someone with no name on file"}
                    </Link>
                    {run.contactName && run.contactEmail ? (
                      <div className="text-xs text-muted-foreground">{run.contactEmail}</div>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell muted>{formatDate(run.enteredAt)}</DataTableCell>
                  <DataTableCell>
                    <DataTableBadge tone={BUCKET_TONE[run.bucket]}>{BUCKET_LABEL[run.bucket]}</DataTableBadge>
                    {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
                  </DataTableCell>
                  <DataTableCell muted>{formatDate(run.completedAt)}</DataTableCell>
                </DataTableRow>
              )
            })
          )}
        </tbody>
      </DataTable>
    </DataTableCard>
  )
}
```

- [ ] **Step 2: Build the page**

Create `app/(admin)/admin/sequences/[key]/page.tsx`:

```tsx
// One sequence: its tally, and every person who entered it.
//
// Keyed by `key` rather than id so the URL reads
// /admin/sequences/new_lead_nurture — the same identifier every script uses.
//
// notFound() rather than an empty report when the key belongs to another
// business: an empty report would tell an operator that a sequence they can
// name has nobody in it, when the truth is that it is not theirs.

import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { DETAIL_PAGE_SIZE, sequenceDetail } from "@/lib/db/sequence-reporting"
import { SequenceRunsTable } from "@/components/admin/sequences/SequenceRunsTable"

export const metadata = { title: "Sequence" }
export const dynamic = "force-dynamic"

const SUMMARY: { key: "entered" | "in_progress" | "bought" | "booked" | "opted_out" | "finished" | "failed"; label: string }[] = [
  { key: "entered", label: "Entered" },
  { key: "in_progress", label: "Still going" },
  { key: "bought", label: "Bought" },
  { key: "booked", label: "Booked a call" },
  { key: "opted_out", label: "Opted out" },
  { key: "finished", label: "Reached the end" },
  { key: "failed", label: "Didn't send" },
]

export default async function SequenceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>
  searchParams: Promise<{ page?: string }>
}) {
  await requirePermission("contacts")
  const { businessId } = await resolveAdminTenant()
  const { key } = await params
  const { page } = await searchParams

  const pageNumber = Math.max(1, Number.parseInt(page ?? "1", 10) || 1)
  const offset = (pageNumber - 1) * DETAIL_PAGE_SIZE

  const detail = await sequenceDetail(businessId, key, { limit: DETAIL_PAGE_SIZE, offset })
  if (!detail) notFound()

  const totalPages = Math.max(1, Math.ceil(detail.totalRuns / DETAIL_PAGE_SIZE))

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/sequences"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-4" />
          All sequences
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-primary">{detail.name}</h1>
        {detail.description ? (
          <p className="mt-1 text-sm text-muted-foreground">{detail.description}</p>
        ) : null}
        <p className="mt-1 text-sm text-muted-foreground">
          {detail.stepCount === 1 ? "1 step" : `${detail.stepCount} steps`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {SUMMARY.map((item) => {
          const value = item.key === "entered" ? detail.entered : detail.buckets[item.key]
          return (
            <div key={item.key} className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="text-2xl font-semibold text-primary">{value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{item.label}</div>
            </div>
          )
        })}
      </div>

      {detail.buckets.other > 0 ? (
        <p className="text-sm text-muted-foreground">
          {detail.buckets.other} left for a reason this page does not have a name for yet. They are listed
          below with the raw reason.
        </p>
      ) : null}

      <SequenceRunsTable runs={detail.runs} />

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {pageNumber} of {totalPages}
          </span>
          <div className="flex gap-3">
            {pageNumber > 1 ? (
              <Link href={`/admin/sequences/${key}?page=${pageNumber - 1}`} className="text-primary hover:underline">
                Previous
              </Link>
            ) : null}
            {pageNumber < totalPages ? (
              <Link href={`/admin/sequences/${key}?page=${pageNumber + 1}`} className="text-primary hover:underline">
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Verify it compiles**

```bash
source ~/.nvm/nvm.sh && nvm use 24 && npx tsc --noEmit 2>&1 | grep "error TS" | sed 's/(.*//' | sort -u > /tmp/claude-501/tsc-after-seq-files.txt
diff /tmp/claude-501/tsc-baseline-seq-files.txt /tmp/claude-501/tsc-after-seq-files.txt
```

Expected: no new files in the error set. `diff` prints nothing.

- [ ] **Step 4: Run the touched suites**

```bash
source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run __tests__/lib/db/ __tests__/lib/permissions/ __tests__/lib/lead-engine/
```

Expected: green. `__tests__/lib/lead-engine/no-brand-literals.test.ts` and the tenancy inventory test must both still pass.

- [ ] **Step 5: Commit**

```bash
git add app/\(admin\)/admin/sequences components/admin/sequences
git commit -m "feat(lead-engine): the per-sequence detail page

Splits 'opted out' back into its three reasons, because an email
unsubscribe, a texted STOP and 'was already on the do-not-contact list'
are three different things — and the third is not a decision the person
made about this sequence at all.

404s rather than rendering an empty report for a key belonging to another
business."
```

---

### Task 7: Drive the real app and annotate the screenshots

**Files:**
- Create: `scripts/screenshot-sequence-reporting.mjs`
- Create: `screenshots/sequence-reporting/*.png`

- [ ] **Step 1: Start the dev server against the dev clone**

```bash
cd "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete-seq-reporting"
source ~/.nvm/nvm.sh && nvm use 24
npm run dev > /tmp/claude-501/dev-seq-reporting.log 2>&1 &
```

**Never pipe a long-running server to `head`** — it wedges, and every route then times out after having worked fine. Redirect to a log file, as above.

Wait for "Ready" in the log before driving it.

- [ ] **Step 2: Sign in as the owner and drive the real routes**

Use Playwright against `http://localhost:3050`. Sign in through the real login form — **not** a minted JWT — and assert the session landed before screenshotting, because an expired session renders as a feature failure that mimics the scariest real bug here.

Capture, at the real routes, in the real page chrome:

1. `/admin/sequences` — the list, showing the mix of on / paused / not-started and the plain-language "why is this empty" text.
2. `/admin/sequences/<a sequence with runs>` — the detail with a populated runs table and the summary tiles.
3. `/admin/sequences/<a sequence with none>` — the honest empty state.

The dev clone has the four quiz sequences active and at least one real run from the 2026-09-06 end-to-end test. If more outcomes are needed, produce them **by driving the real quiz flow** at `/quiz` with a real submission — never by writing rows.

- [ ] **Step 3: Burn the annotations into the PNGs**

Numbered markers and captions composed **into** the image file at the source capture's exact pixel width — never upscaled, never an HTML page drawing callouts around a clean shot. Derive marker positions from `boundingBox() × deviceScaleFactor`; warn loudly if a target selector matches nothing, and never let two markers resolve to one element.

- [ ] **Step 4: Verify by looking**

Open each PNG and confirm the annotations are present and land on the right elements. `ffprobe`/`sips` each for its real pixel dimensions. A screenshot nobody looked at is not evidence.

- [ ] **Step 5: Commit**

```bash
git add screenshots/sequence-reporting scripts/screenshot-sequence-reporting.mjs
git commit -m "docs(lead-engine): annotated shots of the sequence report, driven in the real app"
```

---

## Self-review notes

**Spec coverage:** §2 outcome axis → Task 1. §2.1 reason inventory → Task 1 comment + tests. §2.2 opted-out split → Tasks 4 and 6. §3 surfaces/conventions/permissions/nav → Task 5. §4 aggregation contract → Tasks 2–4. §4 consent count → Task 3. §5 empty-vs-failed states → Task 5 (`whyEmpty`) and the throwing tests in Tasks 2–4. §6 out-of-scope items appear in no task, by design. §7 testing → the mutation steps in Tasks 1–4 and Task 7.

**Known rough edge for the executor:** Task 4's paging test as written expects a `count` field the mock harness does not model, and the implementation derives `totalRuns` from the tally read instead. Task 4 Step 4 says explicitly to fix the test rather than add a redundant count query. This is the one place the plan expects the executor to change a test it was given, and it says so at the point of failure.
