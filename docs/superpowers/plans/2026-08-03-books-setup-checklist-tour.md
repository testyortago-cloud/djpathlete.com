# Accounting Setup Checklist + Cross-Page Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An auto-detected accounting setup checklist (banner + panel on /admin/books) and a cross-page spotlight tour over all six books pages.

**Architecture:** A pure `computeSetupItems` aggregator fed by DAL reads through one admin API route (GET status / PATCH manual-check + tour stamp); a `sessionStorage`-persisted page-tour engine modeled on the existing `FormTour` spotlight, mounted in all six books client components, targeting `data-tour` attributes.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 semantic classes, framer-motion, Zod, Vitest + Testing Library. Spec: `docs/superpowers/specs/2026-08-03-books-setup-checklist-tour-design.md`.

## Global Constraints

- `/api/*` is NOT in the middleware matcher — every route self-gates: `const session = await auth(); if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })`.
- Semantic color classes only (`text-primary`, `bg-warning/10`, `text-muted-foreground`); never hex, never inline fontFamily.
- No new dependencies. No new feature flags (this is UI, not money/mass-email risk). No migration (state lives in existing `system_settings`).
- Tests use `fireEvent` from `@testing-library/react` — the repo has NO `@testing-library/user-event`.
- Green vitest ≠ green tsc: after implementing, `npx tsc --noEmit` output must be grepped for every file you touched (pre-existing NextRequest errors in unrelated tests are baseline noise).
- Commit after each task directly to `main` (solo repo). NEVER `git push` — the owner is asleep; push happens on their go-ahead.
- Settings keys (verified in code, do not invent others): `cron_bookkeeping_gmail_receipts_enabled`, `cron_bookkeeping_income_sync_enabled`, `cron_bookkeeping_payout_sync_enabled`, `cron_bookkeeping_retention_enabled`, `cron_bookkeeping_receipt_watchdog_enabled`, `cron_bookkeeping_quarterly_pack_enabled`, `bookkeeping_tax_rate_percent`, `bookkeeping_accountant_email`, `bookkeeping_gmail_receipt_forwarders`, new keys `bookkeeping_setup_manual_checks` and `bookkeeping_tour_completed_at`.

---

### Task 1: Setup-status aggregator (pure) + DAL helpers

**Files:**
- Create: `lib/bookkeeping/setup-status.ts`
- Modify: `lib/db/cron-runs.ts` (add `latestCronRun`)
- Modify: `lib/db/bookkeeping.ts` (add `hasStatementImportEntries`)
- Test: `__tests__/lib/bookkeeping/setup-status.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `computeSetupItems(sources: SetupStatusSources): SetupItem[]`, types `SetupItem { key, title, why, status: "done"|"todo"|"attention", detail?, href, manual? }` and `SetupStatusSources` (below); `latestCronRun(supabase: SupabaseClient, cronName: string): Promise<CronRun | null>`; `hasStatementImportEntries(): Promise<boolean>`.

- [ ] **Step 1: Write the failing test** — `__tests__/lib/bookkeeping/setup-status.test.ts`. Fixtures must be mutation-discriminating: a fully-configured baseline where EVERY item is `done`, then one test per item flipping exactly one source and asserting exactly that item's key flips (and only it).

```ts
import { describe, it, expect } from "vitest"
import { computeSetupItems, type SetupStatusSources } from "@/lib/bookkeeping/setup-status"

function allDone(over: Partial<SetupStatusSources> = {}): SetupStatusSources {
  return {
    gmailConnected: true,
    latestGmailCronDetail: { fetch_status: "ok", listed: 3 }, // no label_missing key = label exists
    forwarders: ["daz_paul@hotmail.com"],
    flags: { gmailReceipts: true, incomeSync: true, payoutSync: true, retention: true, receiptWatchdog: true, quarterlyPack: true },
    taxRatePercent: 22.5,
    accountantEmail: "cpa@example.com",
    statementEntryExists: true,
    manualChecks: ["categories_reviewed"],
    ...over,
  }
}
const byKey = (s: SetupStatusSources) => Object.fromEntries(computeSetupItems(s).map((i) => [i.key, i]))

describe("computeSetupItems", () => {
  it("fully configured system → every item done", () => {
    expect(computeSetupItems(allDone()).every((i) => i.status === "done")).toBe(true)
  })
  it("returns 11 items in stable order with unique keys", () => {
    const items = computeSetupItems(allDone())
    expect(items).toHaveLength(11)
    expect(new Set(items.map((i) => i.key)).size).toBe(11)
  })
  it("no gmail connection → only gmail_connected flips", () => {
    const items = byKey(allDone({ gmailConnected: false }))
    expect(items.gmail_connected.status).toBe("todo")
    expect(Object.values(items).filter((i) => i.status !== "done")).toHaveLength(1)
  })
  it("label_missing on the latest cron run → gmail_label todo with detail", () => {
    const items = byKey(allDone({ latestGmailCronDetail: { fetch_status: "ok", label_missing: true } }))
    expect(items.gmail_label.status).toBe("todo")
    expect(items.gmail_label.detail).toMatch(/label/i)
  })
  it("cron never ran → gmail_label is attention (cannot verify), not done", () => {
    expect(byKey(allDone({ latestGmailCronDetail: null })).gmail_label.status).toBe("attention")
  })
  it("empty/garbage forwarders → forwarders todo", () => {
    expect(byKey(allDone({ forwarders: [] })).forwarders.status).toBe("todo")
    expect(byKey(allDone({ forwarders: "junk" })).forwarders.status).toBe("todo")
  })
  it("income sync done requires BOTH income and payout flags; detail names the off one", () => {
    const items = byKey(allDone({ flags: { ...allDone().flags, payoutSync: false } }))
    expect(items.income_sync.status).toBe("todo")
    expect(items.income_sync.detail).toMatch(/payout/i)
  })
  it("null tax rate → tax_rate todo", () => {
    expect(byKey(allDone({ taxRatePercent: null })).tax_rate.status).toBe("todo")
  })
  it("blank accountant email → accountant_email todo AND quarterly pack stays independent", () => {
    const items = byKey(allDone({ accountantEmail: "" }))
    expect(items.accountant_email.status).toBe("todo")
    expect(items.quarterly_pack.status).toBe("done")
  })
  it("housekeeping requires retention AND watchdog", () => {
    expect(byKey(allDone({ flags: { ...allDone().flags, retention: false } })).housekeeping.status).toBe("todo")
  })
  it("no statement entries → first_statement todo", () => {
    expect(byKey(allDone({ statementEntryExists: false })).first_statement.status).toBe("todo")
  })
  it("manual categories_reviewed comes from the stored array and is marked manual", () => {
    const items = byKey(allDone({ manualChecks: [] }))
    expect(items.categories_reviewed.status).toBe("todo")
    expect(items.categories_reviewed.manual).toBe(true)
    expect(byKey(allDone({ manualChecks: "garbage" })).categories_reviewed.status).toBe("todo")
  })
})
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run "__tests__/lib/bookkeeping/setup-status.test.ts"` → FAIL (module not found).

- [ ] **Step 3: Implement `lib/bookkeeping/setup-status.ts`** (pure part):

```ts
// Auto-detected accounting setup checklist (spec: 2026-08-03-books-setup-checklist-tour-design.md).
// Pure compute over already-fetched state — zero IO here; the API route gathers sources.
// "attention" = cannot verify (e.g. the gmail cron has never run), rendered amber.

