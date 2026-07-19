# Detailed Income Import + Editable Imported Rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Platform-income imports arrive maximally detailed (program + athlete + pack product + deterministic category), never undercount deleted-source sales (orphaned-mirror fallback), and imported ledger rows become editable for the safe fields (category/memo/counterparty/business purpose) with money fields locked UI+API.

**Architecture:** Spec: `docs/superpowers/specs/2026-07-19-detailed-income-import-design.md`. Pure enrichment (`income-enrich.ts`) + pure category tie-break (`account-match.ts`) feed the existing adapter; `listPlatformIncome` gains two graceful batch lookups; `buildIncomeDrafts` gains rich memos/counterparties + greedy one-to-one orphan pairing (equal cents, ≤7 days); the entries PATCH route gains a locked-field 422 for non-manual rows; `LedgerTable`/`ManualEntryDialog` unlock imported-row editing. Zero migrations/flags/functions — Vercel-only.

**Tech Stack:** Next.js 16, TypeScript strict, Zod v4, Supabase (service-role DAL), Vitest + Testing Library (jsdom).

## Global Constraints

- No new npm dependencies; no `functions/` imports; no migrations; no feature flags.
- Semantic Tailwind classes only; no hex; no inline fontFamily.
- Pinned memo formats (spec §3.2, verbatim): `<program_name> — week <n> access` / `<program_name> — program purchase` / `Session fee` / `<product_name ?? session_type ?? "Session pack"> (<credits_total> sessions)` (credits suffix omitted when `credits_total` is null) / `<event_title ?? "Event"> — signup` / `Shop order <order_number>` / `Session pack (record deleted)` / `Camp/event signup (record deleted)`.
- Counterparty chains (spec §3.2): payments `payer_name ?? metadata.customerEmail ?? payer_email ?? description ?? null`; packages `client_name ?? null`; signups `parent_name ?? null`; shop `customer_name`.
- Orphan pairing (spec §4): same mirror type, equal `amount_cents`, |date diff| ≤ 7 days; smallest diff wins, tie → earliest candidate date; one-to-one consumption. Fallback ref `payments:<id>`. Warnings: `"<n> session-pack payment(s) counted directly — the pack records no longer exist."` / `"<n> event-signup payment(s) counted directly — the signup records no longer exist."`
- Locked import fields (spec §5): `direction`, `amount_cents`, `occurred_on`, `adjusts_period`; PATCH 422 body `{"error":"amount, date and direction are locked on imported entries"}` on PRESENCE of any locked key when `entry.source !== "manual"`. Delete stays manual-only.
- Commit directly to `main`; push HELD. Never chain `npm run build` behind tests with `&&`.
- Full-suite baseline is GREEN 3162/3162 — zero regressions tolerated.

---

## File Structure

| File | Task | Responsibility |
| --- | --- | --- |
| `lib/bookkeeping/account-match.ts` (new) | 1 | Pure deterministic service_line → account tie-break |
| `components/admin/bookkeeping/ImportPlatformDialog.tsx` | 1 | Swap inline `find` for the helper |
| `lib/bookkeeping/income-enrich.ts` (new) | 2 | Pure id collection + enrichment stamping |
| `lib/bookkeeping/types.ts` | 2 | Widen `IncomeSourceRows` |
| `lib/db/bookkeeping.ts` | 2 | `listPlatformIncome` batch lookups (graceful) |
| `lib/bookkeeping/income-adapter.ts` | 3 | Rich drafts + orphan pairing + warnings |
| `__tests__/lib/bookkeeping/income-adapter.test.ts` | 3 | Updated + new fixtures |
| `app/api/admin/bookkeeping/entries/[id]/route.ts` | 4 | Always-fetch + locked-field 422 |
| `components/admin/bookkeeping/LedgerTable.tsx` | 5 | Edit for all sources; Delete manual-only |
| `components/admin/bookkeeping/ManualEntryDialog.tsx` | 5 | Locked edit variant |

---

### Task 1: `account-match.ts` + ImportPlatformDialog swap

**Files:**
- Create: `lib/bookkeeping/account-match.ts`
- Modify: `components/admin/bookkeeping/ImportPlatformDialog.tsx:81-84`
- Test: `__tests__/lib/bookkeeping/account-match.test.ts`

**Interfaces:**
- Consumes: `BookkeepingAccount` from `@/types/database` (reads `id`, `name`, `account_type`, `service_line`, `archived_at` via safe cast).
- Produces: `matchAccountForServiceLine(direction: "income" | "expense", serviceLine: string | null, accounts: BookkeepingAccount[]): BookkeepingAccount | null`.

- [ ] **Step 1: Write the failing test** — `__tests__/lib/bookkeeping/account-match.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { matchAccountForServiceLine } from "@/lib/bookkeeping/account-match"
import type { BookkeepingAccount } from "@/types/database"

function acct(over: Partial<BookkeepingAccount>): BookkeepingAccount {
  return { id: "a1", name: "X", account_type: "income", service_line: null, archived_at: null, ...over } as BookkeepingAccount
}

describe("matchAccountForServiceLine", () => {
  it("returns the single matching account", () => {
    const a = acct({ id: "p1", name: "Session Packs", service_line: "session_packs" })
    expect(matchAccountForServiceLine("income", "session_packs", [a])?.id).toBe("p1")
  })

  it("prefers the Stripe-named account when several share the service line", () => {
    const sports = acct({ id: "s1", name: "Performance Training — Sports", service_line: "performance_training" })
    const stripe = acct({ id: "s2", name: "Performance Training — Stripe", service_line: "performance_training" })
    expect(matchAccountForServiceLine("income", "performance_training", [sports, stripe])?.id).toBe("s2")
    expect(matchAccountForServiceLine("income", "performance_training", [stripe, sports])?.id).toBe("s2")
  })

  it("falls back to alphabetical-first when no Stripe name exists", () => {
    const b = acct({ id: "b", name: "Bravo", service_line: "other" })
    const a = acct({ id: "a", name: "Alpha", service_line: "other" })
    expect(matchAccountForServiceLine("income", "other", [b, a])?.id).toBe("a")
  })

  it("never matches wrong type, archived accounts, or null service line", () => {
    const wrongType = acct({ id: "w", name: "W", account_type: "expense", service_line: "camps" })
    const archived = acct({ id: "x", name: "X", service_line: "camps", archived_at: "2026-01-01T00:00:00Z" })
    expect(matchAccountForServiceLine("income", "camps", [wrongType, archived])).toBeNull()
    expect(matchAccountForServiceLine("income", null, [acct({ service_line: "camps" })])).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify failure** — `npx vitest run __tests__/lib/bookkeeping/account-match.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `lib/bookkeeping/account-match.ts`:**

