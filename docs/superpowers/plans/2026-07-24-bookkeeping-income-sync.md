# Bookkeeping Income Sync Cron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A nightly cron that posts new platform income to the primary business book automatically, through the exact pipeline the manual import already uses.

**Architecture:** Firebase `onSchedule` delegator (`bookkeepingIncomeSyncCron`, daily 04:30 UTC) POSTs to `/api/admin/internal/bookkeeping-income-sync`; the route flag-gates, resolves the primary business book, computes a watermark window, runs `listPlatformIncome → buildIncomeDrafts → matchAccountForServiceLine → insertImportedEntries` (all existing, untouched), and is the single `cron_runs` owner. Idempotency comes entirely from the existing insert path.

**Tech Stack:** Next.js 16 route handler (nodejs runtime), Firebase Functions v2 `onSchedule`, Supabase service-role DAL, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-24-bookkeeping-income-sync-design.md` (all D-numbers below refer to it).

## Global Constraints

- Contract strings must be **byte-identical** everywhere: cron name `bookkeepingIncomeSyncCron` (functions export, `logCronStart` name, `EXPECTED_CRONS` name), route dir `bookkeeping-income-sync`, flag key `cron_bookkeeping_income_sync_enabled`, audit slug `bookkeeping.income_synced`.
- The route is the SINGLE `cron_runs` owner; the functions delegator must NOT log `cron_runs` (D7).
- Functions delegator declares `secrets: [internalCronToken, appUrl]` ONLY — same as `bookkeepingReceiptWatchdogCron`; do not copy the quarterly-pack's list. Same `INTERNAL_CRON_TOKEN` env var on the route; no new token anywhere.
- Do not modify `insertImportedEntries`, `buildIncomeDrafts`, `listPlatformIncome`, or `matchAccountForServiceLine` (D4).
- Money-path reads/writes stay on existing helpers (`fetchAllRows` inside `listPlatformIncome`); reports/ledger only, never `payments` aggregation.
- Migration `00190` is idempotent (`on conflict (key) do nothing`), seeds the flag `false`. Applied to prod via `mcp__supabase__apply_migration` by the orchestrator (CLI is not linked), never `db push`.
- Pinned numbers need mutation-discriminating fixtures (a date that distinguishes a 13/14/15-day margin, not a round number).
- Never chain `npm run build` behind `npm run test:run` with `&&`.
- Windows PowerShell environment; run vitest via `npx vitest run <path>`.

---

### Task 1: Migration 00190 + audit action slug

**Files:**
- Create: `supabase/migrations/00190_bookkeeping_income_sync.sql`
- Modify: `lib/audit/actions.ts` (append one row to the bookkeeping block, after the `bookkeeping.asset_deleted` line ~259)

**Interfaces:**
- Produces: flag key `cron_bookkeeping_income_sync_enabled` (seeded `false`), audit slug `bookkeeping.income_synced` (category `commerce`) — Task 3's route uses both.

- [ ] **Step 1: Write the migration**

```sql
-- 00190_bookkeeping_income_sync.sql
-- Nightly platform-income sync cron flag. Arrives OFF (money-posting cron);
-- the owner flips it in admin settings. Additive, idempotent, inert without code.
insert into system_settings (key, value, description) values
  ('cron_bookkeeping_income_sync_enabled', 'false'::jsonb, 'Enable the nightly platform-income auto-post to the primary business book')
on conflict (key) do nothing;
```

- [ ] **Step 2: Add the audit slug**

In `lib/audit/actions.ts`, directly after the `bookkeeping.asset_deleted` row, add:

```ts
  { slug: "bookkeeping.income_synced", category: "commerce", description: "Nightly cron posted new platform income to the ledger" },