export interface SetupItem {
  key: string
  title: string
  why: string
  status: "done" | "todo" | "attention"
  detail?: string
  href: string
  manual?: boolean
}

export interface SetupStatusSources {
  gmailConnected: boolean
  /** detail of the latest bookkeepingGmailReceiptsCron run; null = never ran. */
  latestGmailCronDetail: Record<string, unknown> | null
  forwarders: unknown
  flags: {
    gmailReceipts: boolean
    incomeSync: boolean
    payoutSync: boolean
    retention: boolean
    receiptWatchdog: boolean
    quarterlyPack: boolean
  }
  taxRatePercent: number | null
  accountantEmail: string
  statementEntryExists: boolean
  manualChecks: unknown
}

export const MANUAL_CHECK_KEYS = ["categories_reviewed"] as const

function has(list: unknown, key: string): boolean {
  return Array.isArray(list) && list.includes(key)
}

export function computeSetupItems(s: SetupStatusSources): SetupItem[] {
  const forwarderCount = Array.isArray(s.forwarders)
    ? s.forwarders.filter((f) => typeof f === "string" && f.trim()).length
    : 0
  const labelStatus: SetupItem["status"] =
    s.latestGmailCronDetail === null
      ? "attention"
      : s.latestGmailCronDetail.label_missing
        ? "todo"
        : "done"
  const offSyncs = [
    ...(s.flags.incomeSync ? [] : ["income sync"]),
    ...(s.flags.payoutSync ? [] : ["payout sync"]),
  ]
  const offHousekeeping = [
    ...(s.flags.retention ? [] : ["retention"]),
    ...(s.flags.receiptWatchdog ? [] : ["receipt watchdog"]),
  ]
  return [
    {
      key: "gmail_connected",
      title: "Connect Gmail",
      why: "Powers the inbox and automatic email-receipt ingestion.",
      status: s.gmailConnected ? "done" : "todo",
      href: "/admin/inbox",
    },
    {
      key: "gmail_label",
      title: "Create the receipt label in Gmail",
      why: "The poller backfills anything you label — the opt-in path for old receipts.",
      status: labelStatus,
      detail:
        labelStatus === "attention"
          ? "The email-receipts cron hasn't run yet, so the label can't be verified."
          : labelStatus === "todo"
            ? "The last cron run reported the label missing in the connected mailbox."
            : undefined,
      href: "/admin/books/email-receipts",
    },
    {
      key: "forwarders",
      title: "Add receipt forwarder addresses",
      why: "Mail from (or to) these addresses is ingested automatically — no labeling needed.",
      status: forwarderCount > 0 ? "done" : "todo",
      href: "/admin/books/email-receipts",
    },
    {
      key: "email_receipts_cron",
      title: "Turn on email-receipt ingestion",
      why: "The hourly poll that reads receipts out of Gmail.",
      status: s.flags.gmailReceipts ? "done" : "todo",
      href: "/admin/books/email-receipts",
    },
    {
      key: "income_sync",
      title: "Turn on platform income sync",
      why: "Nightly sync of Stripe income and payout fees into the ledger.",
      status: offSyncs.length === 0 ? "done" : "todo",
      detail: offSyncs.length ? `Off: ${offSyncs.join(", ")}.` : undefined,
      href: "/admin/books",
    },
    {
      key: "tax_rate",
      title: "Set your safe-harbor tax rate",
      why: "Your CPA's effective rate drives the rolling tax forecast — without it there is no estimate.",
      status: s.taxRatePercent !== null ? "done" : "todo",
      href: "/admin/books/insights",
    },
    {
      key: "accountant_email",
      title: "Set your accountant's email",
      why: "Where report packs and the quarterly close email go.",
      status: s.accountantEmail.trim() ? "done" : "todo",
      href: "/admin/books/reports",
    },
    {
      key: "quarterly_pack",
      title: "Turn on the quarterly accountant pack",
      why: "Emails your accountant a full pack each quarter (needs the email above).",
      status: s.flags.quarterlyPack ? "done" : "todo",
      href: "/admin/books/reports",
    },
    {
      key: "housekeeping",
      title: "Turn on receipt housekeeping",
      why: "Retention pruning and the stuck-receipt watchdog.",
      status: offHousekeeping.length === 0 ? "done" : "todo",
      detail: offHousekeeping.length ? `Off: ${offHousekeeping.join(", ")}.` : undefined,
      href: "/admin/books",
    },
    {
      key: "first_statement",
      title: "Import your first bank statement",
      why: "Statements catch every expense that never had a receipt.",
      status: s.statementEntryExists ? "done" : "todo",
      href: "/admin/books",
    },
    {
      key: "categories_reviewed",
      title: "Review expense categories per book",
      why: "Each book is its own tax context — check the category list fits before bulk-importing.",
      status: has(s.manualChecks, "categories_reviewed") ? "done" : "todo",
      href: "/admin/books/accounts",
      manual: true,
    },
  ]
}
```

- [ ] **Step 4: Run the test** → all pass.

- [ ] **Step 5: Add the two DAL helpers.** In `lib/db/cron-runs.ts` append (uses the existing `CronRun` interface in that file):

```ts
/** Latest run (any status) for one cron, else null. Setup checklist reads
 *  bookkeepingGmailReceiptsCron's detail.label_missing telemetry through this. */