```ts
// Deterministic service_line → account resolution for import drafts. When a
// book has several accounts on one service line (e.g. "Performance Training —
// Sports" AND "— Stripe"), platform imports must not depend on array order:
// prefer the Stripe-named account, then alphabetical. Pure, zero IO.
import type { BookkeepingAccount } from "@/types/database"

export function matchAccountForServiceLine(
  direction: "income" | "expense",
  serviceLine: string | null,
  accounts: BookkeepingAccount[],
): BookkeepingAccount | null {
  if (!serviceLine) return null
  const matches = accounts.filter(
    (a) =>
      a.account_type === direction &&
      a.service_line === serviceLine &&
      (a as { archived_at?: string | null }).archived_at == null,
  )
  if (matches.length === 0) return null
  return [...matches].sort((a, b) => {
    const aStripe = /stripe/i.test(a.name) ? 0 : 1
    const bStripe = /stripe/i.test(b.name) ? 0 : 1
    if (aStripe !== bStripe) return aStripe - bStripe
    return a.name.localeCompare(b.name)
  })[0]
}
```

- [ ] **Step 4: Run the test** → PASS.

- [ ] **Step 5: Swap the dialog's inline matcher.** In `components/admin/bookkeeping/ImportPlatformDialog.tsx` add `import { matchAccountForServiceLine } from "@/lib/bookkeeping/account-match"` and replace the body of `defaultAccountFor` (lines ~81-84):

```ts
function defaultAccountFor(draft: LedgerEntryDraft): string {
  return matchAccountForServiceLine(draft.direction, draft.service_line, accounts)?.id ?? ""
}
```

- [ ] **Step 6: Verify** — `npx tsc --noEmit 2>&1 | grep -E "account-match|ImportPlatformDialog"` → no output. Re-run Step 4's test → PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/bookkeeping/account-match.ts __tests__/lib/bookkeeping/account-match.test.ts components/admin/bookkeeping/ImportPlatformDialog.tsx
git commit -m "feat(bookkeeper): deterministic service-line account matching for import drafts"
```

---

### Task 2: Enrichment lookups — pure stamper + DAL wiring

**Files:**
- Create: `lib/bookkeeping/income-enrich.ts`
- Modify: `lib/bookkeeping/types.ts` (widen `IncomeSourceRows`)
- Modify: `lib/db/bookkeeping.ts` (`listPlatformIncome` tail + two lookup helpers)
- Test: `__tests__/lib/bookkeeping/income-enrich.test.ts`

**Interfaces:**
- Consumes: `IncomeSourceRows` from `@/lib/bookkeeping/types`.
- Produces (Task 3 relies on the widened rows):
  - `types.ts`: `payments: Array<Payment & { payer_name?: string | null; payer_email?: string | null; program_name?: string | null }>`; `clientPackages: Array<ClientPackage & { product_name?: string | null; client_name?: string | null }>` (other members unchanged).
  - `income-enrich.ts`: `collectEnrichmentIds(sources: IncomeSourceRows): { userIds: string[]; programIds: string[] }`; `interface EnrichmentUser { first_name: string | null; last_name: string | null; email: string | null }`; `fullName(u: EnrichmentUser | undefined): string | null`; `stampIncomeEnrichment(sources: IncomeSourceRows, usersById: Map<string, EnrichmentUser>, programNamesById: Map<string, string>): IncomeSourceRows`.

- [ ] **Step 1: Widen `lib/bookkeeping/types.ts`** — replace the two lines:

```ts
  payments: Array<Payment & { payer_name?: string | null; payer_email?: string | null; program_name?: string | null }>
  clientPackages: Array<ClientPackage & { product_name?: string | null; client_name?: string | null }>
```

- [ ] **Step 2: Write the failing test** — `__tests__/lib/bookkeeping/income-enrich.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { collectEnrichmentIds, fullName, stampIncomeEnrichment } from "@/lib/bookkeeping/income-enrich"
import type { IncomeSourceRows } from "@/lib/bookkeeping/types"

const U1 = "11111111-1111-4111-8111-111111111111"
const U2 = "22222222-2222-4222-8222-222222222222"
const PR = "33333333-3333-4333-8333-333333333333"

function sources(over: Partial<IncomeSourceRows> = {}): IncomeSourceRows {
  return { payments: [], shopOrders: [], clientPackages: [], eventSignups: [], memberships: [], ...over } as IncomeSourceRows
}

describe("collectEnrichmentIds", () => {
  it("collects distinct user ids from payments + packages and uuid programIds from metadata", () => {
    const s = sources({
      payments: [
        { user_id: U1, metadata: { programId: PR } },
        { user_id: U1, metadata: { programId: "not-a-uuid" } },
        { user_id: null, metadata: null },
      ] as never,
      clientPackages: [{ client_user_id: U2 }, { client_user_id: null }] as never,
    })
    const ids = collectEnrichmentIds(s)
    expect(ids.userIds.sort()).toEqual([U1, U2].sort())
    expect(ids.programIds).toEqual([PR])
  })
})

describe("fullName", () => {
  it("joins and trims, null on blank or missing", () => {
    expect(fullName({ first_name: "Mila", last_name: "Rukosuev", email: null })).toBe("Mila Rukosuev")
    expect(fullName({ first_name: "  ", last_name: null, email: "x@y.z" })).toBeNull()
    expect(fullName(undefined)).toBeNull()
  })
})

describe("stampIncomeEnrichment", () => {
  it("stamps payer/program/client fields; misses become null; other members untouched", () => {
    const s = sources({
      payments: [{ id: "p1", user_id: U1, metadata: { programId: PR } }, { id: "p2", user_id: null, metadata: {} }] as never,
      clientPackages: [{ id: "c1", client_user_id: U2 }, { id: "c2", client_user_id: null }] as never,
      shopOrders: [{ id: "o1" }] as never,
    })
    const out = stampIncomeEnrichment(
      s,
      new Map([
        [U1, { first_name: "Cannon", last_name: "Kremer", email: "ck@x.com" }],
        [U2, { first_name: "Sandeep", last_name: "Chennadi", email: "sc@x.com" }],
      ]),
      new Map([[PR, "Cannon Baller!"]]),
    )
    expect(out.payments[0]).toMatchObject({ payer_name: "Cannon Kremer", payer_email: "ck@x.com", program_name: "Cannon Baller!" })
    expect(out.payments[1]).toMatchObject({ payer_name: null, payer_email: null, program_name: null })
    expect(out.clientPackages[0]).toMatchObject({ client_name: "Sandeep Chennadi" })
    expect(out.clientPackages[1]).toMatchObject({ client_name: null })
    expect(out.shopOrders).toBe(s.shopOrders)
  })
})
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run __tests__/lib/bookkeeping/income-enrich.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `lib/bookkeeping/income-enrich.ts`:**

