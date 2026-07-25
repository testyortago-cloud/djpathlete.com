# Track B — 5b Insights Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add findings dismissals, ledger deep-links, proportional shared-cost allocation, and a bounded AI narrative to /admin/books/insights.

**Architecture:** Dismissals persist an identity-based fingerprint (finder + stable key) in a new table and filter display only — the pure recompute stays. Deep-links hydrate BooksClient filters from URL params the entries API already parses, plus an account_id=none sentinel for uncategorized rows. Allocation is a pure largest-remainder split whose cents sum exactly. The narrative is one button-triggered, timeout-bounded Sonnet call with an honest fallback, fed a bundle with dismissed findings already filtered out.

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
- **Task count:** 7.

---

### Task B1: Migration 00192 — `bookkeeping_finding_dismissals`

**Files:**
- Create: `supabase/migrations/00192_bookkeeping_finding_dismissals.sql`

**Interfaces:**
- Produces: table `bookkeeping_finding_dismissals` (`id uuid PK`, `book_id uuid NOT NULL FK CASCADE`, `fingerprint text NOT NULL`, `dismissed_by uuid FK users SET NULL`, `dismissed_at timestamptz`, plain `UNIQUE (book_id, fingerprint)`), admin-only RLS ceremony matching 00183.
- Consumes: `bookkeeping_books` (00183), `users`.

- [ ] Write the migration file `supabase/migrations/00192_bookkeeping_finding_dismissals.sql` with exactly this SQL:

```sql
-- 00192_bookkeeping_finding_dismissals.sql
-- Track B (5b polish, design 2026-07-25 §2.1, decision B-1): identity-based
-- dismissals for insight findings. Fingerprint = "<finder>:<key>" (pure fn in
-- lib/bookkeeping/finding-fingerprint.ts) — identity, never amounts, so nightly
-- income-sync total growth cannot resurface a dismissal. Dismissals only filter
-- DISPLAY (and the AI narrative input); the pure recompute (D4) never changes.
-- RLS is enabled for ceremony only (00183 precedent): every DAL uses the
-- service-role client and scopes book_id in application code.

CREATE TABLE IF NOT EXISTS bookkeeping_finding_dismissals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id       UUID NOT NULL REFERENCES bookkeeping_books(id) ON DELETE CASCADE,
  fingerprint   TEXT NOT NULL,
  dismissed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_bk_dismissals_book ON bookkeeping_finding_dismissals(book_id);

ALTER TABLE bookkeeping_finding_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage finding dismissals" ON bookkeeping_finding_dismissals FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
```

- [ ] Apply it live: call the MCP tool `mcp__supabase__apply_migration` with `name: "00192_bookkeeping_finding_dismissals"` and the identical SQL above (the Supabase CLI is not linked — MCP is the only apply path).
- [ ] Verify: call `mcp__supabase__execute_sql` with `SELECT count(*) FROM bookkeeping_finding_dismissals;` — expect `0` rows, no error (table exists, empty).
- [ ] Commit. Write this message to `C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\commit-b1.txt` using the Write tool:

```
feat(bookkeeping): migration 00192 finding-dismissals table

Identity-fingerprint dismissals for insight findings (design B-1).
Plain UNIQUE (book_id, fingerprint); admin-only RLS ceremony per 00183.
Applied live via mcp apply_migration.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

  Then run: `git add supabase/migrations/00192_bookkeeping_finding_dismissals.sql` and `git commit -F "C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\commit-b1.txt"`

### Task B2: Pure `findingFingerprint` in `lib/bookkeeping/finding-fingerprint.ts`

**Files:**
- Create: `lib/bookkeeping/finding-fingerprint.ts`
- Create: `__tests__/lib/bookkeeping/finding-fingerprint.test.ts`

**Interfaces:**
- Produces: `export type FinderKind = "watchlist" | "substantiation_gap" | "uncategorized" | "vendor" | "home_office" | "year_end" | "watchdog"`; `export function findingFingerprint(finder: FinderKind, key: string): string` → `"<finder>:<key>"`, vendor keys normalized via `normalizeCounterparty`.
- Consumes: `normalizeCounterparty(raw: string | null): string | null` from `lib/bookkeeping/insight-types.ts:19` (trim + lowercase + collapse-ws).

- [ ] Write the failing test `__tests__/lib/bookkeeping/finding-fingerprint.test.ts` (zero-mock, mutation-discriminating fixtures per the house `12.555` convention):

```ts
import { describe, expect, it } from "vitest"
import { findingFingerprint } from "@/lib/bookkeeping/finding-fingerprint"

const ENTRY = "e0000000-0000-4000-8000-000000000001"

describe("findingFingerprint", () => {
  it("is <finder>:<key> for id-keyed finders, key untouched", () => {
    expect(findingFingerprint("substantiation_gap", ENTRY)).toBe(`substantiation_gap:${ENTRY}`)
    expect(findingFingerprint("year_end", "q4_timing")).toBe("year_end:q4_timing")
  })

  it("distinct finders over the SAME key never collide (same entry can be a gap AND a watchdog finding)", () => {
    expect(findingFingerprint("substantiation_gap", ENTRY)).not.toBe(findingFingerprint("watchdog", ENTRY))
    expect(findingFingerprint("watchlist", ENTRY)).not.toBe(findingFingerprint("home_office", ENTRY))
  })

  it("vendor keys collapse case + whitespace runs via normalizeCounterparty", () => {
    expect(findingFingerprint("vendor", " Adobe   INC ")).toBe("vendor:adobe inc")
    expect(findingFingerprint("vendor", "adobe inc")).toBe("vendor:adobe inc")
  })

  it("normalization applies ONLY to the vendor finder — other keys keep their exact bytes", () => {
    // Discriminator: a blanket .toLowerCase() mutation would pass the vendor
    // test but corrupt this one.
    expect(findingFingerprint("year_end", "Q4_Timing")).toBe("year_end:Q4_Timing")
  })

  it("a vendor key that normalizes to null (whitespace-only) falls back to the raw key", () => {
    expect(findingFingerprint("vendor", "   ")).toBe("vendor:   ")
  })
})
```

- [ ] Run `npx vitest run __tests__/lib/bookkeeping/finding-fingerprint.test.ts` — expect failure: `Cannot find module '@/lib/bookkeeping/finding-fingerprint'`.
- [ ] Implement `lib/bookkeeping/finding-fingerprint.ts`:

```ts
// Pure identity fingerprint for insight-finding dismissals (5b, decision B-1).
// "<finder>:<key>" — identity only, NEVER amounts: aggregate totals grow nightly
// (income-sync) and an amount-bearing hash would resurface every dismissal
// within a day. Keys per finder (design §2.1): watchlist/home_office →
// account uuid; substantiation_gap/uncategorized/watchdog → entry uuid;
// vendor → normalizeCounterparty(vendor key); year_end → literal flag id.
// Client-safe: zero IO, imported by both the routes and InsightsClient.
import { normalizeCounterparty } from "./insight-types"

export type FinderKind =
  | "watchlist"
  | "substantiation_gap"
  | "uncategorized"
  | "vendor"
  | "home_office"
  | "year_end"
  | "watchdog"

export function findingFingerprint(finder: FinderKind, key: string): string {
  const stableKey = finder === "vendor" ? (normalizeCounterparty(key) ?? key) : key
  return `${finder}:${stableKey}`
}
```

- [ ] Run `npx vitest run __tests__/lib/bookkeeping/finding-fingerprint.test.ts` — expect 5 passing.
- [ ] Commit. Write to `C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\commit-b2.txt`:

```
feat(bookkeeping): pure findingFingerprint for dismissals

<finder>:<key> identity fingerprint; vendor keys pass through
normalizeCounterparty; zero-mock discriminating tests.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

  Then `git add lib/bookkeeping/finding-fingerprint.ts __tests__/lib/bookkeeping/finding-fingerprint.test.ts` and `git commit -F "C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\commit-b2.txt"`

### Task B3: Dismissals DAL + POST/DELETE routes + insights GET wiring

**Files:**
- Modify: `lib/db/bookkeeping.ts` (append a new `// ── Finding dismissals` section after the accounts section, ~line 65)
- Create: `app/api/admin/bookkeeping/insights/dismissals/route.ts`
- Modify: `app/api/admin/bookkeeping/insights/route.ts` (import at :16; `bookPayloads` map at :45-60)
- Modify: `lib/audit/actions.ts` (append two rows to the `// bookkeeping` block, after the `bookkeeping.income_synced` row at :260)
- Create: `__tests__/api/admin/bookkeeping/insights-dismissals.test.ts`
- Create: `__tests__/api/admin/bookkeeping/insights.test.ts`

**Interfaces:**
- Produces: `export async function listDismissedFingerprints(bookId: string): Promise<string[]>`, `export async function insertDismissal(input: { book_id: string; fingerprint: string; dismissed_by: string | null }): Promise<void>`, `export async function deleteDismissal(bookId: string, fingerprint: string): Promise<void>` in `lib/db/bookkeeping.ts`; `POST`/`DELETE /api/admin/bookkeeping/insights/dismissals`; insights GET books gain `dismissed_fingerprints: string[]`; audit slugs `bookkeeping.finding_dismissed` / `bookkeeping.finding_undismissed`.
- Consumes: `fetchAllRows` (`lib/db/paginate.ts:9`), `recordAudit` (`lib/audit/record.ts`), `auth` (`lib/auth`), plain unique `(book_id, fingerprint)` from B1 (upsert `onConflict` requires a PLAIN unique constraint — satisfied).