export async function latestCronRun(
  supabase: SupabaseClient,
  cron_name: string,
): Promise<CronRun | null> {
  const { data, error } = await supabase
    .from("cron_runs")
    .select("*")
    .eq("cron_name", cron_name)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error(`[cron_runs] latestCronRun(${cron_name}) failed:`, error.message)
    return null
  }
  return (data as CronRun) ?? null
}
```

In `lib/db/bookkeeping.ts` append near the other entry reads (`db()` is that file's client helper — match neighboring functions):

```ts
/** True if ANY ledger entry came from a statement import (setup checklist). */
export async function hasStatementImportEntries(): Promise<boolean> {
  const { data, error } = await db()
    .from("bookkeeping_ledger_entries")
    .select("id")
    .eq("source", "statement_import")
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data !== null
}
```

- [ ] **Step 6: Commit** — `git add lib/bookkeeping/setup-status.ts lib/db/cron-runs.ts lib/db/bookkeeping.ts __tests__/lib/bookkeeping/setup-status.test.ts` then `git commit -m "feat(bookkeeping): setup-status aggregator + DAL reads"` (append the standard Co-Authored-By footer used in this repo).

---

### Task 2: Setup-status API route (GET + PATCH) + audit action

**Files:**
- Create: `app/api/admin/bookkeeping/setup-status/route.ts`
- Modify: `lib/audit/actions.ts` (add `"bookkeeping.setup_manual_check_set"` and `"bookkeeping.tour_completed"` to the closed slug set, category `admin_write` — follow the file's existing structure exactly; open it first)
- Test: `__tests__/api/admin/bookkeeping/setup-status.test.ts`

**Interfaces:**
- Consumes: `computeSetupItems`, `SetupStatusSources`, `MANUAL_CHECK_KEYS` from `@/lib/bookkeeping/setup-status`; `latestCronRun` from `@/lib/db/cron-runs`; `hasStatementImportEntries` from `@/lib/db/bookkeeping`; `getSetting`/`setSetting` from `@/lib/db/system-settings`; `getPlatformConnection` from `@/lib/db/platform-connections`; `createServiceRoleClient` from `@/lib/supabase` (check the exact export name — the quarterly-pack route imports it; copy that import line); `recordAudit` from `@/lib/audit/record`; `auth` from `@/lib/auth`.
- Produces: `GET /api/admin/bookkeeping/setup-status` → `{ items: SetupItem[], doneCount: number, totalCount: number, tourCompletedAt: string | null }`; `PATCH` with body `{ key: "categories_reviewed", checked: boolean }` or `{ tour_completed: true }` → `{ ok: true }`.

- [ ] **Step 1: Write the failing route test** (mock every DAL module with `vi.mock`, the repo's established route-test pattern — mirror `__tests__/api/admin/bookkeeping/duplicates-scan.test.ts`'s mocking style):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSettingMock = vi.fn()
const setSettingMock = vi.fn()
const getPlatformConnectionMock = vi.fn()
const latestCronRunMock = vi.fn()
const hasStatementImportEntriesMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/system-settings", () => ({
  getSetting: (...a: unknown[]) => getSettingMock(...a),
  setSetting: (...a: unknown[]) => setSettingMock(...a),
}))
vi.mock("@/lib/db/platform-connections", () => ({ getPlatformConnection: (...a: unknown[]) => getPlatformConnectionMock(...a) }))
vi.mock("@/lib/db/cron-runs", () => ({ latestCronRun: (...a: unknown[]) => latestCronRunMock(...a) }))
vi.mock("@/lib/db/bookkeeping", () => ({ hasStatementImportEntries: (...a: unknown[]) => hasStatementImportEntriesMock(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({}) }))

import { GET, PATCH } from "@/app/api/admin/bookkeeping/setup-status/route"

function patchReq(body: unknown) {
  return new Request("http://test/api/admin/bookkeeping/setup-status", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  // getSetting(key, fallback) → fallback-shaped defaults; individual tests override.
  getSettingMock.mockImplementation(async (_key: string, fallback: unknown) => fallback)
  getPlatformConnectionMock.mockResolvedValue(null)
  latestCronRunMock.mockResolvedValue(null)
  hasStatementImportEntriesMock.mockResolvedValue(false)
  setSettingMock.mockResolvedValue({})
})

describe("GET /api/admin/bookkeeping/setup-status", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await GET()).status).toBe(403)
  })
  it("returns 11 items with counts from real evaluation (unconfigured system → 0 done)", async () => {
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(11)
    expect(body.totalCount).toBe(11)
    expect(body.doneCount).toBe(0)
    expect(body.tourCompletedAt).toBeNull()
  })
  it("a connected gmail account flips gmail_connected to done", async () => {
    getPlatformConnectionMock.mockResolvedValue({ id: "pc1" })
    const body = await (await GET()).json()
    expect(body.items.find((i: { key: string }) => i.key === "gmail_connected").status).toBe("done")
  })
})

describe("PATCH /api/admin/bookkeeping/setup-status", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue(null)
    expect((await PATCH(patchReq({ key: "categories_reviewed", checked: true }))).status).toBe(403)
  })
  it("adds a manual key to the stored array, audits, and is idempotent", async () => {
    getSettingMock.mockImplementation(async (key: string, fallback: unknown) =>
      key === "bookkeeping_setup_manual_checks" ? ["categories_reviewed"] : fallback)
    const res = await PATCH(patchReq({ key: "categories_reviewed", checked: true }))
    expect(res.status).toBe(200)
    expect(setSettingMock).toHaveBeenCalledWith("bookkeeping_setup_manual_checks", ["categories_reviewed"], "admin-1")
    expect(recordAuditMock).toHaveBeenCalled()
  })
  it("unchecking removes the key", async () => {
    getSettingMock.mockImplementation(async (key: string, fallback: unknown) =>
      key === "bookkeeping_setup_manual_checks" ? ["categories_reviewed"] : fallback)
    await PATCH(patchReq({ key: "categories_reviewed", checked: false }))
    expect(setSettingMock).toHaveBeenCalledWith("bookkeeping_setup_manual_checks", [], "admin-1")
  })
  it("rejects an unknown manual key with 400", async () => {
    expect((await PATCH(patchReq({ key: "not_a_key", checked: true }))).status).toBe(400)
  })
  it("tour_completed stamps an ISO timestamp", async () => {
    const res = await PATCH(patchReq({ tour_completed: true }))
    expect(res.status).toBe(200)
    const [key, value] = setSettingMock.mock.calls[0]
    expect(key).toBe("bookkeeping_tour_completed_at")
    expect(typeof value).toBe("string")
  })
})
```