```ts
// Pure enrichment stamping for platform-income sources: which users/programs
// to look up, and how the looked-up names fold back onto the rows. Zero IO —
// the DAL fetches, this stamps. Lookup misses stay null (graceful).
import type { IncomeSourceRows } from "./types"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface EnrichmentUser {
  first_name: string | null
  last_name: string | null
  email: string | null
}

export function collectEnrichmentIds(sources: IncomeSourceRows): { userIds: string[]; programIds: string[] } {
  const userIds = new Set<string>()
  const programIds = new Set<string>()
  for (const p of sources.payments) {
    if (p.user_id) userIds.add(p.user_id)
    const pid = (p.metadata as Record<string, unknown> | null)?.programId
    if (typeof pid === "string" && UUID_RE.test(pid)) programIds.add(pid)
  }
  for (const cp of sources.clientPackages) {
    if (cp.client_user_id) userIds.add(cp.client_user_id)
  }
  return { userIds: [...userIds], programIds: [...programIds] }
}

export function fullName(u: EnrichmentUser | undefined): string | null {
  if (!u) return null
  const name = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim()
  return name || null
}

export function stampIncomeEnrichment(
  sources: IncomeSourceRows,
  usersById: Map<string, EnrichmentUser>,
  programNamesById: Map<string, string>,
): IncomeSourceRows {
  return {
    ...sources,
    payments: sources.payments.map((p) => {
      const u = p.user_id ? usersById.get(p.user_id) : undefined
      const pid = (p.metadata as Record<string, unknown> | null)?.programId
      return {
        ...p,
        payer_name: fullName(u),
        payer_email: u?.email ?? null,
        program_name: typeof pid === "string" ? (programNamesById.get(pid) ?? null) : null,
      }
    }),
    clientPackages: sources.clientPackages.map((cp) => ({
      ...cp,
      client_name: fullName(cp.client_user_id ? usersById.get(cp.client_user_id) : undefined),
    })),
  }
}
```

- [ ] **Step 5: Run the test** → PASS.

- [ ] **Step 6: Wire the DAL.** In `lib/db/bookkeeping.ts`: add to imports `import { collectEnrichmentIds, stampIncomeEnrichment, type EnrichmentUser } from "@/lib/bookkeeping/income-enrich"`. Add two private helpers directly above `listPlatformIncome`:

```ts
async function lookupUsers(ids: string[]): Promise<Map<string, EnrichmentUser>> {
  const map = new Map<string, EnrichmentUser>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    try {
      const { data, error } = await db().from("users").select("id, first_name, last_name, email").in("id", chunk)
      if (error) throw error
      for (const u of (data ?? []) as Array<{ id: string } & EnrichmentUser>) map.set(u.id, u)
    } catch (err) {
      console.warn("[bookkeeping] user lookup failed (names omitted):", (err as Error).message)
    }
  }
  return map
}

async function lookupProgramNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    try {
      const { data, error } = await db().from("programs").select("id, name").in("id", chunk)
      if (error) throw error
      for (const p of (data ?? []) as Array<{ id: string; name: string }>) map.set(p.id, p.name)
    } catch (err) {
      console.warn("[bookkeeping] program lookup failed (names omitted):", (err as Error).message)
    }
  }
  return map
}
```

Then in `listPlatformIncome`, capture the currently-returned object literal as `const base: IncomeSourceRows = { … }` (the existing `return { payments, shopOrders, clientPackages: …, eventSignups: …, memberships: … }` block, unchanged) and replace the return with:

```ts
  const { userIds, programIds } = collectEnrichmentIds(base)
  const [usersById, programNamesById] = await Promise.all([lookupUsers(userIds), lookupProgramNames(programIds)])
  return stampIncomeEnrichment(base, usersById, programNamesById)
```

- [ ] **Step 7: Verify** — `npx tsc --noEmit 2>&1 | grep -E "income-enrich|lib/db/bookkeeping|lib\\\\db\\\\bookkeeping"` → no output. `npx vitest run __tests__/lib/bookkeeping/income-enrich.test.ts __tests__/api/admin/bookkeeping/import-platform.test.ts` → PASS (the route test mocks `listPlatformIncome`, unaffected).

- [ ] **Step 8: Commit**

```bash
git add lib/bookkeeping/income-enrich.ts lib/bookkeeping/types.ts lib/db/bookkeeping.ts __tests__/lib/bookkeeping/income-enrich.test.ts
git commit -m "feat(bookkeeper): platform-income enrichment lookups — payer, program, client names"
```

---

### Task 3: Adapter — rich drafts + orphaned-mirror fallback

**Files:**
- Modify: `lib/bookkeeping/income-adapter.ts` (full body below)
- Test: `__tests__/lib/bookkeeping/income-adapter.test.ts` (update pinned memo/counterparty expectations to the Global-Constraints formats; APPEND the new describes below)

**Interfaces:**
- Consumes: widened `IncomeSourceRows` (Task 2). No signature change: `buildIncomeDrafts(input, window?) → { drafts, warnings }`.
- Produces: fallback drafts with `source_ref: payments:<id>`, `service_line` `"session_packs" | "camps"`; the two pinned warning strings.

- [ ] **Step 1: Replace `lib/bookkeeping/income-adapter.ts` with:**