```

- [ ] **Step 3: Verify nothing broke**

Run: `npx vitest run __tests__/lib/audit` (if the dir exists; otherwise `npx tsc --noEmit` only)
Expected: PASS / no new type errors (pre-existing `__tests__/` tsc noise is known).

- [ ] **Step 4: Commit**

```powershell
git add supabase/migrations/00190_bookkeeping_income_sync.sql lib/audit/actions.ts
git commit -m "feat(bookkeeping): income-sync cron flag migration + audit slug"
```

---

### Task 2: `computeSyncWindow` pure helper (TDD)

**Files:**
- Create: `lib/bookkeeping/income-sync-window.ts`
- Test: `__tests__/lib/bookkeeping/income-sync-window.test.ts`

**Interfaces:**
- Produces: `computeSyncWindow(latestPlatformImportDate: string | null, today: string): { from: string; to: string }` — Task 3's route calls it and Task 3's tests import it to compute expected values.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/bookkeeping/income-sync-window.test.ts
import { describe, it, expect } from "vitest"
import { computeSyncWindow } from "@/lib/bookkeeping/income-sync-window"

describe("computeSyncWindow", () => {
  it("watermark present → from = watermark − 14 days (discriminates 13/15)", () => {
    // 2026-07-20 − 14d = 2026-07-06 (13d → 07-07, 15d → 07-05)
    expect(computeSyncWindow("2026-07-20", "2026-07-24")).toEqual({ from: "2026-07-06", to: "2026-07-24" })
  })

  it("no watermark → from = today − 90 days", () => {
    // 2026-07-24 − 90d = 2026-04-25 (Apr 25→30 =5, +31 May, +30 Jun, +24 Jul = 90)
    expect(computeSyncWindow(null, "2026-07-24")).toEqual({ from: "2026-04-25", to: "2026-07-24" })
  })

  it("crosses month AND year boundaries", () => {
    // 2026-01-05 − 14d = 2025-12-22
    expect(computeSyncWindow("2026-01-05", "2026-01-10")).toEqual({ from: "2025-12-22", to: "2026-01-10" })
  })

  it("future-dated watermark clamps from to today (never an inverted window)", () => {
    expect(computeSyncWindow("2026-08-30", "2026-07-24")).toEqual({ from: "2026-07-24", to: "2026-07-24" })
  })

  it("watermark exactly today still rewinds the overlap margin", () => {
    expect(computeSyncWindow("2026-07-24", "2026-07-24")).toEqual({ from: "2026-07-10", to: "2026-07-24" })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/bookkeeping/income-sync-window.test.ts`
Expected: FAIL — cannot resolve `@/lib/bookkeeping/income-sync-window`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/bookkeeping/income-sync-window.ts
// Watermark window for the nightly income-sync cron (spec D2). Pure, zero IO.
// from = latest posted platform-import date − 14d overlap (late-settling rows,
// pending→paid flips); no watermark → 90d lookback. Re-scanning overlap is free:
// insertImportedEntries is idempotent. No span cap — a long-dark cron heals the
// whole gap on its next run.
const FALLBACK_LOOKBACK_DAYS = 90
const OVERLAP_MARGIN_DAYS = 14

function minusDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)
}

