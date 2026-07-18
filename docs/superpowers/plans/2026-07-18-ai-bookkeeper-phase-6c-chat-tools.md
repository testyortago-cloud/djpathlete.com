# AI Bookkeeper Phase 6c — Ask-Your-Books Chat Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four read-only bookkeeping tools in the admin AI chat (`bookkeeping_summary`, `bookkeeping_income_by_service`, `bookkeeping_top_vendors`, `bookkeeping_find_entries`) so Darren can ask his books questions in `/admin/ai-assistant` — every answer self-cites book name(s) + window, money stays integer cents, aggregates hard-stop at 20,000 rows with an explicit `partial` flag, and nothing writes. Zero migrations, zero flags, zero app-side routes.

**Architecture:** The tools follow the 18-tool house pattern in `functions/src/ai/admin-tools.ts` — raw JSON-Schema declarations in `ADMIN_TOOLS`, a `switch` case in `executeAdminTool(name, input): Promise<string>` returning a JSON string, a `TOOL_LABELS` entry for the UI activity line. Aggregation math lives twice (functions/ cannot import lib/): the lib side gains a pure `topCounterparties` in `lib/bookkeeping/reports.ts`; the functions side gets zero-import twins in `functions/src/lib/bookkeeping-aggregate.ts` (summary totals + service-line rollup + counterparty rollup) plus a `maxRows`-hard-stop `fetchAllRows` twin in `functions/src/lib/paginate.ts`. A root-side fixture-parity test (the `statement-schema-parity` cross-import precedent) pins lib fns and twins to identical outputs. Transport is **Firestore** `onSnapshot` (`hooks/use-ai-job.ts`) — nulls survive; no RTDB null-drop defenses anywhere in 6c.