```ts
// lib/bookkeeping/income-adapter.ts
// Pure: unions the platform's money-of-record tables into reviewable ledger
// drafts. Zero IO. Encodes the design's D3 rules (gross amounts, refund-aware,
// honest membership gap) plus two 2026-07-19 upgrades: maximally-detailed
// memos/counterparties (program + athlete + pack product), and the
// orphaned-mirror fallback — a pack/event mirror payment whose source row was
// deleted is counted from the payment itself instead of silently dropped
// (real $340 undercount found in prod-cloned data). Every draft carries a
// stable source_ref so re-running the import never double-posts.

import type { IncomeSourceRows, IncomeAdapterResult, LedgerEntryDraft } from "./types"

const SHOP_REVENUE_STATUSES = new Set([
  "paid", "draft", "confirmed", "in_production", "shipped", "fulfilled_digital",
])
const MEMBERSHIP_ACTIVE = new Set(["active", "trialing", "past_due"])
const ORPHAN_PAIR_WINDOW_DAYS = 7

/** YYYY-MM-DD from an ISO timestamp. */
function isoDate(ts: string): string {
  return ts.slice(0, 10)
}

/** Best-effort service-line tag for a raw Stripe payment. */
function paymentServiceLine(description: string | null, metadata: Record<string, unknown>): string {
  const d = (description ?? "").toLowerCase()
  if (metadata.type === "session_fee") return "other"
  if (metadata.source === "external") return "other"
  if (d.includes("program") || d.includes("week")) return "performance_training"
  return "other"
}

type EnrichedPayment = IncomeSourceRows["payments"][number]

function paymentMemo(p: EnrichedPayment, meta: Record<string, unknown>): string {
  if (p.program_name) {
    const week = meta.weekNumber
    return week != null && week !== ""
      ? `${p.program_name} — week ${week} access`
      : `${p.program_name} — program purchase`
  }
  if (meta.type === "session_fee") return "Session fee"
  return p.description ?? "Platform payment"
}

function paymentCounterparty(p: EnrichedPayment, meta: Record<string, unknown>): string | null {
  const email = typeof meta.customerEmail === "string" ? meta.customerEmail : null
  return p.payer_name ?? email ?? p.payer_email ?? p.description ?? null
}

/** Mutable pairing candidate for the orphaned-mirror check. */
interface MirrorCandidate {
  amount_cents: number
  occurred_on: string
  consumed: boolean
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000))
}

/** Greedy one-to-one pairing: equal cents, ≤7 days; smallest diff wins,
 *  tie → earliest candidate date. Returns true when a candidate was consumed. */
function consumeCandidate(candidates: MirrorCandidate[], amountCents: number, date: string): boolean {
  let best = -1
  let bestDiff = Infinity
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    if (c.consumed || c.amount_cents !== amountCents) continue
    const diff = dayDiff(c.occurred_on, date)
    if (diff > ORPHAN_PAIR_WINDOW_DAYS) continue
    if (diff < bestDiff || (diff === bestDiff && best >= 0 && c.occurred_on < candidates[best].occurred_on)) {
      best = i
      bestDiff = diff
    }
  }
  if (best < 0) return false
  candidates[best].consumed = true
  return true
}

export function buildIncomeDrafts(input: IncomeSourceRows, window?: { from: string; to: string }): IncomeAdapterResult {
  const drafts: LedgerEntryDraft[] = []
  const warnings: string[] = []

  // Source tables FIRST — they are both the richer record and the pairing
  // candidates the mirror check consumes.
  const packCandidates: MirrorCandidate[] = []
  for (const pk of input.clientPackages) {
    if (pk.payment_status !== "paid") continue
    const occurred = isoDate(pk.purchased_at)
    packCandidates.push({ amount_cents: pk.price_cents, occurred_on: occurred, consumed: false })
    const base = pk.product_name ?? pk.session_type ?? "Session pack"
    drafts.push({
      direction: "income",
      amount_cents: pk.price_cents,
      occurred_on: occurred,
      memo: pk.credits_total != null ? `${base} (${pk.credits_total} sessions)` : base,
      counterparty: pk.client_name ?? null,
      service_line: "session_packs",
      source: "platform_import",
      source_ref: `client_packages:${pk.id}`,
    })
  }

  const signupCandidates: MirrorCandidate[] = []
  for (const s of input.eventSignups) {
    if (s.signup_type !== "paid" || s.status !== "confirmed" || s.amount_paid_cents == null) continue
    const occurred = isoDate(s.created_at)
    signupCandidates.push({ amount_cents: s.amount_paid_cents, occurred_on: occurred, consumed: false })
    drafts.push({
      direction: "income",
      amount_cents: s.amount_paid_cents,
      occurred_on: occurred,
      memo: `${s.event_title ?? "Event"} — signup`,
      counterparty: s.parent_name ?? null,
      service_line: "camps",
      source: "platform_import",
      source_ref: `event_signups:${s.id}`,
    })
  }

  let orphanPacks = 0
  let orphanSignups = 0
  for (const p of input.payments) {
    if (p.status === "refunded") {
      warnings.push(`Payment ${p.id} is refunded — skipped (gross income reversed).`)
      continue
    }
    if (p.status !== "succeeded") continue
    const meta = (p.metadata ?? {}) as Record<string, unknown>
    const mirrorType = meta.type
    if (mirrorType === "session_pack" || mirrorType === "event_signup") {
      // Mirror row: normally the source table carries this sale — but when the
      // pack/signup row was deleted, dropping the mirror silently undercounts
      // revenue. Pair one-to-one; unpaired mirrors post from the payment.
      const paired =
        mirrorType === "session_pack"
          ? consumeCandidate(packCandidates, p.amount_cents, isoDate(p.created_at))
          : consumeCandidate(signupCandidates, p.amount_cents, isoDate(p.created_at))
      if (paired) continue
      if (mirrorType === "session_pack") orphanPacks++
      else orphanSignups++
      drafts.push({
        direction: "income",
        amount_cents: p.amount_cents,
        occurred_on: isoDate(p.created_at),
        memo: mirrorType === "session_pack" ? "Session pack (record deleted)" : "Camp/event signup (record deleted)",
        counterparty: paymentCounterparty(p, meta),
        service_line: mirrorType === "session_pack" ? "session_packs" : "camps",
        source: "platform_import",
        source_ref: `payments:${p.id}`,
      })
      continue
    }
    if (!p.user_id && typeof meta.customerEmail !== "string") {
      warnings.push(`Payment ${p.id} has no user and no customer email — counterparty unknown.`)
    }
    drafts.push({
      direction: "income",
      amount_cents: p.amount_cents,
      occurred_on: isoDate(p.created_at),
      memo: paymentMemo(p, meta),
      counterparty: paymentCounterparty(p, meta),
      service_line: paymentServiceLine(p.description, meta),
      source: "platform_import",
      source_ref: `payments:${p.id}`,
    })
  }

  if (orphanPacks > 0) {
    warnings.push(`${orphanPacks} session-pack payment(s) counted directly — the pack records no longer exist.`)
  }
  if (orphanSignups > 0) {
    warnings.push(`${orphanSignups} event-signup payment(s) counted directly — the signup records no longer exist.`)
  }

  for (const o of input.shopOrders) {
    if (!SHOP_REVENUE_STATUSES.has(o.status)) continue
    drafts.push({
      direction: "income",
      amount_cents: o.total_cents,
      occurred_on: isoDate(o.created_at),
      memo: `Shop order ${o.order_number}`,
      counterparty: o.customer_name,
      service_line: "shop",
      source: "platform_import",
      source_ref: `shop_orders:${o.id}`,
    })
  }

  const activeInWindow = input.memberships.filter((m) => MEMBERSHIP_ACTIVE.has(m.status))
  if (activeInWindow.length > 0) {
    const w = window ? ` during ${window.from}…${window.to}` : ""
    warnings.push(
      `${activeInWindow.length} membership(s) were active${w}, but recurring membership revenue is not in the database ` +
      `(it lives in Stripe invoices) — import it via statement/payout ingestion (Phase 6).`,
    )
  }

  drafts.sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : a.occurred_on > b.occurred_on ? 1 : 0))
  return { drafts, warnings }
}
```

