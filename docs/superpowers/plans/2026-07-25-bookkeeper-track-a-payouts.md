# Track A — 6e Stripe Payout Ingestion, Net Revenue, Exact Dedupe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest Stripe payouts and their balance transactions into a new read-model mirror (bookkeeping_payouts + lines), derive net revenue as a labeled second line across every report surface, and add an exact payout-deposit layer to statement dedupe.

**Architecture:** A nightly flag-gated cron (functions delegator → internal route; the route owns cron_runs) reads payouts.list + balanceTransactions.list with a watermark derived from the payouts table itself, plus an eligibility re-pull of non-terminal payouts so a late status flip can never strand outside the window. Fees stay report-layer only — zero ledger writes — so the close guard and the ledger source CHECK are untouched. A new exact dedupe layer sits between the existing source_ref layer and the fuzzy aggregate layer, with its own consumed set.

**Tech Stack:** Next.js 16 App Router (no src/), TypeScript strict, Supabase PostgreSQL (service-role DAL in `lib/db/`), Zod validators, Vitest + Testing Library, Firebase Functions (`onSchedule` delegators), Stripe SDK 20.3.1, Anthropic via `lib/ai/anthropic.ts`.

## Global Constraints

- **Design doc:** `docs/superpowers/specs/2026-07-25-bookkeeper-completion-design.md` (committed `c445a4d1`) — every decision + rationale lives there. Deviating from it requires recording a new decision.
- **Solo-dev convention:** commit directly on `main` as each task lands. **NEVER push** — the owner holds the push.
- **Money math is integer cents end-to-end.** Stripe `balanceTransactions` amounts are already cents; no float conversion anywhere. Every pinned number needs a mutation-discriminating fixture (the 12.555 house style — a value where round, trunc, sum-of-rounds and round-of-sum all differ).
- **Migrations** apply live via `mcp__supabase__apply_migration` (the Supabase CLI is not linked). Write the identical SQL to `supabase/migrations/<n>_<name>.sql` as well. Additive, reversible, inert without code.
- **PostgREST:** every growth-table read uses `fetchAllRows` (`lib/db/paginate.ts`) — a bare `.select()` silently caps at ~1000 rows. Upsert `onConflict` keys must be PLAIN unique constraints, never expression indexes.
- **Never edit** `app/api/stripe/webhook/route.ts`. Reconcile-by-read on a schedule instead.
- **functions/ ↔ lib/ boundary:** `functions/` cannot import from `lib/`; root code must never import from `functions/src` (it breaks the Vercel deploy). Helpers needed in both runtimes are twin copies.
- **Cron discipline:** three-way byte-identical name contract (functions POST path ↔ route directory ↔ the `cron_runs`/`EXPECTED_CRONS` name). The ROUTE is the single `cron_runs` owner; the functions delegator never logs. Delegator secrets are `[internalCronToken, appUrl]` ONLY. Success-skip (HTTP 200) when the flag is OFF or there is nothing to do.
- **Auth:** `/api/*` self-gates via `auth()` → 403 (middleware does not cover `/api`). Internal cron routes use the Bearer triple-clause. JSON screen-reads stay unaudited; mutations and downloads are audited with slugs registered in `lib/audit/actions.ts`.
- **Feature flags** are DB-backed rows in `system_settings`, never env vars; new crons arrive with their flag seeded `false`.
- **Tests:** pure fns → `__tests__/lib/bookkeeping/` (zero-mock); routes → `__tests__/api/admin/...` or `__tests__/app/api/admin/...` matching siblings; functions-side → `functions/src/__tests__/`; RFC-4122 fixture UUIDs; multipart route tests need `// @vitest-environment node`.
- **Gates run by the orchestrator between tracks, not inside tasks:** the full suite against the known-red baseline (the Stripe-webhook pair wall-clock-flakes under load — stash-isolate before blaming a change), then `npm run build` as its OWN command, never `&&`-chained behind tests.
- **Commit messages:** conventional commits; multi-line messages go through a scratchpad file + `git commit -F <file>` (PowerShell here-strings get mangled by this harness).
- **Task count:** 10.

---

### Task A1: Pin the Stripe SDK apiVersion (own commit, behavior-neutral)

**Files:**
- Modify: `lib/stripe.ts:5` (currently `export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)` — verified unpinned)