- [ ] **Step 2: Run to verify it fails** (module not found).

- [ ] **Step 3: Implement the route.** Structure (fill in with the verified keys from Global Constraints; open the quarterly-pack route to copy the exact `createServiceRoleClient` import):

```ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { computeSetupItems, MANUAL_CHECK_KEYS } from "@/lib/bookkeeping/setup-status"
import { latestCronRun } from "@/lib/db/cron-runs"
import { hasStatementImportEntries } from "@/lib/db/bookkeeping"
import { getSetting, setSetting } from "@/lib/db/system-settings"
import { getPlatformConnection } from "@/lib/db/platform-connections"
import { createServiceRoleClient } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit/record"

const patchSchema = z.union([
  z.object({ key: z.enum(MANUAL_CHECK_KEYS), checked: z.boolean() }),
  z.object({ tour_completed: z.literal(true) }),
])

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const supabase = createServiceRoleClient()
    const [connection, cronRun, forwarders, gmailReceipts, incomeSync, payoutSync, retention, receiptWatchdog, quarterlyPack, taxRatePercent, accountantEmail, statementEntryExists, manualChecks, tourCompletedAt] = await Promise.all([
      getPlatformConnection("gmail").catch(() => null),
      latestCronRun(supabase, "bookkeepingGmailReceiptsCron"),
      getSetting<unknown>("bookkeeping_gmail_receipt_forwarders", []),
      getSetting<boolean>("cron_bookkeeping_gmail_receipts_enabled", false),
      getSetting<boolean>("cron_bookkeeping_income_sync_enabled", false),
      getSetting<boolean>("cron_bookkeeping_payout_sync_enabled", false),
      getSetting<boolean>("cron_bookkeeping_retention_enabled", false),
      getSetting<boolean>("cron_bookkeeping_receipt_watchdog_enabled", false),
      getSetting<boolean>("cron_bookkeeping_quarterly_pack_enabled", false),
      getSetting<number | null>("bookkeeping_tax_rate_percent", null),
      getSetting<string>("bookkeeping_accountant_email", ""),
      hasStatementImportEntries(),
      getSetting<unknown>("bookkeeping_setup_manual_checks", []),
      getSetting<string | null>("bookkeeping_tour_completed_at", null),
    ])
    const items = computeSetupItems({
      gmailConnected: connection !== null,
      latestGmailCronDetail: cronRun?.detail ?? null,
      forwarders,
      flags: { gmailReceipts, incomeSync, payoutSync, retention, receiptWatchdog, quarterlyPack },
      taxRatePercent,
      accountantEmail,
      statementEntryExists,
      manualChecks,
    })
    return NextResponse.json({
      items,
      doneCount: items.filter((i) => i.status === "done").length,
      totalCount: items.length,
      tourCompletedAt,
    })
  } catch (error) {
    console.error("bookkeeping setup-status:", error)
    return NextResponse.json({ error: "Failed to load setup status" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    if ("tour_completed" in parsed.data) {
      await setSetting("bookkeeping_tour_completed_at", new Date().toISOString(), session.user.id)
      void recordAudit({ action: "bookkeeping.tour_completed", category: "admin_write", outcome: "success",
        target: { type: "system_setting", id: "bookkeeping_tour_completed_at" }, request })
      return NextResponse.json({ ok: true })
    }
    const { key, checked } = parsed.data
    const stored = await getSetting<unknown>("bookkeeping_setup_manual_checks", [])
    const list = Array.isArray(stored) ? stored.filter((k): k is string => typeof k === "string") : []
    const next = checked ? Array.from(new Set([...list, key])) : list.filter((k) => k !== key)
    await setSetting("bookkeeping_setup_manual_checks", next, session.user.id)
    void recordAudit({ action: "bookkeeping.setup_manual_check_set", category: "admin_write", outcome: "success",
      target: { type: "system_setting", id: "bookkeeping_setup_manual_checks" }, metadata: { key, checked }, request })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("bookkeeping setup-status patch:", error)
    return NextResponse.json({ error: "Failed to save" }, { status: 500 })
  }
}
```

Note: `MANUAL_CHECK_KEYS` is a `readonly ["categories_reviewed"]` tuple — `z.enum` needs a non-empty tuple; if the Zod version rejects the readonly tuple, use `z.enum(MANUAL_CHECK_KEYS as unknown as [string, ...string[]])`.

- [ ] **Step 4: Add the audit slugs.** Open `lib/audit/actions.ts`, find the bookkeeping cluster of slugs, add `"bookkeeping.setup_manual_check_set"` and `"bookkeeping.tour_completed"` following the file's exact structure (it is a closed set — match how neighbors declare category/description).

- [ ] **Step 5: Run the route test** → all pass. Also re-run Task 1's test.

- [ ] **Step 6: Commit** — `feat(bookkeeping): setup-status API + audit actions`.

---

### Task 3: SetupBanner + SetupPanel, wired into BooksClient