- [ ] Write the failing route test `__tests__/api/admin/bookkeeping/insights-dismissals.test.ts` — mock style mirrored from `__tests__/api/admin/bookkeeping/entries.test.ts` (module-level `vi.fn()` + `vi.mock` of `@/lib/auth`, `@/lib/audit/record`, `@/lib/db/bookkeeping`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const insertDismissalMock = vi.fn()
const deleteDismissalMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))
vi.mock("@/lib/db/bookkeeping", () => ({
  insertDismissal: (...a: unknown[]) => insertDismissalMock(...a),
  deleteDismissal: (...a: unknown[]) => deleteDismissalMock(...a),
}))

import { POST, DELETE } from "@/app/api/admin/bookkeeping/insights/dismissals/route"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const FP = "vendor:adobe inc"

function req(method: string, body: unknown): Request {
  return new Request("http://x/api/admin/bookkeeping/insights/dismissals", {
    method,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  authMock.mockReset(); insertDismissalMock.mockReset(); deleteDismissalMock.mockReset(); recordAuditMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  insertDismissalMock.mockResolvedValue(undefined)
  deleteDismissalMock.mockResolvedValue(undefined)
})

describe("POST /api/admin/bookkeeping/insights/dismissals", () => {
  it("403s a non-admin and writes nothing", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req("POST", { book_id: BOOK, fingerprint: FP }) as never)
    expect(res.status).toBe(403)
    expect(insertDismissalMock).not.toHaveBeenCalled()
  })
  it("400s a non-uuid book_id and an empty fingerprint", async () => {
    expect((await POST(req("POST", { book_id: "nope", fingerprint: FP }) as never)).status).toBe(400)
    expect((await POST(req("POST", { book_id: BOOK, fingerprint: "" }) as never)).status).toBe(400)
    expect(insertDismissalMock).not.toHaveBeenCalled()
  })
  it("inserts the dismissal stamped with the actor and audits finding_dismissed", async () => {
    const res = await POST(req("POST", { book_id: BOOK, fingerprint: FP }) as never)
    expect(res.status).toBe(200)
    expect(insertDismissalMock).toHaveBeenCalledWith({ book_id: BOOK, fingerprint: FP, dismissed_by: "admin-1" })
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bookkeeping.finding_dismissed", category: "commerce" }),
    )
  })
  it("500s without leaking when the DAL throws", async () => {
    insertDismissalMock.mockRejectedValue(new Error("db boom"))
    const res = await POST(req("POST", { book_id: BOOK, fingerprint: FP }) as never)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain("boom")
  })
})

describe("DELETE /api/admin/bookkeeping/insights/dismissals", () => {
  it("deletes the dismissal and audits finding_undismissed", async () => {
    const res = await DELETE(req("DELETE", { book_id: BOOK, fingerprint: FP }) as never)
    expect(res.status).toBe(200)
    expect(deleteDismissalMock).toHaveBeenCalledWith(BOOK, FP)
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bookkeeping.finding_undismissed" }),
    )
  })
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue(null)
    const res = await DELETE(req("DELETE", { book_id: BOOK, fingerprint: FP }) as never)
    expect(res.status).toBe(403)
    expect(deleteDismissalMock).not.toHaveBeenCalled()
  })
})
```

- [ ] Run `npx vitest run __tests__/api/admin/bookkeeping/insights-dismissals.test.ts` — expect failure: cannot resolve `@/app/api/admin/bookkeeping/insights/dismissals/route`.
- [ ] Add the audit slugs — in `lib/audit/actions.ts`, immediately after the `bookkeeping.income_synced` row (:260), insert:

```ts
  { slug: "bookkeeping.finding_dismissed", category: "commerce", description: "Insight finding dismissed from the insights page" },
  { slug: "bookkeeping.finding_undismissed", category: "commerce", description: "Insight finding dismissal removed — finding restored" },
```

- [ ] Add the DAL functions — in `lib/db/bookkeeping.ts`, after `updateAccount` (:64), insert:

```ts
// ── Finding dismissals (5b) ──────────────────────────────────────────────
// Identity fingerprints ("<finder>:<key>", lib/bookkeeping/finding-fingerprint.ts).
// Dismissals gate DISPLAY only — the insight recompute (D4) never reads them.
export async function listDismissedFingerprints(bookId: string): Promise<string[]> {
  const rows = await fetchAllRows<{ fingerprint: string }>(
    (from, to) =>
      db().from("bookkeeping_finding_dismissals").select("fingerprint")
        .eq("book_id", bookId).order("dismissed_at", { ascending: true })
        .range(from, to) as never,
  )
  return rows.map((r) => r.fingerprint)
}

export async function insertDismissal(input: { book_id: string; fingerprint: string; dismissed_by: string | null }): Promise<void> {
  // Idempotent: re-dismissing is a no-op. onConflict targets the PLAIN unique
  // constraint (book_id, fingerprint) from 00192 — never an expression index.
  const { error } = await db().from("bookkeeping_finding_dismissals")
    .upsert(input, { onConflict: "book_id,fingerprint", ignoreDuplicates: true })
  if (error) throw error
}

export async function deleteDismissal(bookId: string, fingerprint: string): Promise<void> {
  const { error } = await db().from("bookkeeping_finding_dismissals")
    .delete().eq("book_id", bookId).eq("fingerprint", fingerprint)
  if (error) throw error
}
```

- [ ] Create `app/api/admin/bookkeeping/insights/dismissals/route.ts`:

```ts
// Dismiss / restore an insight finding (5b, decision B-2). Admin self-gated
// (/api/* is NOT in the middleware matcher), audited both ways. The body
// fingerprint is opaque here — identity semantics live in finding-fingerprint.ts.
import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { deleteDismissal, insertDismissal } from "@/lib/db/bookkeeping"

const dismissalBodySchema = z.object({ book_id: z.string().uuid(), fingerprint: z.string().min(1) })

async function handle(request: Request, mode: "dismiss" | "undismiss") {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const body = await request.json().catch(() => null)
    const parsed = dismissalBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    }
    const { book_id, fingerprint } = parsed.data
    if (mode === "dismiss") {
      await insertDismissal({ book_id, fingerprint, dismissed_by: session.user.id })
    } else {
      await deleteDismissal(book_id, fingerprint)
    }
    void recordAudit({
      action: mode === "dismiss" ? "bookkeeping.finding_dismissed" : "bookkeeping.finding_undismissed",
      category: "commerce",
      outcome: "success",
      target: { type: "bookkeeping_finding", id: fingerprint, label: fingerprint },
      metadata: { book_id, fingerprint },
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("bookkeeping finding dismissal:", error)
    return NextResponse.json({ error: "Failed to update the dismissal" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return handle(request, "dismiss")
}

export async function DELETE(request: Request) {
  return handle(request, "undismiss")
}
```

- [ ] Run `npx vitest run __tests__/api/admin/bookkeeping/insights-dismissals.test.ts` — expect 6 passing.
- [ ] Write the failing insights-GET test `__tests__/api/admin/bookkeeping/insights.test.ts` (pure finders run for real over empty fixtures; only IO is mocked — same mock style as `entries.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const loadInsightsBundleMock = vi.fn()
const getSettingMock = vi.fn()
const listEntriesForInsightsMock = vi.fn()
const listDismissedFingerprintsMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/bookkeeping/insight-data", () => ({
  loadInsightsBundle: (...a: unknown[]) => loadInsightsBundleMock(...a),
}))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: (...a: unknown[]) => getSettingMock(...a) }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listEntriesForInsights: (...a: unknown[]) => listEntriesForInsightsMock(...a),
  listDismissedFingerprints: (...a: unknown[]) => listDismissedFingerprintsMock(...a),
}))

import { GET } from "@/app/api/admin/bookkeeping/insights/route"

const BOOK = {
  id: "b0000000-0000-4000-8000-000000000001",
  name: "Darren — DJP Athlete",
  book_kind: "business",
  owner_label: "Darren",
  is_primary: true,
  currency: "usd",
  sort_order: 0,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

beforeEach(() => {
  authMock.mockReset(); loadInsightsBundleMock.mockReset(); getSettingMock.mockReset()
  listEntriesForInsightsMock.mockReset(); listDismissedFingerprintsMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  loadInsightsBundleMock.mockResolvedValue({ books: [BOOK], accounts: [], entries: [] })
  getSettingMock.mockResolvedValue(null)
  listEntriesForInsightsMock.mockResolvedValue([])
  listDismissedFingerprintsMock.mockResolvedValue(["vendor:adobe inc"])
})

describe("GET /api/admin/bookkeeping/insights", () => {
  it("returns each book's dismissed_fingerprints from the dismissals table", async () => {
    const res = await GET(new Request("http://x/api?from=2026-01-01&to=2026-06-30") as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.books[0].dismissed_fingerprints).toEqual(["vendor:adobe inc"])
    expect(listDismissedFingerprintsMock).toHaveBeenCalledWith(BOOK.id)
  })
  it("403s a non-admin before any read", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await GET(new Request("http://x/api?from=2026-01-01&to=2026-06-30") as never)
    expect(res.status).toBe(403)
    expect(loadInsightsBundleMock).not.toHaveBeenCalled()
  })
})
```

- [ ] Run `npx vitest run __tests__/api/admin/bookkeeping/insights.test.ts` — expect failure: `dismissed_fingerprints` is `undefined`.
- [ ] Wire the GET — in `app/api/admin/bookkeeping/insights/route.ts`: change the import at :16 to `import { listDismissedFingerprints, listEntriesForInsights } from "@/lib/db/bookkeeping"`; before the `bookPayloads` map (:45) add:

```ts
    const dismissedPerBook = await Promise.all(bundle.books.map((b) => listDismissedFingerprints(b.id)))