**Interfaces:**
- Consumes: `Stripe` constructor from `stripe@20.3.1` (bundled default `2026-01-28.clover` per `node_modules/stripe/cjs/apiVersion.js`).
- Produces: unchanged export `stripe: Stripe` — same name, same behavior (the pin equals the SDK's bundled literal, Decision A-5).

No new test — this is a pin of the version every existing call already sends; the regression signal is the existing stripe-adjacent suite (webhook tests are the known wall-clock-flake family and are deliberately NOT in this run set — memory `test_baseline_not_green`).

- [ ] Confirm the bundled literal before pinning:
  ```
  Grep pattern "2026-01-28" in node_modules/stripe/cjs/apiVersion.js — must hit `exports.ApiVersion = '2026-01-28.clover';`
  ```
- [ ] Edit `lib/stripe.ts:5`:
  ```ts
  export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-01-28.clover" })
  ```
  Do NOT touch the three self-constructed script clients (`scripts/check-stripe-price.ts:14`, `scripts/backfill-stripe-payments.ts:33`, `scripts/backfill-events-stripe-live.ts:31`) — historical backfills, noted for the owner (spec §1.2).
- [ ] Run the stripe-adjacent tests (non-webhook):
  `npx vitest run __tests__/lib/stripe-setup-session.test.ts __tests__/api/session-packs/checkout.test.ts __tests__/api/events/checkout.test.ts __tests__/api/shop/checkout.test.ts __tests__/lib/services/session-fees.test.ts` — expect all pass.
- [ ] Commit: write this message to `a1-msg.txt` in your session scratchpad directory, then `git add lib/stripe.ts` and `git commit -F "<scratchpad>\a1-msg.txt"`:
  ```
  fix(stripe): pin apiVersion to 2026-01-28.clover (SDK 20.3.1 bundled literal)

  Behavior-neutral today (the unpinned client already sends this version);
  keeps request shapes fixed across future stripe package updates. Backfill
  scripts' own clients left unpinned (historical, owner-noted).

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

### Task A2: Migration 00191 — payout mirror tables + cron flag seed

**Files:**
- Create: `supabase/migrations/00191_bookkeeping_payouts.sql`

**Interfaces:**
- Produces: tables `bookkeeping_payouts` (plain UNIQUE `stripe_payout_id` — upsert key), `bookkeeping_payout_lines` (plain UNIQUE `stripe_balance_txn_id`), flag `cron_bookkeeping_payout_sync_enabled = false`. Additive, inert without code. Plain UNIQUEs per memory `postgrest_onconflict_plain_unique`.

- [ ] Write the file `supabase/migrations/00191_bookkeeping_payouts.sql` with exactly this SQL (spec §1.1; status CHECK includes `'pending'`):
  ```sql
  -- 00191_bookkeeping_payouts.sql
  -- Track A (6e): Stripe payout mirror (read model — never a ledger table).
  -- amount_cents = Stripe payout `amount` (NET); gross/fee derived from lines.
  -- Plain UNIQUEs are the upsert keys (PostgREST onConflict needs plain).
  -- Flag arrives OFF; additive, idempotent, inert without code.
  create table if not exists bookkeeping_payouts (
    id uuid primary key default gen_random_uuid(),
    stripe_payout_id text not null unique,
    book_id uuid not null references bookkeeping_books(id) on delete cascade,
    amount_cents integer not null,
    gross_cents integer not null default 0,
    fee_cents integer not null default 0,
    arrival_date date not null,
    status text not null check (status in ('in_transit','paid','failed','canceled','pending')),
    currency text not null default 'usd',
    raw jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists idx_bk_payouts_book_arrival on bookkeeping_payouts (book_id, arrival_date);

  create table if not exists bookkeeping_payout_lines (
    id uuid primary key default gen_random_uuid(),
    payout_id uuid not null references bookkeeping_payouts(id) on delete cascade,
    stripe_balance_txn_id text not null unique,
    type text not null,
    amount_cents integer not null,
    fee_cents integer not null,
    net_cents integer not null,
    txn_date date not null,
    description text,
    source_ref text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists idx_bk_payout_lines_txn_date on bookkeeping_payout_lines (txn_date);

  insert into system_settings (key, value, description) values
    ('cron_bookkeeping_payout_sync_enabled', 'false'::jsonb, 'Enable the nightly Stripe payout ingestion into the bookkeeping payout mirror')
  on conflict (key) do nothing;
  ```
- [ ] Apply live: call `mcp__supabase__apply_migration` with `name: "bookkeeping_payouts"` and the exact SQL above (CLI is not linked — memory `supabase_migrations_via_mcp`).
- [ ] Verify: call `mcp__supabase__execute_sql` with `select key, value from system_settings where key = 'cron_bookkeeping_payout_sync_enabled';` — expect one row, value `false`; and `select count(*) from bookkeeping_payouts;` — expect 0.
- [ ] Commit: write to `a2-msg.txt` in scratchpad, `git add supabase/migrations/00191_bookkeeping_payouts.sql`, `git commit -F "<scratchpad>\a2-msg.txt"`:
  ```
  feat(bookkeeping): migration 00191 — payout mirror tables + payout-sync flag seed

  bookkeeping_payouts (plain UNIQUE stripe_payout_id) + bookkeeping_payout_lines
  (plain UNIQUE stripe_balance_txn_id) + cron_bookkeeping_payout_sync_enabled=false.
  Applied live via MCP. Additive, inert while the flag is OFF.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

### Task A3: Pure watermark helper `computePayoutSyncWindow`

**Files:**
- Create: `lib/bookkeeping/payout-sync-window.ts`
- Create: `__tests__/lib/bookkeeping/payout-sync-window.test.ts` (zero-mock, mirrors `__tests__/lib/bookkeeping/income-sync-window.test.ts`)

**Interfaces:**
- Produces: `export interface PayoutSyncWindow { fromDate: string | null; fromEpochSeconds: number | null; to: string }` and `export function computePayoutSyncWindow(latestArrivalDate: string | null, today: string): PayoutSyncWindow`. Cold start (`null` watermark) → both `from*` fields `null` = full history (Decision A-4, deviates from income-sync's 90d fallback). Steady state → `latestArrivalDate − 14d`, clamped to `today`. `fromEpochSeconds` = `fromDate` at 00:00:00 UTC in epoch **seconds** (feeds Stripe `arrival_date.gte`).
- Consumed by: Task A5 route.

- [ ] Write the failing test `__tests__/lib/bookkeeping/payout-sync-window.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest"
  import { computePayoutSyncWindow } from "@/lib/bookkeeping/payout-sync-window"

  describe("computePayoutSyncWindow", () => {
    it("watermark present → fromDate = watermark − 14 days with epoch-seconds twin (discriminates 13/15d and ms-vs-s)", () => {
      // 2026-07-20 − 14d = 2026-07-06 (13d → 07-07, 15d → 07-05).
      // 2026-07-06T00:00:00Z = 1783296000 s (a ms value would be 1000× larger).
      expect(computePayoutSyncWindow("2026-07-20", "2026-07-24")).toEqual({
        fromDate: "2026-07-06", fromEpochSeconds: 1783296000, to: "2026-07-24",
      })
    })

    it("cold start (null watermark) → NO lower bound: full history (Decision A-4)", () => {
      expect(computePayoutSyncWindow(null, "2026-07-24")).toEqual({
        fromDate: null, fromEpochSeconds: null, to: "2026-07-24",
      })
    })

    it("crosses month AND year boundaries", () => {
      // 2026-01-05 − 14d = 2025-12-22 = 1766361600 s
      expect(computePayoutSyncWindow("2026-01-05", "2026-01-10")).toEqual({
        fromDate: "2025-12-22", fromEpochSeconds: 1766361600, to: "2026-01-10",
      })
    })

    it("future-dated watermark clamps fromDate to today (never an inverted window)", () => {
      const w = computePayoutSyncWindow("2026-08-30", "2026-07-24")
      expect(w.fromDate).toBe("2026-07-24")
      expect(w.to).toBe("2026-07-24")
      expect(w.fromEpochSeconds).toBe(Date.parse("2026-07-24T00:00:00Z") / 1000)
    })

    it("watermark exactly today still rewinds the overlap margin", () => {
      expect(computePayoutSyncWindow("2026-07-24", "2026-07-24").fromDate).toBe("2026-07-10")
    })
  })
  ```
- [ ] Run: `npx vitest run __tests__/lib/bookkeeping/payout-sync-window.test.ts` — expect failure (module not found).
- [ ] Implement `lib/bookkeeping/payout-sync-window.ts` (style mirrors `lib/bookkeeping/income-sync-window.ts`):
  ```ts
  // Watermark window for the nightly Stripe payout-sync cron (Track A §1.3).
  // Pure, zero IO. Steady state: arrival_date >= latest stored arrival − 14d
  // (late arrivals + status flips ride the overlap; the route's eligibility arm
  // additionally re-pulls stored non-terminal payouts by id every run, so a
  // flip can never strand outside this window). Cold start (no stored payouts):
  // NULL lower bound = FULL history (Decision A-4 — the YTD report needs fees
  // back to January; a solo-coach payout list is tiny). Re-scanning overlap is
  // free: upsertPayouts/upsertPayoutLines are idempotent merge-upserts.
  const OVERLAP_MARGIN_DAYS = 14

  function minusDays(isoDate: string, days: number): string {
    return new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)
  }

  export interface PayoutSyncWindow {
    /** YYYY-MM-DD lower bound; null = no bound (cold start → full history). */
    fromDate: string | null
    /** fromDate at 00:00:00 UTC in epoch SECONDS (Stripe arrival_date.gte); null = no bound. */
    fromEpochSeconds: number | null
    /** Informational upper bound = today (the Stripe listing needs no upper bound). */
    to: string
  }

  export function computePayoutSyncWindow(
    latestArrivalDate: string | null,
    today: string,
  ): PayoutSyncWindow {
    if (latestArrivalDate == null) return { fromDate: null, fromEpochSeconds: null, to: today }
    const rewound = minusDays(latestArrivalDate, OVERLAP_MARGIN_DAYS)
    const fromDate = rewound > today ? today : rewound
    return { fromDate, fromEpochSeconds: Date.parse(`${fromDate}T00:00:00Z`) / 1000, to: today }
  }
  ```
- [ ] Run again: `npx vitest run __tests__/lib/bookkeeping/payout-sync-window.test.ts` — expect 5 passed.
- [ ] Commit: write to `a3-msg.txt` in scratchpad, `git add lib/bookkeeping/payout-sync-window.ts __tests__/lib/bookkeeping/payout-sync-window.test.ts`, `git commit -F "<scratchpad>\a3-msg.txt"`:
  ```
  feat(bookkeeping): pure payout-sync watermark window (14d overlap, full-history cold start)

  Mirrors income-sync-window.ts; adds epoch-seconds twin for Stripe
  arrival_date.gte. Cold start = null bound per Decision A-4.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

### Task A4: Payout types + DAL (merge upserts, watermark read, window/dedupe/non-terminal lists)

**Files:**
- Modify: `types/database.ts` (after `NewBookkeepingAsset` at `:636`, before `export interface Subscription` at `:638`)
- Modify: `lib/db/bookkeeping.ts` (append a new section after `pruneExpiredDocuments` ending at `:454`; extend the type import at `:5-9`)
- Create: `__tests__/lib/db/bookkeeping-payouts.test.ts` (chainable-builder mock style of `__tests__/lib/db/bookkeeping-period-guard.test.ts`)

**Interfaces:**
- Produces (types): `BookkeepingPayoutStatus`, `BookkeepingPayout`, `BookkeepingPayoutLine`, `NewBookkeepingPayout = Omit<BookkeepingPayout, "id" | "created_at" | "updated_at">`, `NewBookkeepingPayoutLine = Omit<BookkeepingPayoutLine, "id" | "created_at" | "updated_at">`.
- Produces (DAL): `upsertPayouts(rows: NewBookkeepingPayout[]): Promise<BookkeepingPayout[]>` (merge mode, `onConflict: "stripe_payout_id"`, NO `ignoreDuplicates` — Decision A-6 status flips must land); `upsertPayoutLines(rows: NewBookkeepingPayoutLine[]): Promise<number>` (`onConflict: "stripe_balance_txn_id"`); `latestPayoutArrivalDate(bookId: string): Promise<string | null>`; `listPayoutLinesForWindow(from: string, to: string): Promise<PayoutLineWindowRow[]>` (fetchAllRows); `listPayoutsForDedupe(bookId: string, from: string, to: string): Promise<PayoutDedupeRow[]>` (fetchAllRows, PostgREST alias `net_cents:amount_cents`); `listNonTerminalPayouts(bookId: string): Promise<BookkeepingPayout[]>` (fetchAllRows, `status in (pending, in_transit)`). Plus exported row interfaces `PayoutLineWindowRow { txn_date: string; fee_cents: number; net_cents: number; amount_cents: number; type: string }` and `PayoutDedupeRow { id: string; stripe_payout_id: string; net_cents: number; arrival_date: string; status: BookkeepingPayoutStatus }`.
- Consumes: `fetchAllRows` (`lib/db/paginate.ts:9`), `createServiceRoleClient`.

- [ ] Write the failing test `__tests__/lib/db/bookkeeping-payouts.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest"

  // Chainable Supabase mock — house idiom, see __tests__/lib/db/bookkeeping-period-guard.test.ts.
  type Row = Record<string, unknown>
  const state = {
    selectRows: [] as Row[],
    maybeSingleRow: null as Row | null,
    upsertCalls: [] as Array<{ table: string; rows: Row[]; opts: unknown }>,
    selectCalls: [] as Array<{ table: string; cols: string; eqMap: Record<string, string>; inArgs: { col: string; vals: string[] } | null; gteMap: Record<string, string>; lteMap: Record<string, string> }>,
  }
  function resetState() {
    state.selectRows = []; state.maybeSingleRow = null; state.upsertCalls = []; state.selectCalls = []
  }
  function makeBuilder(table: string) {
    let op: "select" | "upsert" | null = null
    let cols = ""
    let upsertRows: Row[] = []
    const eqMap: Record<string, string> = {}
    const gteMap: Record<string, string> = {}
    const lteMap: Record<string, string> = {}
    let inArgs: { col: string; vals: string[] } | null = null
    const resolve = (): Promise<{ data: unknown; error: unknown }> => {
      if (op === "select") {
        state.selectCalls.push({ table, cols, eqMap, inArgs, gteMap, lteMap })
        return Promise.resolve({ data: state.selectRows, error: null })
      }
      // upsert path: echo rows back with ids so the caller can map them
      return Promise.resolve({ data: upsertRows.map((r, i) => ({ id: `row-${i}`, ...r })), error: null })
    }
    const builder = {
      select: (c?: string) => { if (op === null) op = "select"; cols = c ?? ""; return builder },
      upsert: (rows: Row[], opts: unknown) => { op = "upsert"; upsertRows = rows; state.upsertCalls.push({ table, rows, opts }); return builder },
      eq: (c: string, v: string) => { eqMap[c] = v; return builder },
      in: (c: string, vals: string[]) => { inArgs = { col: c, vals }; return builder },
      gte: (c: string, v: string) => { gteMap[c] = v; return builder },
      lte: (c: string, v: string) => { lteMap[c] = v; return builder },
      order: () => builder,
      limit: () => builder,
      range: () => builder,
      maybeSingle: () => {
        state.selectCalls.push({ table, cols, eqMap, inArgs, gteMap, lteMap })
        return Promise.resolve({ data: state.maybeSingleRow, error: null })
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thenable protocol
      then: (onF?: any, onR?: any) => resolve().then(onF, onR),
    }
    return builder
  }
  vi.mock("@/lib/supabase", () => ({
    createServiceRoleClient: () => ({ from: (table: string) => makeBuilder(table) }),
  }))

  import {
    upsertPayouts, upsertPayoutLines, latestPayoutArrivalDate,
    listPayoutsForDedupe, listNonTerminalPayouts, listPayoutLinesForWindow,
  } from "@/lib/db/bookkeeping"

  const BOOK = "b0000000-0000-4000-8000-000000000001"
  const payoutRow = {
    stripe_payout_id: "po_1", book_id: BOOK, amount_cents: 9600, gross_cents: 10000,
    fee_cents: 400, arrival_date: "2026-07-07", status: "paid" as const, currency: "usd", raw: null,
  }

  beforeEach(() => { vi.clearAllMocks(); resetState() })

  describe("upsertPayouts", () => {
    it("MERGE-mode upsert on stripe_payout_id (no ignoreDuplicates — status flips must land)", async () => {
      const out = await upsertPayouts([payoutRow])
      const call = state.upsertCalls.at(-1)!
      expect(call.table).toBe("bookkeeping_payouts")
      expect(call.opts).toEqual({ onConflict: "stripe_payout_id" })
      expect(call.rows[0]).toMatchObject({ stripe_payout_id: "po_1", amount_cents: 9600 })
      expect(out[0]).toMatchObject({ id: "row-0", stripe_payout_id: "po_1" })
    })
    it("empty input → no builder call", async () => {
      expect(await upsertPayouts([])).toEqual([])
      expect(state.upsertCalls).toHaveLength(0)
    })
  })

  describe("upsertPayoutLines", () => {
    it("MERGE-mode upsert on stripe_balance_txn_id, returns count", async () => {
      const n = await upsertPayoutLines([{
        payout_id: "row-0", stripe_balance_txn_id: "txn_1", type: "charge",
        amount_cents: 10000, fee_cents: 400, net_cents: 9600, txn_date: "2026-07-03",
        description: null, source_ref: "ch_1",
      }])
      expect(n).toBe(1)
      expect(state.upsertCalls.at(-1)).toMatchObject({
        table: "bookkeeping_payout_lines", opts: { onConflict: "stripe_balance_txn_id" },
      })
    })
    it("empty input → 0 without a builder call", async () => {
      expect(await upsertPayoutLines([])).toBe(0)
      expect(state.upsertCalls).toHaveLength(0)
    })
  })

  describe("latestPayoutArrivalDate", () => {
    it("returns the newest arrival_date", async () => {
      state.maybeSingleRow = { arrival_date: "2026-07-20" }
      expect(await latestPayoutArrivalDate(BOOK)).toBe("2026-07-20")
      expect(state.selectCalls.at(-1)!.eqMap.book_id).toBe(BOOK)
    })
    it("null when no payouts exist", async () => {
      state.maybeSingleRow = null
      expect(await latestPayoutArrivalDate(BOOK)).toBeNull()
    })
  })

  describe("listPayoutsForDedupe", () => {
    it("selects with the net_cents:amount_cents alias, scoped to book + window", async () => {
      state.selectRows = [{ id: "p1", stripe_payout_id: "po_1", net_cents: 9600, arrival_date: "2026-07-07", status: "paid" }]
      const rows = await listPayoutsForDedupe(BOOK, "2026-07-01", "2026-07-31")
      expect(rows[0].net_cents).toBe(9600)
      const call = state.selectCalls.at(-1)!
      expect(call.cols).toContain("net_cents:amount_cents")
      expect(call.eqMap.book_id).toBe(BOOK)
      expect(call.gteMap.arrival_date).toBe("2026-07-01")
      expect(call.lteMap.arrival_date).toBe("2026-07-31")
    })
  })

  describe("listNonTerminalPayouts", () => {
    it("filters status in (pending, in_transit) for the book", async () => {
      state.selectRows = []
      await listNonTerminalPayouts(BOOK)
      const call = state.selectCalls.at(-1)!
      expect(call.inArgs).toEqual({ col: "status", vals: ["pending", "in_transit"] })
      expect(call.eqMap.book_id).toBe(BOOK)
    })
  })

  describe("listPayoutLinesForWindow", () => {
    it("windows on txn_date inclusive", async () => {
      state.selectRows = [{ txn_date: "2026-07-03", fee_cents: 400, net_cents: 9600, amount_cents: 10000, type: "charge" }]
      const rows = await listPayoutLinesForWindow("2026-07-01", "2026-07-31")
      expect(rows).toHaveLength(1)
      const call = state.selectCalls.at(-1)!
      expect(call.gteMap.txn_date).toBe("2026-07-01")
      expect(call.lteMap.txn_date).toBe("2026-07-31")
    })
  })
  ```
- [ ] Run: `npx vitest run __tests__/lib/db/bookkeeping-payouts.test.ts` — expect failure (missing exports).
- [ ] Add types to `types/database.ts` immediately after line 636 (`export type NewBookkeepingAsset = ...`):
  ```ts
  // ── AI Bookkeeper Track A (6e): Stripe payout mirror ──────────────────────
  export type BookkeepingPayoutStatus = "in_transit" | "paid" | "failed" | "canceled" | "pending"

  export interface BookkeepingPayout {
    id: string
    stripe_payout_id: string
    book_id: string
    amount_cents: number // Stripe payout `amount` = NET
    gross_cents: number
    fee_cents: number
    arrival_date: string
    status: BookkeepingPayoutStatus
    currency: string
    raw: Record<string, unknown> | null
    created_at: string
    updated_at: string
  }
  export type NewBookkeepingPayout = Omit<BookkeepingPayout, "id" | "created_at" | "updated_at">

  export interface BookkeepingPayoutLine {
    id: string
    payout_id: string
    stripe_balance_txn_id: string
    type: string
    amount_cents: number // signed gross
    fee_cents: number
    net_cents: number
    txn_date: string // balance-txn `created`, UTC date
    description: string | null
    source_ref: string | null
    created_at: string
    updated_at: string
  }
  export type NewBookkeepingPayoutLine = Omit<BookkeepingPayoutLine, "id" | "created_at" | "updated_at">
  ```
- [ ] In `lib/db/bookkeeping.ts`, extend the type import block (`:5-9`) with `BookkeepingPayout, NewBookkeepingPayout, NewBookkeepingPayoutLine, BookkeepingPayoutStatus`, then append this section after `pruneExpiredDocuments` (ends `:454`), before the Phase-6a close-guard section:
  ```ts
  // ── Track A (6e): Stripe payout mirror (read model — NEVER the ledger) ─────
  // Merge-mode upserts (no ignoreDuplicates): a re-pulled payout whose status
  // flipped (in_transit→paid, paid→failed) must overwrite the stored row (A-6).
  export async function upsertPayouts(rows: NewBookkeepingPayout[]): Promise<BookkeepingPayout[]> {
    if (rows.length === 0) return []
    const now = new Date().toISOString()
    const { data, error } = await db()
      .from("bookkeeping_payouts")
      .upsert(rows.map((r) => ({ ...r, updated_at: now })), { onConflict: "stripe_payout_id" })
      .select()
    if (error) throw error
    return (data ?? []) as BookkeepingPayout[]
  }

  export async function upsertPayoutLines(rows: NewBookkeepingPayoutLine[]): Promise<number> {
    if (rows.length === 0) return 0
    const now = new Date().toISOString()
    const { data, error } = await db()
      .from("bookkeeping_payout_lines")
      .upsert(rows.map((r) => ({ ...r, updated_at: now })), { onConflict: "stripe_balance_txn_id" })
      .select("id")
    if (error) throw error
    return (data ?? []).length
  }

  /** Latest arrival_date among the book's stored payouts — the payout-sync
   *  cron's watermark (mirrors latestPlatformImportDate). Null when none. */
  export async function latestPayoutArrivalDate(bookId: string): Promise<string | null> {
    const { data, error } = await db()
      .from("bookkeeping_payouts")
      .select("arrival_date")
      .eq("book_id", bookId)
      .order("arrival_date", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data as { arrival_date: string } | null)?.arrival_date ?? null
  }

  export interface PayoutLineWindowRow {
    txn_date: string; fee_cents: number; net_cents: number; amount_cents: number; type: string
  }
  /** Windowed payout lines for the net-revenue report layer. fetchAllRows —
   *  growth table (blanket rule: no bare .select() over growth tables). */
  export async function listPayoutLinesForWindow(from: string, to: string): Promise<PayoutLineWindowRow[]> {
    return fetchAllRows<PayoutLineWindowRow>((f, t) =>
      db().from("bookkeeping_payout_lines")
        .select("txn_date,fee_cents,net_cents,amount_cents,type")
        .gte("txn_date", from).lte("txn_date", to)
        .order("txn_date", { ascending: true }).order("id", { ascending: true })
        .range(f, t) as never)
  }

  export interface PayoutDedupeRow {
    id: string; stripe_payout_id: string; net_cents: number; arrival_date: string; status: BookkeepingPayoutStatus
  }
  /** Payouts for the statement-dedupe exact layer. PostgREST column alias maps
   *  amount_cents (payout NET) → net_cents to match PayoutRef. Paginated. */
  export async function listPayoutsForDedupe(bookId: string, from: string, to: string): Promise<PayoutDedupeRow[]> {
    return fetchAllRows<PayoutDedupeRow>((f, t) =>
      db().from("bookkeeping_payouts")
        .select("id,stripe_payout_id,net_cents:amount_cents,arrival_date,status")
        .eq("book_id", bookId).gte("arrival_date", from).lte("arrival_date", to)
        .order("arrival_date", { ascending: true }).range(f, t) as never)
  }

  /** Stored payouts whose status can still change — the sync route re-pulls
   *  these by id every run (eligibility arm; income-sync watermark lesson). */
  export async function listNonTerminalPayouts(bookId: string): Promise<BookkeepingPayout[]> {
    return fetchAllRows<BookkeepingPayout>((f, t) =>
      db().from("bookkeeping_payouts").select("*")
        .eq("book_id", bookId).in("status", ["pending", "in_transit"])
        .order("arrival_date", { ascending: true }).range(f, t) as never)
  }
  ```
- [ ] Run: `npx vitest run __tests__/lib/db/bookkeeping-payouts.test.ts` — expect all pass. Also `npx vitest run __tests__/lib/db/bookkeeping-period-guard.test.ts` — unchanged, must stay green.
- [ ] Commit: write to `a4-msg.txt` in scratchpad, `git add types/database.ts lib/db/bookkeeping.ts __tests__/lib/db/bookkeeping-payouts.test.ts`, `git commit -F "<scratchpad>\a4-msg.txt"`:
  ```
  feat(bookkeeping): payout mirror types + DAL (merge upserts, watermark, window/dedupe reads)

  upsertPayouts/upsertPayoutLines are merge-mode (status flips land),
  all growth-table reads fetchAllRows-paginated, listPayoutsForDedupe
  aliases amount_cents->net_cents for the dedupe layer.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

### Task A5: Payout-sync internal route + audit slug + EXPECTED_CRONS entry

**Files:**
- Create: `app/api/admin/internal/bookkeeping-payout-sync/route.ts` (byte-for-byte the income-sync template `app/api/admin/internal/bookkeeping-income-sync/route.ts`, adapted)
- Modify: `lib/audit/actions.ts` (insert after line 260, `bookkeeping.income_synced`)
- Modify: `lib/automation/automation-health-scanner.ts` (insert after line 34, `bookkeepingIncomeSyncCron`)
- Create: `__tests__/api/admin/internal/bookkeeping-payout-sync.test.ts` (mirrors `__tests__/api/admin/internal/bookkeeping-income-sync.test.ts` — cited as the mock-style source)

**Interfaces:**
- Consumes: `stripe` (`lib/stripe.ts`), `computePayoutSyncWindow` (A3), `listBooks, latestPayoutArrivalDate, listNonTerminalPayouts, upsertPayouts, upsertPayoutLines` (A4), `isCronSkipped` (`lib/db/system-settings.ts:52`), `logCronStart/logCronEnd` (`lib/db/cron-runs.ts:17/33`), `recordAudit` (`lib/audit/record.ts`).
- Produces: `POST` handler; cron_runs single owner `"bookkeepingPayoutSyncCron"`; audit action `bookkeeping.payout_synced` (commerce, system actor, only when `upserted > 0`); EXPECTED_CRONS entry `{ name: "bookkeepingPayoutSyncCron", sla_hours: 30 }`. Never touches the shared Stripe webhook, `payments`, or any ledger table.

- [ ] Write the failing test `__tests__/api/admin/internal/bookkeeping-payout-sync.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest"

  vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: vi.fn() }))
  vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
  vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: vi.fn(), logCronEnd: vi.fn() }))
  vi.mock("@/lib/db/bookkeeping", () => ({
    listBooks: vi.fn(), latestPayoutArrivalDate: vi.fn(), listNonTerminalPayouts: vi.fn(),
    upsertPayouts: vi.fn(), upsertPayoutLines: vi.fn(),
  }))
  vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
  vi.mock("@/lib/stripe", () => ({
    stripe: {
      payouts: { list: vi.fn(), retrieve: vi.fn() },
      balanceTransactions: { list: vi.fn() },
    },
  }))

  import { isCronSkipped } from "@/lib/db/system-settings"
  import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
  import {
    listBooks, latestPayoutArrivalDate, listNonTerminalPayouts, upsertPayouts, upsertPayoutLines,
  } from "@/lib/db/bookkeeping"
  import { recordAudit } from "@/lib/audit/record"
  import { stripe } from "@/lib/stripe"
  import { POST } from "@/app/api/admin/internal/bookkeeping-payout-sync/route"

  const TOKEN = "test-cron-token"
  const AUTH = `Bearer ${TOKEN}`
  const BOOK = "b0000000-0000-4000-8000-000000000001"

  const books = [
    { id: "b0000000-0000-4000-8000-000000000003", name: "Household & Personal", book_kind: "household", is_primary: false, owner_label: "Shared", sort_order: 2, archived_at: null },
    { id: BOOK, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, owner_label: "Darren", sort_order: 0, archived_at: null },
  ]
  // 2026-07-07T00:00:00Z = 1783382400 s; 2026-07-03 = 1783036800 s
  const stripePayout = { id: "po_1", amount: 9600, arrival_date: 1783382400, status: "paid", currency: "usd", created: 1783036800 }
  const chargeTxn = { id: "txn_1", type: "charge", amount: 10000, fee: 400, net: 9600, created: 1783036800, description: "Client payment", source: "ch_1" }
  // The payout's OWN balance txn shows up in the per-payout listing — must be filtered out of lines.
  const selfTxn = { id: "txn_self", type: "payout", amount: -9600, fee: 0, net: -9600, created: 1783382400, description: "STRIPE PAYOUT", source: "po_1" }
  const pager = <T,>(items: T[]) => ({ autoPagingToArray: vi.fn().mockResolvedValue(items) })

  function makeRequest(authHeader = AUTH): Request {
    return new Request("http://localhost/api/admin/internal/bookkeeping-payout-sync", {
      method: "POST", headers: { authorization: authHeader },
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INTERNAL_CRON_TOKEN = TOKEN
    ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: false })
    ;(logCronStart as ReturnType<typeof vi.fn>).mockResolvedValue("run-1")
    ;(logCronEnd as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(listBooks as ReturnType<typeof vi.fn>).mockResolvedValue(books)
    ;(latestPayoutArrivalDate as ReturnType<typeof vi.fn>).mockResolvedValue("2026-07-20")
    ;(listNonTerminalPayouts as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(stripe.payouts.list as ReturnType<typeof vi.fn>).mockReturnValue(pager([stripePayout]))
    ;(stripe.balanceTransactions.list as ReturnType<typeof vi.fn>).mockReturnValue(pager([chargeTxn, selfTxn]))
    ;(upsertPayouts as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "bp-1", stripe_payout_id: "po_1" }])
    ;(upsertPayoutLines as ReturnType<typeof vi.fn>).mockResolvedValue(1)
  })

  describe("POST /api/admin/internal/bookkeeping-payout-sync", () => {
    it("401 with a missing bearer token", async () => {
      const res = await POST(makeRequest(""))
      expect(res.status).toBe(401)
      expect(isCronSkipped).not.toHaveBeenCalled()
    })

    it("401 with a wrong bearer token", async () => {
      expect((await POST(makeRequest("Bearer wrong"))).status).toBe(401)
    })

    it("200 {skipped} with no logCronStart when the flag is off", async () => {
      ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: true, reason: "disabled" })
      const res = await POST(makeRequest())
      expect(res.status).toBe(200)
      expect((await res.json()).skipped).toBe("disabled")
      expect(logCronStart).not.toHaveBeenCalled()
      expect(upsertPayouts).not.toHaveBeenCalled()
    })

    it("happy path: watermark-windowed list, self-payout txn filtered, gross/fee derived, audit on upserted > 0", async () => {
      const res = await POST(makeRequest())
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ok: true, upserted: 1, upserted_lines: 1 })
      expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "bookkeepingPayoutSyncCron")
      // Window from the watermark: 2026-07-20 − 14d = 2026-07-06 = 1783296000 s
      expect(stripe.payouts.list).toHaveBeenCalledWith({ limit: 100, arrival_date: { gte: 1783296000 } })
      // Payout row: amount is NET; gross/fee are Σ over NON-payout lines only
      const payoutRows = (upsertPayouts as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(payoutRows).toEqual([expect.objectContaining({
        stripe_payout_id: "po_1", book_id: BOOK, amount_cents: 9600,
        gross_cents: 10000, fee_cents: 400, arrival_date: "2026-07-07", status: "paid",
      })])
      // Lines: the type:"payout" self-txn must NOT be stored
      const lineRows = (upsertPayoutLines as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(lineRows).toEqual([expect.objectContaining({
        payout_id: "bp-1", stripe_balance_txn_id: "txn_1", type: "charge",
        amount_cents: 10000, fee_cents: 400, net_cents: 9600, txn_date: "2026-07-03", source_ref: "ch_1",
      })])
      expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: "bookkeeping.payout_synced", category: "commerce", outcome: "success",
        actor: expect.objectContaining({ role: "system" }),
      }))
      expect(logCronEnd).toHaveBeenCalledWith(
        expect.anything(), "run-1", "success", expect.objectContaining({ upserted: 1, window_from: "2026-07-06" }),
      )
    })

    it("cold start (null watermark) lists with NO arrival_date bound (full history)", async () => {
      ;(latestPayoutArrivalDate as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      await POST(makeRequest())
      expect(stripe.payouts.list).toHaveBeenCalledWith({ limit: 100 })
    })

    it("eligibility arm: a stored in_transit payout outside the window is re-pulled by id", async () => {
      ;(stripe.payouts.list as ReturnType<typeof vi.fn>).mockReturnValue(pager([]))
      ;(listNonTerminalPayouts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "bp-2", stripe_payout_id: "po_flip", status: "in_transit", book_id: BOOK, arrival_date: "2026-05-01" },
      ])
      ;(stripe.payouts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue(
        { ...stripePayout, id: "po_flip", status: "paid" },
      )
      ;(upsertPayouts as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "bp-2", stripe_payout_id: "po_flip" }])
      const res = await POST(makeRequest())
      expect(res.status).toBe(200)
      expect(stripe.payouts.retrieve).toHaveBeenCalledWith("po_flip")
      const payoutRows = (upsertPayouts as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(payoutRows[0]).toMatchObject({ stripe_payout_id: "po_flip", status: "paid" })
    })

    it("gross − fee ≠ payout amount → reconciliation warning in detail (run still succeeds)", async () => {
      ;(stripe.balanceTransactions.list as ReturnType<typeof vi.fn>).mockReturnValue(
        pager([{ ...chargeTxn, fee: 500, net: 9500 }, selfTxn]), // 10000−500=9500 ≠ 9600
      )
      const res = await POST(makeRequest())
      expect(res.status).toBe(200)
      const detail = (logCronEnd as ReturnType<typeof vi.fn>).mock.calls[0][3]
      expect(detail.warnings.some((w: string) => w.includes("po_1"))).toBe(true)
    })

    it("zero payouts: success, upserted 0, NO audit row", async () => {
      ;(stripe.payouts.list as ReturnType<typeof vi.fn>).mockReturnValue(pager([]))
      ;(upsertPayouts as ReturnType<typeof vi.fn>).mockResolvedValue([])
      const res = await POST(makeRequest())
      expect(res.status).toBe(200)
      expect(recordAudit).not.toHaveBeenCalled()
      expect(logCronEnd).toHaveBeenCalledWith(
        expect.anything(), "run-1", "success", expect.objectContaining({ upserted: 0 }),
      )
    })

    it("a Stripe read failure → 500 + logCronEnd failed (fail-closed; watchdog is the alarm)", async () => {
      ;(stripe.payouts.list as ReturnType<typeof vi.fn>).mockReturnValue({
        autoPagingToArray: vi.fn().mockRejectedValue(new Error("stripe boom")),
      })
      const res = await POST(makeRequest())
      expect(res.status).toBe(500)
      expect(upsertPayouts).not.toHaveBeenCalled()
      expect(logCronEnd).toHaveBeenCalledWith(
        expect.anything(), "run-1", "failed",
        expect.objectContaining({ message: expect.stringContaining("stripe boom") }),
      )
    })

    it("no primary business book → 500 + logCronEnd failed", async () => {
      ;(listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([books[0]])
      const res = await POST(makeRequest())
      expect(res.status).toBe(500)
      expect(logCronEnd).toHaveBeenCalledWith(
        expect.anything(), "run-1", "failed",
        expect.objectContaining({ message: expect.stringContaining("primary business book") }),
      )
    })
  })
  ```
- [ ] Run: `npx vitest run __tests__/api/admin/internal/bookkeeping-payout-sync.test.ts` — expect failure (route missing).
- [ ] Implement `app/api/admin/internal/bookkeeping-payout-sync/route.ts`:
  ```ts
  // Called by functions bookkeepingPayoutSyncCron (daily 05:15 UTC). READS the
  // Stripe API (payouts + per-payout balance transactions) into the
  // bookkeeping_payouts mirror — never the webhook, never payments, never any
  // ledger table (reconcile-by-read only). Idempotent: merge upserts on plain
  // UNIQUE stripe_payout_id / stripe_balance_txn_id, so status flips land.
  // SINGLE cron_runs owner under "bookkeepingPayoutSyncCron" — functions/ must not log.
  import { NextRequest, NextResponse } from "next/server"
  import type Stripe from "stripe"
  import { stripe } from "@/lib/stripe"
  import { isCronSkipped } from "@/lib/db/system-settings"
  import { createServiceRoleClient } from "@/lib/supabase"
  import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
  import {
    listBooks, latestPayoutArrivalDate, listNonTerminalPayouts, upsertPayouts, upsertPayoutLines,
  } from "@/lib/db/bookkeeping"
  import { computePayoutSyncWindow } from "@/lib/bookkeeping/payout-sync-window"
  import { recordAudit } from "@/lib/audit/record"
  import type { BookkeepingPayoutStatus, NewBookkeepingPayout, NewBookkeepingPayoutLine } from "@/types/database"

  export const runtime = "nodejs"
  export const maxDuration = 300

  const WARNINGS_CAP = 20
  // Backlog discipline: per-run cap on payout line-fetches; oldest-first, so a
  // capped cold start resumes exactly where it stopped (watermark = stored
  // max(arrival_date)). more_pending surfaces the remainder in detail.
  const MAX_PAYOUTS_PER_RUN = 200
  const PAYOUT_STATUSES: readonly string[] = ["in_transit", "paid", "failed", "canceled", "pending"]

  function epochToIsoDate(epochSeconds: number): string {
    return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
  }

  export async function POST(request: NextRequest) {
    const expected = process.env.INTERNAL_CRON_TOKEN
    const authHeader = request.headers.get("authorization") ?? ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
    if (!expected || !bearer || bearer !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const gate = await isCronSkipped({
      enabledKey: "cron_bookkeeping_payout_sync_enabled",
      defaultEnabled: false,
    })
    if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

    const supabase = createServiceRoleClient()
    const runId = await logCronStart(supabase, "bookkeepingPayoutSyncCron")
    try {
      const books = await listBooks()
      const book = books.find((b) => b.is_primary && b.book_kind === "business")
      if (!book) throw new Error("No primary business book found")

      const today = new Date().toISOString().slice(0, 10)
      const watermark = await latestPayoutArrivalDate(book.id)
      const window = computePayoutSyncWindow(watermark, today)

      const listed: Stripe.Payout[] = await stripe.payouts
        .list({
          limit: 100,
          ...(window.fromEpochSeconds != null ? { arrival_date: { gte: window.fromEpochSeconds } } : {}),
        })
        .autoPagingToArray({ limit: 10000 })

      // Eligibility arm (the income-sync watermark lesson — key on eligibility,
      // not creation time): re-pull every stored non-terminal payout by id, so
      // an in_transit→paid or paid→failed flip can never strand outside the
      // arrival-date window.
      const warnings: string[] = []
      const listedIds = new Set(listed.map((p) => p.id))
      const nonTerminal = await listNonTerminalPayouts(book.id)
      for (const stored of nonTerminal) {
        if (listedIds.has(stored.stripe_payout_id)) continue
        const fresh = await stripe.payouts.retrieve(stored.stripe_payout_id)
        listed.push(fresh)
        listedIds.add(fresh.id)
      }

      listed.sort((a, b) => a.arrival_date - b.arrival_date) // oldest-first
      const morePending = listed.length > MAX_PAYOUTS_PER_RUN
      const batch = listed.slice(0, MAX_PAYOUTS_PER_RUN)

      const payoutRows: NewBookkeepingPayout[] = []
      const lineRowsByPayout = new Map<string, Array<Omit<NewBookkeepingPayoutLine, "payout_id">>>()
      for (const p of batch) {
        const txns: Stripe.BalanceTransaction[] = await stripe.balanceTransactions
          .list({ payout: p.id, limit: 100 })
          .autoPagingToArray({ limit: 10000 })
        // Landmine: the payout's own type:"payout" balance txn appears in this
        // listing — it is the transfer itself, not a constituent line.
        const lines = txns.filter((t) => t.type !== "payout")
        const gross = lines.reduce((s, t) => s + t.amount, 0)
        const fee = lines.reduce((s, t) => s + t.fee, 0)
        if (gross - fee !== p.amount) {
          // The gross−fee−net reconciliation trace — warn, never fail the run.
          warnings.push(`payout ${p.id}: gross ${gross} − fee ${fee} = ${gross - fee} ≠ payout net ${p.amount}`)
        }
        const status: BookkeepingPayoutStatus = PAYOUT_STATUSES.includes(p.status)
          ? (p.status as BookkeepingPayoutStatus)
          : "pending"
        payoutRows.push({
          stripe_payout_id: p.id, book_id: book.id, amount_cents: p.amount,
          gross_cents: gross, fee_cents: fee,
          arrival_date: epochToIsoDate(p.arrival_date), status,
          currency: p.currency, raw: p as unknown as Record<string, unknown>,
        })
        lineRowsByPayout.set(p.id, lines.map((t) => ({
          stripe_balance_txn_id: t.id, type: t.type, amount_cents: t.amount,
          fee_cents: t.fee, net_cents: t.net, txn_date: epochToIsoDate(t.created),
          description: t.description ?? null,
          source_ref: typeof t.source === "string" ? t.source : (t.source?.id ?? null),
        })))
      }

      const upserted = await upsertPayouts(payoutRows)
      const idByStripeId = new Map(upserted.map((r) => [r.stripe_payout_id, r.id]))
      const lineRows: NewBookkeepingPayoutLine[] = []
      for (const [stripePayoutId, rows] of lineRowsByPayout) {
        const payoutId = idByStripeId.get(stripePayoutId)
        if (!payoutId) continue
        for (const r of rows) lineRows.push({ ...r, payout_id: payoutId })
      }
      const upsertedLines = await upsertPayoutLines(lineRows)

      const detail = {
        upserted: upserted.length, upserted_lines: upsertedLines,
        listed: listed.length, more_pending: morePending,
        window_from: window.fromDate, window_to: window.to,
        warnings: warnings.slice(0, WARNINGS_CAP),
      }
      if (upserted.length > 0) {
        void recordAudit({
          action: "bookkeeping.payout_synced",
          category: "commerce",
          outcome: "success",
          actor: { id: null, email: "bookkeepingPayoutSyncCron", role: "system" },
          target: { type: "bookkeeping_book", id: book.id },
          metadata: detail,
        })
      }
      await logCronEnd(supabase, runId, "success", detail)
      return NextResponse.json({ ok: true, ...detail })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error("[bookkeeping-payout-sync] failed:", err)
      await logCronEnd(supabase, runId, "failed", { message })
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }
  ```
- [ ] Register the audit slug — in `lib/audit/actions.ts`, insert after line 260 (`bookkeeping.income_synced`):
  ```ts
    { slug: "bookkeeping.payout_synced", category: "commerce", description: "Nightly cron ingested Stripe payouts into the payout mirror" },
  ```
- [ ] Register the watchdog entry — in `lib/automation/automation-health-scanner.ts`, insert after line 34 (`bookkeepingIncomeSyncCron`):
  ```ts
    { name: "bookkeepingPayoutSyncCron", sla_hours: 30 },  // daily 05:15
  ```
  (Never-run crons don't alert — `if (!last) continue` at `:67` — so pre-launch append is safe; the scanner tests are generic over `EXPECTED_CRONS[0]`, not a pinned list.)
- [ ] Run: `npx vitest run __tests__/api/admin/internal/bookkeeping-payout-sync.test.ts __tests__/lib/automation/automation-health-scanner.test.ts __tests__/lib/bookkeeping/receipt-validators.test.ts` — expect all pass.
- [ ] Commit: write to `a5-msg.txt` in scratchpad, `git add app/api/admin/internal/bookkeeping-payout-sync/route.ts lib/audit/actions.ts lib/automation/automation-health-scanner.ts __tests__/api/admin/internal/bookkeeping-payout-sync.test.ts`, `git commit -F "<scratchpad>\a5-msg.txt"`:
  ```
  feat(bookkeeping): payout-sync internal route (flag-gated, oldest-first cap 200, eligibility re-pull)

  Income-sync template: Bearer triple-clause, isCronSkipped, single cron_runs
  owner bookkeepingPayoutSyncCron, fail-closed 500. Filters the payout's own
  type:payout balance txn; gross-fee-net reconciliation warning; audit
  bookkeeping.payout_synced only on upserted>0; EXPECTED_CRONS sla 30h.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

### Task A6: Functions delegator `bookkeepingPayoutSyncCron` (05:15 UTC)

**Files:**
- Modify: `functions/src/index.ts` — append at the file TAIL, after `reapStaleAiJobsCron` (closes at `:2085`, end of file)

**Interfaces:**
- Consumes: existing module-level secrets `internalCronToken` + `appUrl` (already defined near the top of `functions/src/index.ts` — reuse, do NOT redeclare), `onSchedule` (already imported).
- Produces: `export const bookkeepingPayoutSyncCron` — pure fetch-delegator, console-only error handling, NO cron_runs (route is the single owner), NO Stripe secret (key lives Vercel-side). Verified: no delegator in this file has a functions-side test (checked `functions/src/__tests__/` — none exists for `bookkeepingIncomeSyncCron`), so none is added here.

- [ ] Append to `functions/src/index.ts` after the `reapStaleAiJobsCron` closing `)` at line 2085:
  ```ts

  // Bookkeeping payout sync. POSTs to /api/admin/internal/bookkeeping-payout-sync,
  // which READS Stripe payouts + balance transactions into the
  // bookkeeping_payouts mirror (idempotent merge upserts on plain UNIQUE
  // stripe_payout_id / stripe_balance_txn_id) — never the webhook, never the
  // ledger. Gated by system_settings.cron_bookkeeping_payout_sync_enabled
  // (default false, seeded by migration 00191). 05:15 UTC — after income-sync
  // (04:30) so payout-net dedupe sees the night's freshly posted income. The
  // route owns logCronStart/logCronEnd under "bookkeepingPayoutSyncCron" —
  // this function must NOT log cron_runs itself (single-owner rule). Pure
  // fetch-delegator: only internalCronToken + appUrl (Stripe key stays Vercel-side).
  export const bookkeepingPayoutSyncCron = onSchedule(
    {
      schedule: "15 5 * * *",
      timeZone: "Etc/UTC",
      timeoutSeconds: 120,
      memory: "256MiB",
      region: "us-central1",
      secrets: [internalCronToken, appUrl],
    },
    async () => {
      const baseUrl = process.env.APP_URL
      const token = process.env.INTERNAL_CRON_TOKEN
      if (!baseUrl || !token) {
        console.error("[bookkeepingPayoutSyncCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
        return
      }
      try {
        const res = await fetch(`${baseUrl}/api/admin/internal/bookkeeping-payout-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: "{}",
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          console.error("[bookkeepingPayoutSyncCron]", res.status, body)
          return
        }
        console.log("[bookkeepingPayoutSyncCron]", res.status, body)
      } catch (err) {
        console.error("[bookkeepingPayoutSyncCron] failed:", err)
      }
    },
  )
  ```
- [ ] Build the functions workspace: `npm --prefix functions run build` — expect a clean tsc exit.
- [ ] Run the functions suite (index.ts is imported by nothing test-side, but keep the touched-workspace gate): `npm --prefix functions run test:run` if that script exists, else `npx --prefix functions vitest run` from `functions/` — expect green (same baseline as before this task).
- [ ] Commit: write to `a6-msg.txt` in scratchpad, `git add functions/src/index.ts`, `git commit -F "<scratchpad>\a6-msg.txt"`:
  ```
  feat(bookkeeping): bookkeepingPayoutSyncCron delegator (daily 05:15 UTC)

  Pure fetch-delegator to /api/admin/internal/bookkeeping-payout-sync;
  secrets internalCronToken+appUrl only, no cron_runs (route owns logging).

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

### Task A7: Pure fee aggregation `stripeFeesInWindow`

**Files:**
- Create: `lib/bookkeeping/payout-fees.ts`
- Create: `__tests__/lib/bookkeeping/payout-fees.test.ts` (zero-mock)

**Interfaces:**
- Produces: `export interface PayoutLineRef { txn_date: string; fee_cents: number }` and `export function stripeFeesInWindow(lines: PayoutLineRef[], from: string, to: string): number`. Structurally satisfied by `PayoutLineWindowRow` (A4) — the DAL rows pass straight in. Fees attribute by **balance-txn date** (Decision A-3), inclusive window both ends.
- Consumed by: Task A8 surfaces.

- [ ] Write the failing test `__tests__/lib/bookkeeping/payout-fees.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest"
  import { stripeFeesInWindow } from "@/lib/bookkeeping/payout-fees"

  // Unique prime-ish fee values: any wrong boundary inclusion/exclusion
  // produces a sum no other subset can produce (mutation-discriminating).
  const lines = [
    { txn_date: "2026-06-30", fee_cents: 111 },  // day before from — excluded
    { txn_date: "2026-07-01", fee_cents: 257 },  // from day — included
    { txn_date: "2026-07-15", fee_cents: 389 },  // mid — included
    { txn_date: "2026-07-31", fee_cents: 643 },  // to day — included
    { txn_date: "2026-08-01", fee_cents: 1009 }, // day after to — excluded
  ]

  describe("stripeFeesInWindow", () => {
    it("sums fee_cents over txn_date in [from, to] inclusive both ends", () => {
      expect(stripeFeesInWindow(lines, "2026-07-01", "2026-07-31")).toBe(257 + 389 + 643) // 1289
    })
    it("boundary days count; adjacent days do not (discriminates > vs >= and < vs <=)", () => {
      expect(stripeFeesInWindow(lines, "2026-06-30", "2026-06-30")).toBe(111)
      expect(stripeFeesInWindow(lines, "2026-07-02", "2026-07-30")).toBe(389)
    })
    it("empty lines → 0 (the honest pre-first-sync state)", () => {
      expect(stripeFeesInWindow([], "2026-01-01", "2026-12-31")).toBe(0)
    })
    it("all lines outside the window → 0", () => {
      expect(stripeFeesInWindow(lines, "2027-01-01", "2027-12-31")).toBe(0)
    })
  })
  ```
- [ ] Run: `npx vitest run __tests__/lib/bookkeeping/payout-fees.test.ts` — expect failure.
- [ ] Implement `lib/bookkeeping/payout-fees.ts`:
  ```ts
  // Pure fee aggregation for the net-revenue report layer (Track A §1.4).
  // Fees attribute by BALANCE-TXN date, not payout arrival date (Decision A-3),
  // so the fee sum aligns with the same window as gross income — a January
  // charge paid out in February counts against January. Honest caveat rendered
  // beside the number: fees appear only after their payout is ingested.
  // type:"payout" self-rows are never stored (filtered at sync), so every line
  // here is a constituent transaction. Integer cents end-to-end.
  export interface PayoutLineRef {
    txn_date: string // YYYY-MM-DD
    fee_cents: number
  }

  export function stripeFeesInWindow(lines: PayoutLineRef[], from: string, to: string): number {
    let total = 0
    for (const l of lines) {
      if (l.txn_date >= from && l.txn_date <= to) total += l.fee_cents
    }
    return total
  }
  ```
- [ ] Run: `npx vitest run __tests__/lib/bookkeeping/payout-fees.test.ts` — expect 4 passed.
- [ ] Commit: write to `a7-msg.txt` in scratchpad, `git add lib/bookkeeping/payout-fees.ts __tests__/lib/bookkeeping/payout-fees.test.ts`, `git commit -F "<scratchpad>\a7-msg.txt"`:
  ```
  feat(bookkeeping): pure stripeFeesInWindow (fee-by-balance-txn-date, inclusive window)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

### Task A8: Net-revenue surfaces (reports JSON + page, pack, print, email copy)

**Files:**
- Modify: `lib/bookkeeping/report-data.ts` (whole file is 21 lines — bundle gains `payoutLines`)
- Modify: `app/api/admin/bookkeeping/reports/route.ts` (payload map `:19-28`)
- Modify: `components/admin/bookkeeping/ReportsClient.tsx` (`BookReport` interface `:17-23`; disclaimer `:100-102`; "Total gross income" row `:267-271`)
- Modify: `lib/bookkeeping/accountant-pack.ts` (`AccountantPackInput` `:14-22`; Read-Me line `:133`; Summary `:143-147`; Income-by-Service `:149-158`)
- Modify: `app/api/admin/bookkeeping/reports/accountant-pack/route.ts`, `app/api/admin/bookkeeping/reports/email-pack/route.ts`, `app/api/admin/internal/bookkeeping-quarterly-pack/route.ts` (pass the new pack input)
- Modify: `app/(admin)/admin/books/reports/print/page.tsx` (disclaimer `:109-112`; "Total gross income" rows `:158-162`; `loadPrintData` `:28-35`)
- Modify: `lib/bookkeeping/email-pack.ts` (bullet `:21`, subject `:37`)
- Modify tests: `__tests__/app/api/admin/bookkeeping/reports.test.ts`, `__tests__/lib/bookkeeping/accountant-pack.test.ts`, `__tests__/lib/bookkeeping/email-pack.test.ts`

**Interfaces:**
- Consumes: `listPayoutLinesForWindow`, `PayoutLineWindowRow` (A4); `stripeFeesInWindow` (A7).
- Produces: `ReportBundle` gains `payoutLines: PayoutLineWindowRow[]`; reports JSON per-book payload gains `stripe_fee_cents: number` + `net_income_cents: number` (fee attaches ONLY to the primary business book; 0 elsewhere); `AccountantPackInput` gains required `stripe_fee_cents: number`. QBO CSV **unchanged** (no legal slot in the 4-column format); P&L blocks unchanged (fees are not an account). Gross stays primary everywhere (D3).

- [ ] Update the reports JSON route test first — in `__tests__/app/api/admin/bookkeeping/reports.test.ts`, extend the `beforeEach` `loadReportBundle` mock return (`:18-25`) with `payoutLines: [{ txn_date: "2026-07-02", fee_cents: 73, net_cents: 1427, amount_cents: 1500, type: "charge" }]`, and add this test inside the describe block:
  ```ts
    it("attaches stripe_fee_cents + net_income_cents to the primary business book only", async () => {
      const res = await GET(req("from=2026-07-01&to=2026-07-31"))
      expect(res.status).toBe(200)
      const body = await res.json()
      // 1500 gross income − 73 fee = 1427 net (fee 73 is a mutation discriminator:
      // no other fixture arithmetic produces it)
      expect(body.books[0].stripe_fee_cents).toBe(73)
      expect(body.books[0].net_income_cents).toBe(1427)
    })
    it("a line dated outside the window contributes no fee", async () => {
      ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue({
        books: [{ id: BOOK, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, currency: "usd", sort_order: 0 }],
        accounts: [],
        entries: [
          { book_id: BOOK, account_id: null, direction: "income", amount_cents: 1500, occurred_on: "2026-07-02", counterparty: null, memo: null, source: "manual" },
        ],
        payoutLines: [{ txn_date: "2026-08-02", fee_cents: 73, net_cents: 1427, amount_cents: 1500, type: "charge" }],
      })
      const res = await GET(req("from=2026-07-01&to=2026-07-31"))
      const body = await res.json()
      expect(body.books[0].stripe_fee_cents).toBe(0)
      expect(body.books[0].net_income_cents).toBe(1500)
    })
  ```
  Run `npx vitest run __tests__/app/api/admin/bookkeeping/reports.test.ts` — expect the two new tests to fail.
- [ ] Rewrite `lib/bookkeeping/report-data.ts` in full:
  ```ts
  /** Server-side fetch bundle for report surfaces (JSON route, CSV route,
   *  pack route, print page) — one place that knows which DAL readers a
   *  report needs. Server-only (DAL is service-role). payoutLines feed the
   *  net-revenue second line (Track A §1.4) — gross stays primary (D3). */
  import { listBooks, listAccountsForReports, listEntriesForReports, listPayoutLinesForWindow } from "@/lib/db/bookkeeping"
  import type { PayoutLineWindowRow } from "@/lib/db/bookkeeping"
  import type { ReportAccount, ReportEntry } from "@/lib/bookkeeping/reports"
  import type { BookkeepingBook } from "@/types/database"

  export interface ReportBundle {
    books: BookkeepingBook[]
    accounts: ReportAccount[]
    entries: ReportEntry[]
    payoutLines: PayoutLineWindowRow[]
  }

  export async function loadReportBundle(from: string, to: string): Promise<ReportBundle> {
    const [books, accounts, entries, payoutLines] = await Promise.all([
      listBooks(),
      listAccountsForReports(),
      listEntriesForReports(from, to),
      listPayoutLinesForWindow(from, to),
    ])
    return { books, accounts, entries, payoutLines }
  }
  ```
- [ ] In `app/api/admin/bookkeeping/reports/route.ts`: add `import { stripeFeesInWindow } from "@/lib/bookkeeping/payout-fees"`; replace lines 17-28 with:
  ```ts
      const bundle = await loadReportBundle(from, to)
      const { books, accounts, entries } = bundle
      // ?? [] keeps older test doubles of loadReportBundle (pre-payoutLines) valid;
      // the real bundle always supplies the array.
      const stripeFees = stripeFeesInWindow(bundle.payoutLines ?? [], from, to)
      const summaries = perBookSummary(entries, books)
      const payload = books.map((book) => {
        const bookEntries = entries.filter((e) => e.book_id === book.id)
        const incomeByService = incomeByServiceLine(bookEntries, accounts)
        // Payouts only ever ingest into the primary business book (sync route);
        // every other book reports 0 fees and net == gross.
        const feeCents = book.is_primary && book.book_kind === "business" ? stripeFees : 0
        return {
          book: { id: book.id, name: book.name, book_kind: book.book_kind, is_primary: book.is_primary, currency: book.currency },
          summary: summaries.find((s) => s.book_id === book.id)!,
          income_by_service: incomeByService,
          pnl: profitAndLossByCategory(bookEntries, accounts),
          row_count: bookEntries.length,
          stripe_fee_cents: feeCents,
          net_income_cents: incomeByService.total_cents - feeCents,
        }
      })
      return NextResponse.json({ from, to, books: payload })
  ```
  Run `npx vitest run __tests__/app/api/admin/bookkeeping/reports.test.ts` — expect all pass (including the 4 pre-existing tests).
- [ ] `components/admin/bookkeeping/ReportsClient.tsx`: (1) add `stripe_fee_cents: number` and `net_income_cents: number` to `BookReport` (`:17-23`); (2) replace the disclaimer text at `:101` with:
  ```
  Gross figures stay primary; Stripe processing fees from ingested payouts appear as a labeled net line (est.). Estimates for planning; your CPA files.
  ```
  (3) after the "Total gross income" `<tr>` (`:267-271`), inside the same `<tbody>`, add (business primary book only; honest `$0.00 recorded` pre-first-sync per spec §6):
  ```tsx
  {active.book.is_primary && active.book.book_kind === "business" ? (
    <>
      <tr>
        <td className="py-1.5 pr-4 text-muted-foreground">Stripe processing fees (est., from ingested payouts)</td>
        <td />
        <td className="py-1.5 pr-4 text-muted-foreground">
          {active.stripe_fee_cents === 0 ? "$0.00 recorded" : `−${formatCents(active.stripe_fee_cents)}`}
        </td>
      </tr>
      <tr>
        <td className="py-1.5 pr-4 font-semibold">Net income after Stripe fees (est.)</td>
        <td />
        <td className="py-1.5 pr-4 font-semibold">{formatCents(active.net_income_cents)}</td>
      </tr>
    </>
  ) : null}
  ```
- [ ] Update the pack test before touching the builder — in `__tests__/lib/bookkeeping/accountant-pack.test.ts`: add `stripe_fee_cents: 0` to every existing `buildAccountantPack({ ... })` call, EXCEPT the first tab test (`"builds the expected tabs..."`) which uses `stripe_fee_cents: 4550`, and extend that test with:
  ```ts
      // Fee 4550 is a mutation discriminator: $45.50 and net $1,456.50
      // (1502.00 − 45.50) appear nowhere else in the fixture arithmetic.
      const svcText = JSON.stringify(wb.getWorksheet("Income by Service")!.getSheetValues())
      expect(svcText).toContain("Stripe processing fees")
      expect(svcText).toContain("$45.50")
      expect(svcText).toContain("Net income after Stripe fees")
      expect(svcText).toContain("$1,456.50")
      const summaryText = JSON.stringify(summary.getSheetValues())
      expect(summaryText).toContain("$45.50")   // fee column on the primary row
      expect(summaryText).toContain("$1,456.50") // net-after-fees column
      expect(readmeText).toContain("net after fees")
  ```
  Run `npx vitest run __tests__/lib/bookkeeping/accountant-pack.test.ts` — expect the extended test to fail (missing input field is also a type error — that's the red).
- [ ] Implement in `lib/bookkeeping/accountant-pack.ts`: (1) add `stripe_fee_cents: number` to `AccountantPackInput` (`:14-22`) and to the destructure at `:121`; (2) replace Read-Me line `:133` with:
  ```ts
      `PRIMARY FIGURES ARE GROSS — Stripe processing fees (from ingested payouts) appear only as labeled "net after fees (est.)" lines; fees never post to the ledger.`,
  ```
  (3) Summary sheet (`:143-147`): change the header row to `["Book", "Kind", "Income", "Expenses", "Net", "Entries", "Stripe fees (est.)", "Net after fees (est.)"]` with widths `[30, 12, 16, 16, 16, 10, 18, 20]`, and in the row loop fill the two new cells for the primary business book only:
  ```ts
    for (const s of perBookSummary(entries, books)) {
      const isFeeBook = books.some((b) => b.id === s.book_id && b.is_primary && b.book_kind === "business")
      summary.addRow([
        s.name, s.book_kind, formatCents(s.income_cents), formatCents(s.expense_cents), formatCents(s.net_cents), s.entry_count,
        isFeeBook ? formatCents(stripe_fee_cents) : "",
        isFeeBook ? formatCents(s.income_cents - stripe_fee_cents) : "",
      ])
    }
  ```
  (4) Income-by-Service sheet: after the `"Total gross income"` row (`:156-157`) add:
  ```ts
      svc.addRow(["Stripe processing fees (est., from ingested payouts)", "", formatCents(stripe_fee_cents)])
      const netRow = svc.addRow(["Net income after Stripe fees (est.)", "", formatCents(ibs.total_cents - stripe_fee_cents)])
      netRow.eachCell((c) => { c.font = { bold: true } })
  ```
  Run `npx vitest run __tests__/lib/bookkeeping/accountant-pack.test.ts` — expect all pass.
- [ ] Update the three pack callers to satisfy the new required input (all three destructure the bundle already): in `app/api/admin/bookkeeping/reports/accountant-pack/route.ts`, `app/api/admin/bookkeeping/reports/email-pack/route.ts`, and `app/api/admin/internal/bookkeeping-quarterly-pack/route.ts`, add `import { stripeFeesInWindow } from "@/lib/bookkeeping/payout-fees"` and pass into `buildAccountantPack`:
  ```ts
  stripe_fee_cents: stripeFeesInWindow(bundle.payoutLines ?? [], from, to),
  ```
  (where the route binds the bundle to a different name, use that name; `?? []` keeps the existing route tests' stale `loadReportBundle` mocks — `reports-accountant-pack.test.ts:23`, `reports-email-pack.test.ts:29`, quarterly test — passing untouched since they mock `buildAccountantPack` itself).
- [ ] Print page `app/(admin)/admin/books/reports/print/page.tsx`: (1) `loadPrintData` (`:28-35`) — the bundle now carries `payoutLines`; return it: `return { books, accounts, entries, payoutLines: bundle.payoutLines ?? [], documents, assets }` (restructure the existing destructure accordingly) and add `import { stripeFeesInWindow } from "@/lib/bookkeeping/payout-fees"`; (2) in the page body compute `const stripeFees = stripeFeesInWindow(payoutLines, from, to)`; (3) replace the header disclaimer sentence at `:110` ("GROSS figures from the posted ledger (Stripe fees &amp; payouts not netted).") with:
  ```
  GROSS figures stay primary; Stripe processing fees from ingested payouts appear as a labeled net line (est.).
  ```
  (4) after the "Total gross income" `<tr>` (`:158-162`) add:
  ```tsx
  <tr>
    <td className="py-1 pr-4">Stripe processing fees (est., from ingested payouts)</td>
    <td />
    <td className="py-1 pr-4 text-right">{stripeFees === 0 ? "$0.00 recorded" : `−${formatCents(stripeFees)}`}</td>
  </tr>
  <tr>
    <td className="py-1 pr-4 font-semibold">Net income after Stripe fees (est.)</td>
    <td />
    <td className="py-1 pr-4 text-right font-semibold">{formatCents(ibs.total_cents - stripeFees)}</td>
  </tr>
  ```
- [ ] Email copy `lib/bookkeeping/email-pack.ts`: replace the bullet at `:21` with:
  ```ts
        <li>Primary figures are <strong>GROSS</strong> — Stripe processing fees appear as a labeled <strong>net-after-fees (est.)</strong> line in the Summary and Income by Service sheets.</li>
  ```
  and the subject at `:37` with:
  ```ts
      subject: `Accountant pack — ${input.from} to ${input.to} (gross + net-after-fees, estimates)`,
  ```
  In `__tests__/lib/bookkeeping/email-pack.test.ts` extend the `accountantPackEmailHtml` honesty test with `expect(html).toContain("net-after-fees")` and the send test with `expect(arg.subject).toContain("net-after-fees")` (existing `toContain("GROSS")` / `toContain("Accountant pack")` pins survive unchanged).
- [ ] Run the full adjacent set: `npx vitest run __tests__/app/api/admin/bookkeeping/reports.test.ts __tests__/lib/bookkeeping/accountant-pack.test.ts __tests__/lib/bookkeeping/email-pack.test.ts __tests__/app/api/admin/bookkeeping/reports-accountant-pack.test.ts __tests__/app/api/admin/bookkeeping/reports-email-pack.test.ts __tests__/api/admin/internal/bookkeeping-quarterly-pack.test.ts __tests__/lib/bookkeeping/quickbooks-csv.test.ts` — expect all pass (QBO test included to prove the CSV is untouched).
- [ ] Commit: write to `a8-msg.txt` in scratchpad, `git add lib/bookkeeping/report-data.ts app/api/admin/bookkeeping/reports/route.ts components/admin/bookkeeping/ReportsClient.tsx lib/bookkeeping/accountant-pack.ts app/api/admin/bookkeeping/reports/accountant-pack/route.ts app/api/admin/bookkeeping/reports/email-pack/route.ts app/api/admin/internal/bookkeeping-quarterly-pack/route.ts "app/(admin)/admin/books/reports/print/page.tsx" lib/bookkeeping/email-pack.ts __tests__/app/api/admin/bookkeeping/reports.test.ts __tests__/lib/bookkeeping/accountant-pack.test.ts __tests__/lib/bookkeeping/email-pack.test.ts`, `git commit -F "<scratchpad>\a8-msg.txt"`:
  ```
  feat(bookkeeping): net-revenue second line across reports, pack, print, email

  Gross stays primary (D3). loadReportBundle carries windowed payout lines;
  stripe_fee_cents/net_income_cents on the reports payload (primary business
  book only); pack Read-Me/Summary/Income-by-Service amended; print + email
  copy reworded; QBO CSV deliberately unchanged (no slot in the 4-col format).
  Honest "$0.00 recorded" empty state before the first payout sync.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

### Task A9: Exact payout-match dedupe layer

**Files:**
- Modify: `lib/bookkeeping/statement-dedupe.ts` (`AnnotatedStatementRow` `:39-46`; insertion inside `annotateIncome` at the `:141` boundary — after the `if (best) {...}` return closing at `:140`, before the layer-2 comment at `:142`; `annotateRow` `:232-263`; `flagStatementDuplicates` `:273-296`)
- Modify: `app/api/admin/bookkeeping/statement-import/dedupe/route.ts` (imports `:3`, posted fetch `:74`, flagger call `:77`)
- Modify tests: `__tests__/lib/bookkeeping/statement-dedupe.test.ts`, `__tests__/api/admin/bookkeeping/statement-import-dedupe.test.ts`

**Interfaces:**
- Produces: `export interface PayoutRef { id: string; stripe_payout_id: string; net_cents: number; arrival_date: string; status: string }`; `AnnotatedStatementRow` gains optional `matchedPayoutId?: string | null`; `flagStatementDuplicates` opts gain `payouts?: PayoutRef[]`. Match rule (Decision A-8): `amount_cents === net_cents` AND `|dayDiff| <= 2` AND `status === 'paid'`; nearest-date unconsumed payout wins; separate `consumedPayouts: Set<string>` — the payout layer never touches the posted-entry `consumed` pool. Flags, never drops (`defaultInclude: false`, coach can re-include — membership escape hatch). Layer-2 aggregate stays as pre-ingestion fallback.
- Consumes: `listPayoutsForDedupe` / `PayoutDedupeRow` (A4 — structurally a `PayoutRef`).

- [ ] Add the failing tests to `__tests__/lib/bookkeeping/statement-dedupe.test.ts` (reuse the existing `inc`/`posted` factories at `:4-9`; add a payout factory):
  ```ts
  const payout = (over: Partial<import("@/lib/bookkeeping/statement-dedupe").PayoutRef> = {}) => ({
    id: "bp-1", stripe_payout_id: "po_1", net_cents: 5000, arrival_date: "2026-07-04", status: "paid", ...over,
  })

  describe("flagStatementDuplicates — exact payout layer (Track A)", () => {
    it("bank income == paid payout net within ±2d → flagged with matchedPayoutId, matchedEntry null", () => {
      const [r] = flagStatementDuplicates([inc()], [], { payouts: [payout()] })
      expect(r.possibleDuplicate).toBe(true)
      expect(r.matchedPayoutId).toBe("bp-1")
      expect(r.matchedEntry).toBeNull()
      expect(r.defaultInclude).toBe(false)
      expect(r.newCandidate).toBe(false)
      expect(r.reason).toMatch(/Stripe payout deposit/)
      expect(r.reason).toContain("po_1")
    })
    it("±2d boundary: 2 days matches, 3 days does not", () => {
      const [hit] = flagStatementDuplicates([inc({ occurred_on: "2026-07-06" })], [], { payouts: [payout()] })
      expect(hit.matchedPayoutId).toBe("bp-1")
      const [miss] = flagStatementDuplicates([inc({ occurred_on: "2026-07-07" })], [], { payouts: [payout()] })
      expect(miss.possibleDuplicate).toBe(false)
      expect(miss.matchedPayoutId).toBeUndefined()
    })
    it("non-paid payouts are never matched (in_transit excluded)", () => {
      const [r] = flagStatementDuplicates([inc()], [], { payouts: [payout({ status: "in_transit" })] })
      expect(r.possibleDuplicate).toBe(false)
    })
    it("net must match exactly — ±0¢, no layer-2 fuzz", () => {
      const [r] = flagStatementDuplicates([inc({ amount_cents: 5001 })], [], { payouts: [payout()] })
      expect(r.matchedPayoutId).toBeUndefined()
    })
    it("double-match consumption: one payout satisfies at most one bank line", () => {
      const out = flagStatementDuplicates([inc(), inc()], [], { payouts: [payout()] })
      expect(out.filter((r) => r.matchedPayoutId === "bp-1")).toHaveLength(1)
    })
    it("layer-1 precedence: an exact posted-entry match wins and does NOT consume the payout", () => {
      const out = flagStatementDuplicates([inc(), inc()], [posted()], { payouts: [payout()] })
      // first (in match order) row consumed the posted entry; second row still matched the payout
      expect(out.filter((r) => r.matchedEntry?.id === "p1")).toHaveLength(1)
      expect(out.filter((r) => r.matchedPayoutId === "bp-1")).toHaveLength(1)
    })
    it("payout layer does not consume posted entries: layer-2 pool stays intact for other rows", () => {
      // row 1 matches the payout; row 2 (different amount ≈ platform sum) still aggregate-matches
      const rows = [inc(), inc({ amount_cents: 9600, occurred_on: "2026-07-05" })]
      const platform = [posted({ id: "a", amount_cents: 6000 }), posted({ id: "b", amount_cents: 4000 })]
      const out = flagStatementDuplicates(rows, platform, { payouts: [payout()] })
      expect(out[0].matchedPayoutId).toBe("bp-1")
      expect(out[1].reason).toMatch(/probable Stripe payout/)
    })
  })
  ```
- [ ] Run: `npx vitest run __tests__/lib/bookkeeping/statement-dedupe.test.ts` — new describe fails (unknown opts key / missing field).
- [ ] Implement in `lib/bookkeeping/statement-dedupe.ts`:
  1. Below `PostedRef` (`:29`) add:
     ```ts
     /** Track A exact payout layer — a stored Stripe payout the bank line may BE. */
     export interface PayoutRef {
       id: string
       stripe_payout_id: string
       net_cents: number
       arrival_date: string
       status: string
     }
     ```
  2. `AnnotatedStatementRow` (`:39-46`): add `matchedPayoutId?: string | null`.
  3. Beside `DEFAULT_WINDOW_DAYS` (`:48`) add `const PAYOUT_WINDOW_DAYS = 2`.
  4. `annotateIncome` — new params `payouts: PayoutRef[], consumedPayouts: Set<string>` (after `consumed`), and insert between the `if (best) { ... }` block closing at `:140` and the `// 2. Aggregate-payout` comment:
     ```ts
       // 1b. Exact payout-net (Decision A-8): the bank line IS a Stripe payout
       // deposit — net match ±0¢, arrival ±2d, status 'paid' only. SEPARATE
       // consumedPayouts set: one bank line consumes one payout, and this layer
       // never touches the posted-entry pool (layers 1/2 keep their pool intact
       // for other rows). Flags, never drops — the coach can still include the
       // row (the membership-revenue escape hatch).
       let bestPayout: PayoutRef | null = null
       let bestPayoutDiff = Infinity
       for (const po of payouts) {
         if (consumedPayouts.has(po.id)) continue
         if (po.status !== "paid") continue
         if (po.net_cents !== row.amount_cents) continue
         const diff = dayDiff(row.occurred_on, po.arrival_date)
         if (diff > PAYOUT_WINDOW_DAYS) continue
         if (diff < bestPayoutDiff) {
           bestPayout = po
           bestPayoutDiff = diff
         }
       }
       if (bestPayout) {
         consumedPayouts.add(bestPayout.id)
         return {
           row,
           possibleDuplicate: true,
           matchedEntry: null,
           matchedPayoutId: bestPayout.id,
           reason: `Stripe payout deposit — net ${formatCents(bestPayout.net_cents)} arriving ${bestPayout.arrival_date} (${bestPayout.stripe_payout_id})`,
           defaultInclude: false,
           newCandidate: false,
         }
       }
     ```
  5. `annotateRow` (`:232`): add the same two params and pass them through to `annotateIncome` (expense/transfer branches unchanged).
  6. `flagStatementDuplicates` (`:273`): opts becomes `opts?: { windowDays?: number; feeTolerancePct?: number; payouts?: PayoutRef[] }`; add `const payouts = opts?.payouts ?? []` and `const consumedPayouts = new Set<string>()` beside `consumed` (`:281`); thread both into the `annotateRow` call (`:292`).
- [ ] Run: `npx vitest run __tests__/lib/bookkeeping/statement-dedupe.test.ts` — all pass (all pre-existing pins must survive untouched — the layer only adds a branch between 1 and 2).
- [ ] Route: in `app/api/admin/bookkeeping/statement-import/dedupe/route.ts` change line 3 to `import { listPostedForDedupe, listPayoutsForDedupe, listDocuments } from "@/lib/db/bookkeeping"`, and replace lines 74-77 with:
  ```ts
      const posted = await listPostedForDedupe(book_id, fromWide, toWide)
      // Same ±WINDOW_DAYS-widened span covers the payout layer's ±2d rule.
      const payouts = await listPayoutsForDedupe(book_id, fromWide, toWide)
      // Exactly ONE call — `consumed`/`consumedPayouts` inside are per-call, so a
      // posted entry or payout can only be matched once across this whole batch.
      const annotated = flagStatementDuplicates(dedupeRows, posted, { payouts })
  ```
- [ ] Update `__tests__/api/admin/bookkeeping/statement-import-dedupe.test.ts`: add `const listPayoutsForDedupeMock = vi.fn()` beside the other mock fns (`:4-5`), add `listPayoutsForDedupe: (...a: unknown[]) => listPayoutsForDedupeMock(...a),` to the `vi.mock("@/lib/db/bookkeeping", ...)` factory (`:8-11`) — without this the route's new import is `undefined` and every test 500s — reset + default `listPayoutsForDedupeMock.mockResolvedValue([])` in `beforeEach` (`:44-51`), and add:
  ```ts
    it("fetches payouts over the widened window and flags an exact payout-net deposit", async () => {
      listPayoutsForDedupeMock.mockResolvedValue([
        { id: "bp-1", stripe_payout_id: "po_1", net_cents: 5000, arrival_date: "2026-01-05", status: "paid" },
      ])
      const incomeRow = row({ direction: "income", amount_cents: 5000, description: "STRIPE PAYOUT", occurred_on: "2026-01-05" })
      const res = await POST(req({ book_id: BOOK, rows: [incomeRow] }) as never)
      expect(res.status).toBe(200)
      expect(listPayoutsForDedupeMock).toHaveBeenCalledWith(BOOK, "2026-01-01", "2026-01-09")
      const json = await res.json()
      expect(json.rows[0].possibleDuplicate).toBe(true)
      expect(json.rows[0].matchedPayoutId).toBe("bp-1")
      expect(json.rows[0].reason).toContain("po_1")
    })
    it("empty rows short-circuit still makes NO payout DAL read", async () => {
      await POST(req({ book_id: BOOK, rows: [] }) as never)
      expect(listPayoutsForDedupeMock).not.toHaveBeenCalled()
    })
  ```
- [ ] Run: `npx vitest run __tests__/api/admin/bookkeeping/statement-import-dedupe.test.ts __tests__/lib/bookkeeping/statement-dedupe.test.ts` — all pass.
- [ ] Commit: write to `a9-msg.txt` in scratchpad, `git add lib/bookkeeping/statement-dedupe.ts app/api/admin/bookkeeping/statement-import/dedupe/route.ts __tests__/lib/bookkeeping/statement-dedupe.test.ts __tests__/api/admin/bookkeeping/statement-import-dedupe.test.ts`, `git commit -F "<scratchpad>\a9-msg.txt"`:
  ```
  feat(bookkeeping): exact payout-net dedupe layer (net ±0c, arrival ±2d, paid only)

  New layer between exact-posted and aggregate inside annotateIncome; separate
  consumedPayouts set (posted-entry pool untouched); flags never drops;
  matchedPayoutId surfaced to the review UI; dedupe route feeds
  listPayoutsForDedupe over the same widened window.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

### Task A10: D(i) fold — account-scope guards on import-platform commit + manual entry create

**Files:**
- Modify: `app/api/admin/bookkeeping/import-platform/commit/route.ts` (guard before `insertImportedEntries` at `:15`)
- Modify: `app/api/admin/bookkeeping/entries/route.ts` (guard inside `POST` before `createEntry` at `:54`)
- Modify: `__tests__/api/admin/bookkeeping/import-platform.test.ts` (`vi.mock` factory `:9-12`), `__tests__/api/admin/bookkeeping/entries.test.ts` (`vi.mock` factory `:10-14`)
- Create: `__tests__/app/api/admin/bookkeeping/import-platform-scope.test.ts`, `__tests__/app/api/admin/bookkeeping/entries-create-scope.test.ts` (both mirror `__tests__/app/api/admin/bookkeeping/statement-commit-scope.test.ts` — cited mock style)

**Interfaces:**
- Consumes: `assertAccountsInBook` (`lib/db/bookkeeping.ts:415`), `assertAccountInBook` (`lib/db/bookkeeping.ts:306`), `AccountScopeError` codes `ACCOUNT_NOT_FOUND | WRONG_BOOK | WRONG_TYPE`.
- Produces: identical error mapping to statement commit (`statement-import/commit/route.ts:21-28`): `ACCOUNT_NOT_FOUND → 404`, `WRONG_BOOK | WRONG_TYPE → 409`. Receipts' inline checks left as-is (Decision D-1).

- [ ] Write the failing scope tests. `__tests__/app/api/admin/bookkeeping/import-platform-scope.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest"
  vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
  vi.mock("@/lib/db/bookkeeping", () => ({
    insertImportedEntries: vi.fn().mockResolvedValue({ inserted: 1, rejected_closed: 0, rejected_closed_rows: [], skipped_alt_ref: 0 }),
    assertAccountsInBook: vi.fn(),
  }))
  vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
  import { auth } from "@/lib/auth"
  import { insertImportedEntries, assertAccountsInBook } from "@/lib/db/bookkeeping"
  import { POST } from "@/app/api/admin/bookkeeping/import-platform/commit/route"

  const UUID = "11111111-2222-4333-8444-555555555555"
  const body = (b: unknown) => ({ json: async () => b }) as never
  const entry = {
    direction: "income", amount_cents: 5000, occurred_on: "2026-07-01", memo: "pack",
    counterparty: null, service_line: "session_packs", source: "platform_import",
    source_ref: "client_packages:22222222-3333-4444-8555-666666666666", account_id: UUID,
  }
  beforeEach(() => { vi.clearAllMocks(); (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "admin" } }) })

  describe("import-platform commit — batch account scope (D-i)", () => {
    it("409 on WRONG_BOOK and the insert never runs", async () => {
      ;(assertAccountsInBook as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("scope"), { code: "WRONG_BOOK" }))
      const res = await POST(body({ book_id: UUID, entries: [entry] }))
      expect(res.status).toBe(409)
      expect(insertImportedEntries).not.toHaveBeenCalled()
    })
    it("404 on ACCOUNT_NOT_FOUND", async () => {
      ;(assertAccountsInBook as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("scope"), { code: "ACCOUNT_NOT_FOUND" }))
      expect((await POST(body({ book_id: UUID, entries: [entry] }))).status).toBe(404)
    })
    it("guard passing → commit proceeds", async () => {
      ;(assertAccountsInBook as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
      const res = await POST(body({ book_id: UUID, entries: [entry] }))
      expect(res.status).toBe(200)
      expect(assertAccountsInBook).toHaveBeenCalledWith(UUID, [{ accountId: UUID, direction: "income" }])
      expect(insertImportedEntries).toHaveBeenCalled()
    })
  })
  ```
  `__tests__/app/api/admin/bookkeeping/entries-create-scope.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest"
  vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
  vi.mock("@/lib/db/bookkeeping", () => ({
    listEntries: vi.fn(), entryTotals: vi.fn(),
    createEntry: vi.fn().mockResolvedValue({ id: "e0000000-0000-4000-8000-000000000001", memo: null }),
    assertAccountInBook: vi.fn(),
  }))
  vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
  import { auth } from "@/lib/auth"
  import { createEntry, assertAccountInBook } from "@/lib/db/bookkeeping"
  import { POST } from "@/app/api/admin/bookkeeping/entries/route"

  const BOOK = "b0000000-0000-4000-8000-000000000001"
  const ACCOUNT = "a0000000-0000-4000-8000-000000000003"
  const req = (b: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(b) }) as never
  const okBody = { book_id: BOOK, direction: "expense", amount_cents: 100, occurred_on: "2026-07-01", account_id: ACCOUNT }
  beforeEach(() => { vi.clearAllMocks(); (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "admin-1", role: "admin" } }) })

  describe("entries POST — inline account scope (D-i)", () => {
    it("409 on WRONG_TYPE and createEntry never runs", async () => {
      ;(assertAccountInBook as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("scope"), { code: "WRONG_TYPE" }))
      const res = await POST(req(okBody))
      expect(res.status).toBe(409)
      expect(createEntry).not.toHaveBeenCalled()
    })
    it("404 on ACCOUNT_NOT_FOUND", async () => {
      ;(assertAccountInBook as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("scope"), { code: "ACCOUNT_NOT_FOUND" }))
      expect((await POST(req(okBody))).status).toBe(404)
    })
    it("guard runs with the entry's own book + direction, then creates", async () => {
      ;(assertAccountInBook as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
      const res = await POST(req(okBody))
      expect(res.status).toBe(201)
      expect(assertAccountInBook).toHaveBeenCalledWith(ACCOUNT, BOOK, "expense")
    })
    it("no account_id → guard skipped entirely (uncategorized entry unchanged)", async () => {
      const { account_id: _drop, ...noAccount } = okBody
      const res = await POST(req(noAccount))
      expect(res.status).toBe(201)
      expect(assertAccountInBook).not.toHaveBeenCalled()
    })
  })
  ```
- [ ] Run: `npx vitest run __tests__/app/api/admin/bookkeeping/import-platform-scope.test.ts __tests__/app/api/admin/bookkeeping/entries-create-scope.test.ts` — expect failures (guards absent).
- [ ] Implement. `import-platform/commit/route.ts`: change line 3 to `import { insertImportedEntries, assertAccountsInBook } from "@/lib/db/bookkeeping"` and insert between the parse (`:13`) and `const batchId` (`:14`) — exactly the statement-commit mapping (`statement-import/commit/route.ts:21-28`):
  ```ts
      try {
        await assertAccountsInBook(parsed.data.book_id, parsed.data.entries.map((e) => ({ accountId: e.account_id ?? null, direction: e.direction })))
      } catch (err) {
        const code = (err as { code?: string })?.code
        if (code === "ACCOUNT_NOT_FOUND") return NextResponse.json({ error: "account not found" }, { status: 404 })
        if (code === "WRONG_BOOK" || code === "WRONG_TYPE") return NextResponse.json({ error: "account scope" }, { status: 409 })
        throw err
      }
  ```
  `entries/route.ts`: change line 3 to `import { listEntries, entryTotals, createEntry, assertAccountInBook } from "@/lib/db/bookkeeping"` and insert after `const d = parsed.data` (`:53`), before `createEntry`:
  ```ts
      if (d.account_id) {
        try {
          await assertAccountInBook(d.account_id, d.book_id, d.direction)
        } catch (err) {
          const code = (err as { code?: string })?.code
          if (code === "ACCOUNT_NOT_FOUND") return NextResponse.json({ error: "account not found" }, { status: 404 })
          if (code === "WRONG_BOOK" || code === "WRONG_TYPE") return NextResponse.json({ error: "account scope" }, { status: 409 })
          throw err
        }
      }
  ```
- [ ] Fix the existing mock factories (a `vi.mock` factory replaces the whole module — the routes' new imports would be `undefined` and crash otherwise): in `__tests__/api/admin/bookkeeping/import-platform.test.ts` add `assertAccountsInBook: vi.fn(),` to the factory at `:9-12`; in `__tests__/api/admin/bookkeeping/entries.test.ts` add `assertAccountInBook: vi.fn(),` to the factory at `:10-14`.
- [ ] Run the full adjacent set: `npx vitest run __tests__/app/api/admin/bookkeeping/import-platform-scope.test.ts __tests__/app/api/admin/bookkeeping/entries-create-scope.test.ts __tests__/api/admin/bookkeeping/import-platform.test.ts __tests__/api/admin/bookkeeping/entries.test.ts __tests__/api/admin/bookkeeping/entries-guards.test.ts __tests__/app/api/admin/bookkeeping/statement-commit-scope.test.ts` — all pass.
- [ ] Commit: write to `a10-msg.txt` in scratchpad, `git add app/api/admin/bookkeeping/import-platform/commit/route.ts app/api/admin/bookkeeping/entries/route.ts __tests__/app/api/admin/bookkeeping/import-platform-scope.test.ts __tests__/app/api/admin/bookkeeping/entries-create-scope.test.ts __tests__/api/admin/bookkeeping/import-platform.test.ts __tests__/api/admin/bookkeeping/entries.test.ts`, `git commit -F "<scratchpad>\a10-msg.txt"`:
  ```
  fix(bookkeeping): account-scope guards on import-platform commit + manual entry create (D-i)

  Closes the last two unguarded ledger write routes: assertAccountsInBook on
  import-platform/commit, inline assertAccountInBook on entries POST — both
  mapping AccountScopeError to 404/409 exactly like statement commit.
  Receipts' inline single-account checks left as-is (Decision D-1).

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```