**Files:**
- Create: `components/admin/bookkeeping/SetupPanel.tsx` (exports `SetupBanner` and `SetupPanel`)
- Modify: `components/admin/bookkeeping/BooksClient.tsx` (render banner above the filter row; add a `?` icon button at the end of the toolbar button row; own `panelOpen` state)
- Test: `__tests__/components/admin/bookkeeping/SetupPanel.test.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /api/admin/bookkeeping/setup-status` (Task 2 shapes); `SetupItem` type from `@/lib/bookkeeping/setup-status`; shadcn `Dialog`, `Button`, `Checkbox` (`components/ui/checkbox.tsx` — verify it exists; if not, use a native `<input type="checkbox">` styled with the repo's classes); `Progress` from `components/ui/progress`; icons `CircleCheck`, `Circle`, `TriangleAlert`, `CircleHelp` from lucide.
- Produces: `<SetupBanner onOpen={() => void} />` — fetches status on mount, hidden when complete or dismissed (`localStorage["books_setup_banner_dismissed"] === "1"`); `<SetupPanel open onOpenChange onStartTour />` — fetches on each open, renders grouped items, manual checkbox PATCHes, footer "Take the tour" / "Retake the tour" (by `tourCompletedAt`) calling `onStartTour`.

- [ ] **Step 1: Write failing component tests** (stub `fetch` like `DuplicateScanDialog.test.tsx` does):

```tsx
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { SetupBanner, SetupPanel } from "@/components/admin/bookkeeping/SetupPanel"

const item = (key: string, status = "todo", over: Record<string, unknown> = {}) =>
  ({ key, title: `Title ${key}`, why: "why", status, href: "/admin/books", ...over })
const fetchMock = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal("fetch", fetchMock)
})
function mockStatus(items: unknown[], tourCompletedAt: string | null = null) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") {
      return new Response(JSON.stringify({
        items, totalCount: items.length,
        doneCount: (items as { status: string }[]).filter((i) => i.status === "done").length,
        tourCompletedAt,
      }), { status: 200 })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })
}

describe("<SetupBanner>", () => {
  it("shows progress while incomplete and opens on click", async () => {
    mockStatus([item("a", "done"), item("b")])
    const onOpen = vi.fn()
    render(<SetupBanner onOpen={onOpen} />)
    expect(await screen.findByText(/1 of 2/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /set.?up/i }))
    expect(onOpen).toHaveBeenCalled()
  })
  it("renders nothing when everything is done", async () => {
    mockStatus([item("a", "done")])
    const { container } = render(<SetupBanner onOpen={() => {}} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.textContent).toBe("")
  })
  it("stays hidden after dismissal", async () => {
    localStorage.setItem("books_setup_banner_dismissed", "1")
    mockStatus([item("b")])
    const { container } = render(<SetupBanner onOpen={() => {}} />)
    await waitFor(() => {})
    expect(container.textContent).toBe("")
  })
})

describe("<SetupPanel>", () => {
  it("renders items with status icons, attention detail, and fix links", async () => {
    mockStatus([
      item("gmail_label", "attention", { detail: "cron never ran" }),
      item("tax_rate", "todo", { href: "/admin/books/insights" }),
    ])
    render(<SetupPanel open onOpenChange={() => {}} onStartTour={() => {}} />)
    expect(await screen.findByText("cron never ran")).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: /fix/i })[0]).toHaveAttribute("href", "/admin/books/insights")
  })
  it("manual item checkbox PATCHes {key, checked}", async () => {
    mockStatus([item("categories_reviewed", "todo", { manual: true })])
    render(<SetupPanel open onOpenChange={() => {}} onStartTour={() => {}} />)
    fireEvent.click(await screen.findByRole("checkbox"))
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")
      expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ key: "categories_reviewed", checked: true })
    })
  })
  it("footer offers the tour and fires onStartTour", async () => {
    mockStatus([item("a", "done")])
    const onStartTour = vi.fn()
    render(<SetupPanel open onOpenChange={() => {}} onStartTour={onStartTour} />)
    fireEvent.click(await screen.findByRole("button", { name: /take the tour/i }))
    expect(onStartTour).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `SetupPanel.tsx`.** One file, two exports, shared `useSetupStatus()` internal hook (fetch on mount / on open; request-id ref guard like `DuplicateScanDialog`'s `scanRequestIdRef` — copy that pattern including the stale-response bail). Banner: `<button>` row, `bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 text-sm`, `Progress` bar `value={(done/total)*100}`, an X dismiss button setting the localStorage key. Panel: `Dialog` with `max-h-[85vh] overflow-y-auto sm:max-w-2xl`; item rows: icon by status (`CircleCheck` `text-success`, `Circle` `text-muted-foreground`, `TriangleAlert` `text-warning`), title + why + detail (detail in `text-xs text-warning` when attention, else `text-xs text-muted-foreground`), right side: manual → checkbox (optimistic toggle, revert + `toast.error` on failure); non-manual non-done → `Fix this` `next/link` `text-primary underline text-xs` with `aria-label` containing "Fix". Footer: Close + "Take the tour" (or "Retake the tour" when `tourCompletedAt` non-null).

- [ ] **Step 4: Wire into `BooksClient.tsx`.** Read the file first. Add `const [setupOpen, setSetupOpen] = useState(false)`. Render `<SetupBanner onOpen={() => setSetupOpen(true)} />` directly above the filters section; add to the end of the toolbar button row: `<Button variant="outline" size="sm" aria-label="Accounting setup and tour" onClick={() => setSetupOpen(true)}><CircleHelp className="size-4" /></Button>`; render `<SetupPanel open={setupOpen} onOpenChange={setSetupOpen} onStartTour={...} />` (onStartTour is a no-op stub until Task 5 — pass `() => {}` and leave a `// wired in Task 5` comment).

- [ ] **Step 5: Run the new test + `EmailReceiptsClient`/`BooksClient`-adjacent suites** (`npx vitest run "__tests__/components/admin/bookkeeping/"`) → green.

- [ ] **Step 6: Commit** — `feat(bookkeeping): setup banner + panel on /admin/books`.

---

### Task 4: Tour steps registry + page-tour engine + overlay component

**Files:**
- Create: `lib/bookkeeping/tour-steps.ts`
- Create: `hooks/use-page-tour.ts`
- Create: `components/admin/bookkeeping/BooksTour.tsx`
- Test: `__tests__/lib/bookkeeping/tour-steps.test.ts`, `__tests__/components/admin/bookkeeping/BooksTour.test.tsx`

**Interfaces:**
- Consumes: nothing from Tasks 1-3 (independent).
- Produces:
  - `BOOKS_TOUR_STEPS: BooksTourStep[]` and `interface BooksTourStep { id: string; page: string; title: string; body: string }` from `lib/bookkeeping/tour-steps`.
  - `startBooksTour(): void` (writes `sessionStorage["books_tour_state"] = JSON.stringify({ stepIndex: 0 })`, dispatches `window.dispatchEvent(new Event("books-tour-changed"))`) from `hooks/use-page-tour`.
  - `usePageTour(pathname: string)` returning `{ step, stepIndex, total, targetRect, next, prev, close } | null` (null when inactive or the active step belongs to another page).
  - `<BooksTour />` — self-contained client component (calls `usePathname()` + `useRouter()` internally); render it inside any books client root.

- [ ] **Step 1: Write the failing registry test:**

```ts
import { describe, it, expect } from "vitest"
import { BOOKS_TOUR_STEPS } from "@/lib/bookkeeping/tour-steps"

const PAGES = ["/admin/books", "/admin/books/accounts", "/admin/books/reports",
  "/admin/books/insights", "/admin/books/assets", "/admin/books/email-receipts"]

describe("BOOKS_TOUR_STEPS", () => {
  it("has unique ids", () => {
    expect(new Set(BOOKS_TOUR_STEPS.map((s) => s.id)).size).toBe(BOOKS_TOUR_STEPS.length)
  })
  it("only uses the six known pages", () => {
    for (const s of BOOKS_TOUR_STEPS) expect(PAGES).toContain(s.page)
  })
  it("groups steps contiguously by page — cross-page resume depends on it", () => {
    const seen = new Set<string>()
    let prev = ""
    for (const s of BOOKS_TOUR_STEPS) {
      if (s.page !== prev) {
        expect(seen.has(s.page)).toBe(false) // a page never reappears after we left it
        seen.add(s.page)
        prev = s.page
      }
    }
  })
  it("starts on the ledger page", () => {
    expect(BOOKS_TOUR_STEPS[0].page).toBe("/admin/books")
  })
})
```

- [ ] **Step 2: Run → fails. Implement `lib/bookkeeping/tour-steps.ts`** — pure data, 13 steps. Copy verbatim:

```ts
// Cross-page tour over the accounting area. Steps MUST stay contiguous per
// page (the sessionStorage resume navigates on page boundaries). Target
// elements carry data-tour="<id>" (wired in the six client components).
export interface BooksTourStep {
  id: string
  page: string
  title: string
  body: string
}

export const BOOKS_TOUR_STEPS: BooksTourStep[] = [
  { id: "toolbar", page: "/admin/books", title: "Getting money into the ledger",
    body: "Every ingestion path lives here: manual entries, platform income, bank statements, cash receipts, photo/PDF receipts, and Amazon order history." },
  { id: "find-duplicates", page: "/admin/books", title: "Duplicate scan",
    body: "AI reviews same-amount pairs (like a vendor invoice and its paid receipt) and helps you delete the extra one safely." },
  { id: "filters", page: "/admin/books", title: "Slice the ledger",
    body: "Filter by period, category, source, or search memo and counterparty. Filters survive in the URL, so you can share a view." },
  { id: "ledger", page: "/admin/books", title: "The ledger itself",
    body: "Each row shows the memo (or the receipt's business purpose in italics), its category, source, and amount. The paperclip opens the attached document; the pencil edits." },
  { id: "email-chip", page: "/admin/books", title: "Email receipts, waiting",
    body: "When the Gmail poller finds receipts, the pending count appears here — one click into the review board." },
  { id: "accounts", page: "/admin/books/accounts", title: "Categories per book",
    body: "Each book keeps its own chart of expense categories — its own tax context. Categories marked 'business purpose required' force substantiation before posting." },
  { id: "reports", page: "/admin/books/reports", title: "Reports",
    body: "P&L, category breakdowns, and the exportable accountant pack (QuickBooks CSV + spreadsheet + print view) live here." },
  { id: "accountant", page: "/admin/books/reports", title: "Your accountant, on autopilot",
    body: "Set your accountant's email and the quarterly cron emails them a full pack after each quarter closes." },
  { id: "insights", page: "/admin/books/insights", title: "Insights & watchdogs",
    body: "Deduction finder, anomaly checks, and duplicate findings surface here. Dismissing a finding hides it from every future run." },
  { id: "tax", page: "/admin/books/insights", title: "The tax forecast",
    body: "Enter the effective rate your CPA gives you and this tracks estimated tax against year-to-date net, with the next safe-harbor date." },
  { id: "assets", page: "/admin/books/assets", title: "Assets & depreciation",
    body: "Big purchases become assets with a depreciation schedule your accountant can use instead of a same-year expense." },
  { id: "email-board", page: "/admin/books/email-receipts", title: "The email-receipts board",
    body: "Receipts pulled from Gmail land here in three columns: ready to post, needs a look, and possible duplicates." },
  { id: "email-post", page: "/admin/books/email-receipts", title: "Review, pick a book, post",
    body: "Each card shows what the AI read. Check the amount, choose which book it posts into, then Post — or Ignore what doesn't belong." },
]
```

- [ ] **Step 3: Implement `hooks/use-page-tour.ts`.** Model on `hooks/use-form-tour.ts` (read it first) with these differences: document-scoped (`document.querySelector('[data-tour="<id>"]')`), viewport-fixed rects (no scrollTop math — return `getBoundingClientRect()` directly), window scroll+resize listeners, and sessionStorage persistence:

```ts
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BOOKS_TOUR_STEPS } from "@/lib/bookkeeping/tour-steps"

const STORAGE_KEY = "books_tour_state"
const CHANGED_EVENT = "books-tour-changed"

export function startBooksTour(): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stepIndex: 0 }))
  window.dispatchEvent(new Event(CHANGED_EVENT))
}

function readState(): { stepIndex: number } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { stepIndex?: unknown }
    return typeof parsed.stepIndex === "number" &&
      parsed.stepIndex >= 0 && parsed.stepIndex < BOOKS_TOUR_STEPS.length
      ? { stepIndex: parsed.stepIndex }
      : null
  } catch {
    return null
  }
}

export interface PageTourState {
  step: (typeof BOOKS_TOUR_STEPS)[number]
  stepIndex: number
  total: number
  targetRect: DOMRect | null
  next: () => void
  prev: () => void
  close: (opts?: { completed?: boolean }) => void
}

/** Active tour state for THIS page, or null (inactive / step lives elsewhere). */
export function usePageTour(pathname: string): PageTourState | null {
  const router = useRouter()
  const [stepIndex, setStepIndex] = useState<number | null>(null)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const rafRef = useRef(0)

  const sync = useCallback(() => setStepIndex(readState()?.stepIndex ?? null), [])
  useEffect(() => {
    sync()
    window.addEventListener(CHANGED_EVENT, sync)
    return () => window.removeEventListener(CHANGED_EVENT, sync)
  }, [sync])

  const step = stepIndex !== null ? BOOKS_TOUR_STEPS[stepIndex] : null
  const onThisPage = step !== null && step.page === pathname

  const measure = useCallback(() => {
    if (!step || !onThisPage) return
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.id}"]`)
    setTargetRect(el ? el.getBoundingClientRect() : null)
  }, [step, onThisPage])

  // Scroll the target into view, then measure; skip a missing target so
  // markup drift can never hard-block the tour.
  useEffect(() => {
    if (!step || !onThisPage) return
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.id}"]`)
    if (!el) {
      console.warn(`books tour: target "${step.id}" missing — skipping`)
      const nextIndex = (stepIndex ?? 0) + 1
      if (nextIndex < BOOKS_TOUR_STEPS.length) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stepIndex: nextIndex }))
        window.dispatchEvent(new Event(CHANGED_EVENT))
      } else {
        sessionStorage.removeItem(STORAGE_KEY)
        window.dispatchEvent(new Event(CHANGED_EVENT))
      }
      return
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    const t = setTimeout(measure, 300)
    return () => clearTimeout(t)
  }, [step, onThisPage, stepIndex, measure])

  useEffect(() => {
    if (!onThisPage) return
    function onScrollResize() {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(measure)
    }
    window.addEventListener("scroll", onScrollResize, { passive: true })
    window.addEventListener("resize", onScrollResize)
    return () => {
      window.removeEventListener("scroll", onScrollResize)
      window.removeEventListener("resize", onScrollResize)
      cancelAnimationFrame(rafRef.current)
    }
  }, [onThisPage, measure])

  const go = useCallback(
    (index: number) => {
      const target = BOOKS_TOUR_STEPS[index]
      if (!target) return
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stepIndex: index }))
      window.dispatchEvent(new Event(CHANGED_EVENT))
      if (target.page !== pathname) router.push(target.page)
    },
    [pathname, router],
  )

  const close = useCallback((opts?: { completed?: boolean }) => {
    sessionStorage.removeItem(STORAGE_KEY)
    window.dispatchEvent(new Event(CHANGED_EVENT))
    setTargetRect(null)
    if (opts?.completed) {
      void fetch("/api/admin/bookkeeping/setup-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tour_completed: true }),
      }).catch(() => {})
    }
  }, [])

  if (stepIndex === null || !step || !onThisPage) return null
  return {
    step,
    stepIndex,
    total: BOOKS_TOUR_STEPS.length,
    targetRect,
    next: () => (stepIndex < BOOKS_TOUR_STEPS.length - 1 ? go(stepIndex + 1) : close({ completed: true })),
    prev: () => stepIndex > 0 && go(stepIndex - 1),
    close,
  }
}
```

- [ ] **Step 4: Implement `components/admin/bookkeeping/BooksTour.tsx`.** Fixed-position sibling of `FormTour` (read `components/admin/FormTour.tsx` for the motion/tooltip idiom and copy its visual classes):

```tsx
"use client"