```

  and change the map header from `const bookPayloads = bundle.books.map((book) => {` to `const bookPayloads = bundle.books.map((book, i) => {`, adding one field to the returned object after `row_count: bookEntries.length,`:

```ts
        dismissed_fingerprints: dismissedPerBook[i],
```

- [ ] Run `npx vitest run __tests__/api/admin/bookkeeping/insights.test.ts __tests__/api/admin/bookkeeping/insights-dismissals.test.ts` — expect all passing.
- [ ] Commit. Write to `C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\commit-b3.txt`:

```
feat(bookkeeping): dismissals DAL + POST/DELETE route + insights GET wiring

listDismissedFingerprints/insertDismissal/deleteDismissal (fetchAllRows,
idempotent upsert on the plain unique pair); admin self-gated dismissals
route audited finding_dismissed/finding_undismissed (both slugs registered);
insights GET returns dismissed_fingerprints per book — pure recompute (D4)
untouched, dismissals gate display only (decision B-2).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

  Then `git add lib/db/bookkeeping.ts lib/audit/actions.ts app/api/admin/bookkeeping/insights/dismissals/route.ts app/api/admin/bookkeeping/insights/route.ts __tests__/api/admin/bookkeeping/insights-dismissals.test.ts __tests__/api/admin/bookkeeping/insights.test.ts` and `git commit -F "C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\commit-b3.txt"`

### Task B4: InsightsClient dismissal UI (per-row X, "N dismissed — show" reveal)

**Files:**
- Modify: `components/admin/bookkeeping/InsightsClient.tsx` (imports :3-19; `BookInsights` :21-27; state block :66-77; `fetchInsights` :79-97; derived values :185-191; cards: year-end strip :348-357, watchlist :383-427, gaps :429-482, uncategorized :484-525, vendors :572-608, watchdog :610-669)

**Interfaces:**
- Consumes: `findingFingerprint`, `FinderKind` (B2); `POST`/`DELETE /api/admin/bookkeeping/insights/dismissals` (B3); `dismissed_fingerprints: string[]` per book from the insights GET (B3); existing types `SubstantiationGap`/`UncategorizedEntry`/`WatchlistRow` (`lib/bookkeeping/deduction-finder.ts:13-48`), `RecurringVendor` (`lib/bookkeeping/vendor-sweep.ts:8`), `WatchdogFinding` (`lib/bookkeeping/receipt-watchdog.ts:14`), `YearEndFlag` (`lib/bookkeeping/year-end-flags.ts:2`).
- Produces: UI-only changes; no new exports.

**Coverage note (checked 2026-07-25):** `__tests__/components/admin/bookkeeping/` does not exist and no sibling bookkeeping client component (BooksClient, ReportsClient, InsightsClient, LedgerTable) has a component test — per the established boundary, this task's behavior is covered at the route level (B3's dismissals + insights-GET tests) and the pure-fn level (B2). No component test is added here; the D(iii) track-end click-through exercises the reveal/restore flow live.

**Scope decisions (documented, not placeholders):** (a) Card headline chips ("N entries · $X") keep the full recompute totals — dismissals collapse rows, they never alter computed numbers ("pure recompute stays; dismissals only filter display" — collapsing is display, totals are recompute output). (b) The home-office card gets NO dismiss UI — its rows are proposal *inputs* governed by the percent control, not findings; `home_office` stays in `FinderKind` for fingerprint completeness. (c) Year-end flags are computed cross-book, so their dismissals are scoped to the primary book's `book_id`.

- [ ] Add imports and shared helpers. In `components/admin/bookkeeping/InsightsClient.tsx`, extend the lucide import (:5) to `import { ArrowLeft, BarChart3, CalendarRange, Lightbulb, X } from "lucide-react"`, add `import { findingFingerprint } from "@/lib/bookkeeping/finding-fingerprint"`, and add `dismissed_fingerprints: string[]` to `BookInsights` (:21-27). Then add these module-scope helpers below `ReceiptDot` (:57):

```tsx
function partitionDismissed<T>(rows: T[], dismissed: (row: T) => boolean): { visible: T[]; hidden: T[] } {
  const visible: T[] = []
  const hidden: T[] = []
  for (const row of rows) (dismissed(row) ? hidden : visible).push(row)
  return { visible, hidden }
}

function DismissButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="text-muted-foreground transition-colors hover:text-error"
    >
      <X className="size-3.5" />
    </button>
  )
}

/** Collapsed dismissed rows: compact summary lines + a Restore button each. */
function DismissedReveal({
  count,
  open,
  onToggle,
  children,
}: {
  count: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        {count} dismissed — {open ? "hide" : "show"}
      </button>
      {open ? <div className="mt-2 space-y-1 opacity-70">{children}</div> : null}
    </div>
  )
}
```

- [ ] Add dismissal state + actions inside `InsightsClient` (after `fetchRequestIdRef`, :77):

```ts
  // Dismissals (5b): optimistic overrides keyed `${bookId}|${fingerprint}`,
  // cleared whenever a fresh GET lands (server truth wins). Reveal open-state
  // is per card key.
  const [dismissOverrides, setDismissOverrides] = useState<Record<string, "dismissed" | "active">>({})
  const [revealOpen, setRevealOpen] = useState<Record<string, boolean>>({})

  const setDismissed = useCallback(async (rowBookId: string, fingerprint: string, dismissed: boolean) => {
    const key = `${rowBookId}|${fingerprint}`
    setDismissOverrides((o) => ({ ...o, [key]: dismissed ? "dismissed" : "active" }))
    try {
      const res = await fetch("/api/admin/bookkeeping/insights/dismissals", {
        method: dismissed ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: rowBookId, fingerprint }),
      })
      if (!res.ok) throw new Error("failed")
    } catch {
      setDismissOverrides((o) => ({ ...o, [key]: dismissed ? "active" : "dismissed" }))
      toast.error(dismissed ? "Failed to dismiss the finding" : "Failed to restore the finding")
    }
  }, [])
```

  and inside `fetchInsights`'s success branch (:87-91), after `setData(body)`, add `setDismissOverrides({})`.
- [ ] Add the per-card partitions in the derived-values block (after `forecastForBook`, :191):

```ts
  const isDismissed = (rowBookId: string, fingerprint: string, serverList: string[]) => {
    const override = dismissOverrides[`${rowBookId}|${fingerprint}`]
    if (override) return override === "dismissed"
    return serverList.includes(fingerprint)
  }
  const activeDismissed = active?.dismissed_fingerprints ?? []
  const activeBookId = active?.book.id ?? ""
  const watchlistParts = partitionDismissed(active?.deductions.watchlist ?? [], (w) =>
    isDismissed(activeBookId, findingFingerprint("watchlist", w.account_id), activeDismissed))
  const gapParts = partitionDismissed(active?.deductions.substantiation_gaps ?? [], (g) =>
    isDismissed(activeBookId, findingFingerprint("substantiation_gap", g.entry_id), activeDismissed))
  const uncatParts = partitionDismissed(active?.deductions.uncategorized.entries ?? [], (u) =>
    isDismissed(activeBookId, findingFingerprint("uncategorized", u.entry_id), activeDismissed))
  const vendorParts = partitionDismissed(active?.vendors.recurring ?? [], (v) =>
    isDismissed(activeBookId, findingFingerprint("vendor", v.key), activeDismissed))
  const watchdogParts = partitionDismissed(watchdogRows, (f) =>
    isDismissed(activeBookId, findingFingerprint("watchdog", f.entry_id), activeDismissed))
  // Year-end flags are cross-book: dismissals scope to the primary book.
  const primaryPayload = data?.books.find((b) => b.book.is_primary) ?? data?.books[0]
  const flagParts = partitionDismissed(data?.year_end_flags ?? [], (flag) =>
    primaryPayload
      ? isDismissed(primaryPayload.book.id, findingFingerprint("year_end", flag.id), primaryPayload.dismissed_fingerprints)
      : false)
```

- [ ] Rewrite the year-end flags strip (:348-357) to use `flagParts` (X per flag, reveal below):

```tsx
      {data && data.year_end_flags.length > 0 && primaryPayload ? (
        <div className="space-y-2">
          {flagParts.visible.map((flag) => (
            <div key={flag.id} className="rounded-lg border border-border bg-primary/5 p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-primary">{flag.title}</p>
                <DismissButton
                  label={`Dismiss flag: ${flag.title}`}
                  onClick={() => void setDismissed(primaryPayload.book.id, findingFingerprint("year_end", flag.id), true)}
                />
              </div>
              <p className="text-muted-foreground">{flag.detail}</p>
            </div>
          ))}
          <DismissedReveal
            count={flagParts.hidden.length}
            open={revealOpen["year_end"] ?? false}
            onToggle={() => setRevealOpen((r) => ({ ...r, year_end: !r.year_end }))}
          >
            {flagParts.hidden.map((flag) => (
              <div key={flag.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{flag.title}</span>
                <button
                  type="button"
                  className="text-xs underline-offset-4 hover:underline"
                  onClick={() => void setDismissed(primaryPayload.book.id, findingFingerprint("year_end", flag.id), false)}
                >
                  Restore
                </button>
              </div>
            ))}
          </DismissedReveal>
        </div>
      ) : null}
```

- [ ] Apply the same mechanical change to the five per-book cards. For each: (1) map `<parts>.visible` instead of the raw list, `.slice(0, VISIBLE_ROW_CAP)` where it exists today; (2) add a trailing `<td className="py-1.5">` cell (plus an empty `<th className="py-1" />` in the header row) holding a `DismissButton`; (3) append a `DismissedReveal` after the table. Exact per-card wiring:

  **Watchlist** (:399-417 rows): map `watchlistParts.visible`; button `onClick={() => void setDismissed(active.book.id, findingFingerprint("watchlist", w.account_id), true)}` with `label={`Dismiss watchlist row: ${w.name}`}`; reveal key `"watchlist"`, hidden summary line:

```tsx
              <div key={w.account_id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{w.name} · {formatCents(w.total_cents, active.book.currency)}</span>
                <button type="button" className="text-xs underline-offset-4 hover:underline"
                  onClick={() => void setDismissed(active.book.id, findingFingerprint("watchlist", w.account_id), false)}>
                  Restore
                </button>
              </div>
```

  **Substantiation gaps** (:455-466 rows): map `gapParts.visible.slice(0, VISIBLE_ROW_CAP)`; the "and N more" check (:469) becomes `gapParts.visible.length > VISIBLE_ROW_CAP` with `gapParts.visible.length - VISIBLE_ROW_CAP`; button key `findingFingerprint("substantiation_gap", gap.entry_id)`, `label={`Dismiss gap: ${gap.counterparty ?? gap.occurred_on}`}`; reveal key `"gaps"`, hidden line: `{gap.occurred_on} · {gap.counterparty ?? "—"} · {formatCents(gap.amount_cents, active.book.currency)}` + Restore.

  **Uncategorized** (:508-515 rows): map `uncatParts.visible.slice(0, VISIBLE_ROW_CAP)` (same "and N more" adjustment at :518); fingerprint `findingFingerprint("uncategorized", entry.entry_id)`; reveal key `"uncategorized"`, hidden line: `{entry.occurred_on} · {entry.counterparty ?? "—"} · {formatCents(entry.amount_cents, active.book.currency)}` + Restore.

  **Vendors** (:586-601 rows): map `vendorParts.visible`; fingerprint `findingFingerprint("vendor", v.key)` (`v.key` is already normalized — `findingFingerprint` re-normalizing is idempotent), `label={`Dismiss vendor: ${v.display_name}`}`; reveal key `"vendors"`, hidden line: `{v.display_name} · {formatCents(v.annualized_cents, active.book.currency)}/yr` + Restore. This is the design's "expected first customer" — vendor-sweep noise.

  **Watchdog** (:641-660 rows): map `watchdogParts.visible.slice(0, VISIBLE_ROW_CAP)` (same "and N more" adjustment at :663); fingerprint `findingFingerprint("watchdog", f.entry_id)`; reveal key `"watchdog"`, hidden line: `{f.occurred_on} · {f.counterparty ?? "—"} · {formatCents(f.amount_cents, active.book.currency)}` + Restore.

- [ ] Run the adjacent suites (no component harness — see coverage note): `npx vitest run __tests__/lib/bookkeeping/finding-fingerprint.test.ts __tests__/api/admin/bookkeeping/insights-dismissals.test.ts __tests__/api/admin/bookkeeping/insights.test.ts` — expect all passing (pins the contract this UI consumes).
- [ ] Commit. Write to `C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\commit-b4.txt`:

```
feat(bookkeeping): insights dismissal UI — per-row X + dismissed reveal

Optimistic per-(book,fingerprint) overrides cleared on refetch; six cards
(watchlist, gaps, uncategorized, vendors, watchdog, year-end) collapse
dismissed rows into an "N dismissed — show" reveal with Restore. Chips keep
recompute totals; home-office card intentionally has no dismiss UI; year-end
flags scope to the primary book. No component harness exists for bookkeeping
components — covered by B2/B3 tests + track-end click-through.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

  Then `git add components/admin/bookkeeping/InsightsClient.tsx` and `git commit -F "C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\commit-b4.txt"`

### Task B5: Gap deep-links — URL hydration, `account_id=none` sentinel, insights → ledger links

**Files:**
- Modify: `app/(admin)/admin/books/page.tsx` (whole file, 12 lines)
- Modify: `components/admin/bookkeeping/BooksClient.tsx` (props :59-67; `filters` init :69; `preset` init :176; account select :424-435)
- Modify: `lib/db/bookkeeping.ts` (`applyEntryFilters` :72-86)
- Modify: `components/admin/bookkeeping/InsightsClient.tsx` (gaps "Open ledger" link :474-479; gap account cell :460; uncategorized date cell :510)
- Create: `__tests__/lib/db/bookkeeping-entries-filters.test.ts`
- Modify: `__tests__/api/admin/bookkeeping/entries.test.ts` (append one GET test)
- Create: `__tests__/components/admin/bookkeeping/BooksClient-hydration.test.tsx`

**Interfaces:**
- Produces: `export type BooksClientInitialFilters = Omit<Filters, "page">` + optional `initialFilters` prop on `BooksClient`; `applyEntryFilters` exported (for the builder test) and handling `accountId === "none"` via `.is("account_id", null)`; "Uncategorized" option in the Category select; per-row `Link` hrefs in InsightsClient.
- Consumes: entries GET (`app/api/admin/bookkeeping/entries/route.ts:9-44` — already parses `book_id/from/to/direction/account_id/source/q/page`, passes `account_id` through untouched, so no route change is needed for the sentinel); async `searchParams` Promise convention per `app/(admin)/admin/books/reports/print/page.tsx:71`; `handleBookChange` (:166-169) is user-event-only so hydration survives mount (verified — the `:168` accountId reset never fires on first render).

- [ ] Write the failing DAL builder test `__tests__/lib/db/bookkeeping-entries-filters.test.ts` (chainable-recorder Supabase mock — house idiom mirrored from `__tests__/lib/db/bookkeeping-platform-income.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// Chainable recorder builder (house idiom — see bookkeeping-platform-income.test.ts):
// records every filter call; thenable so `await q` resolves.
const calls: { method: string; args: unknown[] }[] = []
function makeBuilder() {
  const builder: Record<string, unknown> = {}
  for (const m of ["select", "eq", "gte", "lte", "or", "is", "order", "range"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args })
      return builder
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thenable protocol
  ;(builder as any).then = (onFulfilled?: any, onRejected?: any) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(onFulfilled, onRejected)
  return builder
}
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({ from: () => makeBuilder() }) }))