Behavioral deltas an existing test may pin (update those expectations, keep everything else): pack memo gains ` (<n> sessions)` suffix and `client_name` counterparty; signup memo `"<title> — signup"` (was bare title); payment counterparty now prefers `payer_name`; payment memo now prefers `program_name` composition; the no-user/no-email warning now checks `meta.customerEmail` (same semantics).

- [ ] **Step 2: Append the new describes** to `__tests__/lib/bookkeeping/income-adapter.test.ts`:

```ts
describe("enriched memos and counterparties (2026-07-19)", () => {
  it("composes program memos and athlete counterparties", () => {
    const { drafts } = buildIncomeDrafts(src({
      payments: [
        pay({ id: P1, amount_cents: 32000, description: "program", metadata: { programId: PRG }, program_name: "Cannon Baller!", payer_name: "Cannon Kremer" }),
        pay({ id: P2, amount_cents: 8000, description: "program week", metadata: { programId: PRG, weekNumber: 3 }, program_name: "Cannon Baller!", payer_name: "Cannon Kremer" }),
        pay({ id: P3, amount_cents: 5000, metadata: { type: "session_fee" }, payer_name: null, payer_email: "sf@x.com" }),
      ],
    }))
    expect(drafts.map((d) => d.memo)).toEqual([
      "Cannon Baller! — program purchase",
      "Cannon Baller! — week 3 access",
      "Session fee",
    ])
    expect(drafts[0].counterparty).toBe("Cannon Kremer")
    expect(drafts[2].counterparty).toBe("sf@x.com")
  })

  it("details pack and signup drafts", () => {
    const { drafts } = buildIncomeDrafts(src({
      clientPackages: [pack({ id: C1, price_cents: 150000, product_name: "1-On-1", credits_total: 10, client_name: "Sandeep Chennadi" })],
      eventSignups: [signup({ id: S1, amount_paid_cents: 8500, event_title: "Summer Speed Camp", parent_name: "A Parent" })],
    }))
    expect(drafts.map((d) => d.memo)).toEqual(["1-On-1 (10 sessions)", "Summer Speed Camp — signup"])
    expect(drafts.map((d) => d.counterparty)).toEqual(["Sandeep Chennadi", "A Parent"])
  })
})

describe("orphaned-mirror fallback (2026-07-19)", () => {
  it("counts the real 4×$85 case: event mirrors with zero signup rows", () => {
    const { drafts, warnings } = buildIncomeDrafts(src({
      payments: [
        mirror({ id: P1, amount_cents: 8500, created_at: "2026-05-04T10:00:00Z", mtype: "event_signup" }),
        mirror({ id: P2, amount_cents: 8500, created_at: "2026-05-09T10:00:00Z", mtype: "event_signup" }),
        mirror({ id: P3, amount_cents: 8500, created_at: "2026-05-09T11:00:00Z", mtype: "event_signup" }),
        mirror({ id: P4, amount_cents: 8500, created_at: "2026-05-14T10:00:00Z", mtype: "event_signup" }),
      ],
    }))
    expect(drafts).toHaveLength(4)
    expect(drafts.every((d) => d.memo === "Camp/event signup (record deleted)" && d.service_line === "camps")).toBe(true)
    expect(drafts.map((d) => d.source_ref).sort()).toEqual([P1, P2, P3, P4].map((id) => `payments:${id}`).sort())
    expect(warnings).toContain("4 event-signup payment(s) counted directly — the signup records no longer exist.")
  })

  it("still skips mirrors whose source rows exist (double-count regression pin)", () => {
    const { drafts, warnings } = buildIncomeDrafts(src({
      payments: [mirror({ id: P1, amount_cents: 150000, created_at: "2026-07-17T10:00:00Z", mtype: "session_pack" })],
      clientPackages: [pack({ id: C1, price_cents: 150000, purchased_at: "2026-07-10T10:00:00Z", product_name: "1-On-1", credits_total: 10 })],
    }))
    expect(drafts).toHaveLength(1)
    expect(drafts[0].source_ref).toBe(`client_packages:${C1}`)
    expect(warnings.some((w) => w.includes("counted directly"))).toBe(false)
  })

  it("pairs one-to-one: two equal mirrors, one candidate → one skip + one fallback", () => {
    const { drafts } = buildIncomeDrafts(src({
      payments: [
        mirror({ id: P1, amount_cents: 20000, created_at: "2026-07-06T10:00:00Z", mtype: "session_pack" }),
        mirror({ id: P2, amount_cents: 20000, created_at: "2026-07-07T10:00:00Z", mtype: "session_pack" }),
      ],
      clientPackages: [pack({ id: C1, price_cents: 20000, purchased_at: "2026-07-06T09:00:00Z", credits_total: 5 })],
    }))
    expect(drafts).toHaveLength(2)
    expect(drafts.map((d) => d.source_ref).sort()).toEqual([`client_packages:${C1}`, `payments:${P2}`].sort())
  })

  it("respects the ±7-day window boundary: 7 pairs, 8 falls back", () => {
    const seven = buildIncomeDrafts(src({
      payments: [mirror({ id: P1, amount_cents: 150000, created_at: "2026-07-17T10:00:00Z", mtype: "session_pack" })],
      clientPackages: [pack({ id: C1, price_cents: 150000, purchased_at: "2026-07-10T10:00:00Z", credits_total: 10 })],
    }))
    expect(seven.drafts).toHaveLength(1)
    const eight = buildIncomeDrafts(src({
      payments: [mirror({ id: P1, amount_cents: 150000, created_at: "2026-07-18T10:00:00Z", mtype: "session_pack" })],
      clientPackages: [pack({ id: C1, price_cents: 150000, purchased_at: "2026-07-10T10:00:00Z", credits_total: 10 })],
    }))
    expect(eight.drafts).toHaveLength(2)
    expect(eight.warnings).toContain("1 session-pack payment(s) counted directly — the pack records no longer exist.")
  })
})
```