import { usePathname } from "next/navigation"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ChevronLeft, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePageTour } from "@/hooks/use-page-tour"

const spring = { type: "spring", stiffness: 350, damping: 30 } as const

export function BooksTour() {
  const pathname = usePathname()
  const tour = usePageTour(pathname ?? "")
  const reducedMotion = useReducedMotion()
  if (!tour || !tour.targetRect) return null
  const { step, stepIndex, total, targetRect, next, prev, close } = tour

  const hlTop = targetRect.top - 4
  const hlLeft = targetRect.left - 4
  const hlWidth = targetRect.width + 8
  const hlHeight = targetRect.height + 8
  // Tooltip below the highlight; clamp into the viewport.
  const tooltipTop = Math.min(hlTop + hlHeight + 8, window.innerHeight - 220)
  const tooltipLeft = Math.max(8, Math.min(hlLeft, window.innerWidth - 340))
  const transition = reducedMotion ? { duration: 0 } : spring

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/30" onClick={() => close()} />
      <motion.div animate={{ top: hlTop, left: hlLeft, width: hlWidth, height: hlHeight }}
        transition={transition}
        className="fixed z-[61] rounded-md ring-2 ring-primary/70 bg-background/10 pointer-events-none" />
      <div className="fixed z-[62] w-[min(330px,calc(100vw-2rem))]" style={{ top: tooltipTop, left: tooltipLeft }}>
        <motion.div key={stepIndex} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.18, delay: 0.08 }}
          className="rounded-lg border border-border bg-background shadow-lg p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{step.title}</p>
            <button aria-label="Close tour" onClick={() => close()} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground">{step.body}</p>
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground tabular-nums">{stepIndex + 1} of {total}</span>
            <div className="flex gap-1.5">
              {stepIndex > 0 && (
                <Button size="sm" variant="outline" onClick={prev}>
                  <ChevronLeft className="size-3.5" /> Back
                </Button>
              )}
              <Button size="sm" onClick={next}>{stepIndex === total - 1 ? "Done" : "Next"}</Button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