import { listEntries } from "@/lib/db/bookkeeping"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACCOUNT = "a0000000-0000-4000-8000-000000000001"

beforeEach(() => {
  calls.length = 0
})

describe("listEntries account filter", () => {
  it("accountId='none' filters with .is('account_id', null) and never .eq on account_id", async () => {
    await listEntries({ bookId: BOOK, accountId: "none", page: 1, perPage: 50 })
    expect(calls.some((c) => c.method === "is" && c.args[0] === "account_id" && c.args[1] === null)).toBe(true)
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "account_id")).toBe(false)
  })
  it("a real accountId still filters with .eq — the sentinel does not swallow uuids", async () => {
    await listEntries({ bookId: BOOK, accountId: ACCOUNT, page: 1, perPage: 50 })
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "account_id" && c.args[1] === ACCOUNT)).toBe(true)
    expect(calls.some((c) => c.method === "is" && c.args[0] === "account_id")).toBe(false)
  })
})
```

- [ ] Run `npx vitest run __tests__/lib/db/bookkeeping-entries-filters.test.ts` — expect the first test to fail (`.is` never called; "none" currently goes through `.eq`).
- [ ] Implement the sentinel — in `lib/db/bookkeeping.ts`, change `applyEntryFilters` (:72-86) to add `is` to the generic constraint and export it, and branch on the sentinel:

```ts
/** Exported for the builder-recorder test (bookkeeping-entries-filters.test.ts). */
export function applyEntryFilters<Q extends { eq: (c: string, v: unknown) => Q; gte: (c: string, v: unknown) => Q; lte: (c: string, v: unknown) => Q; or: (s: string) => Q; is: (c: string, v: unknown) => Q }>(
  q: Q, p: ListEntriesParams,
): Q {
  let out = q.eq("book_id", p.bookId)
  if (p.from) out = out.gte("occurred_on", p.from)
  if (p.to) out = out.lte("occurred_on", p.to)
  if (p.direction) out = out.eq("direction", p.direction)
  // "none" sentinel (design B-3): uncategorized entries have account_id NULL,
  // which eq() can never match — deep-links from the insights page need it.
  if (p.accountId === "none") out = out.is("account_id", null)
  else if (p.accountId) out = out.eq("account_id", p.accountId)
  if (p.source) out = out.eq("source", p.source)
  if (p.search) {
    const esc = p.search.replace(/[%_]/g, (m) => `\\${m}`).replace(/[,().]/g, " ")
    out = out.or(`memo.ilike.%${esc}%,counterparty.ilike.%${esc}%`)
  }
  return out
}
```

- [ ] Run `npx vitest run __tests__/lib/db/bookkeeping-entries-filters.test.ts` — expect 2 passing.
- [ ] Pin the route passthrough — append to the GET describe in `__tests__/api/admin/bookkeeping/entries.test.ts`:

```ts
  it("passes the account_id=none sentinel through to listEntries untouched", async () => {
    listEntriesMock.mockResolvedValue({ rows: [], total: 0 })
    entryTotalsMock.mockResolvedValue({ income_cents: 0, expense_cents: 0 })
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}&account_id=none`) as never)
    expect(res.status).toBe(200)
    expect(listEntriesMock).toHaveBeenCalledWith(expect.objectContaining({ accountId: "none" }))
  })
```

  Run `npx vitest run __tests__/api/admin/bookkeeping/entries.test.ts` — expect pass immediately (the route already passes `account_id` through; this pins it against future validation tightening).
- [ ] Write the failing hydration component test `__tests__/components/admin/bookkeeping/BooksClient-hydration.test.tsx` (the repo DOES test client components — style mirrored from `__tests__/components/admin/AdGroupAdList.test.tsx`: `render` + mocked `sonner` + mocked `global.fetch`; `next/navigation` is globally mocked in `__tests__/setup.tsx`):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { BooksClient } from "@/components/admin/bookkeeping/BooksClient"
import type { BookkeepingBook } from "@/types/database"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const fetchUrls: string[] = []
function jsonRes(body: unknown) {
  return { ok: true, json: async () => body, text: async () => JSON.stringify(body) }
}

const BOOK: BookkeepingBook = {
  id: "b0000000-0000-4000-8000-000000000001",
  name: "Darren — DJP Athlete",
  book_kind: "business",
  owner_label: "Darren",
  is_primary: true,
  currency: "usd",
  sort_order: 0,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchUrls.length = 0
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    fetchUrls.push(url)
    if (url.includes("/entries")) {
      return jsonRes({ rows: [], total: 0, totals: { income_cents: 0, expense_cents: 0 }, page: 1, perPage: 50 })
    }
    if (url.includes("/closes")) return jsonRes({ closes: [] })
    return jsonRes({ accounts: [] })
  }) as unknown as typeof fetch
})