Fixture helpers to add at the top of the test file (adapt names only if identical helpers already exist — reuse, don't duplicate):

```ts
const P1 = "aaaaaaa1-0000-4000-8000-000000000001"
const P2 = "aaaaaaa2-0000-4000-8000-000000000002"
const P3 = "aaaaaaa3-0000-4000-8000-000000000003"
const P4 = "aaaaaaa4-0000-4000-8000-000000000004"
const C1 = "ccccccc1-0000-4000-8000-000000000001"
const S1 = "sssssss1-0000-4000-8000-000000000001"
const PRG = "ddddddd1-0000-4000-8000-000000000001"

function src(over: Partial<IncomeSourceRows>): IncomeSourceRows {
  return { payments: [], shopOrders: [], clientPackages: [], eventSignups: [], memberships: [], ...over } as IncomeSourceRows
}
function pay(over: Record<string, unknown>) {
  return { id: P1, status: "succeeded", amount_cents: 1000, created_at: "2026-07-01T10:00:00Z", description: null, metadata: {}, user_id: null, payer_name: null, payer_email: null, program_name: null, ...over }
}
function mirror(over: Record<string, unknown> & { mtype: string }) {
  const { mtype, ...rest } = over
  return pay({ metadata: { type: mtype }, ...rest })
}
function pack(over: Record<string, unknown>) {
  return { id: C1, payment_status: "paid", price_cents: 1000, purchased_at: "2026-07-01T10:00:00Z", session_type: "1-on-1", product_name: null, credits_total: null, client_name: null, ...over }
}
function signup(over: Record<string, unknown>) {
  return { id: S1, signup_type: "paid", status: "confirmed", amount_paid_cents: 1000, created_at: "2026-07-01T10:00:00Z", parent_name: null, event_title: null, ...over }
}
```

- [ ] **Step 3: Run the adapter suite** — `npx vitest run __tests__/lib/bookkeeping/income-adapter.test.ts`. Update any pre-existing expectation that pins the OLD memo/counterparty formats to the Global-Constraints table (that is the only permitted change to existing tests). Expected: ALL PASS.

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit 2>&1 | grep -E "income-adapter"` → no output.

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/income-adapter.ts __tests__/lib/bookkeeping/income-adapter.test.ts
git commit -m "feat(bookkeeper): detailed income drafts + orphaned-mirror fallback (fixes silent undercount)"
```

---

### Task 4: PATCH locked-field guard for imported entries

**Files:**
- Modify: `app/api/admin/bookkeeping/entries/[id]/route.ts` (PATCH only; DELETE untouched)
- Test: `__tests__/api/admin/bookkeeping/entries-imported-lock.test.ts` (new)

**Interfaces:**
- Consumes: `getEntry`, `updateEntry`, `assertAccountInBook` from `@/lib/db/bookkeeping` (existing signatures); `updateEntrySchema`.
- Produces: PATCH behavior — always 404 on missing entry; 422 `{"error":"amount, date and direction are locked on imported entries"}` when `entry.source !== "manual"` and body contains any of `direction`/`amount_cents`/`occurred_on`/`adjusts_period`.

- [ ] **Step 1: Write the failing test** — `__tests__/api/admin/bookkeeping/entries-imported-lock.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
const getEntryMock = vi.fn()
const updateEntryMock = vi.fn()
const assertAccountInBookMock = vi.fn()
vi.mock("@/lib/db/bookkeeping", () => ({
  getEntry: (...a: unknown[]) => getEntryMock(...a),
  updateEntry: (...a: unknown[]) => updateEntryMock(...a),
  deleteEntry: vi.fn(),
  assertAccountInBook: (...a: unknown[]) => assertAccountInBookMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { PATCH } from "@/app/api/admin/bookkeeping/entries/[id]/route"

const ID = "e0000000-0000-4000-8000-000000000001"
const ACC = "a0000000-0000-4000-8000-000000000001"

function req(body: unknown): Request {
  return new Request(`http://x/api/admin/bookkeeping/entries/${ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
const ctx = { params: Promise.resolve({ id: ID }) }

function entry(over: Record<string, unknown> = {}) {
  return { id: ID, book_id: "b1", direction: "income", source: "platform_import", ...over }
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "u1", role: "admin" } })
  getEntryMock.mockReset()
  updateEntryMock.mockReset().mockResolvedValue(entry())
  assertAccountInBookMock.mockReset().mockResolvedValue(undefined)
})