```

- [ ] **Step 5: Write + run the BooksTour component test** (jsdom: give the target a mocked rect):

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { BooksTour } from "@/components/admin/bookkeeping/BooksTour"
import { startBooksTour } from "@/hooks/use-page-tour"
import { BOOKS_TOUR_STEPS } from "@/lib/bookkeeping/tour-steps"

const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/books",
  useRouter: () => ({ push: pushMock }),
}))

function mountTarget(id: string) {
  const el = document.createElement("div")
  el.setAttribute("data-tour", id)
  el.getBoundingClientRect = () => new DOMRect(10, 20, 300, 40)
  el.scrollIntoView = vi.fn()
  document.body.appendChild(el)
  return el
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  document.body.innerHTML = ""
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
})

describe("<BooksTour>", () => {
  it("renders nothing while inactive", () => {
    mountTarget("toolbar")
    const { container } = render(<BooksTour />)
    expect(container.textContent).toBe("")
  })
  it("starting the tour spotlights step 1 and Next advances within the page", async () => {
    for (const s of BOOKS_TOUR_STEPS.filter((x) => x.page === "/admin/books")) mountTarget(s.id)
    render(<BooksTour />)
    act(() => startBooksTour())
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    expect(screen.getByText(BOOKS_TOUR_STEPS[0].title)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /next/i }))
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    expect(screen.getByText(BOOKS_TOUR_STEPS[1].title)).toBeInTheDocument()
    expect(pushMock).not.toHaveBeenCalled()
  })
  it("Next on the page's last step navigates to the next page and keeps state", async () => {
    for (const s of BOOKS_TOUR_STEPS.filter((x) => x.page === "/admin/books")) mountTarget(s.id)
    const lastOnPage = BOOKS_TOUR_STEPS.filter((s) => s.page === "/admin/books").length - 1
    sessionStorage.setItem("books_tour_state", JSON.stringify({ stepIndex: lastOnPage }))
    render(<BooksTour />)
    act(() => window.dispatchEvent(new Event("books-tour-changed")))
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    fireEvent.click(screen.getByRole("button", { name: /next/i }))
    expect(pushMock).toHaveBeenCalledWith(BOOKS_TOUR_STEPS[lastOnPage + 1].page)
    expect(JSON.parse(sessionStorage.getItem("books_tour_state")!)).toEqual({ stepIndex: lastOnPage + 1 })
  })
  it("close clears the sessionStorage state", async () => {
    mountTarget("toolbar")
    render(<BooksTour />)
    act(() => startBooksTour())
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    fireEvent.click(screen.getByRole("button", { name: /close tour/i }))
    expect(sessionStorage.getItem("books_tour_state")).toBeNull()
  })
})
```