**Tech Stack:** Firebase Functions (`functions/tsconfig.json`: `module: "ESNext"` + `moduleResolution: "bundler"`, `type: "module"` at runtime — Node's ESM loader requires functions-internal imports to end in the `.js` extension even though tsc's bundler resolution wouldn't otherwise demand it), `@supabase/supabase-js` service-role via `functions/src/lib/supabase.ts:getSupabase()`, Anthropic tool-use via `streamWithTools`, Vitest twice (root config + `functions/vitest.config.ts`).

**Spec:** `docs/superpowers/specs/2026-07-18-ai-bookkeeper-phase-6-design.md` §5 (stack facts §5, tool table §5.1, twins + parity §5.2, D-11, honesty §7).

## Global Constraints

- Branch `feat/ai-bookkeeper-phase-6` (already checked out). Commit per task. NEVER push. Never stage the pre-existing dirty files (`render-worker/*`, `docs/superpowers/2026-07-18-*-kickoff-prompt.md`, `docs/superpowers/plans/2026-06-04-reel-no-audio-support.md`, `exercise-library-match.csv`, `step-up-for-students.html`, `JOURNAL.md`).
- **6c ships NO migration, NO feature flag, NO app-side route, NO audit slug, NO UI change.** The only lib/ change is `topCounterparties` in `reports.ts`. Tools are functions-side reads; `recordAudit`/`withAudit` do not apply (no Next.js route is touched).
- **functions/ cannot import lib/** (`functions/tsconfig.json` `rootDir: "src"`) — twins only. Every functions-internal import ends in `.js` (ESNext modules + `moduleResolution: "bundler"` at compile time, Node ESM runtime), e.g. `import { getSupabase } from "../lib/supabase.js"`.
- **The two twin files must import NOTHING** (no lib, no node builtins, no npm). The root parity test relative-imports them across the package boundary (`statement-schema-parity` precedent, `__tests__/lib/bookkeeping/statement-schema-parity.test.ts:2-6`) and any dependency breaks that.
- Integer cents everywhere. 6c defines **no rounding point** — any `Math.round`/`Math.trunc` on money in new code is a defect. The only cents→dollars conversion happens in the model's prose, steered by the cents note every result carries.
- **No tool writes.** Any `.insert(`/`.update(`/`.upsert(`/`.delete(`/`.rpc(` in the new code is a defect (grep-gated in Task 5).
- Every result JSON carries `book_name` (or `book_names`) + `from`/`to` + the cents note. Aggregate reads go through the paginated fetch-all with the 20,000-row hard stop → `partial: true` + explicit note; never a bare `.select()` (silent ~1000-row PostgREST cap). `bookkeeping_find_entries` gets `total_count` via `count: "exact"` (rows+count precedent `lib/db/bookkeeping.ts:84-90`; head-only precedent `admin-tools.ts:1308-1313`).
- Book resolution is case-insensitive on name; unknown name returns `{ error, available_books }` — the model corrects itself, it never guesses. Default window is calendar YTD (Jan 1 → today, UTC date strings).
- Errors inside a tool return `{ error: "..." }` JSON strings; unexpected throws are caught by `executeAdminTool`'s existing top-level catch (`admin-tools.ts:315-318`) which reports `Error executing …` back to the model — never crashes the stream.
- Tests: lib pure logic → `__tests__/lib/bookkeeping/` with ZERO mocks; functions tests → `functions/src/__tests__/*.test.ts` (flat dir, `functions/vitest.config.ts` include `src/**/__tests__/**`; run with `cd functions && npx vitest run …` — cwd resets between shell calls, so EVERY functions command re-`cd`s); parity test at root. NEVER `__tests__/db/`. RFC-4122 mnemonic fixture UUIDs (`b…`/`a…`/`e…` prefixes, version nibble 4, variant 8).
- Verification: scoped vitest globs; `npm run build` (root) and `cd functions && npm run build` each as their OWN command, never chained behind a test run with `&&` (known-red baseline exits non-zero and silently skips the build).
- Before writing code that calls an existing helper, READ the helper's real signature in source — do not trust this plan's memory of it (standing lesson: plans have shipped wrong shapes 5 phases running).
- **Shell:** this environment's primary shell is PowerShell 5.1, where `&&` is a parser error. Run every `cd … && …` command in this plan (all `cd functions && …` commands in Tasks 2, 3, and 5) via the Bash tool (POSIX sh), never PowerShell. For the Task 5 Step 5 grep gates, prefer the executor's Grep tool (or a plain `rg` on PATH) over `npx rg` — npx's PATH-fallback resolution isn't guaranteed to find a ripgrep binary.

Verified anchors used below (re-check on contact): `executeAdminTool` at `functions/src/ai/admin-tools.ts:273`, `ADMIN_TOOLS` closes at :246, `TOOL_LABELS` at :250-269, `switch` `default:` at :312; `SYSTEM_PROMPT` template literal at `functions/src/admin-chat.ts:11-38`; `getSupabase(): SupabaseClient` at `functions/src/lib/supabase.ts:5`; lib paginator `fetchAllRows(buildQuery, pageSize = 1000)` at `lib/db/paginate.ts:9`; `incomeByServiceLine` at `lib/bookkeeping/reports.ts:61`, `perBookSummary` at :120, `SERVICE_LINE_LABELS` at :48; `normalizeCounterparty` at `lib/bookkeeping/insight-types.ts:19` (that file imports only TYPES from reports.ts — line 4 — so reports.ts may runtime-import it without a cycle); ilike escape idiom at `lib/db/bookkeeping.ts:73-76`; functions supabase-mock idiom at `functions/src/__tests__/social-outcome-tracker.test.ts:3`.

---

### Task 1: `topCounterparties` pure rollup in `lib/bookkeeping/reports.ts`

**Files:**
- Modify: `lib/bookkeeping/reports.ts` (append; hoist one import)
- Test: `__tests__/lib/bookkeeping/top-counterparties.test.ts` (new file — do NOT touch the existing `reports.test.ts` fixtures)

**Interfaces:**
- Consumes: `ReportEntry`, `LedgerDirection` (already imported in reports.ts); `normalizeCounterparty` from `./insight-types` (safe: insight-types has only `import type` from reports — no runtime cycle).
- Produces (Task 2's twin and Task 4's parity test mirror these EXACT names/shapes): `CounterpartyRow { counterparty: string | null; total_cents: number; entry_count: number }`, `topCounterparties(entries: ReportEntry[], opts: { direction: LedgerDirection; limit: number }): CounterpartyRow[]`.

**Pinned semantics (spec §5.1/§5.2):** filter to `opts.direction`; group by normalized counterparty (blank/missing → the shared null bucket); sum `amount_cents` magnitudes (single direction — no sign mixing) and count entries; sort total desc, tie-break name asc with the null bucket last (the deduction-finder `top_counterparties` comparator, verbatim); slice to `limit` AFTER sorting, with `limit` clamped `Math.max(0, Math.floor(limit))` so 0/negative → `[]` (never `slice(0, -1)`).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/bookkeeping/top-counterparties.test.ts
import { describe, expect, it } from "vitest"
import { topCounterparties, type ReportEntry } from "@/lib/bookkeeping/reports"

const BOOK = "b0000000-0000-4000-8000-000000000001"

function entry(over: Partial<ReportEntry>): ReportEntry {
  return {
    book_id: BOOK,
    account_id: null,
    direction: "expense",
    amount_cents: 1000,
    occurred_on: "2026-03-01",
    counterparty: null,
    memo: null,
    source: "manual",
    ...over,
  }
}

describe("topCounterparties", () => {
  it("groups by normalized counterparty, sums cents, counts entries, sorts total desc", () => {
    const rows = topCounterparties(
      [
        entry({ counterparty: " Rogue  Fitness ", amount_cents: 500 }),
        entry({ counterparty: "rogue fitness", amount_cents: 400 }),
        entry({ counterparty: "Amazon", amount_cents: 800 }),
        entry({ counterparty: "Titan", amount_cents: 700 }),
      ],
      { direction: "expense", limit: 10 },
    )
    expect(rows).toEqual([
      { counterparty: "rogue fitness", total_cents: 900, entry_count: 2 },
      { counterparty: "amazon", total_cents: 800, entry_count: 1 },
      { counterparty: "titan", total_cents: 700, entry_count: 1 },
    ])
  })

  it("filters to the requested direction (income ranks payers, not vendors)", () => {
    const entries = [
      entry({ direction: "income", counterparty: "Stripe", amount_cents: 50000 }),
      entry({ counterparty: "Rogue", amount_cents: 800 }),
    ]
    expect(topCounterparties(entries, { direction: "income", limit: 10 })).toEqual([
      { counterparty: "stripe", total_cents: 50000, entry_count: 1 },
    ])
    expect(topCounterparties(entries, { direction: "expense", limit: 10 })).toEqual([
      { counterparty: "rogue", total_cents: 800, entry_count: 1 },
    ])
  })

  it("blank/whitespace counterparties group into the null bucket", () => {
    const rows = topCounterparties(
      [entry({ counterparty: null, amount_cents: 700 }), entry({ counterparty: "   ", amount_cents: 300 })],
      { direction: "expense", limit: 10 },
    )
    expect(rows).toEqual([{ counterparty: null, total_cents: 1000, entry_count: 2 }])
  })

  describe("topCounterparties — pinned invariant discrimination", () => {
    it("equal totals tie-break name asc with the null bucket last (mutation: null-first or insertion order)", () => {
      const rows = topCounterparties(
        [
          entry({ counterparty: "beta", amount_cents: 500 }),
          entry({ counterparty: null, amount_cents: 500 }),
          entry({ counterparty: "alpha", amount_cents: 500 }),
        ],
        { direction: "expense", limit: 10 },
      )
      expect(rows.map((r) => r.counterparty)).toEqual(["alpha", "beta", null])
    })

    it("limit slices AFTER sorting (mutation: slice-before-sort keeps the wrong row)", () => {
      const rows = topCounterparties(
        [entry({ counterparty: "small", amount_cents: 100 }), entry({ counterparty: "big", amount_cents: 900 })],
        { direction: "expense", limit: 1 },
      )
      expect(rows).toEqual([{ counterparty: "big", total_cents: 900, entry_count: 1 }])
    })

    it("limit 0 and negative limits yield [] (mutation: raw slice(0, -1) drops only the last row)", () => {
      const entries = [entry({ counterparty: "a" }), entry({ counterparty: "b" })]
      expect(topCounterparties(entries, { direction: "expense", limit: 0 })).toEqual([])
      expect(topCounterparties(entries, { direction: "expense", limit: -1 })).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/top-counterparties.test.ts`
Expected: FAIL — `topCounterparties` is not exported from `@/lib/bookkeeping/reports`.

- [ ] **Step 3: Write the implementation**

Hoist this import to the top of `lib/bookkeeping/reports.ts`, directly under the existing `import type { BookkeepingBook, ... }` line:

```ts
// insight-types imports only TYPES from this file (insight-types.ts:4), so this
// runtime import cannot form a cycle — one lib-side normalizer, not a third copy.
import { normalizeCounterparty } from "./insight-types"
```

Append at the end of `lib/bookkeeping/reports.ts`:

```ts
// ── Counterparty rollup (Phase 6c — chat tools; reusable by future UI) ──────
// Twin: functions/src/lib/bookkeeping-aggregate.ts — keep in lockstep; the
// fixture-parity test (__tests__/lib/bookkeeping/chat-tools-parity.test.ts)
// pins the two to identical outputs.

export interface CounterpartyRow {
  counterparty: string | null
  total_cents: number
  entry_count: number
}

/** Rank counterparties for ONE direction by total cents. Grouping key is the
 *  normalized (trim/lowercase/collapse-ws) name; blank/missing names share the
 *  null bucket. Sort: total desc, tie name asc with null last. Sliced to
 *  `limit` AFTER sorting; limit ≤ 0 → empty (clamped — never slice(0, -1)). */
export function topCounterparties(
  entries: ReportEntry[],
  opts: { direction: LedgerDirection; limit: number },
): CounterpartyRow[] {
  const limit = Math.max(0, Math.floor(opts.limit))
  const buckets = new Map<string | null, CounterpartyRow>()
  for (const e of entries) {
    if (e.direction !== opts.direction) continue
    const key = normalizeCounterparty(e.counterparty)
    const row = buckets.get(key) ?? { counterparty: key, total_cents: 0, entry_count: 0 }
    row.total_cents += e.amount_cents
    row.entry_count += 1
    buckets.set(key, row)
  }
  return [...buckets.values()]
    .sort((a, b) => {
      if (b.total_cents !== a.total_cents) return b.total_cents - a.total_cents
      if (a.counterparty === null) return 1
      if (b.counterparty === null) return -1
      return a.counterparty.localeCompare(b.counterparty)
    })
    .slice(0, limit)
}
```

(`Math.floor` here clamps a junk fractional limit, not money — the no-rounding-on-money constraint is untouched.)

- [ ] **Step 4: Run test to verify it passes (and the existing reports suite stayed green)**

Run: `npx vitest run __tests__/lib/bookkeeping/top-counterparties.test.ts __tests__/lib/bookkeeping/reports.test.ts __tests__/lib/bookkeeping/insight-types.test.ts`
Expected: PASS (all three files).

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/reports.ts __tests__/lib/bookkeeping/top-counterparties.test.ts
git commit -m "feat(bookkeeper): topCounterparties pure rollup in reports.ts"
```

---

### Task 2: functions-side twins — hard-stop paginator + aggregate math

**Files:**
- Create: `functions/src/lib/paginate.ts`
- Create: `functions/src/lib/bookkeeping-aggregate.ts`
- Test: `functions/src/__tests__/paginate.test.ts`
- Test: `functions/src/__tests__/bookkeeping-aggregate.test.ts`

**Interfaces:**
- `paginate.ts` produces: `FetchAllResult<T> { rows: T[]; partial: boolean }`, `fetchAllRows<T>(buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, maxRows: number, pageSize = 1000): Promise<FetchAllResult<T>>` — the lib paginator's builder contract (`lib/db/paginate.ts:9-11`) with a REQUIRED `maxRows` second parameter and a `{rows, partial}` result instead of a bare array.
- `bookkeeping-aggregate.ts` produces (names identical to the lib originals for grep-ability; Task 3 imports these, Task 4 parity-pins them): `LedgerDirection`, `AggEntry`, `AggAccount`, `AggBook`, `ServiceLineRow`, `IncomeByServiceLine`, `BookSummaryRow`, `CounterpartyRow`, `SERVICE_LINE_LABELS`, `perBookSummary(entries, books)`, `incomeByServiceLine(entries, accounts)`, `topCounterparties(entries, opts)`.
- Both files import NOTHING (Global Constraints — the parity cross-import depends on it).

**Pinned hard-stop semantics (D-11; tests assert these exact branches):** pages accumulate until (a) `all.length > maxRows` → return the first `maxRows` rows, `partial: true` (a short final page can overshoot); (b) `all.length === maxRows` AND the last page was FULL → `partial: true` (cannot prove completeness without another fetch — honest cap); (c) short page otherwise → `partial: false` (includes the exactly-maxRows-and-exhausted case). Errors throw `new Error(error.message)`. Row order preserved.

- [ ] **Step 1: Write the failing tests**

```ts
// functions/src/__tests__/paginate.test.ts
import { describe, expect, it } from "vitest"
import { fetchAllRows } from "../lib/paginate.js"

/** Simulates a DB table: buildQuery slices [from, to] out of `rows`. */
function pagesOf<T>(rows: T[]) {
  return (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null })
}

const SEVEN = [1, 2, 3, 4, 5, 6, 7]

describe("fetchAllRows (functions twin with maxRows hard stop)", () => {
  it("fetches every page and preserves order when under the cap", async () => {
    const r = await fetchAllRows(pagesOf(SEVEN), 100, 3)
    expect(r).toEqual({ rows: [1, 2, 3, 4, 5, 6, 7], partial: false })
  })

  it("empty source → empty rows, partial false", async () => {
    expect(await fetchAllRows(pagesOf([]), 100, 3)).toEqual({ rows: [], partial: false })
  })

  it("throws the builder error message", async () => {
    const failing = () => Promise.resolve({ data: null, error: { message: "boom" } })
    await expect(fetchAllRows(failing, 100, 3)).rejects.toThrow("boom")
  })

  describe("hard stop — pinned invariant discrimination", () => {
    it("overshooting page is sliced to exactly maxRows with partial true (mutation: missing slice or off-by-one)", async () => {
      // pages of 3 → after page 2 all=6 > maxRows 5 → first 5 rows only
      const r = await fetchAllRows(pagesOf(SEVEN), 5, 3)
      expect(r).toEqual({ rows: [1, 2, 3, 4, 5], partial: true })
    })

    it("exactly maxRows via a SHORT final page is complete → partial false (mutation: >= instead of > at the boundary)", async () => {
      // 5 rows, pages of 3 → page 2 returns 2 (short) → data exhausted at exactly the cap
      const r = await fetchAllRows(pagesOf([1, 2, 3, 4, 5]), 5, 3)
      expect(r).toEqual({ rows: [1, 2, 3, 4, 5], partial: false })
    })

    it("exactly maxRows via a FULL final page reports partial true (pinned: no extra probe fetch)", async () => {
      // 6 rows, pages of 3, maxRows 6 → page 2 is full → cannot prove completeness → honest cap
      const r = await fetchAllRows(pagesOf([1, 2, 3, 4, 5, 6]), 6, 3)
      expect(r).toEqual({ rows: [1, 2, 3, 4, 5, 6], partial: true })
    })

    it("terminates against an endless source (mutation: dropped hard stop = infinite loop)", async () => {
      const endless = (from: number, to: number) =>
        Promise.resolve({ data: Array.from({ length: to - from + 1 }, (_, i) => from + i), error: null })
      const r = await fetchAllRows(endless, 10, 4)
      expect(r.partial).toBe(true)
      expect(r.rows).toHaveLength(10)
      expect(r.rows[9]).toBe(9)
    })
  })
})
```

```ts
// functions/src/__tests__/bookkeeping-aggregate.test.ts
import { describe, expect, it } from "vitest"
import {
  incomeByServiceLine,
  perBookSummary,
  topCounterparties,
  type AggAccount,
  type AggEntry,
} from "../lib/bookkeeping-aggregate.js"

const BOOK_A = "b0000000-0000-4000-8000-000000000001"
const BOOK_B = "b0000000-0000-4000-8000-000000000002"
const BOOK_DEAD = "b0000000-0000-4000-8000-00000000dead"
const ACC_PT = "a0000000-0000-4000-8000-000000000001" // income, performance_training
const ACC_NOLINE = "a0000000-0000-4000-8000-000000000002" // income, no service line → "other"

const books = [
  { id: BOOK_A, name: "Darren — DJP Athlete", book_kind: "business" },
  { id: BOOK_B, name: "Household & Personal", book_kind: "household" },
]
const accounts: AggAccount[] = [
  { id: ACC_PT, service_line: "performance_training" },
  { id: ACC_NOLINE, service_line: null },
]

function entry(over: Partial<AggEntry>): AggEntry {
  return { book_id: BOOK_A, account_id: null, direction: "expense", amount_cents: 1000, counterparty: null, ...over }
}

describe("perBookSummary (twin)", () => {
  it("nets income − expense per book, skips unlisted books, zero-fills empty books", () => {
    const r = perBookSummary(
      [
        entry({ direction: "income", amount_cents: 500 }),
        entry({ direction: "expense", amount_cents: 200 }),
        entry({ book_id: BOOK_DEAD, amount_cents: 99999 }), // not in books → skipped
      ],
      books,
    )
    // mutation discriminators: sign-flip (net −300 or 700) and dropped skip (count 3)
    expect(r).toEqual([
      { book_id: BOOK_A, name: "Darren — DJP Athlete", book_kind: "business", income_cents: 500, expense_cents: 200, net_cents: 300, entry_count: 2 },
      { book_id: BOOK_B, name: "Household & Personal", book_kind: "household", income_cents: 0, expense_cents: 0, net_cents: 0, entry_count: 0 },
    ])
  })
})

describe("incomeByServiceLine (twin)", () => {
  it("income only; no-line account folds into 'other'; unknown/null account is the null Uncategorized bucket; sorts total desc", () => {
    const r = incomeByServiceLine(
      [
        entry({ direction: "income", account_id: ACC_PT, amount_cents: 50000 }),
        entry({ direction: "income", account_id: ACC_NOLINE, amount_cents: 20000 }),
        entry({ direction: "income", account_id: "a0000000-0000-4000-8000-00000000dead", amount_cents: 700 }),
        entry({ direction: "expense", account_id: ACC_PT, amount_cents: 99999 }), // excluded
      ],
      accounts,
    )
    expect(r).toEqual({
      rows: [
        { service_line: "performance_training", label: "Performance Training", total_cents: 50000, entry_count: 1 },
        { service_line: "other", label: "Other", total_cents: 20000, entry_count: 1 },
        { service_line: null, label: "Uncategorized", total_cents: 700, entry_count: 1 },
      ],
      total_cents: 70700,
    })
  })
})

describe("topCounterparties (twin)", () => {
  it("normalized merge + tie-break (name asc, null last) + post-sort clamped limit", () => {
    const rows = topCounterparties(
      [
        entry({ counterparty: " Rogue  Fitness ", amount_cents: 500 }),
        entry({ counterparty: "rogue fitness", amount_cents: 400 }),
        entry({ counterparty: "beta", amount_cents: 800 }),
        entry({ counterparty: null, amount_cents: 800 }),
        entry({ counterparty: "alpha", amount_cents: 800 }),
      ],
      { direction: "expense", limit: 4 },
    )
    expect(rows).toEqual([
      { counterparty: "rogue fitness", total_cents: 900, entry_count: 2 },
      { counterparty: "alpha", total_cents: 800, entry_count: 1 },
      { counterparty: "beta", total_cents: 800, entry_count: 1 },
      { counterparty: null, total_cents: 800, entry_count: 1 },
    ])
    expect(topCounterparties([entry({})], { direction: "expense", limit: -1 })).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx vitest run src/__tests__/paginate.test.ts src/__tests__/bookkeeping-aggregate.test.ts`
Expected: FAIL — cannot resolve `../lib/paginate.js` / `../lib/bookkeeping-aggregate.js`.

- [ ] **Step 3: Write the implementations**

```ts
// functions/src/lib/paginate.ts
// Twin of lib/db/paginate.ts's fetchAllRows (functions/ cannot import lib/),
// with one addition for chat tools: a REQUIRED maxRows hard stop, because a
// tool result feeds straight back into the model — it must never balloon and
// must never silently truncate (D-11: partial is explicit, never implied).
// MUST import nothing: the root-side parity/consumer tests relative-import
// sibling files in this directory across the package boundary.

const DEFAULT_PAGE_SIZE = 1000

export interface FetchAllResult<T> {
  rows: T[]
  partial: boolean
}

export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maxRows: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<FetchAllResult<T>> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await buildQuery(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    all.push(...batch)
    const exhausted = batch.length < pageSize
    // Overshoot (a short final page may land past the cap): keep the first maxRows.
    if (all.length > maxRows) return { rows: all.slice(0, maxRows), partial: true }
    // Landed exactly on the cap off a FULL page: completeness unprovable without
    // another fetch — report the cap honestly rather than probe.
    if (all.length === maxRows && !exhausted) return { rows: all, partial: true }
    if (exhausted) return { rows: all, partial: false }
    from += pageSize
  }
}
```

```ts
// functions/src/lib/bookkeeping-aggregate.ts
// Twin of the pure aggregation math in lib/bookkeeping/reports.ts
// (perBookSummary, incomeByServiceLine, topCounterparties, SERVICE_LINE_LABELS)
// plus the normalizeCounterparty helper from lib/bookkeeping/insight-types.ts.
// functions/ cannot import lib/ (tsconfig rootDir "src") — hand-maintained twin.
// MUST import nothing: __tests__/lib/bookkeeping/chat-tools-parity.test.ts
// relative-imports this file under the ROOT vitest config (the
// statement-schema-parity precedent), which only works while it is
// dependency-free. Keep in lockstep with the lib originals — the parity test
// pins identical fixtures to deep-equal outputs.

export type LedgerDirection = "income" | "expense"

/** Slim ledger row — the columns the aggregators read. Wider fetch rows are
 *  structurally assignable. amount_cents is a magnitude; direction carries sign. */
export interface AggEntry {
  book_id: string
  account_id: string | null
  direction: LedgerDirection
  amount_cents: number
  counterparty: string | null
}

export interface AggAccount {
  id: string
  service_line: string | null
}

export interface AggBook {
  id: string
  name: string
  book_kind: string
}

export interface ServiceLineRow {
  service_line: string | null
  label: string
  total_cents: number
  entry_count: number
}

export interface IncomeByServiceLine {
  rows: ServiceLineRow[]
  total_cents: number
}

export interface BookSummaryRow {
  book_id: string
  name: string
  book_kind: string
  income_cents: number
  expense_cents: number
  net_cents: number
  entry_count: number
}

export interface CounterpartyRow {
  counterparty: string | null
  total_cents: number
  entry_count: number
}

// Twin of lib/bookkeeping/reports.ts SERVICE_LINE_LABELS — parity-pinned.
export const SERVICE_LINE_LABELS: Record<string, string> = {
  performance_training: "Performance Training",
  session_packs: "Session Packs",
  camps: "Camps & Clinics",
  teams_center: "Teams / Center Work",
  memberships: "Memberships",
  shop: "Shop",
  other: "Other",
}

/** Twin of lib/bookkeeping/insight-types.ts normalizeCounterparty. */
function normalizeCounterparty(raw: string | null): string | null {
  if (!raw) return null
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ")
  return normalized === "" ? null : normalized
}

/** Twin of lib/bookkeeping/reports.ts perBookSummary. net = income − expense
 *  is the only subtraction; entries for unlisted books are skipped. */
export function perBookSummary(entries: AggEntry[], books: AggBook[]): BookSummaryRow[] {
  const rows: BookSummaryRow[] = books.map((b) => ({
    book_id: b.id, name: b.name, book_kind: b.book_kind,
    income_cents: 0, expense_cents: 0, net_cents: 0, entry_count: 0,
  }))
  const byId = new Map(rows.map((r) => [r.book_id, r]))
  for (const e of entries) {
    const s = byId.get(e.book_id)
    if (!s) continue
    if (e.direction === "income") s.income_cents += e.amount_cents
    else s.expense_cents += e.amount_cents
    s.entry_count += 1
  }
  for (const s of rows) s.net_cents = s.income_cents - s.expense_cents
  return rows
}

/** Twin of lib/bookkeeping/reports.ts incomeByServiceLine. Account without a
 *  service line folds into "other"; no/unknown account is the null
 *  Uncategorized bucket. Sort total desc, tie label asc. */
export function incomeByServiceLine(entries: AggEntry[], accounts: AggAccount[]): IncomeByServiceLine {
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const buckets = new Map<string | null, ServiceLineRow>()
  let total = 0
  for (const e of entries) {
    if (e.direction !== "income") continue
    const account = e.account_id ? accountById.get(e.account_id) : undefined
    const line = account ? (account.service_line ?? "other") : null
    const row = buckets.get(line) ?? {
      service_line: line,
      label: line === null ? "Uncategorized" : (SERVICE_LINE_LABELS[line] ?? line),
      total_cents: 0,
      entry_count: 0,
    }
    row.total_cents += e.amount_cents
    row.entry_count += 1
    buckets.set(line, row)
    total += e.amount_cents
  }
  return {
    rows: [...buckets.values()].sort(
      (a, b) => b.total_cents - a.total_cents || a.label.localeCompare(b.label),
    ),
    total_cents: total,
  }
}

/** Twin of lib/bookkeeping/reports.ts topCounterparties (Task 1) — same
 *  normalize/sort/tie/clamp rules; see the lib docstring. */
export function topCounterparties(
  entries: AggEntry[],
  opts: { direction: LedgerDirection; limit: number },
): CounterpartyRow[] {
  const limit = Math.max(0, Math.floor(opts.limit))
  const buckets = new Map<string | null, CounterpartyRow>()
  for (const e of entries) {
    if (e.direction !== opts.direction) continue
    const key = normalizeCounterparty(e.counterparty)
    const row = buckets.get(key) ?? { counterparty: key, total_cents: 0, entry_count: 0 }
    row.total_cents += e.amount_cents
    row.entry_count += 1
    buckets.set(key, row)
  }
  return [...buckets.values()]
    .sort((a, b) => {
      if (b.total_cents !== a.total_cents) return b.total_cents - a.total_cents
      if (a.counterparty === null) return 1
      if (b.counterparty === null) return -1
      return a.counterparty.localeCompare(b.counterparty)
    })
    .slice(0, limit)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx vitest run src/__tests__/paginate.test.ts src/__tests__/bookkeeping-aggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/paginate.ts functions/src/lib/bookkeeping-aggregate.ts functions/src/__tests__/paginate.test.ts functions/src/__tests__/bookkeeping-aggregate.test.ts
git commit -m "feat(bookkeeper): functions-side paginate hard-stop twin + bookkeeping aggregate twins"
```

---

### Task 3: The 4 tools in `functions/src/ai/admin-tools.ts`

**Files:**
- Modify: `functions/src/ai/admin-tools.ts` (declarations into `ADMIN_TOOLS`, labels into `TOOL_LABELS`, cases into `executeAdminTool`'s switch, helpers + implementations appended at end of file)
- Test: `functions/src/__tests__/admin-tools-bookkeeping.test.ts`

**Interfaces:**
- Consumes: `getSupabase` from `../lib/supabase.js` (already imported at admin-tools.ts:2); `fetchAllRows` from `../lib/paginate.js` and `incomeByServiceLine`/`perBookSummary`/`topCounterparties` from `../lib/bookkeeping-aggregate.js` (Task 2).
- Produces: tool names `bookkeeping_summary`, `bookkeeping_income_by_service`, `bookkeeping_top_vendors`, `bookkeeping_find_entries` — all reachable ONLY via `executeAdminTool`; no new exports.

**Pinned semantics (spec §5.1):** limits clamp (`top_vendors` ≤ 20 default 10; `find_entries` ≤ 50 default 20, `offset` ≥ 0 default 0 — all `Number.isFinite`-defended); direction default `expense` for `top_vendors`, optional filter for `find_entries`, junk direction → `{error}`; default window YTD; `book` omitted ⇒ all books for summary/top_vendors/find_entries but the PRIMARY BUSINESS book for income_by_service (mirrors the print report's primary-book-only income-by-service section — `app/(admin)/admin/books/reports/print/page.tsx:139-143`; the interactive reports API at `app/api/admin/bookkeeping/reports/route.ts:24` computes it per-book instead, which is not the precedent being followed here); aggregate reads through the 20,000 hard stop; ilike escape copied from `lib/db/bookkeeping.ts:73-76` verbatim.

- [ ] **Step 1: Write the failing executor tests**

```ts
// functions/src/__tests__/admin-tools-bookkeeping.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/supabase.js", () => ({ getSupabase: vi.fn() }))

import { ADMIN_TOOLS, TOOL_LABELS, executeAdminTool } from "../ai/admin-tools.js"
import { getSupabase } from "../lib/supabase.js"

const BOOK_BIZ = "b0000000-0000-4000-8000-000000000001"
const BOOK_HH = "b0000000-0000-4000-8000-000000000002"
const ACC_PT = "a0000000-0000-4000-8000-000000000001"

const BOOKS = [
  { id: BOOK_BIZ, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true },
  { id: BOOK_HH, name: "Household & Personal", book_kind: "household", is_primary: false },
]
const ACCOUNTS = [{ id: ACC_PT, name: "Performance Training", service_line: "performance_training" }]

type ChainResult = { data?: unknown; error?: unknown; count?: number | null }

/** Thenable self-chaining supabase query stub (house idiom: social-outcome-tracker.test.ts).
 *  `resolve` sees the LAST .range(from, to) so the paginate loop gets real pages. */
function chain(resolve: (from: number, to: number) => ChainResult) {
  let f = 0
  let t = 999
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {}
  for (const m of ["select", "is", "eq", "gte", "lte", "or", "order", "limit"]) c[m] = vi.fn(() => c)
  c.range = vi.fn((from: number, to: number) => {
    f = from
    t = to
    return c
  })
  c.then = (onFulfilled: (v: ChainResult) => unknown) =>
    Promise.resolve({ data: null, error: null, count: null, ...resolve(f, t) }).then(onFulfilled)
  return c
}

function entryRow(over: Record<string, unknown> = {}) {
  return {
    book_id: BOOK_BIZ,
    account_id: ACC_PT,
    direction: "expense",
    amount_cents: 1000,
    occurred_on: "2026-03-01",
    counterparty: "Rogue Fitness",
    memo: null,
    source: "manual",
    ...over,
  }
}

function mockSupabase(tables: Record<string, ReturnType<typeof chain>>) {
  ;(getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn((table: string) => {
      const c = tables[table]
      if (!c) throw new Error(`unexpected table ${table}`)
      return c
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-07-18T12:00:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

describe("bookkeeping tool declarations", () => {
  it("declares all 4 tools in ADMIN_TOOLS with TOOL_LABELS entries", () => {
    const names = ADMIN_TOOLS.map((tool) => tool.name)
    for (const n of [
      "bookkeeping_summary",
      "bookkeeping_income_by_service",
      "bookkeeping_top_vendors",
      "bookkeeping_find_entries",
    ]) {
      expect(names).toContain(n)
      expect(TOOL_LABELS[n]).toBeTruthy()
    }
  })
})

describe("bookkeeping_summary", () => {
  it("unknown book name → available names, never a guess", async () => {
    mockSupabase({ bookkeeping_books: chain(() => ({ data: BOOKS })) })
    const out = JSON.parse(await executeAdminTool("bookkeeping_summary", { book: "Bizness" }))
    expect(out.error).toContain('Unknown book "Bizness"')
    expect(out.available_books).toEqual(["Darren — DJP Athlete", "Household & Personal"])
    expect(out.books).toBeUndefined()
  })

  it("defaults to calendar YTD, self-cites window + per-book names, exact cents math", async () => {
    const entries = [
      entryRow({ direction: "income", amount_cents: 50000 }),
      entryRow({ direction: "expense", amount_cents: 12500 }),
      entryRow({ book_id: BOOK_HH, direction: "expense", amount_cents: 200000 }),
    ]
    const entriesChain = chain(() => ({ data: entries }))
    mockSupabase({ bookkeeping_books: chain(() => ({ data: BOOKS })), bookkeeping_ledger_entries: entriesChain })
    const out = JSON.parse(await executeAdminTool("bookkeeping_summary", {}))
    expect(out.from).toBe("2026-01-01")
    expect(out.to).toBe("2026-07-18")
    expect(entriesChain.gte).toHaveBeenCalledWith("occurred_on", "2026-01-01")
    expect(entriesChain.lte).toHaveBeenCalledWith("occurred_on", "2026-07-18")
    // mutation discriminator: sign-flip nets −37500 / 62500; cross-book leak changes either row
    expect(out.books).toEqual([
      { book_name: "Darren — DJP Athlete", book_kind: "business", income_cents: 50000, expense_cents: 12500, net_cents: 37500, entry_count: 2 },
      { book_name: "Household & Personal", book_kind: "household", income_cents: 0, expense_cents: 200000, net_cents: -200000, entry_count: 1 },
    ])
    expect(out.partial).toBe(false)
    expect(out.note).toContain("integer cents")
  })

  it("book filter resolves case-insensitively and scopes the query to that book", async () => {
    const entriesChain = chain(() => ({ data: [entryRow({ direction: "income", amount_cents: 700 })] }))
    mockSupabase({ bookkeeping_books: chain(() => ({ data: BOOKS })), bookkeeping_ledger_entries: entriesChain })
    const out = JSON.parse(await executeAdminTool("bookkeeping_summary", { book: "darren — djp athlete" }))
    expect(entriesChain.eq).toHaveBeenCalledWith("book_id", BOOK_BIZ)
    expect(out.books).toHaveLength(1)
    expect(out.books[0]).toMatchObject({ book_name: "Darren — DJP Athlete", income_cents: 700 })
  })

  it("hard stop at 20000 rows → partial:true + explicit note + capped totals", async () => {
    // Endless full pages: the hard stop must terminate the loop AND cap the math.
    const entriesChain = chain((from, to) => ({
      data: Array.from({ length: to - from + 1 }, () => entryRow({ amount_cents: 1 })),
    }))
    mockSupabase({ bookkeeping_books: chain(() => ({ data: BOOKS })), bookkeeping_ledger_entries: entriesChain })
    const out = JSON.parse(await executeAdminTool("bookkeeping_summary", {}))
    expect(out.partial).toBe(true)
    expect(out.partial_note).toContain("first 20,000")
    const biz = out.books.find((b: { book_name: string }) => b.book_name === "Darren — DJP Athlete")
    expect(biz.entry_count).toBe(20000)
    expect(biz.expense_cents).toBe(20000)
  })

  it("rejects a malformed window instead of querying", async () => {
    mockSupabase({ bookkeeping_books: chain(() => ({ data: BOOKS })) })
    const out = JSON.parse(await executeAdminTool("bookkeeping_summary", { from: "2026-07-19", to: "2026-01-01" }))
    expect(out.error).toContain("on or before")
  })
})

describe("bookkeeping_income_by_service", () => {
  it("defaults to the primary business book; income-only rollup with Uncategorized bucket", async () => {
    const entries = [
      entryRow({ direction: "income", amount_cents: 50000 }),
      entryRow({ direction: "income", amount_cents: 700, account_id: null }),
      entryRow({ direction: "expense", amount_cents: 99999 }), // excluded from income rollup
    ]
    const entriesChain = chain(() => ({ data: entries }))
    mockSupabase({
      bookkeeping_books: chain(() => ({ data: BOOKS })),
      bookkeeping_ledger_entries: entriesChain,
      bookkeeping_accounts: chain(() => ({ data: ACCOUNTS })),
    })
    const out = JSON.parse(await executeAdminTool("bookkeeping_income_by_service", {}))
    expect(out.book_name).toBe("Darren — DJP Athlete")
    expect(entriesChain.eq).toHaveBeenCalledWith("book_id", BOOK_BIZ)
    expect(out.rows).toEqual([
      { service_line: "performance_training", label: "Performance Training", total_cents: 50000, entry_count: 1 },
      { service_line: null, label: "Uncategorized", total_cents: 700, entry_count: 1 },
    ])
    expect(out.income_total_cents).toBe(50700)
    expect(out.from).toBe("2026-01-01")
    expect(out.to).toBe("2026-07-18")
  })
})

describe("bookkeeping_top_vendors", () => {
  it("caps limit at 20, defaults direction to expense, merges normalized names, cites all books", async () => {
    const manyVendors = Array.from({ length: 25 }, (_, i) =>
      entryRow({ counterparty: `Vendor ${String(i).padStart(2, "0")}`, amount_cents: 10000 - i * 100 }),
    )
    const entries = [
      ...manyVendors,
      entryRow({ counterparty: " Rogue  Fitness ", amount_cents: 90000 }),
      entryRow({ counterparty: "rogue fitness", amount_cents: 10000 }),
      entryRow({ direction: "income", counterparty: "Stripe", amount_cents: 500000 }), // wrong direction
    ]
    mockSupabase({
      bookkeeping_books: chain(() => ({ data: BOOKS })),
      bookkeeping_ledger_entries: chain(() => ({ data: entries })),
    })
    const out = JSON.parse(await executeAdminTool("bookkeeping_top_vendors", { limit: 999 }))
    expect(out.direction).toBe("expense")
    expect(out.vendors).toHaveLength(20) // mutation discriminator: unclamped limit → 27
    expect(out.vendors[0]).toEqual({ counterparty: "rogue fitness", total_cents: 100000, entry_count: 2 })
    expect(out.vendors.some((v: { counterparty: string | null }) => v.counterparty === "stripe")).toBe(false)
    expect(out.book_names).toEqual(["Darren — DJP Athlete", "Household & Personal"])
  })

  it("junk direction → error JSON, no query", async () => {
    mockSupabase({ bookkeeping_books: chain(() => ({ data: BOOKS })) })
    const out = JSON.parse(await executeAdminTool("bookkeeping_top_vendors", { direction: "both" }))
    expect(out.error).toContain("direction")
  })

  it("defaults limit to 10 when omitted (mutation discriminator: fallback 10 -> 50 against >=11 distinct vendors)", async () => {
    const manyVendors = Array.from({ length: 15 }, (_, i) =>
      entryRow({ counterparty: `Vendor ${String(i).padStart(2, "0")}`, amount_cents: 10000 - i * 100 }),
    )
    mockSupabase({
      bookkeeping_books: chain(() => ({ data: BOOKS })),
      bookkeeping_ledger_entries: chain(() => ({ data: manyVendors })),
    })
    const out = JSON.parse(await executeAdminTool("bookkeeping_top_vendors", {}))
    expect(out.vendors).toHaveLength(10)
  })
})

describe("bookkeeping_find_entries", () => {
  it("total_count via count:'exact', showing-X-of-Y note, limit clamped to 50, ilike on memo+counterparty", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => entryRow({ amount_cents: 100 + i }))
    const entriesChain = chain(() => ({ data: rows, count: 137 }))
    mockSupabase({
      bookkeeping_books: chain(() => ({ data: BOOKS })),
      bookkeeping_ledger_entries: entriesChain,
      bookkeeping_accounts: chain(() => ({ data: ACCOUNTS })),
    })
    const out = JSON.parse(await executeAdminTool("bookkeeping_find_entries", { query: "rogue", limit: 999 }))
    expect(entriesChain.select).toHaveBeenCalledWith(expect.any(String), { count: "exact" })
    expect(entriesChain.range).toHaveBeenCalledWith(0, 49) // mutation discriminator: unclamped → (0, 998)
    expect(entriesChain.or).toHaveBeenCalledWith("memo.ilike.%rogue%,counterparty.ilike.%rogue%")
    expect(out.total_count).toBe(137)
    expect(out.showing).toBe("showing 20 of 137 matching entries")
    expect(out.rows).toHaveLength(20)
    expect(out.rows[0]).toMatchObject({
      account: "Performance Training",
      amount_cents: 100,
      book_name: "Darren — DJP Athlete",
      direction: "expense",
      occurred_on: "2026-03-01",
    })
    expect(out.note).toContain("integer cents")
  })

  it("offset pages via range(offset, offset+limit-1)", async () => {
    const entriesChain = chain(() => ({ data: [], count: 0 }))
    mockSupabase({
      bookkeeping_books: chain(() => ({ data: BOOKS })),
      bookkeeping_ledger_entries: entriesChain,
      bookkeeping_accounts: chain(() => ({ data: ACCOUNTS })),
    })
    await executeAdminTool("bookkeeping_find_entries", { offset: 30, limit: 10 })
    expect(entriesChain.range).toHaveBeenCalledWith(30, 39)
  })

  it("empty window → 0 of 0, empty rows, no invented data, default limit/offset applied", async () => {
    const entriesChain = chain(() => ({ data: [], count: 0 }))
    mockSupabase({
      bookkeeping_books: chain(() => ({ data: BOOKS })),
      bookkeeping_ledger_entries: entriesChain,
      bookkeeping_accounts: chain(() => ({ data: ACCOUNTS })),
    })
    const out = JSON.parse(await executeAdminTool("bookkeeping_find_entries", {}))
    expect(out.total_count).toBe(0)
    expect(out.rows).toEqual([])
    expect(out.showing).toBe("showing 0 of 0 matching entries")
    // mutation discriminator: default limit fallback 20 -> 50 (spec-pinned cap) or
    // default offset fallback 0 -> nonzero would both pass every other test here.
    expect(entriesChain.range).toHaveBeenCalledWith(0, 19)
  })

  it("escapes ilike metacharacters with the house idiom (%/_ escaped; ,(). flattened)", async () => {
    const entriesChain = chain(() => ({ data: [], count: 0 }))
    mockSupabase({
      bookkeeping_books: chain(() => ({ data: BOOKS })),
      bookkeeping_ledger_entries: entriesChain,
      bookkeeping_accounts: chain(() => ({ data: ACCOUNTS })),
    })
    await executeAdminTool("bookkeeping_find_entries", { query: "50%_off,(really)" })
    expect(entriesChain.or).toHaveBeenCalledWith(
      "memo.ilike.%50\\%\\_off  really %,counterparty.ilike.%50\\%\\_off  really %",
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx vitest run src/__tests__/admin-tools-bookkeeping.test.ts`
Expected: FAIL — the declarations test finds no `bookkeeping_*` names; executor cases return `Unknown tool: bookkeeping_summary` which does not JSON-parse into the expected shapes.

- [ ] **Step 3: Write the implementation (four edits to `functions/src/ai/admin-tools.ts`)**

**(3a) Imports** — add directly under the existing `import { getSupabase } from "../lib/supabase.js"` (line 2):

```ts
import { fetchAllRows } from "../lib/paginate.js"
import {
  incomeByServiceLine,
  perBookSummary,
  topCounterparties,
  type AggAccount,
} from "../lib/bookkeeping-aggregate.js"
```

**(3b) Declarations** — append inside the `ADMIN_TOOLS` array, after the `get_form_reviews_queue` object, immediately before the closing `]` (currently line 246):

```ts
  {
    name: "bookkeeping_summary",
    description:
      "Get bookkeeping ledger totals per book from DJP's internal books: income, expenses, net, entry count (integer cents). Omit book for every book. Window defaults to calendar year-to-date. Business and household are SEPARATE books (separate tax contexts) — never combine them in one number.",
    input_schema: {
      type: "object" as const,
      properties: {
        book: { type: "string", description: "Exact book name, case-insensitive. Omit for all books." },
        from: { type: "string", description: "Window start, YYYY-MM-DD. Default: Jan 1 of the current year." },
        to: { type: "string", description: "Window end, YYYY-MM-DD. Default: today." },
      },
      required: [],
    },
  },
  {
    name: "bookkeeping_income_by_service",
    description:
      "Break one book's bookkeeping income down by service line (performance training, session packs, camps, memberships, shop, other, uncategorized). Defaults to the primary business book and calendar year-to-date. Money is integer cents.",
    input_schema: {
      type: "object" as const,
      properties: {
        book: { type: "string", description: "Exact book name, case-insensitive. Default: the primary business book." },
        from: { type: "string", description: "Window start, YYYY-MM-DD. Default: Jan 1 of the current year." },
        to: { type: "string", description: "Window end, YYYY-MM-DD. Default: today." },
      },
      required: [],
    },
  },
  {
    name: "bookkeeping_top_vendors",
    description:
      "Rank bookkeeping counterparties by total integer cents in the window, with entry counts — vendors when direction=expense (default), payers when direction=income. A null counterparty bucket means entries with no vendor name recorded. Defaults to all books and calendar year-to-date.",
    input_schema: {
      type: "object" as const,
      properties: {
        book: { type: "string", description: "Exact book name, case-insensitive. Omit for all books." },
        from: { type: "string", description: "Window start, YYYY-MM-DD. Default: Jan 1 of the current year." },
        to: { type: "string", description: "Window end, YYYY-MM-DD. Default: today." },
        direction: { type: "string", enum: ["expense", "income"], description: "Which side to rank. Default: expense." },
        limit: { type: "number", description: "Max counterparties to return (default 10, max 20)." },
      },
      required: [],
    },
  },
  {
    name: "bookkeeping_find_entries",
    description:
      "Search individual bookkeeping ledger entries (date, integer-cents amount, direction, account, counterparty, memo, source, book). query is a case-insensitive substring match on memo and counterparty. Returns total_count and a 'showing X of Y' note; page with offset. limit max 50 (default 20). Defaults to all books and calendar year-to-date.",
    input_schema: {
      type: "object" as const,
      properties: {
        book: { type: "string", description: "Exact book name, case-insensitive. Omit for all books." },
        from: { type: "string", description: "Window start, YYYY-MM-DD. Default: Jan 1 of the current year." },
        to: { type: "string", description: "Window end, YYYY-MM-DD. Default: today." },
        query: { type: "string", description: "Substring to match against memo and counterparty." },
        direction: { type: "string", enum: ["expense", "income"], description: "Optional direction filter." },
        limit: { type: "number", description: "Rows to return (default 20, max 50)." },
        offset: { type: "number", description: "Rows to skip for paging (default 0)." },
      },
      required: [],
    },
  },
```

**(3c) Labels** — append inside `TOOL_LABELS` before its closing `}` (currently line 269):

```ts
  bookkeeping_summary: "Reading your books",
  bookkeeping_income_by_service: "Breaking income down by service",
  bookkeeping_top_vendors: "Ranking vendors",
  bookkeeping_find_entries: "Searching ledger entries",
```

**(3d) Switch cases** — insert inside `executeAdminTool`'s switch, after the `get_form_reviews_queue` case and before `default:` (currently line 312):

```ts
      case "bookkeeping_summary":
        return await getBookkeepingSummary(
          input.book as string | undefined,
          input.from as string | undefined,
          input.to as string | undefined,
        )
      case "bookkeeping_income_by_service":
        return await getBookkeepingIncomeByService(
          input.book as string | undefined,
          input.from as string | undefined,
          input.to as string | undefined,
        )
      case "bookkeeping_top_vendors":
        return await getBookkeepingTopVendors(
          input.book as string | undefined,
          input.from as string | undefined,
          input.to as string | undefined,
          input.direction as string | undefined,
          input.limit as number | undefined,
        )
      case "bookkeeping_find_entries":
        return await getBookkeepingFindEntries(
          input.book as string | undefined,
          input.from as string | undefined,
          input.to as string | undefined,
          input.query as string | undefined,
          input.direction as string | undefined,
          input.limit as number | undefined,
          input.offset as number | undefined,
        )
```

**(3e) Helpers + implementations** — append at the END of the file:

```ts
// ─── Bookkeeping tools (Phase 6c) ───────────────────────────────────────────
// Read-only ask-your-books tools (spec §5.1, D-11). Every result self-cites
// book name(s) + from/to and carries the cents note. Aggregates paginate
// through the 20k hard stop (never the silent ~1000-row PostgREST cap) and
// say so via partial/partial_note. NO tool here writes anything.

const LEDGER_MAX_AGGREGATE_ROWS = 20000
const LEDGER_CENTS_NOTE = "All money values are integer cents — divide by 100 for dollars."
const LEDGER_PARTIAL_NOTE =
  "Row cap hit: this result covers only the first 20,000 entries in the window (oldest first). Narrow the from/to window for exact numbers."
const LEDGER_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface LedgerBookRow {
  id: string
  name: string
  book_kind: string
  is_primary: boolean
}

interface LedgerEntryRow {
  book_id: string
  account_id: string | null
  direction: "income" | "expense"
  amount_cents: number
  occurred_on: string
  counterparty: string | null
  memo: string | null
  source: string
}

async function listLedgerBooks(): Promise<LedgerBookRow[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from("bookkeeping_books")
    .select("id, name, book_kind, is_primary")
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as LedgerBookRow[]
}

/** ALL accounts including archived — filtering archived would re-bucket
 *  historical money as Uncategorized (the listAccountsForReports hazard). */
async function listLedgerAccounts(): Promise<Array<AggAccount & { name: string }>> {
  const supabase = getSupabase()
  const { data, error } = await supabase.from("bookkeeping_accounts").select("id, name, service_line")
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<AggAccount & { name: string }>
}

/** Case-insensitive book resolve. Unknown name → the real names, so the model
 *  corrects itself instead of guessing (D-11: never guess a book). */
function resolveLedgerBook(
  books: LedgerBookRow[],
  name: string,
): LedgerBookRow | { error: string; available_books: string[] } {
  const target = name.trim().toLowerCase()
  const match = books.find((b) => b.name.trim().toLowerCase() === target)
  if (match) return match
  return {
    error: `Unknown book "${name}". Use one of the exact book names in available_books.`,
    available_books: books.map((b) => b.name),
  }
}

/** Window default: calendar YTD (Jan 1 → today, UTC). */
function resolveLedgerWindow(fromIn?: string, toIn?: string): { from: string; to: string } | { error: string } {
  const today = new Date().toISOString().slice(0, 10)
  const from = fromIn ?? `${today.slice(0, 4)}-01-01`
  const to = toIn ?? today
  if (!LEDGER_DATE_RE.test(from) || !LEDGER_DATE_RE.test(to)) {
    return { error: "from/to must be YYYY-MM-DD dates." }
  }
  if (from > to) return { error: `from (${from}) must be on or before to (${to}).` }
  return { from, to }
}

function clampLedgerInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(Math.max(n, min), max)
}

/** Windowed slim ledger read through the hard-stop paginator (D-11). */
async function fetchLedgerEntries(
  from: string,
  to: string,
  bookId?: string,
): Promise<{ rows: LedgerEntryRow[]; partial: boolean }> {
  const supabase = getSupabase()
  return fetchAllRows<LedgerEntryRow>((f, t) => {
    let q = supabase
      .from("bookkeeping_ledger_entries")
      .select("book_id, account_id, direction, amount_cents, occurred_on, counterparty, memo, source")
      .gte("occurred_on", from)
      .lte("occurred_on", to)
    if (bookId) q = q.eq("book_id", bookId)
    return q.order("occurred_on", { ascending: true }).order("id", { ascending: true }).range(f, t)
  }, LEDGER_MAX_AGGREGATE_ROWS)
}

function ledgerBookCitation(books: LedgerBookRow[]): { book_name: string } | { book_names: string[] } {
  return books.length === 1 ? { book_name: books[0].name } : { book_names: books.map((b) => b.name) }
}

async function getBookkeepingSummary(book?: string, fromIn?: string, toIn?: string): Promise<string> {
  const books = await listLedgerBooks()
  if (books.length === 0) return JSON.stringify({ error: "No bookkeeping books exist yet." })
  const window = resolveLedgerWindow(fromIn, toIn)
  if ("error" in window) return JSON.stringify(window)
  let targetBooks = books
  if (book !== undefined) {
    const resolved = resolveLedgerBook(books, book)
    if ("error" in resolved) return JSON.stringify(resolved)
    targetBooks = [resolved]
  }
  const { rows, partial } = await fetchLedgerEntries(
    window.from,
    window.to,
    targetBooks.length === 1 ? targetBooks[0].id : undefined,
  )
  const summary = perBookSummary(rows, targetBooks)
  return JSON.stringify({
    from: window.from,
    to: window.to,
    books: summary.map((s) => ({
      book_name: s.name,
      book_kind: s.book_kind,
      income_cents: s.income_cents,
      expense_cents: s.expense_cents,
      net_cents: s.net_cents,
      entry_count: s.entry_count,
    })),
    partial,
    ...(partial ? { partial_note: LEDGER_PARTIAL_NOTE } : {}),
    note: LEDGER_CENTS_NOTE,
  })
}

async function getBookkeepingIncomeByService(book?: string, fromIn?: string, toIn?: string): Promise<string> {
  const books = await listLedgerBooks()
  if (books.length === 0) return JSON.stringify({ error: "No bookkeeping books exist yet." })
  const window = resolveLedgerWindow(fromIn, toIn)
  if ("error" in window) return JSON.stringify(window)
  let target: LedgerBookRow
  if (book !== undefined) {
    const resolved = resolveLedgerBook(books, book)
    if ("error" in resolved) return JSON.stringify(resolved)
    target = resolved
  } else {
    // Income-by-service is a primary-business-book concept (print-report semantics:
    // reports/print/page.tsx:139-143 restricts this section to the primary book;
    // the interactive reports API computes it per-book instead).
    target = books.find((b) => b.book_kind === "business" && b.is_primary) ?? books[0]
  }
  const [{ rows, partial }, accounts] = await Promise.all([
    fetchLedgerEntries(window.from, window.to, target.id),
    listLedgerAccounts(),
  ])
  const breakdown = incomeByServiceLine(rows, accounts)
  return JSON.stringify({
    book_name: target.name,
    from: window.from,
    to: window.to,
    rows: breakdown.rows,
    income_total_cents: breakdown.total_cents,
    partial,
    ...(partial ? { partial_note: LEDGER_PARTIAL_NOTE } : {}),
    note: LEDGER_CENTS_NOTE,
  })
}

async function getBookkeepingTopVendors(
  book?: string,
  fromIn?: string,
  toIn?: string,
  directionIn?: string,
  limitIn?: number,
): Promise<string> {
  const books = await listLedgerBooks()
  if (books.length === 0) return JSON.stringify({ error: "No bookkeeping books exist yet." })
  const direction = directionIn ?? "expense"
  if (direction !== "expense" && direction !== "income") {
    return JSON.stringify({ error: 'direction must be "expense" or "income".' })
  }
  const window = resolveLedgerWindow(fromIn, toIn)
  if ("error" in window) return JSON.stringify(window)
  let targetBooks = books
  if (book !== undefined) {
    const resolved = resolveLedgerBook(books, book)
    if ("error" in resolved) return JSON.stringify(resolved)
    targetBooks = [resolved]
  }
  const limit = clampLedgerInt(limitIn, 10, 1, 20)
  const { rows, partial } = await fetchLedgerEntries(
    window.from,
    window.to,
    targetBooks.length === 1 ? targetBooks[0].id : undefined,
  )
  const vendors = topCounterparties(rows, { direction, limit })
  return JSON.stringify({
    ...ledgerBookCitation(targetBooks),
    from: window.from,
    to: window.to,
    direction,
    vendors,
    partial,
    ...(partial ? { partial_note: LEDGER_PARTIAL_NOTE } : {}),
    note: `${LEDGER_CENTS_NOTE} A null counterparty groups entries with no vendor name recorded.`,
  })
}

async function getBookkeepingFindEntries(
  book?: string,
  fromIn?: string,
  toIn?: string,
  query?: string,
  directionIn?: string,
  limitIn?: number,
  offsetIn?: number,
): Promise<string> {
  const books = await listLedgerBooks()
  if (books.length === 0) return JSON.stringify({ error: "No bookkeeping books exist yet." })
  const window = resolveLedgerWindow(fromIn, toIn)
  if ("error" in window) return JSON.stringify(window)
  let targetBooks = books
  if (book !== undefined) {
    const resolved = resolveLedgerBook(books, book)
    if ("error" in resolved) return JSON.stringify(resolved)
    targetBooks = [resolved]
  }
  if (directionIn !== undefined && directionIn !== "expense" && directionIn !== "income") {
    return JSON.stringify({ error: 'direction must be "expense" or "income".' })
  }
  const limit = clampLedgerInt(limitIn, 20, 1, 50)
  const offset = clampLedgerInt(offsetIn, 0, 0, Number.MAX_SAFE_INTEGER)

  const supabase = getSupabase()
  let q = supabase
    .from("bookkeeping_ledger_entries")
    .select("book_id, account_id, direction, amount_cents, occurred_on, counterparty, memo, source", {
      count: "exact",
    })
    .gte("occurred_on", window.from)
    .lte("occurred_on", window.to)
  if (targetBooks.length === 1) q = q.eq("book_id", targetBooks[0].id)
  if (directionIn) q = q.eq("direction", directionIn)
  if (query && query.trim() !== "") {
    // Escape idiom from lib/db/bookkeeping.ts applyEntryFilters: %/_ escaped,
    // or-syntax metacharacters flattened so user text can't break the filter.
    const esc = query.replace(/[%_]/g, (m) => `\\${m}`).replace(/[,().]/g, " ")
    q = q.or(`memo.ilike.%${esc}%,counterparty.ilike.%${esc}%`)
  }
  const { data, error, count } = await q
    .order("occurred_on", { ascending: false })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(error.message)
  const accounts = await listLedgerAccounts()
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const bookName = new Map(books.map((b) => [b.id, b.name]))
  const rows = (data ?? []) as LedgerEntryRow[]
  const total = count ?? 0
  return JSON.stringify({
    ...ledgerBookCitation(targetBooks),
    from: window.from,
    to: window.to,
    ...(query && query.trim() !== "" ? { query } : {}),
    ...(directionIn ? { direction: directionIn } : {}),
    ...(offset > 0 ? { offset } : {}),
    total_count: total,
    showing: `showing ${rows.length} of ${total} matching entries`,
    rows: rows.map((r) => ({
      occurred_on: r.occurred_on,
      amount_cents: r.amount_cents,
      direction: r.direction,
      account: r.account_id === null ? null : (accountName.get(r.account_id) ?? null),
      counterparty: r.counterparty,
      memo: r.memo,
      source: r.source,
      book_name: bookName.get(r.book_id) ?? null,
    })),
    note: LEDGER_CENTS_NOTE,
  })
}
```

(Contingency, not a change of design: if `tsc` rejects the builder closure passed to `fetchAllRows` — the untyped functions Supabase client usually infers `any` rows and is structurally assignable — mirror the lib idiom at `lib/db/bookkeeping.ts:348` and append `as never` to the returned `.range(f, t)` chain.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx vitest run src/__tests__/admin-tools-bookkeeping.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/admin-tools.ts functions/src/__tests__/admin-tools-bookkeeping.test.ts
git commit -m "feat(bookkeeper): 4 ask-your-books chat tools in ADMIN_TOOLS — summary, income-by-service, top vendors, find entries"
```

---

### Task 4: Fixture-parity test — lib fns vs functions twins

**Files:**
- Test: `__tests__/lib/bookkeeping/chat-tools-parity.test.ts` (root vitest config — this is the whole task; parity IS the deliverable)

**Interfaces:**
- Consumes: `perBookSummary`, `incomeByServiceLine`, `topCounterparties`, `SERVICE_LINE_LABELS`, types from `@/lib/bookkeeping/reports`; the same four names from `../../../functions/src/lib/bookkeeping-aggregate` (relative cross-package import — legal because the twin imports nothing; `statement-schema-parity` precedent).
- One shared fixture set flows through BOTH sides; outputs must deep-equal AND match pinned absolute values (deep-equal alone would pass if both sides drifted identically — the absolute pins catch that for the load-bearing numbers).

- [ ] **Step 1: Write the test (it should PASS immediately if Tasks 1-2 are correct — a failure here is a real twin-drift catch, fix the twin, not the test)**

```ts
// __tests__/lib/bookkeeping/chat-tools-parity.test.ts
import { describe, expect, it } from "vitest"
import {
  SERVICE_LINE_LABELS,
  incomeByServiceLine,
  perBookSummary,
  topCounterparties,
  type ReportAccount,
  type ReportEntry,
} from "@/lib/bookkeeping/reports"
import type { BookkeepingBook } from "@/types/database"
// Direct relative import of the functions/ twin — bookkeeping-aggregate.ts imports
// NOTHING, so it loads cleanly under the root vitest config even though functions/
// is otherwise an isolated package (the statement-schema-parity precedent:
// __tests__/lib/bookkeeping/statement-schema-parity.test.ts).
import {
  SERVICE_LINE_LABELS as twinLabels,
  incomeByServiceLine as twinIncomeByServiceLine,
  perBookSummary as twinPerBookSummary,
  topCounterparties as twinTopCounterparties,
} from "../../../functions/src/lib/bookkeeping-aggregate"

const BOOK_BIZ = "b0000000-0000-4000-8000-000000000001"
const BOOK_HH = "b0000000-0000-4000-8000-000000000002"
const BOOK_DEAD = "b0000000-0000-4000-8000-00000000dead"
const ACC_PT = "a0000000-0000-4000-8000-000000000001" // income, performance_training
const ACC_SHOP = "a0000000-0000-4000-8000-000000000002" // income, service_line null → "other"
const ACC_EQ = "a0000000-0000-4000-8000-000000000003" // expense, no line
const ACC_UNKNOWN = "a0000000-0000-4000-8000-00000000dead" // never in accounts

const books = [
  { id: BOOK_BIZ, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true },
  { id: BOOK_HH, name: "Household & Personal", book_kind: "household", is_primary: false },
] as BookkeepingBook[]

const accounts: ReportAccount[] = [
  { id: ACC_PT, book_id: BOOK_BIZ, name: "Performance Training", account_type: "income", service_line: "performance_training", tax_category: null, sort_order: 0 },
  { id: ACC_SHOP, book_id: BOOK_BIZ, name: "Shop Sales", account_type: "income", service_line: null, tax_category: null, sort_order: 1 },
  { id: ACC_EQ, book_id: BOOK_BIZ, name: "Equipment", account_type: "expense", service_line: null, tax_category: null, sort_order: 2 },
]

function entry(over: Partial<ReportEntry>): ReportEntry {
  return {
    book_id: BOOK_BIZ,
    account_id: null,
    direction: "expense",
    amount_cents: 1000,
    occurred_on: "2026-03-01",
    counterparty: null,
    memo: null,
    source: "manual",
    ...over,
  }
}

// ONE shared fixture set exercising: normalized merge, tie-break, null bucket,
// "other" fold vs null Uncategorized, cross-book isolation, unlisted-book skip.
const entries: ReportEntry[] = [
  entry({ direction: "income", account_id: ACC_PT, amount_cents: 50000, counterparty: "Stripe" }),
  entry({ direction: "income", account_id: ACC_SHOP, amount_cents: 20000, counterparty: "Shopify" }),
  entry({ direction: "income", account_id: ACC_UNKNOWN, amount_cents: 700, counterparty: "Venmo" }),
  entry({ account_id: ACC_EQ, amount_cents: 12500, counterparty: " Rogue  Fitness " }),
  entry({ account_id: ACC_EQ, amount_cents: 400, counterparty: "rogue fitness" }),
  entry({ amount_cents: 800, counterparty: "Titan" }),
  entry({ amount_cents: 800, counterparty: "Amazon" }),
  entry({ amount_cents: 100, counterparty: null }),
  entry({ book_id: BOOK_HH, amount_cents: 200000, counterparty: "Landlord" }),
  entry({ book_id: BOOK_DEAD, amount_cents: 300, counterparty: "Ghost Gym" }), // unlisted book
]

describe("chat-tools twin parity (lib/bookkeeping/reports.ts vs functions/src/lib/bookkeeping-aggregate.ts)", () => {
  it("SERVICE_LINE_LABELS are byte-identical", () => {
    expect(twinLabels).toEqual(SERVICE_LINE_LABELS)
  })

  it("perBookSummary: identical fixtures → deep-equal outputs, pinned absolutes", () => {
    const lib = perBookSummary(entries, books)
    const twin = twinPerBookSummary(entries, books)
    expect(twin).toEqual(lib)
    // Absolute pins (deep-equal alone passes if both sides drift identically):
    expect(lib).toEqual([
      { book_id: BOOK_BIZ, name: "Darren — DJP Athlete", book_kind: "business", income_cents: 70700, expense_cents: 14600, net_cents: 56100, entry_count: 8 },
      { book_id: BOOK_HH, name: "Household & Personal", book_kind: "household", income_cents: 0, expense_cents: 200000, net_cents: -200000, entry_count: 1 },
    ])
  })

  it("incomeByServiceLine: deep-equal + pinned 'other' fold and null Uncategorized bucket", () => {
    const lib = incomeByServiceLine(entries, accounts)
    const twin = twinIncomeByServiceLine(entries, accounts)
    expect(twin).toEqual(lib)
    expect(lib).toEqual({
      rows: [
        { service_line: "performance_training", label: "Performance Training", total_cents: 50000, entry_count: 1 },
        { service_line: "other", label: "Other", total_cents: 20000, entry_count: 1 },
        { service_line: null, label: "Uncategorized", total_cents: 700, entry_count: 1 },
      ],
      total_cents: 70700,
    })
  })

  it("topCounterparties expense: deep-equal + pinned merge/tie/limit (amazon beats titan on the 800 tie; titan cut by limit)", () => {
    const opts = { direction: "expense" as const, limit: 3 }
    const lib = topCounterparties(entries, opts)
    const twin = twinTopCounterparties(entries, opts)
    expect(twin).toEqual(lib)
    expect(lib).toEqual([
      { counterparty: "landlord", total_cents: 200000, entry_count: 1 },
      { counterparty: "rogue fitness", total_cents: 12900, entry_count: 2 },
      { counterparty: "amazon", total_cents: 800, entry_count: 1 },
    ])
  })

  it("topCounterparties income + clamped limit: deep-equal both ways", () => {
    const incomeOpts = { direction: "income" as const, limit: 10 }
    expect(twinTopCounterparties(entries, incomeOpts)).toEqual(topCounterparties(entries, incomeOpts))
    expect(topCounterparties(entries, incomeOpts)).toEqual([
      { counterparty: "stripe", total_cents: 50000, entry_count: 1 },
      { counterparty: "shopify", total_cents: 20000, entry_count: 1 },
      { counterparty: "venmo", total_cents: 700, entry_count: 1 },
    ])
    const clamped = { direction: "expense" as const, limit: -1 }
    expect(twinTopCounterparties(entries, clamped)).toEqual(topCounterparties(entries, clamped))
    expect(topCounterparties(entries, clamped)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it under the ROOT config**

Run: `npx vitest run __tests__/lib/bookkeeping/chat-tools-parity.test.ts`
Expected: PASS. If any block fails, the TWIN (or Task 1) has drifted from the lib original — fix the implementation to match the pinned lib behavior; never loosen the test.

- [ ] **Step 3: Confirm the statement-schema parity precedent still passes beside it**

Run: `npx vitest run __tests__/lib/bookkeeping/chat-tools-parity.test.ts __tests__/lib/bookkeeping/statement-schema-parity.test.ts`
Expected: PASS (both cross-import files).

- [ ] **Step 4: Commit**

```bash
git add __tests__/lib/bookkeeping/chat-tools-parity.test.ts
git commit -m "test(bookkeeper): chat-tools fixture parity — lib aggregators vs functions twins, pinned absolutes"
```

---

### Task 5: System-prompt addendum + full 6c verification

**Files:**
- Modify: `functions/src/admin-chat.ts` (the `SYSTEM_PROMPT` template literal, lines 11-38 — the sweep-verified single home of the admin-chat system prompt)

**Interfaces:** none — prose only. No test asserts prompt text (house precedent: SYSTEM_PROMPT has no test); the citation behavior is enforced structurally by every tool result carrying book/window/notes (Task 3 tests).

- [ ] **Step 1: Add bookkeeping to the capability list**

In `functions/src/admin-chat.ts`, replace:

```
- Form reviews: video form-check submissions awaiting your review
- AI usage: generations, tokens, cost signals, failures
```

with:

```
- Form reviews: video form-check submissions awaiting your review
- AI usage: generations, tokens, cost signals, failures
- Bookkeeping: per-book ledger summaries, income by service line, top vendors / counterparties, and individual entry search (business and household are SEPARATE books — separate tax contexts, never combined)
```

- [ ] **Step 2: Add the citation guideline**

In the same file, replace:

```
- Identify patterns and trends across the data — events, ads, content, retention often interact
```

with:

```
- Identify patterns and trends across the data — events, ads, content, retention often interact
- Bookkeeping answers: always cite the book name(s) and the from/to window the tool result carries; amounts come back as integer cents — convert to dollars; NEVER invent, estimate, or extrapolate ledger rows a tool did not return; when a result says "partial" or "showing X of Y", say the numbers are capped
```

- [ ] **Step 3: Functions suite + functions build (build is its OWN command)**

Run: `cd functions && npm test`
Expected: PASS — all functions tests including the three new files; no pre-existing functions test is red.
Run: `cd functions && npm run build`
Expected: clean `tsc` exit (catches any missing `.js` extension or boundary violation).

- [ ] **Step 4: Root bookkeeping suites + root build (build is its OWN command)**

Run: `npx vitest run __tests__/lib/bookkeeping __tests__/app/api/admin/bookkeeping __tests__/api/admin/bookkeeping`
Expected: PASS (Task 1's reports change and Task 4's parity file included; no existing bookkeeping test moved).
Run: `npm run build`
Expected: GREEN. (Silent exit at "Running TypeScript" with no diagnostic = memory flake → re-run once before diagnosing.)

- [ ] **Step 5: Grep gates (D-11 + boundary proofs)**

Use the executor's Grep tool (or a plain `rg` on PATH) for each pattern below, not `npx rg` — npx's PATH-fallback resolution isn't guaranteed to find a ripgrep binary (see Global Constraints, Shell).

Run: `rg -n "\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(" functions/src/ai/admin-tools.ts functions/src/lib/paginate.ts functions/src/lib/bookkeeping-aggregate.ts`
Expected: zero matches — no tool writes.
Run: `rg -n "^import|require\(" functions/src/lib/bookkeeping-aggregate.ts functions/src/lib/paginate.ts`
Expected: zero matches — the twins import nothing (the parity cross-import stays legal).
Run: `rg -n "@/" functions/src/lib/paginate.ts functions/src/lib/bookkeeping-aggregate.ts functions/src/ai/admin-tools.ts`
Expected: zero matches — no lib/ boundary breach.
Run: `rg -n "Math\.round|Math\.trunc" functions/src/lib/bookkeeping-aggregate.ts functions/src/lib/paginate.ts`
Expected: zero matches — 6c defines no money rounding point.

- [ ] **Step 6: Commit**

```bash
git add functions/src/admin-chat.ts
git commit -m "feat(bookkeeper): admin-chat system prompt — bookkeeping capability + cite-book-and-window guardrail"
```

No push (Global Constraints). Note for the controller's final report: 6c touches `functions/**`, so the eventual push to main deploys via the functions GHA — the tools go live with that deploy (no flag; they are read-only and inert until asked). Live-proof option per spec §9: one chat round-trip against `/admin/ai-assistant` after deploy, or the Task 3 executor tests stand as the gate.

---

## Self-Review (done at plan time)

1. **Spec coverage:** §5.1 tool table → Task 3 (all four input/output contracts, caps 20/50/20k, direction default, `count:"exact"` total_count, showing-X-of-Y); §5.1 shared rules → Task 3 helpers (case-insensitive resolve + available_books, YTD default, cents note, partial note, no writes) + Task 5 prompt addendum; §5.2 twins → Task 2, lib `topCounterparties` → Task 1, fixture parity → Task 4; D-11 hard stop → Task 2 paginate + Task 3 endless-pages test. No migration/flag/route per §1 table (6c row). No gaps found.
2. **Placeholders:** none — every test and implementation is complete code. The single contingency note (Task 3 `as never` cast) prescribes the exact house idiom and location rather than leaving a decision open.
3. **Type consistency:** `topCounterparties(entries, { direction, limit })` identical in Task 1 (lib), Task 2 (twin), Task 3 (caller), Task 4 (parity); `fetchAllRows(buildQuery, maxRows, pageSize?)` → `{ rows, partial }` consistent between Task 2 and Task 3's `fetchLedgerEntries`; result-JSON field names (`book_name`/`book_names`, `from`, `to`, `partial`, `partial_note`, `note`, `total_count`, `showing`, `vendors`, `rows`) identical between Task 3 implementation and its tests.
4. **Mutation-discriminating fixtures named:** inverted sort (900/800/700 ordering), dropped normalize (Rogue merge), tie-break direction (alpha/beta/null), slice-before-sort, `slice(0,-1)` clamp, sign-flip net (300 vs −300/700), unlisted-book skip, `>=`-vs-`>` hard-stop boundary (short-page-at-cap → complete), full-page-at-cap → partial, endless-source termination, unclamped limit (27 vs 20; range 0-998 vs 0-49), default-limit fallback (`find_entries` range(0,19) with limit omitted; `top_vendors` length 10 with limit omitted against 15 distinct vendors), ilike escape string. Each pinned to exact expected values.
5. **Boundary discipline:** twins import nothing (grep-gated); functions imports use `.js`; parity test is the only cross-package import and follows the in-repo precedent verbatim; the one lib change is additive with its own new test file so no existing fixture churns.