describe("PATCH locked fields on imported entries", () => {
  it.each([
    ["amount_cents", { amount_cents: 5000 }],
    ["occurred_on", { occurred_on: "2026-07-01" }],
    ["direction", { direction: "expense" }],
    ["adjusts_period", { adjusts_period: "2026-06" }],
  ])("422 when %s present on a platform_import entry", async (_name, body) => {
    getEntryMock.mockResolvedValue(entry())
    const res = await PATCH(req(body), ctx)
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe("amount, date and direction are locked on imported entries")
    expect(updateEntryMock).not.toHaveBeenCalled()
  })

  it("allows the editable fields on an imported entry", async () => {
    getEntryMock.mockResolvedValue(entry())
    const res = await PATCH(req({ account_id: ACC, memo: "Cannon Baller! — program purchase", counterparty: "Cannon Kremer", business_purpose: null }), ctx)
    expect(res.status).toBe(200)
    expect(assertAccountInBookMock).toHaveBeenCalledWith(ACC, "b1", "income")
    expect(updateEntryMock).toHaveBeenCalledWith(ID, expect.objectContaining({ account_id: ACC, memo: "Cannon Baller! — program purchase" }))
  })

  it("manual entries keep full editability", async () => {
    getEntryMock.mockResolvedValue(entry({ source: "manual" }))
    const res = await PATCH(req({ amount_cents: 123, occurred_on: "2026-07-02", direction: "expense" }), ctx)
    expect(res.status).toBe(200)
    expect(updateEntryMock).toHaveBeenCalled()
  })

  it("404s on a missing entry even without account_id", async () => {
    getEntryMock.mockResolvedValue(null)
    const res = await PATCH(req({ memo: "x" }), ctx)
    expect(res.status).toBe(404)
    expect(updateEntryMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run __tests__/api/admin/bookkeeping/entries-imported-lock.test.ts` → FAIL (imported entries currently update, no 422; missing entry without account_id currently reaches `updateEntry`).

- [ ] **Step 3: Rewrite the PATCH handler** in `app/api/admin/bookkeeping/entries/[id]/route.ts` (imports and DELETE unchanged):

```ts
const LOCKED_IMPORT_FIELDS = ["direction", "amount_cents", "occurred_on", "adjusts_period"] as const

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const { id } = await ctx.params
    const body = await request.json().catch(() => null)
    const parsed = updateEntrySchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })
    const existing = await getEntry(id)
    if (!existing) return NextResponse.json({ error: "entry not found" }, { status: 404 })
    if (existing.source !== "manual") {
      const locked = LOCKED_IMPORT_FIELDS.filter((f) => f in parsed.data && parsed.data[f] !== undefined)
      if (locked.length > 0) {
        return NextResponse.json({ error: "amount, date and direction are locked on imported entries" }, { status: 422 })
      }
    }
    if (parsed.data.account_id) {
      const effectiveDirection = parsed.data.direction ?? existing.direction
      try {
        await assertAccountInBook(parsed.data.account_id, existing.book_id, effectiveDirection)
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === "ACCOUNT_NOT_FOUND") return NextResponse.json({ error: "account not found" }, { status: 404 })
        if (code === "WRONG_BOOK" || code === "WRONG_TYPE") return NextResponse.json({ error: (e as Error).message }, { status: 409 })
        throw e
      }
    }
    const entry = await updateEntry(id, parsed.data)
    void recordAudit({ action: "bookkeeping.entry_updated", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_entry", id }, request })
    return NextResponse.json({ entry })
  } catch (error) {
    if ((error as { code?: string }).code === "PERIOD_CLOSED") {
      return NextResponse.json({ error: PERIOD_CLOSED_MESSAGE }, { status: 409 })
    }
    console.error("Update bookkeeping entry error:", error)
    return NextResponse.json({ error: "Failed to update entry" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run the new test + the existing entries suites** — `npx vitest run __tests__/api/admin/bookkeeping/entries-imported-lock.test.ts __tests__/api/admin/bookkeeping/entries.test.ts __tests__/api/admin/bookkeeping/entries-guards.test.ts`. If an existing test PATCHes without stubbing `getEntry` (now always called), stub it to return a `source:"manual"` entry for that case — the ONLY permitted change to existing tests. Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/bookkeeping/entries/[id]/route.ts __tests__/api/admin/bookkeeping/entries-imported-lock.test.ts __tests__/api/admin/bookkeeping/entries.test.ts __tests__/api/admin/bookkeeping/entries-guards.test.ts
git commit -m "feat(bookkeeper): lock money fields on imported entries at the API; always 404 missing"
```

---

### Task 5: UI — Edit action for imported rows + locked dialog variant

**Files:**
- Modify: `components/admin/bookkeeping/LedgerTable.tsx:171-192`
- Modify: `components/admin/bookkeeping/ManualEntryDialog.tsx`
- Test: `__tests__/components/ledger-table-actions.test.tsx` (new), `__tests__/components/manual-entry-dialog-locked.test.tsx` (new)

**Interfaces:**
- Consumes: `LedgerTable` props `{rows, accounts, onChanged, onEdit}`; `ManualEntryDialog` props `{bookId, accounts, entry?, open, onOpenChange, onSaved, closedPeriods?}` — both UNCHANGED.
- Produces: Edit button on every row (Delete stays manual-only); locked dialog variant when `entry.source !== "manual"` that PATCHes ONLY `{account_id, memo, counterparty, business_purpose}`.

- [ ] **Step 1: Write the failing tests.**

`__tests__/components/ledger-table-actions.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { LedgerTable } from "@/components/admin/bookkeeping/LedgerTable"
import type { BookkeepingLedgerEntry } from "@/types/database"

function row(over: Partial<BookkeepingLedgerEntry>): BookkeepingLedgerEntry {
  return {
    id: "e1", book_id: "b1", account_id: null, direction: "income", amount_cents: 32000,
    occurred_on: "2026-07-01", memo: "Cannon Baller! — program purchase", counterparty: "Cannon Kremer",
    business_purpose: null, source: "platform_import", source_ref: "payments:p1", import_batch_id: null,
    document_id: null, adjusts_period: null, currency: "usd",
    created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z",
    ...over,
  } as BookkeepingLedgerEntry
}

describe("LedgerTable actions", () => {
  it("shows Edit on imported rows but Delete only on manual rows", () => {
    render(
      <LedgerTable
        rows={[row({ id: "imp", source: "platform_import" }), row({ id: "man", source: "manual" })]}
        accounts={[]}
        onChanged={() => {}}
        onEdit={() => {}}
      />,
    )
    expect(screen.getAllByTitle(/edit/i)).toHaveLength(2)
    expect(screen.getAllByTitle("Delete entry")).toHaveLength(1)
  })

  it("routes the imported row through onEdit", () => {
    const onEdit = vi.fn()
    render(<LedgerTable rows={[row({ id: "imp" })]} accounts={[]} onChanged={() => {}} onEdit={onEdit} />)
    screen.getByTitle("Edit imported entry").click()
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "imp" }))
  })
})
```

`__tests__/components/manual-entry-dialog-locked.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ManualEntryDialog } from "@/components/admin/bookkeeping/ManualEntryDialog"
import type { BookkeepingAccount, BookkeepingLedgerEntry } from "@/types/database"

const accounts = [
  { id: "acc1", name: "Performance Training — Stripe", account_type: "income" },
] as BookkeepingAccount[]

const imported = {
  id: "e1", book_id: "b1", account_id: null, direction: "income", amount_cents: 32000,
  occurred_on: "2026-07-01", memo: "old memo", counterparty: "old cp", business_purpose: null,
  source: "platform_import", adjusts_period: null,
} as BookkeepingLedgerEntry

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ entry: {} }) })
  vi.stubGlobal("fetch", fetchMock)
})