describe("<BooksClient> deep-link hydration", () => {
  it("hydrates initialFilters into the first entries fetch and the Category select", async () => {
    render(
      <BooksClient
        books={[BOOK]}
        initialBookId={BOOK.id}
        initialAccounts={[]}
        initialFilters={{ from: "2026-01-01", to: "2026-06-30", direction: "expense", accountId: "none", source: "", q: "" }}
      />,
    )
    await waitFor(() => {
      const entriesUrl = fetchUrls.find((u) => u.includes("/entries"))
      expect(entriesUrl).toBeDefined()
      expect(entriesUrl).toContain("account_id=none")
      expect(entriesUrl).toContain("direction=expense")
      expect(entriesUrl).toContain("from=2026-01-01")
    })
    expect(screen.getByRole("option", { name: "Uncategorized" })).toBeInTheDocument()
    expect((screen.getByRole("combobox", { name: /category/i }) as HTMLSelectElement).value).toBe("none")
  })
})
```

  (If `getByRole("combobox", { name: /category/i })` fails because the `<label>` wrapping doesn't associate — it uses a `<span>`, not `htmlFor` — fall back to `screen.getByDisplayValue("Uncategorized")` on the select; keep whichever query passes against the real DOM, asserting the select's value is `"none"`.)
- [ ] Run `npx vitest run __tests__/components/admin/bookkeeping/BooksClient-hydration.test.tsx` — expect failure (`initialFilters` prop does not exist; no "Uncategorized" option).
- [ ] Implement BooksClient hydration — in `components/admin/bookkeeping/BooksClient.tsx`:
  - After the `Filters` interface (:37) add `export type BooksClientInitialFilters = Omit<Filters, "page">`.
  - Extend the props (:59-67) with `initialFilters` and hydrate the two `useState` initializers (`filters` :69, `preset` :176):

```tsx
export function BooksClient({
  books,
  initialBookId,
  initialAccounts,
  initialFilters,
}: {
  books: BookkeepingBook[]
  initialBookId: string
  initialAccounts: BookkeepingAccount[]
  initialFilters?: BooksClientInitialFilters
}) {
  const [bookId, setBookId] = useState(initialBookId)
  // Deep-link hydration (5b): useState initializers only — no effect, no reset
  // guard needed (the :168 accountId reset lives in handleBookChange, which is
  // user-event-only and never fires on mount).
  const [filters, setFilters] = useState<Filters>(() =>
    initialFilters ? { ...EMPTY_FILTERS, ...initialFilters } : EMPTY_FILTERS,
  )
```

  and change the preset initializer (:176) to:

```ts
  const [preset, setPreset] = useState<"all" | "custom" | PeriodPreset>(() =>
    initialFilters && (initialFilters.from || initialFilters.to) ? "custom" : "all",
  )
```

  - Add the sentinel option to the Category select (:429, after `<option value="">All categories</option>`):

```tsx
                  <option value="none">Uncategorized</option>
```

- [ ] Implement the page — replace `app/(admin)/admin/books/page.tsx` in full:

```tsx
import { listBooks, listAccounts } from "@/lib/db/bookkeeping"
import { BooksClient, type BooksClientInitialFilters } from "@/components/admin/bookkeeping/BooksClient"

export const metadata = { title: "Accounting — Admin" }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SOURCES = ["manual", "platform_import", "statement_import", "receipt"] as const

// Next 16 async-searchParams convention (reports/print/page.tsx:71 precedent).
// Junk params fall back silently — a shared deep-link must always render.
export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ book_id?: string; account_id?: string; direction?: string; from?: string; to?: string; source?: string; q?: string }>
}) {
  const sp = await searchParams
  const books = await listBooks()
  const linked = sp.book_id ? books.find((b) => b.id === sp.book_id) : undefined
  const active = linked ?? books.find((b) => b.is_primary) ?? books[0]
  const accounts = active ? await listAccounts(active.id) : []
  const accountIdValid = sp.account_id === "none" || accounts.some((a) => a.id === sp.account_id)
  const initialFilters: BooksClientInitialFilters = {
    from: sp.from && DATE_RE.test(sp.from) ? sp.from : "",
    to: sp.to && DATE_RE.test(sp.to) ? sp.to : "",
    direction: sp.direction === "income" || sp.direction === "expense" ? sp.direction : "",
    accountId: sp.account_id && accountIdValid ? sp.account_id : "",
    source: (SOURCES as readonly string[]).includes(sp.source ?? "") ? (sp.source as (typeof SOURCES)[number]) : "",
    q: sp.q ?? "",
  }
  return (
    <BooksClient
      books={books}
      initialBookId={active?.id ?? ""}
      initialAccounts={accounts}
      initialFilters={initialFilters}
    />
  )
}
```

- [ ] Run `npx vitest run __tests__/components/admin/bookkeeping/BooksClient-hydration.test.tsx` — expect passing.
- [ ] Wire the insights links — in `components/admin/bookkeeping/InsightsClient.tsx` (note: `from`/`to` state vars are the window, type-safe where `data` narrowing isn't):
  - Replace the bare "Open ledger" link (:474-479) href with:

```tsx
                      <Link
                        href={`/admin/books?book_id=${active.book.id}&from=${from}&to=${to}`}
                        className="mt-2 inline-block text-xs text-muted-foreground hover:text-accent underline-offset-4 hover:underline"
                      >
                        Open ledger
                      </Link>
```

  - Gap rows: make the Account cell (:460) a link to the account-filtered ledger over the insights window:

```tsx
                              <td className="py-1.5 pr-4">
                                <Link
                                  href={`/admin/books?book_id=${active.book.id}&account_id=${gap.account_id}&from=${from}&to=${to}`}
                                  className="hover:text-accent underline-offset-4 hover:underline"
                                >
                                  {gap.account_name}
                                </Link>
                              </td>
```

  - Uncategorized rows: make the Date cell (:510) a link using the sentinel:

```tsx
                              <td className="py-1.5 pr-4">
                                <Link
                                  href={`/admin/books?book_id=${active.book.id}&account_id=none&direction=expense&from=${from}&to=${to}`}
                                  className="hover:text-accent underline-offset-4 hover:underline"
                                >
                                  {entry.occurred_on}
                                </Link>
                              </td>
```

- [ ] Run `npx vitest run __tests__/lib/db/bookkeeping-entries-filters.test.ts __tests__/api/admin/bookkeeping/entries.test.ts __tests__/components/admin/bookkeeping/BooksClient-hydration.test.tsx` — expect all passing.
- [ ] Commit. Write to `C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\commit-b5.txt`:

```
feat(bookkeeping): insights-to-ledger deep-links + account_id=none sentinel

BooksPage parses async searchParams into initialFilters (junk falls back
silently); BooksClient hydrates via useState initializers (handleBookChange
reset is user-event-only, verified); applyEntryFilters maps accountId "none"
to .is(account_id, null) with an Uncategorized select option; gap account
cells and uncategorized date cells link into the filtered ledger over the
insights window (design B-3).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

  Then `git add "app/(admin)/admin/books/page.tsx" components/admin/bookkeeping/BooksClient.tsx components/admin/bookkeeping/InsightsClient.tsx lib/db/bookkeeping.ts __tests__/lib/db/bookkeeping-entries-filters.test.ts __tests__/api/admin/bookkeeping/entries.test.ts __tests__/components/admin/bookkeeping/BooksClient-hydration.test.tsx` and `git commit -F "C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\commit-b5.txt"`

### Task B6: `allocateSharedCosts` (largest-remainder) + profit-card toggle