- [ ] **Step 6: Run both new suites → green. Commit** — `feat(bookkeeping): cross-page tour engine + steps registry`.

---

### Task 5: Wire the tour into all six pages + data-tour targets + panel hookup

**Files:**
- Modify: `components/admin/bookkeeping/BooksClient.tsx` (data-tour: `toolbar` on the action-button row wrapper, `find-duplicates` on the Find-duplicates button, `filters` on the filter row wrapper, `ledger` on the table wrapper, `email-chip` on the email-receipts pending link/button; render `<BooksTour />`; replace Task 3's `onStartTour` stub with `startBooksTour` from `@/hooks/use-page-tour`)
- Modify: `components/admin/bookkeeping/AccountsManager.tsx` (`data-tour="accounts"` on the root wrapper; render `<BooksTour />`)
- Modify: `components/admin/bookkeeping/ReportsClient.tsx` (`data-tour="reports"` on the root; `data-tour="accountant"` on the accountant-email / email-pack section wrapper — find it by searching the file for `accountant_email` or the email-pack UI; render `<BooksTour />`)
- Modify: `components/admin/bookkeeping/InsightsClient.tsx` (`data-tour="insights"` on the root; `data-tour="tax"` on the tax-forecast card wrapper — search the file for `TaxForecast`; render `<BooksTour />`)
- Modify: `components/admin/bookkeeping/AssetsClient.tsx` (`data-tour="assets"` on the root; render `<BooksTour />`)
- Modify: `components/admin/bookkeeping/EmailReceiptsClient.tsx` (`data-tour="email-board"` on the columns wrapper; `data-tour="email-post"` on the first column's card list wrapper; render `<BooksTour />`)
- Test: extend `__tests__/components/admin/bookkeeping/SetupPanel.test.tsx` with one integration assertion (below); rely on Task 4's registry test for step/page consistency.

**Interfaces:**
- Consumes: `<BooksTour />`, `startBooksTour` (Task 4); `SetupPanel` (Task 3).
- Produces: every `BOOKS_TOUR_STEPS` id present as a `data-tour` attribute on its page.

- [ ] **Step 1:** Read each client file, add the `data-tour` attributes to the EXISTING wrapper elements (never new wrappers unless the target is a fragment — then wrap in a plain `<div data-tour="...">`). The `email-chip` target only renders when pending > 0 — that is fine; the engine skips missing targets by design.
- [ ] **Step 2:** Render `<BooksTour />` once inside each of the six client components' outermost JSX (import from `@/components/admin/bookkeeping/BooksTour`).
- [ ] **Step 3:** In `BooksClient`, wire `onStartTour={() => { setSetupOpen(false); startBooksTour() }}`.
- [ ] **Step 4:** Add to the SetupPanel test file: render `BooksClient`? — NO (too heavy). Instead assert the wiring statically: add this test to `__tests__/lib/bookkeeping/tour-steps.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"

it("every step id appears as a data-tour attribute in some books client component", () => {
  const dir = join(process.cwd(), "components/admin/bookkeeping")
  const files = ["BooksClient.tsx", "AccountsManager.tsx", "ReportsClient.tsx",
    "InsightsClient.tsx", "AssetsClient.tsx", "EmailReceiptsClient.tsx"]
  const source = files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n")
  for (const s of BOOKS_TOUR_STEPS) {
    expect(source, `data-tour="${s.id}" missing from all six clients`).toContain(`data-tour="${s.id}"`)
  }
})
```

- [ ] **Step 5:** Run: tour-steps + SetupPanel + DuplicateScanDialog + EmailReceiptsClient suites → green.
- [ ] **Step 6: Commit** — `feat(bookkeeping): wire the cross-page tour + setup panel across the books pages`.

---

### Task 6: Verification + docs

- [ ] `npx vitest run "__tests__/lib/bookkeeping/" "__tests__/components/admin/bookkeeping/" "__tests__/api/admin/bookkeeping/"` → green.
- [ ] `npm run build` → green; grep output for the touched files.
- [ ] `npx tsc --noEmit` → grep for every touched file (baseline NextRequest noise in unrelated tests is expected).
- [ ] Update `JOURNAL.md` (local only, never staged) and the project memory.
- [ ] Final commit of any stragglers. **DO NOT PUSH.**