describe("ManualEntryDialog locked (imported) mode", () => {
  it("locks money fields, titles as imported, and shows the lock caption", () => {
    render(<ManualEntryDialog bookId="b1" accounts={accounts} entry={imported} open onOpenChange={() => {}} onSaved={() => {}} />)
    expect(screen.getByText("Edit imported entry")).toBeInTheDocument()
    expect(screen.getByLabelText(/amount/i)).toBeDisabled()
    expect(screen.getByLabelText(/date/i)).toBeDisabled()
    expect(screen.getByRole("button", { name: "Income" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Expense" })).toBeDisabled()
    expect(screen.getByText(/locked — imported from platform records/i)).toBeInTheDocument()
  })

  it("PATCHes ONLY the four editable keys in locked mode", async () => {
    render(<ManualEntryDialog bookId="b1" accounts={accounts} entry={imported} open onOpenChange={() => {}} onSaved={() => {}} />)
    fireEvent.change(screen.getByLabelText(/memo/i), { target: { value: "new memo" } })
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("/api/admin/bookkeeping/entries/e1")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(Object.keys(body).sort()).toEqual(["account_id", "business_purpose", "counterparty", "memo"])
    expect(body.memo).toBe("new memo")
  })

  it("manual entries keep the full form enabled", () => {
    render(<ManualEntryDialog bookId="b1" accounts={accounts} entry={{ ...imported, source: "manual" } as BookkeepingLedgerEntry} open onOpenChange={() => {}} onSaved={() => {}} />)
    expect(screen.getByText("Edit entry")).toBeInTheDocument()
    expect(screen.getByLabelText(/amount/i)).toBeEnabled()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run __tests__/components/ledger-table-actions.test.tsx __tests__/components/manual-entry-dialog-locked.test.tsx` → FAIL (Edit absent on imported; no locked mode).

- [ ] **Step 3: LedgerTable.** Replace lines ~171-192 (the `row.source === "manual" && (…Edit+Delete…)` block) with:

```tsx
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onEdit(row)}
                  disabled={busyId === row.id}
                  title={row.source === "manual" ? "Edit entry" : "Edit imported entry"}
                >
                  <Pencil className="size-3.5" />
                </Button>
                {row.source === "manual" && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(row.id)}
                    disabled={busyId === row.id}
                    title="Delete entry"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
```

- [ ] **Step 4: ManualEntryDialog locked variant.** In `components/admin/bookkeeping/ManualEntryDialog.tsx`:
  1. After `const isEdit = Boolean(entry)` add: `const locked = isEdit && entry!.source !== "manual"`.
  2. Title: `{locked ? "Edit imported entry" : isEdit ? "Edit entry" : "Add entry"}`.
  3. Add `disabled={locked}` to: both direction `<Button>`s, the amount `<Input>`, the date `<Input>`, and the adjusts-period `<Select>` (prop on `Select` itself: `disabled={locked}`).
  4. Directly under the amount/date grid add:

```tsx
          {locked && (
            <p className="text-xs text-muted-foreground">
              Amount, date and direction are locked — imported from platform records.
            </p>
          )}
```

  5. In `submit()`, build the body conditionally (validation block unchanged — the prefilled amount passes it):

```ts
      const body = locked
        ? {
            account_id: form.accountId || null,
            memo: form.memo.trim() || null,
            counterparty: form.counterparty.trim() || null,
            business_purpose: form.businessPurpose.trim() || null,
          }
        : {
            book_id: bookId,
            account_id: form.accountId || null,
            direction: form.direction,
            amount_cents: cents,
            occurred_on: form.occurredOn,
            memo: form.memo.trim() || null,
            counterparty: form.counterparty.trim() || null,
            business_purpose: form.businessPurpose.trim() || null,
            adjusts_period: form.adjustsPeriod || null,
          }
```

- [ ] **Step 5: Run the tests** — same command as Step 2. Expected: ALL PASS. Then `npx tsc --noEmit 2>&1 | grep -E "LedgerTable|ManualEntryDialog"` → no output.

- [ ] **Step 6: Commit**

```bash
git add components/admin/bookkeeping/LedgerTable.tsx components/admin/bookkeeping/ManualEntryDialog.tsx __tests__/components/ledger-table-actions.test.tsx __tests__/components/manual-entry-dialog-locked.test.tsx
git commit -m "feat(bookkeeper): imported ledger rows editable — safe fields only, money fields locked"
```

---

### Task 6: Whole-feature verification gate

**Files:** none — verification only. Heavy commands run SEQUENTIALLY, in the FOREGROUND, generous timeouts (600000ms) — never two heavy background jobs at once (2026-07-19 lesson: concurrent test:run + tsc crashed the vitest fork pool).

- [ ] **Step 1: Scoped suite** — `npx vitest run __tests__/lib/bookkeeping/account-match.test.ts __tests__/lib/bookkeeping/income-enrich.test.ts __tests__/lib/bookkeeping/income-adapter.test.ts __tests__/api/admin/bookkeeping/entries-imported-lock.test.ts __tests__/api/admin/bookkeeping/entries.test.ts __tests__/api/admin/bookkeeping/entries-guards.test.ts __tests__/api/admin/bookkeeping/import-platform.test.ts __tests__/components/ledger-table-actions.test.tsx __tests__/components/manual-entry-dialog-locked.test.tsx` → ALL PASS.
- [ ] **Step 2: Full suite** — `npm run test:run` (foreground, 600000ms timeout). Baseline 3162/3162 green → expect a higher total, zero failures. A failure outside the touched files: re-run that file alone before calling it a regression.
- [ ] **Step 3: Typecheck** — `npx tsc --noEmit`; pre-existing `Request`/`NextRequest` errors in old test files are documented baseline — REQUIRED: zero errors referencing the nine files this feature touched.
- [ ] **Step 4: Build** — `npm run build` (own command, foreground). Expect exit 0, `/admin/books` in route output.
- [ ] **Step 5:** `git status --short` — confirm only pre-existing untracked/modified files remain unstaged; commit any gate fixes with `git add <specific files>` + `git commit -m "fix(bookkeeper): detailed-import verification fixes"`.

---

## Self-Review (completed at plan time)

1. **Spec coverage:** §3.1 lookups → Task 2; §3.2 memo/counterparty table → Task 3 (+ Global Constraints verbatim); §3.3 tie-break → Task 1; §4 pairing/fallback/warnings → Task 3; §5 LedgerTable/dialog/PATCH → Tasks 4-5; §7 testing rows → Tasks 1-5 tests + Task 6 gate. No gaps.
2. **Placeholder scan:** clean — complete code in every code step; the only "update existing expectations" steps enumerate the exact permitted change and pin the new values in Global Constraints.
3. **Type consistency:** `matchAccountForServiceLine` (T1) used by T1's dialog swap only; widened `IncomeSourceRows` fields (T2: `payer_name/payer_email/program_name/client_name`) consumed by T3's `EnrichedPayment`/pack memo; `EnrichmentUser` shared T2 lib↔DAL; PATCH locked list matches spec §5 and T5's locked body (complement sets); component props unchanged everywhere.