export function computeSyncWindow(
  latestPlatformImportDate: string | null,
  today: string,
): { from: string; to: string } {
  const from = latestPlatformImportDate == null
    ? minusDays(today, FALLBACK_LOOKBACK_DAYS)
    : minusDays(latestPlatformImportDate, OVERLAP_MARGIN_DAYS)
  return { from: from > today ? today : from, to: today }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/bookkeeping/income-sync-window.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```powershell
git add lib/bookkeeping/income-sync-window.ts __tests__/lib/bookkeeping/income-sync-window.test.ts
git commit -m "feat(bookkeeping): pure watermark-window helper for the income-sync cron"
```

---

### Task 3: DAL watermark read + internal route (TDD)

**Files:**
- Modify: `lib/db/bookkeeping.ts` (add `latestPlatformImportDate` in the "Ledger entries" section, after `insertImportedEntries` ends ~line 197)
- Create: `app/api/admin/internal/bookkeeping-income-sync/route.ts`
- Test: `__tests__/api/admin/internal/bookkeeping-income-sync.test.ts`

**Interfaces:**
- Consumes: `computeSyncWindow` (Task 2); flag key + audit slug (Task 1); existing `listBooks(): Promise<BookkeepingBook[]>`, `listAccounts(bookId): Promise<BookkeepingAccount[]>`, `listPlatformIncome(from, to): Promise<IncomeSourceRows>`, `buildIncomeDrafts(sources, {from,to}): {drafts, warnings}`, `matchAccountForServiceLine(direction, serviceLine, accounts): BookkeepingAccount | null`, `insertImportedEntries(bookId, batchId, drafts): Promise<{inserted, rejected_closed, rejected_closed_rows, skipped_alt_ref}>`, `isCronSkipped`, `logCronStart`/`logCronEnd`, `recordAudit`.
- Produces: `latestPlatformImportDate(bookId: string): Promise<string | null>`; `POST /api/admin/internal/bookkeeping-income-sync` — Task 4's delegator calls it.

- [ ] **Step 1: Add the DAL reader**

In `lib/db/bookkeeping.ts`, after `insertImportedEntries`:

```ts
/** Latest occurred_on among the book's posted platform-import entries —
 *  the income-sync cron's watermark (spec D2). Null when none exist. */
export async function latestPlatformImportDate(bookId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("bookkeeping_ledger_entries")
    .select("occurred_on")
    .eq("book_id", bookId)
    .eq("source", "platform_import")
    .order("occurred_on", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as { occurred_on: string } | null)?.occurred_on ?? null
}
```

- [ ] **Step 2: Write the failing route tests**

Mirror the mocking style of `__tests__/api/admin/internal/bookkeeping-receipt-watchdog.test.ts`: mock ALL IO (DAL, settings, cron-runs, supabase, audit), run the REAL pure pipeline (`buildIncomeDrafts`, `matchAccountForServiceLine`, `computeSyncWindow` are unmocked).

```ts
// __tests__/api/admin/internal/bookkeeping-income-sync.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: vi.fn(), logCronEnd: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listBooks: vi.fn(), listAccounts: vi.fn(), listPlatformIncome: vi.fn(),
  latestPlatformImportDate: vi.fn(), insertImportedEntries: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { isCronSkipped } from "@/lib/db/system-settings"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import {
  listBooks, listAccounts, listPlatformIncome, latestPlatformImportDate, insertImportedEntries,
} from "@/lib/db/bookkeeping"
import { recordAudit } from "@/lib/audit/record"
import { computeSyncWindow } from "@/lib/bookkeeping/income-sync-window"
import { POST } from "@/app/api/admin/internal/bookkeeping-income-sync/route"

const TOKEN = "test-cron-token"
const AUTH = `Bearer ${TOKEN}`
const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACC_PACKS = "a0000000-0000-4000-8000-000000000001"

const books = [
  { id: "b0000000-0000-4000-8000-000000000003", name: "Household & Personal", book_kind: "household", is_primary: false, owner_label: "Shared", sort_order: 2, archived_at: null },
  { id: BOOK, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, owner_label: "Darren", sort_order: 0, archived_at: null },
]
const accounts = [
  { id: ACC_PACKS, book_id: BOOK, name: "Session Packs", account_type: "income", service_line: "session_packs", tax_category: null, sort_order: 0, is_deductible_candidate: false, requires_business_purpose: false, archived_at: null },
]
// One paid pack → the REAL adapter emits exactly one session_packs draft; the
// REAL matcher assigns ACC_PACKS. Stripe id present → heuristic-eligible (irrelevant here).
const paidPack = {
  id: "cp000000-0000-4000-8000-000000000001", payment_status: "paid",
  purchased_at: "2026-07-22T15:00:00Z", price_cents: 25000, credits_total: 5,
  product_name: "5-Pack", client_name: "Vikram", stripe_session_id: "cs_1", stripe_payment_id: null,
}
const emptySources = { payments: [], shopOrders: [], clientPackages: [], eventSignups: [], memberships: [] }
const insertOk = { inserted: 1, rejected_closed: 0, rejected_closed_rows: [], skipped_alt_ref: 0 }

function makeRequest(authHeader = AUTH): Request {
  return new Request("http://localhost/api/admin/internal/bookkeeping-income-sync", {
    method: "POST",
    headers: { authorization: authHeader },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = TOKEN
  ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: false })
  ;(logCronStart as ReturnType<typeof vi.fn>).mockResolvedValue("run-1")
  ;(logCronEnd as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(listBooks as ReturnType<typeof vi.fn>).mockResolvedValue(books)
  ;(listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue(accounts)
  ;(latestPlatformImportDate as ReturnType<typeof vi.fn>).mockResolvedValue("2026-07-20")
  ;(listPlatformIncome as ReturnType<typeof vi.fn>).mockResolvedValue({ ...emptySources, clientPackages: [paidPack] })
  ;(insertImportedEntries as ReturnType<typeof vi.fn>).mockResolvedValue(insertOk)
})

describe("POST /api/admin/internal/bookkeeping-income-sync", () => {
  it("401 with a missing bearer token", async () => {
    const res = await POST(makeRequest(""))
    expect(res.status).toBe(401)
    expect(isCronSkipped).not.toHaveBeenCalled()
  })

  it("401 with a wrong bearer token", async () => {
    const res = await POST(makeRequest("Bearer wrong"))
    expect(res.status).toBe(401)
  })

  it("200 {skipped} with no logCronStart when the flag is off", async () => {
    ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: true, reason: "disabled" })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).skipped).toBe("disabled")
    expect(logCronStart).not.toHaveBeenCalled()
    expect(insertImportedEntries).not.toHaveBeenCalled()
  })

  it("happy path: watermark window, real adapter + matcher, audit on inserted > 0", async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, inserted: 1 })
    // Byte-identical cron name (single-owner contract)
    expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "bookkeepingIncomeSyncCron")
    // Window derived from the watermark: from is deterministic (watermark − 14d)
    const [from, to] = (listPlatformIncome as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(from).toBe("2026-07-06")
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // The REAL adapter emitted the pack draft; the REAL matcher assigned the account
    const [bookId, batchId, drafts] = (insertImportedEntries as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(bookId).toBe(BOOK)
    expect(batchId).toMatch(/^[0-9a-f-]{36}$/)
    expect(drafts).toEqual([expect.objectContaining({
      direction: "income", amount_cents: 25000, source: "platform_import",
      source_ref: `client_packages:${paidPack.id}`, service_line: "session_packs",
      account_id: ACC_PACKS,
    })])
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.income_synced", category: "commerce", outcome: "success",
      actor: expect.objectContaining({ role: "system" }),
      metadata: expect.objectContaining({ inserted: 1, import_batch_id: batchId }),
    }))
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ inserted: 1, window_from: "2026-07-06" }),
    )
  })

  it("null watermark → 90-day fallback window", async () => {
    ;(latestPlatformImportDate as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await POST(makeRequest())
    const [from, to] = (listPlatformIncome as ReturnType<typeof vi.fn>).mock.calls[0]
    expect({ from, to }).toEqual(computeSyncWindow(null, to))
    expect(from < to).toBe(true)
  })

  it("zero-new night: success with inserted 0 and NO audit row", async () => {
    ;(insertImportedEntries as ReturnType<typeof vi.fn>).mockResolvedValue({ ...insertOk, inserted: 0 })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(recordAudit).not.toHaveBeenCalled()
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ inserted: 0 }),
    )
  })

  it("unmatched service line → account_id null (lands as Uncategorized)", async () => {
    ;(listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await POST(makeRequest())
    const [, , drafts] = (insertImportedEntries as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(drafts[0].account_id).toBeNull()
  })

  it("adapter warnings surface in cron_runs details", async () => {
    ;(listPlatformIncome as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...emptySources,
      payments: [{ id: "p1", status: "refunded", amount_cents: 5000, created_at: "2026-07-21T10:00:00Z", metadata: {}, user_id: null, description: null }],
    })
    ;(insertImportedEntries as ReturnType<typeof vi.fn>).mockResolvedValue({ ...insertOk, inserted: 0 })
    await POST(makeRequest())
    const detail = (logCronEnd as ReturnType<typeof vi.fn>).mock.calls[0][3]
    expect(detail.warnings.some((w: string) => w.includes("refunded"))).toBe(true)
  })

  it("no primary business book → 500 + logCronEnd failed", async () => {
    ;(listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([books[0]]) // household only
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect(insertImportedEntries).not.toHaveBeenCalled()
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "failed",
      expect.objectContaining({ message: expect.stringContaining("primary business book") }),
    )
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run __tests__/api/admin/internal/bookkeeping-income-sync.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 4: Write the route**

```ts
// app/api/admin/internal/bookkeeping-income-sync/route.ts
// Called by functions bookkeepingIncomeSyncCron (daily 04:30 UTC). Sweeps the
// money-of-record tables through the SAME pipeline the manual /admin/books
// import uses and posts new income to the primary business book. Safe to
// re-run: insertImportedEntries upserts on UNIQUE(book_id,source,source_ref),
// drops alt_ref cross-run duplicates, and partitions out closed periods.
// SINGLE cron_runs owner under "bookkeepingIncomeSyncCron" — functions/ must not log.
import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import {
  listBooks, listAccounts, listPlatformIncome, latestPlatformImportDate, insertImportedEntries,
} from "@/lib/db/bookkeeping"
import { buildIncomeDrafts } from "@/lib/bookkeeping/income-adapter"
import { matchAccountForServiceLine } from "@/lib/bookkeeping/account-match"
import { computeSyncWindow } from "@/lib/bookkeeping/income-sync-window"
import { recordAudit } from "@/lib/audit/record"

export const runtime = "nodejs"
export const maxDuration = 120

const WARNINGS_CAP = 20

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const authHeader = request.headers.get("authorization") ?? ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_bookkeeping_income_sync_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "bookkeepingIncomeSyncCron")
  try {
    const books = await listBooks()
    const book = books.find((b) => b.is_primary && b.book_kind === "business")
    if (!book) throw new Error("No primary business book found")

    const today = new Date().toISOString().slice(0, 10)
    const watermark = await latestPlatformImportDate(book.id)
    const { from, to } = computeSyncWindow(watermark, today)

    const sources = await listPlatformIncome(from, to)
    const { drafts, warnings } = buildIncomeDrafts(sources, { from, to })
    const accounts = await listAccounts(book.id)
    const withAccounts = drafts.map((d) => ({
      ...d,
      account_id: matchAccountForServiceLine(d.direction, d.service_line, accounts)?.id ?? null,
    }))

    const batchId = crypto.randomUUID()
    const { inserted, rejected_closed, skipped_alt_ref } =
      await insertImportedEntries(book.id, batchId, withAccounts)

    const detail = {
      inserted, rejected_closed, skipped_alt_ref,
      drafts: drafts.length,
      window_from: from, window_to: to,
      warnings: warnings.slice(0, WARNINGS_CAP),
    }
    if (inserted > 0) {
      void recordAudit({
        action: "bookkeeping.income_synced",
        category: "commerce",
        outcome: "success",
        actor: { id: null, email: "bookkeepingIncomeSyncCron", role: "system" },
        target: { type: "bookkeeping_book", id: book.id },
        metadata: { ...detail, import_batch_id: batchId },
      })
    }
    await logCronEnd(supabase, runId, "success", detail)
    return NextResponse.json({ ok: true, ...detail })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[bookkeeping-income-sync] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

Note: `recordAudit`'s `actor` override shape and `target` usage match the receipt-watchdog and import-platform-commit routes. If TypeScript rejects any field, match the exact `RecordAuditInput` type in `lib/audit/record.ts` rather than casting.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/api/admin/internal/bookkeeping-income-sync.test.ts`
Expected: 9 passed.

- [ ] **Step 6: Run the adjacent suites (regression)**

Run: `npx vitest run __tests__/api/admin/internal __tests__/api/admin/bookkeeping __tests__/lib/bookkeeping`
Expected: all pass (any failure in files this task didn't touch → stop and investigate before committing).

- [ ] **Step 7: Commit**

```powershell
git add lib/db/bookkeeping.ts app/api/admin/internal/bookkeeping-income-sync/route.ts __tests__/api/admin/internal/bookkeeping-income-sync.test.ts
git commit -m "feat(bookkeeping): nightly income-sync internal route + watermark DAL read"
```

---

### Task 4: Functions delegator + health-watchdog registration

**Files:**
- Modify: `functions/src/index.ts` (append after `bookkeepingReceiptWatchdogCron`, ~line 2000)
- Modify: `lib/automation/automation-health-scanner.ts` (append to `EXPECTED_CRONS`, after the `bookkeepingReceiptWatchdogCron` entry ~line 33)

**Interfaces:**
- Consumes: `POST /api/admin/internal/bookkeeping-income-sync` (Task 3); existing `internalCronToken`, `appUrl` secret params already defined at the top of `functions/src/index.ts`.
- Produces: exported `bookkeepingIncomeSyncCron` (GHA deploys it on push); `EXPECTED_CRONS` entry `{ name: "bookkeepingIncomeSyncCron", sla_hours: 30 }`.

- [ ] **Step 1: Append the delegator to `functions/src/index.ts`**

```ts
// Bookkeeping income sync. POSTs to /api/admin/internal/bookkeeping-income-sync,
// which sweeps the money-of-record tables through the manual import's exact
// pipeline and posts new income to the primary business book (idempotent —
// UNIQUE(book_id,source,source_ref) + alt_ref dedupe). Gated by
// system_settings.cron_bookkeeping_income_sync_enabled (default false, seeded
// by migration 00190). The route owns logCronStart/logCronEnd under
// "bookkeepingIncomeSyncCron" — this function must NOT log cron_runs itself
// (single-owner rule). Pure fetch-delegator: only internalCronToken + appUrl.
export const bookkeepingIncomeSyncCron = onSchedule(
  {
    schedule: "30 4 * * *",
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
      console.error("[bookkeepingIncomeSyncCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/bookkeeping-income-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error("[bookkeepingIncomeSyncCron]", res.status, body)
        return
      }
      console.log("[bookkeepingIncomeSyncCron]", res.status, body)
    } catch (err) {
      console.error("[bookkeepingIncomeSyncCron] failed:", err)
    }
  },
)
```

- [ ] **Step 2: Register in `EXPECTED_CRONS`**

In `lib/automation/automation-health-scanner.ts`, after the `bookkeepingReceiptWatchdogCron` line:

```ts
  { name: "bookkeepingIncomeSyncCron", sla_hours: 30 },  // daily 04:30
```

- [ ] **Step 3: Verify functions compile + tests pass**

Run (from `functions/`): `npm run build` then `npm test`
Expected: tsc clean; 517+ tests pass (the delegator itself has no test — same precedent as the receipt-watchdog delegator).

- [ ] **Step 4: Verify the scanner test still passes**

Run: `npx vitest run __tests__/lib/automation/automation-health-scanner.test.ts`
Expected: PASS (the test iterates `EXPECTED_CRONS` generically).

- [ ] **Step 5: Commit**

```powershell
git add functions/src/index.ts lib/automation/automation-health-scanner.ts
git commit -m "feat(bookkeeping): bookkeepingIncomeSyncCron delegator + health-watchdog registration"
```

---

### Task 5: Verification gates + prod migration (orchestrator-level)

**Files:** none new.

- [ ] **Step 1: Full app suite**

Run: `npm run test:run`
Expected: green vs the 2026-07-19 baseline (3118+ passing). Known load-flake: the stripe webhook pair can time out by wall-clock under load — re-run those two files in isolation before blaming this change; if still red, `git stash push -u -- <this change's paths>` and re-run to attribute.

- [ ] **Step 2: Production build (separate invocation — never `&&` after tests)**

Run: `npm run build`
Expected: GREEN. A silent exit-4 at "Running TypeScript" with no diagnostic = memory flake → re-run once. (No root↔functions import boundary is touched by this feature — the route imports only `lib/`, functions imports nothing from root — so the Vercel-condition build check is not required.)

- [ ] **Step 3: Apply migration 00190 to prod**

Via `mcp__supabase__apply_migration` with name `00190_bookkeeping_income_sync` and the file's SQL. Verify: `select value from system_settings where key = 'cron_bookkeeping_income_sync_enabled'` → `false`.

- [ ] **Step 4: Live watermark sanity read (read-only)**

Run via `mcp__supabase__execute_sql`: `select max(occurred_on) from bookkeeping_ledger_entries where book_id = 'b0000000-0000-4000-8000-000000000001' and source = 'platform_import'`
Expected: `2026-07-20` (the backfill) — confirms the first real cron run would sweep 2026-07-06 → today.

- [ ] **Step 5: Hold the push**

Everything stays committed locally on `main`. Push (→ Vercel deploy + functions GHA) waits for the owner's go-ahead. After push, the owner flips `cron_bookkeeping_income_sync_enabled` ON in admin settings.

---

## Self-Review Notes

- Spec coverage: D1 (Task 4 delegator), D2 (Tasks 2+3), D3 (Task 3 audit-only-on-insert; no email anywhere), D4 (route composes existing helpers, none modified), D5 (Task 3 listBooks filter + throw), D6 (Task 1 migration; Task 5 applies), D7 (Task 4 strings/secrets; Task 3 single-owner logging), D8 (Task 3 matcher + null fallback test), D9 (warnings cap + rejected_closed in detail; documented behavior, no special handling). Error handling §5 covered by Task 3 tests (401/skip/500) — the degraded-source-read case lives inside the untouched `listPlatformIncome` and keeps its existing behavior. Testing §6 covered by Tasks 2-4; out-of-scope §7 touches nothing.
- Type consistency: `computeSyncWindow(string | null, string)` used identically in Tasks 2/3; `latestPlatformImportDate(bookId): Promise<string | null>` defined in Task 3 Step 1 and mocked with the same shape in Step 2; insert result destructuring matches the real `insertImportedEntries` return.