**Files:**
- Modify: `lib/bookkeeping/service-line-profit.ts` (append below `serviceLineProfit`, :78)
- Modify: `__tests__/lib/bookkeeping/service-line-profit.test.ts` (append a describe block; reuse the file's `account`/`entry` fixture builders at :13-31)
- Modify: `components/admin/bookkeeping/InsightsClient.tsx` (profit card :527-570; state block; imports :15)

**Interfaces:**
- Produces: `export interface AllocatedServiceLineRow extends ServiceLineProfitRow { allocated_shared_cents: number; net_after_allocated_cents: number }`; `export function allocateSharedCosts(profit: ServiceLineProfit): { rows: AllocatedServiceLineRow[]; allocated_total_cents: number }`.
- Consumes: `ServiceLineProfit` / `ServiceLineProfitRow` (`lib/bookkeeping/service-line-profit.ts:6-20`); `serviceLineProfit` output invariant Σ`row.income_cents` = `income_total_cents` (guarantees the largest-remainder leftover ≤ positive-income row count).

- [ ] Write the failing tests — append to `__tests__/lib/bookkeeping/service-line-profit.test.ts` (zero-mock, mutation-discriminating per house style — the `12.555` convention):

```ts
import { allocateSharedCosts } from "@/lib/bookkeeping/service-line-profit"
// (merge into the existing import line from "@/lib/bookkeeping/service-line-profit")

describe("allocateSharedCosts", () => {
  const row = (over: Partial<import("@/lib/bookkeeping/service-line-profit").ServiceLineProfitRow>) => ({
    service_line: "performance_training", label: "Performance Training",
    income_cents: 0, direct_cost_cents: 0, net_estimate_cents: 0, ...over,
  })
  const profit = (rows: ReturnType<typeof row>[], shared: number) => ({
    rows,
    income_total_cents: rows.reduce((s, r) => s + r.income_cents, 0),
    direct_cost_total_cents: rows.reduce((s, r) => s + r.direct_cost_cents, 0),
    shared_cost_cents: shared,
    uncategorized_expense_cents: 0,
  })

  it("100 cents over three equal lines allocates 34/33/33 — largest-remainder, not per-row rounding", () => {
    // Discriminator: naive Math.round per row gives 33/33/33 (sum 99, loses a
    // cent); round-half-up-all gives 34/34/34 (sum 102, invents cents).
    const r = allocateSharedCosts(profit([
      row({ service_line: "a", label: "A", income_cents: 1000, net_estimate_cents: 1000 }),
      row({ service_line: "b", label: "B", income_cents: 1000, net_estimate_cents: 1000 }),
      row({ service_line: "c", label: "C", income_cents: 1000, net_estimate_cents: 1000 }),
    ], 100))
    expect(r.rows.map((x) => x.allocated_shared_cents)).toEqual([34, 33, 33]) // frac tie → row order
    expect(r.allocated_total_cents).toBe(100)
  })

  it("remainder cents go to the LARGEST fractional remainder, not the first row", () => {
    // shares of 10¢ over incomes 1000/2000: raw 3.333 / 6.667 → floors 3/6,
    // leftover 1 goes to the .667 row. First-row mutation would give 4/6.
    const r = allocateSharedCosts(profit([
      row({ service_line: "a", label: "A", income_cents: 1000, net_estimate_cents: 1000 }),
      row({ service_line: "b", label: "B", income_cents: 2000, net_estimate_cents: 2000 }),
    ], 10))
    expect(r.rows.map((x) => x.allocated_shared_cents)).toEqual([3, 7])
  })

  it("allocated cents always sum EXACTLY to shared_cost_cents (odd split, 12.555-style)", () => {
    const r = allocateSharedCosts(profit([
      row({ service_line: "a", label: "A", income_cents: 12555, net_estimate_cents: 12555 }),
      row({ service_line: "b", label: "B", income_cents: 33333, net_estimate_cents: 33333 }),
      row({ service_line: "c", label: "C", income_cents: 707, net_estimate_cents: 707 }),
    ], 9999))
    expect(r.rows.reduce((s, x) => s + x.allocated_shared_cents, 0)).toBe(9999)
    expect(r.allocated_total_cents).toBe(9999)
  })

  it("zero-income lines get 0 and net_after_allocated subtracts the share", () => {
    const r = allocateSharedCosts(profit([
      row({ service_line: "a", label: "A", income_cents: 5000, direct_cost_cents: 1000, net_estimate_cents: 4000 }),
      row({ service_line: "b", label: "B", income_cents: 0, direct_cost_cents: 400, net_estimate_cents: -400 }),
    ], 500))
    expect(r.rows[0].allocated_shared_cents).toBe(500)
    expect(r.rows[0].net_after_allocated_cents).toBe(3500)
    expect(r.rows[1].allocated_shared_cents).toBe(0)
    expect(r.rows[1].net_after_allocated_cents).toBe(-400)
  })

  it("income_total 0 → no allocation at all (everything stays shared)", () => {
    const r = allocateSharedCosts(profit([
      row({ service_line: "a", label: "A", income_cents: 0, direct_cost_cents: 300, net_estimate_cents: -300 }),
    ], 700))
    expect(r.rows[0].allocated_shared_cents).toBe(0)
    expect(r.allocated_total_cents).toBe(0)
  })
})
```

- [ ] Run `npx vitest run __tests__/lib/bookkeeping/service-line-profit.test.ts` — expect the new block to fail (`allocateSharedCosts` not exported); existing tests stay green.
- [ ] Implement — append to `lib/bookkeeping/service-line-profit.ts`:

```ts
export interface AllocatedServiceLineRow extends ServiceLineProfitRow {
  allocated_shared_cents: number
  net_after_allocated_cents: number
}

/** Largest-remainder allocation of shared_cost_cents by income share (5b, B-4).
 *  Floors every raw share, then hands out the leftover cents by fractional
 *  remainder desc (tie → row order) so allocated cents sum EXACTLY to
 *  shared_cost_cents — naive per-row rounding loses or invents cents.
 *  Zero-income lines get 0; income_total 0 → no allocation. This file's first
 *  division: labeled an ESTIMATE in the UI, never a ledger write. */
export function allocateSharedCosts(profit: ServiceLineProfit): { rows: AllocatedServiceLineRow[]; allocated_total_cents: number } {
  const shared = profit.shared_cost_cents
  const total = profit.income_total_cents
  if (shared <= 0 || total <= 0) {
    return {
      rows: profit.rows.map((r) => ({ ...r, allocated_shared_cents: 0, net_after_allocated_cents: r.net_estimate_cents })),
      allocated_total_cents: 0,
    }
  }
  const raw = profit.rows.map((r) => (r.income_cents > 0 ? (shared * r.income_cents) / total : 0))
  const alloc = raw.map(Math.floor)
  let leftover = shared - alloc.reduce((s, v) => s + v, 0)
  const byRemainder = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .filter((x) => profit.rows[x.i].income_cents > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of byRemainder) {
    if (leftover <= 0) break
    alloc[i] += 1
    leftover -= 1
  }
  return {
    rows: profit.rows.map((r, i) => ({
      ...r,
      allocated_shared_cents: alloc[i],
      net_after_allocated_cents: r.net_estimate_cents - alloc[i],
    })),
    allocated_total_cents: alloc.reduce((s, v) => s + v, 0),
  }
}
```

- [ ] Run `npx vitest run __tests__/lib/bookkeeping/service-line-profit.test.ts` — expect all passing (old + 5 new).
- [ ] Add the UI toggle — in `components/admin/bookkeeping/InsightsClient.tsx`: extend the import at :15 to `import { allocateSharedCosts, type ServiceLineProfit } from "@/lib/bookkeeping/service-line-profit"`; add state `const [allocateShared, setAllocateShared] = useState(false)` next to the dismissal state; in the derived block add `const allocation = allocateShared && active ? allocateSharedCosts(active.profit) : null`; then rewrite the profit-card table (:538-559) to render two extra columns when allocation is on, and add the toggle + empty state after the shared/uncategorized lines (:561-564):

```tsx
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                          <th className="py-1 pr-4 font-medium">Service line</th>
                          <th className="py-1 pr-4 font-medium">Income</th>
                          <th className="py-1 pr-4 font-medium">Direct costs</th>
                          <th className="py-1 pr-4 font-medium">Net</th>
                          {allocation ? (
                            <>
                              <th className="py-1 pr-4 font-medium">Allocated share</th>
                              <th className="py-1 pr-4 font-medium">Net after share</th>
                            </>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {(allocation ? allocation.rows : active.profit.rows).map((r) => (
                          <tr key={r.service_line ?? "uncategorized"} className="border-b last:border-0">
                            <td className="py-1.5 pr-4">{r.label}</td>
                            <td className="py-1.5 pr-4 text-success">{formatCents(r.income_cents, active.book.currency)}</td>
                            <td className="py-1.5 pr-4 text-error">{formatCents(r.direct_cost_cents, active.book.currency)}</td>
                            <td className={`py-1.5 pr-4 ${r.net_estimate_cents >= 0 ? "text-success" : "text-error"}`}>
                              {formatCents(r.net_estimate_cents, active.book.currency)}
                            </td>
                            {allocation && "allocated_shared_cents" in r ? (
                              <>
                                <td className="py-1.5 pr-4 text-error">{formatCents(r.allocated_shared_cents, active.book.currency)}</td>
                                <td className={`py-1.5 pr-4 ${r.net_after_allocated_cents >= 0 ? "text-success" : "text-error"}`}>
                                  {formatCents(r.net_after_allocated_cents, active.book.currency)}
                                </td>
                              </>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
```

  and after the shared/uncategorized `<div>` (:561-564):

```tsx
                  <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={allocateShared}
                      disabled={active.profit.shared_cost_cents === 0}
                      onChange={(e) => setAllocateShared(e.currentTarget.checked)}
                    />
                    Allocate shared costs by revenue share — estimate
                  </label>
                  {active.profit.shared_cost_cents === 0 ? (
                    <p className="text-xs text-muted-foreground mt-1">No shared costs to allocate yet.</p>
                  ) : null}
```

- [ ] Run `npx vitest run __tests__/lib/bookkeeping/service-line-profit.test.ts` once more — expect green (UI consumed the tested fn only).
- [ ] Commit. Write to `C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\commit-b6.txt`:

```
feat(bookkeeping): largest-remainder shared-cost allocation + profit toggle

allocateSharedCosts distributes shared_cost_cents by income share with
exact cents-sum (floor + fractional-remainder desc, tie row order);
zero-income lines 0; zero income_total no-op. Labeled estimate toggle on
the profit card with "No shared costs to allocate yet" empty state
(design B-4).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

  Then `git add lib/bookkeeping/service-line-profit.ts __tests__/lib/bookkeeping/service-line-profit.test.ts components/admin/bookkeeping/InsightsClient.tsx` and `git commit -F "C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\commit-b6.txt"`

### Task B7: AI narrative tail — `lib/with-timeout.ts`, narrative route, "Explain these findings"

**Files:**
- Create: `lib/with-timeout.ts`
- Create: `__tests__/lib/with-timeout.test.ts`
- Create: `app/api/admin/bookkeeping/insights/narrative/route.ts`
- Create: `__tests__/api/admin/bookkeeping/insights-narrative.test.ts`
- Modify: `components/admin/bookkeeping/InsightsClient.tsx` (narrative card after the year-end strip; state + action near `fetchInsights`)

**Interfaces:**
- Produces: `export async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T>` (verbatim promotion of `app/api/inquiry/route.ts:15-25` — the inquiry route keeps its private copy, out of scope); `POST /api/admin/bookkeeping/insights/narrative` returning `{ observations: string[] | null; fallback: string | null }`, always 200 on AI failure.
- Consumes: `callAgent` (`lib/ai/anthropic.ts:57` — forced `structuredOutputMode: "jsonTool"` at :88 means Zod `.min()/.max()` are safe THROUGH it, pinned by `__tests__/lib/ai/anthropic-schema.test.ts:33-61`), `MODEL_SONNET` (`lib/ai/anthropic.ts:12`); `createGenerationLog`/`updateGenerationLog` (`lib/db/ai-generation-log.ts:8-20`; row shape `types/database.ts:755-775` — the inquiry-route pending→completed/failed precedent at `app/api/inquiry/route.ts:120-199`); `loadInsightsBundle` (`lib/bookkeeping/insight-data.ts:14`); `reportQuerySchema` (`lib/validators/bookkeeping.ts:128-130`); `listDismissedFingerprints` (B3); `findingFingerprint` (B2); pure finders `deductionFindings`/`serviceLineProfit`/`vendorSweep`.

- [ ] Write the failing helper test `__tests__/lib/with-timeout.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest"
import { withTimeout } from "@/lib/with-timeout"

afterEach(() => {
  vi.useRealTimers()
})

describe("withTimeout", () => {
  it("resolves with the promise value when it beats the timeout", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 5000, "too slow")).resolves.toBe("ok")
  })

  it("rejects with the timeout message when the promise never settles", async () => {
    vi.useFakeTimers()
    const p = withTimeout(new Promise<never>(() => {}), 5000, "too slow")
    const assertion = expect(p).rejects.toThrow("too slow")
    await vi.advanceTimersByTimeAsync(5001)
    await assertion
  })

  it("clears its timer once the promise settles — no dangling timeout", async () => {
    vi.useFakeTimers()
    await expect(withTimeout(Promise.resolve("ok"), 60_000, "too slow")).resolves.toBe("ok")
    expect(vi.getTimerCount()).toBe(0) // finally { clearTimeout } — a leaked timer would leave 1
  })

  it("propagates the promise's own rejection, not the timeout message", async () => {
    await expect(withTimeout(Promise.reject(new Error("real failure")), 5000, "too slow")).rejects.toThrow("real failure")
  })
})
```

- [ ] Run `npx vitest run __tests__/lib/with-timeout.test.ts` — expect failure: cannot resolve `@/lib/with-timeout`.
- [ ] Create `lib/with-timeout.ts` (verbatim promotion — body byte-identical to `app/api/inquiry/route.ts:15-25` plus `export`):

```ts
/** Bounded-promise race, promoted VERBATIM from app/api/inquiry/route.ts:15-25
 *  (5b narrative tail). The inquiry route keeps its private copy — touching it
 *  is out of scope for Track B. clearTimeout in finally: no dangling timers. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}
```

- [ ] Run `npx vitest run __tests__/lib/with-timeout.test.ts` — expect 4 passing.
- [ ] Write the failing route test `__tests__/api/admin/bookkeeping/insights-narrative.test.ts` — mock style mirrored from `__tests__/api/admin/bookkeeping/entries.test.ts` (module `vi.fn()`s + `vi.mock`); the AI seam mock mirrors `__tests__/lib/ai/lead-analysis.test.ts` (mock `@/lib/ai/anthropic` with `callAgent` + model constant, then inspect `mock.calls` args); pure finders run REAL so the dismissed-filter test discriminates on actual finder output:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const authMock = vi.fn()
const loadInsightsBundleMock = vi.fn()
const listDismissedFingerprintsMock = vi.fn()
const createGenerationLogMock = vi.fn()
const updateGenerationLogMock = vi.fn()
const callAgentMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/bookkeeping/insight-data", () => ({
  loadInsightsBundle: (...a: unknown[]) => loadInsightsBundleMock(...a),
}))
vi.mock("@/lib/db/bookkeeping", () => ({
  listDismissedFingerprints: (...a: unknown[]) => listDismissedFingerprintsMock(...a),
}))
vi.mock("@/lib/db/ai-generation-log", () => ({
  createGenerationLog: (...a: unknown[]) => createGenerationLogMock(...a),
  updateGenerationLog: (...a: unknown[]) => updateGenerationLogMock(...a),
}))
vi.mock("@/lib/ai/anthropic", () => ({
  callAgent: (...a: unknown[]) => callAgentMock(...a),
  MODEL_SONNET: "sonnet",
}))

import { POST } from "@/app/api/admin/bookkeeping/insights/narrative/route"

const BOOK_ID = "b0000000-0000-4000-8000-000000000001"
const ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001"
const GAP_ENTRY_ID = "e0000000-0000-4000-8000-000000000001"

const BOOK = {
  id: BOOK_ID, name: "Darren — DJP Athlete", book_kind: "business", owner_label: "Darren",
  is_primary: true, currency: "usd", sort_order: 0, archived_at: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
}
// Purpose-required account + blank-purpose entry ⇒ ONE real substantiation gap
// out of the REAL deductionFindings run (finders are not mocked).
const ACCOUNT = {
  id: ACCOUNT_ID, book_id: BOOK_ID, name: "Meals (business purpose)", account_type: "expense",
  service_line: null, tax_category: null, sort_order: 0,
  is_deductible_candidate: true, requires_business_purpose: true, archived_at: null,
}
const GAP_ENTRY = {
  id: GAP_ENTRY_ID, book_id: BOOK_ID, account_id: ACCOUNT_ID, direction: "expense",
  amount_cents: 4200, occurred_on: "2026-03-01", counterparty: "Chipotle", memo: null,
  source: "manual", business_purpose: null, document_id: "d0000000-0000-4000-8000-000000000001",
}

function req(body: unknown): Request {
  return new Request("http://x/api/admin/bookkeeping/insights/narrative", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  authMock.mockReset(); loadInsightsBundleMock.mockReset(); listDismissedFingerprintsMock.mockReset()
  createGenerationLogMock.mockReset(); updateGenerationLogMock.mockReset(); callAgentMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  loadInsightsBundleMock.mockResolvedValue({ books: [BOOK], accounts: [ACCOUNT], entries: [GAP_ENTRY] })
  listDismissedFingerprintsMock.mockResolvedValue([])
  createGenerationLogMock.mockResolvedValue({ id: "log-1" })
  updateGenerationLogMock.mockResolvedValue({ id: "log-1" })
  callAgentMock.mockResolvedValue({
    content: { observations: ["One.", "Two.", "Three."] },
    tokens_used: 500, cache_creation_tokens: null, cache_read_tokens: null,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("POST /api/admin/bookkeeping/insights/narrative", () => {
  it("403s a non-admin before any read or spend", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    expect(res.status).toBe(403)
    expect(loadInsightsBundleMock).not.toHaveBeenCalled()
    expect(callAgentMock).not.toHaveBeenCalled()
  })

  it("returns observations and finalizes the generation log as completed", async () => {
    const res = await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.observations).toEqual(["One.", "Two.", "Three."])
    expect(json.fallback).toBeNull()
    expect(createGenerationLogMock).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", model_used: "sonnet" }))
    expect(updateGenerationLogMock).toHaveBeenCalledWith("log-1", expect.objectContaining({ status: "completed", tokens_used: 500 }))
    const options = callAgentMock.mock.calls[0][3]
    expect(options).toMatchObject({ model: "sonnet", maxTokens: 1200 })
  })

  it("a dismissed finding is filtered BEFORE compaction — the AI never sees it", async () => {
    listDismissedFingerprintsMock.mockResolvedValue([`substantiation_gap:${GAP_ENTRY_ID}`])
    await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    const userMessage = JSON.parse(callAgentMock.mock.calls[0][1] as string)
    expect(userMessage.books[0].substantiation_gap_count).toBe(0)
    expect(userMessage.books[0].substantiation_gap_cents).toBe(0)
  })

  it("an undismissed run keeps the gap in the compacted summary (discriminator pair)", async () => {
    await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    const userMessage = JSON.parse(callAgentMock.mock.calls[0][1] as string)
    expect(userMessage.books[0].substantiation_gap_count).toBe(1)
    expect(userMessage.books[0].substantiation_gap_cents).toBe(4200)
  })

  it("AI timeout falls back honestly: 200, observations null, log failed", async () => {
    vi.useFakeTimers()
    callAgentMock.mockReturnValue(new Promise(() => {})) // never settles → withTimeout(20s) fires
    const pending = POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    await vi.advanceTimersByTimeAsync(20_001)
    const res = await pending
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.observations).toBeNull()
    expect(json.fallback).toBe("AI summary unavailable — the live numbers above are unaffected.")
    expect(updateGenerationLogMock).toHaveBeenCalledWith("log-1", expect.objectContaining({ status: "failed" }))
  })

  it("400s an invalid window without spending", async () => {
    const res = await POST(req({ from: "2026-06-30", to: "2026-01-01" }) as never)
    expect(res.status).toBe(400)
    expect(callAgentMock).not.toHaveBeenCalled()
  })
})
```

- [ ] Run `npx vitest run __tests__/api/admin/bookkeeping/insights-narrative.test.ts` — expect failure: cannot resolve the route module.
- [ ] Create `app/api/admin/bookkeeping/insights/narrative/route.ts`:

```ts
// AI narrative tail (5b, decision B-5): explicit-button Sonnet spend over the
// RECOMPUTED findings — the server never trusts client-posted numbers.
// Dismissed findings are filtered BEFORE compaction: dismissals gate display,
// and the narrative IS display. AI failure/timeout never 500s — honest
// fallback with observations:null; the live numbers on the page are computed
// separately and unaffected. Unaudited like the insights GET (D10 read
// surface); ai_generation_log is the spend record (inquiry-route precedent).
import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { MODEL_SONNET, callAgent } from "@/lib/ai/anthropic"
import { deductionFindings } from "@/lib/bookkeeping/deduction-finder"
import { findingFingerprint } from "@/lib/bookkeeping/finding-fingerprint"
import { loadInsightsBundle } from "@/lib/bookkeeping/insight-data"
import { serviceLineProfit } from "@/lib/bookkeeping/service-line-profit"
import { vendorSweep } from "@/lib/bookkeeping/vendor-sweep"
import { createGenerationLog, updateGenerationLog } from "@/lib/db/ai-generation-log"
import { listDismissedFingerprints } from "@/lib/db/bookkeeping"
import { reportQuerySchema } from "@/lib/validators/bookkeeping"
import { withTimeout } from "@/lib/with-timeout"

export const maxDuration = 45

const FALLBACK = "AI summary unavailable — the live numbers above are unaffected."

const narrativeSchema = z.object({ observations: z.array(z.string()).min(3).max(5) })

const SYSTEM_PROMPT = [
  "You are a plain-English bookkeeping explainer for a solo athletic-performance coach.",
  "You receive a compact JSON summary of ledger findings for one or more books; all amounts are integer cents.",
  "Write 3-5 short observations in plain words. Cite the real numbers, converted to dollars.",
  "Never give tax or legal advice — every finding is a candidate the accountant confirms.",
  "Do not invent trends the data does not show; if the ledger is nearly empty, say so plainly.",
  "Your output is labeled AI-generated in the UI.",
].join(" ")

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const body = await request.json().catch(() => null)
    const parsed = reportQuerySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    }
    const { from, to } = parsed.data

    const bundle = await loadInsightsBundle(from, to)
    const summaries = await Promise.all(
      bundle.books.map(async (book) => {
        const dismissed = new Set(await listDismissedFingerprints(book.id))
        const bookEntries = bundle.entries.filter((e) => e.book_id === book.id)
        const deductions = deductionFindings(book.id, bundle.entries, bundle.accounts)
        const profit = serviceLineProfit(bookEntries, bundle.accounts)
        const vendors = vendorSweep(bookEntries, bundle.accounts)
        const watchlist = deductions.watchlist.filter(
          (w) => !dismissed.has(findingFingerprint("watchlist", w.account_id)),
        )
        const gaps = deductions.substantiation_gaps.filter(
          (g) => !dismissed.has(findingFingerprint("substantiation_gap", g.entry_id)),
        )
        const uncategorized = deductions.uncategorized.entries.filter(
          (u) => !dismissed.has(findingFingerprint("uncategorized", u.entry_id)),
        )
        const recurring = vendors.recurring.filter(
          (v) => !dismissed.has(findingFingerprint("vendor", v.key)),
        )
        return {
          book: book.name,
          kind: book.book_kind,
          watchlist: watchlist.map((w) => ({ name: w.name, total_cents: w.total_cents, entries: w.entry_count })),
          substantiation_gap_count: gaps.length,
          substantiation_gap_cents: gaps.reduce((s, g) => s + g.amount_cents, 0),
          uncategorized_count: uncategorized.length,
          uncategorized_cents: uncategorized.reduce((s, u) => s + u.amount_cents, 0),
          profit: {
            income_total_cents: profit.income_total_cents,
            shared_cost_cents: profit.shared_cost_cents,
            rows: profit.rows.map((r) => ({ label: r.label, income_cents: r.income_cents, net_estimate_cents: r.net_estimate_cents })),
          },
          recurring_vendors: recurring.slice(0, 10).map((v) => ({ name: v.display_name, cadence: v.cadence, annualized_cents: v.annualized_cents })),
        }
      }),
    )

    const startTime = Date.now()
    let logId: string | null = null
    try {
      const log = await createGenerationLog({
        program_id: null,
        client_id: null,
        requested_by: session.user.id,
        status: "pending",
        input_params: { feature: "bookkeeping_insights_narrative", from, to },
        output_summary: null,
        error_message: null,
        model_used: MODEL_SONNET,
        tokens_used: null,
        cache_creation_tokens: null,
        cache_read_tokens: null,
        duration_ms: null,
        completed_at: null,
        current_step: 0,
        total_steps: 1,
        generation_trigger: "bookkeeping_insights_narrative",
      })
      logId = log.id

      const { content, tokens_used, cache_creation_tokens, cache_read_tokens } = await withTimeout(
        callAgent(SYSTEM_PROMPT, JSON.stringify({ from, to, books: summaries }), narrativeSchema, {
          model: MODEL_SONNET,
          maxTokens: 1200,
        }),
        20_000,
        "Insights narrative generation timed out",
      )

      await updateGenerationLog(logId, {
        status: "completed",
        output_summary: { observation_count: content.observations.length },
        tokens_used,
        cache_creation_tokens: cache_creation_tokens ?? null,
        cache_read_tokens: cache_read_tokens ?? null,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
      })

      return NextResponse.json({ observations: content.observations, fallback: null })
    } catch (err) {
      console.error("bookkeeping insights narrative — continuing without AI:", err)
      if (logId) {
        await updateGenerationLog(logId, {
          status: "failed",
          error_message: err instanceof Error ? err.message : "Unknown error",
          duration_ms: Date.now() - startTime,
          completed_at: new Date().toISOString(),
        }).catch(() => {})
      }
      return NextResponse.json({ observations: null, fallback: FALLBACK })
    }
  } catch (error) {
    console.error("bookkeeping insights narrative:", error)
    return NextResponse.json({ error: "Failed to build the narrative" }, { status: 500 })
  }
}
```

- [ ] Run `npx vitest run __tests__/api/admin/bookkeeping/insights-narrative.test.ts` — expect 6 passing.
- [ ] Add the UI — in `components/admin/bookkeeping/InsightsClient.tsx`, add state + action after the dismissal block (decision B-5: explicit button, per-`(from,to)` session cache, no flag, no persistence — a reload + re-click is an accepted fresh spend):

```ts
  // AI narrative (B-5): owner-initiated spend, cached in client state per
  // (from, to) window. No persistence — one-user, button-gated tool.
  const [narratives, setNarratives] = useState<Record<string, string[]>>({})
  const [narrativeLoading, setNarrativeLoading] = useState(false)
  const narrative = narratives[`${from}|${to}`]

  const explainFindings = useCallback(async () => {
    setNarrativeLoading(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/insights/narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      })
      if (!res.ok) throw new Error("failed")
      const body = (await res.json()) as { observations: string[] | null; fallback: string | null }
      if (body.observations) {
        setNarratives((n) => ({ ...n, [`${from}|${to}`]: body.observations! }))
      } else {
        toast.error(body.fallback ?? "AI summary unavailable")
      }
    } catch {
      toast.error("AI summary unavailable — the live numbers above are unaffected.")
    } finally {
      setNarrativeLoading(false)
    }
  }, [from, to])
```

  and render the card directly after the year-end flags strip (before the `totalEntries === 0` branch at :359):

```tsx
      {/* Plain-English AI summary (B-5): nothing generates until the button is clicked. */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-heading text-primary">Plain-English summary</h2>
          <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
            AI-generated
          </span>
        </div>
        {narrative ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {narrative.map((obs, i) => (
              <li key={i}>{obs}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            One AI pass over the findings below — nothing is generated until you ask.
          </p>
        )}
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => void explainFindings()}
          disabled={narrativeLoading || loading}
        >
          {narrativeLoading ? "Explaining…" : narrative ? "Regenerate" : "Explain these findings"}
        </Button>
      </div>
```

- [ ] Run the full task-adjacent set: `npx vitest run __tests__/lib/with-timeout.test.ts __tests__/api/admin/bookkeeping/insights-narrative.test.ts __tests__/lib/ai/anthropic-schema.test.ts` — expect all passing (the last pins the `jsonTool` invariant this route's `.min(3).max(5)` schema depends on).
- [ ] Commit. Write to `C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\commit-b7.txt`:

```
feat(bookkeeping): AI narrative tail — withTimeout lib + narrative route + UI

lib/with-timeout.ts promoted verbatim from the inquiry route (which keeps
its copy); POST /insights/narrative recomputes the bundle server-side,
filters dismissed findings BEFORE compaction, callAgent MODEL_SONNET
maxTokens 1200 under withTimeout(20s) with ai_generation_log
pending->completed/failed and an honest 200 fallback (observations null).
Explain-these-findings button with per-(from,to) session cache and an
AI-generated label (decision B-5; unaudited read surface per D10).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

  Then `git add lib/with-timeout.ts __tests__/lib/with-timeout.test.ts app/api/admin/bookkeeping/insights/narrative/route.ts __tests__/api/admin/bookkeeping/insights-narrative.test.ts components/admin/bookkeeping/InsightsClient.tsx` and `git commit -F "C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\commit-b7.txt"`