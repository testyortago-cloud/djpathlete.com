# Session Pack Auto-Renew Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a session pack runs out, charge the client's saved card for a replacement pack automatically; fall back to today's manual payment link when that isn't possible.

**Architecture:** A new `lib/services/pack-renewal.ts` mirrors the proven `lib/services/session-fees.ts` off-session charge path — reserve an attempt row (unique index = the lock), resolve the household payer, charge the saved card with a stable idempotency key, then either clone the pack as paid or leave it pending with a payment link. It is triggered fire-and-forget from the check-in that depletes a pack, with a cron sweep as safety net. Separately, pack checkout starts attaching a Stripe `customer` with `setup_future_usage` so cards begin accumulating at all.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase Postgres (service-role DAL), Stripe Node SDK, Vitest + Testing Library, Firebase `onSchedule` crons.

**Spec:** `docs/superpowers/specs/2026-08-14-pack-auto-renew-design.md` — read it first; this plan argues from it.

## Global Constraints

- **Feature flag `pack_auto_renew_enabled`, default `false`.** Checked at the top of every charge path. Nothing renews until it is on.
- **Never double-charge.** `unique (source_package_id)` on `pack_renewal_attempts` plus a pack-stable Stripe idempotency key `pack_renew_${packId}`.
- **A renewal failure must never fail a check-in.** All renewal calls from the check-in path are fire-and-forget and swallowed.
- **Stripe `customer` and `customer_email` are mutually exclusive.** An explicit `billToEmail` keeps `customer_email` and saves no card; otherwise resolve the payer via `resolveBillingUserId` and attach a `customer`.
- **Never save a card against a user who does not own it.** Account-less payers get no saved card.
- **Migrations:** next number is **00207**. Do not apply to prod and do not push — pushing to `main` auto-applies migrations.
- **Tables:** every new list UI uses `components/ui/data-table.tsx`. Never hand-roll a `<table>`.
- **Colors/fonts:** semantic Tailwind classes only (`text-muted-foreground`, `bg-surface`), never hex, never inline `fontFamily`.
- **Testing:** targeted runs only — `npx vitest run <path>`. No full-suite runs. `npm run build` is the separate compilation gate.
- **Staging:** `git add` explicit paths only. The working tree is permanently dirty and contains a bank CSV; `git add -A` is forbidden.

---

### Task 1: Migration, types, and audit slugs

**Files:**
- Create: `supabase/migrations/00207_pack_auto_renew.sql`
- Modify: `types/database.ts` (near `ClientPackage`, line ~2893, and `SessionFeeCharge`, line ~3039)
- Modify: `lib/audit/actions.ts` (pack block, line ~245)

**Interfaces:**
- Consumes: nothing.
- Produces: `PackRenewalAttempt` interface, `PackRenewalStatus` type, three new `ClientPackage` fields (`auto_renew: boolean`, `renewed_from_package_id: string | null`, `renewal_attempted_at: string | null`), audit slugs `pack.auto_renewed`, `pack.auto_renew_failed`, `pack.auto_renew_enabled`, `pack.auto_renew_disabled`.

- [ ] **Step 1: Write the migration**

```sql
-- 00207_pack_auto_renew.sql — automatic pack renewal against a saved card
-- NOTE: written but NOT applied to the live DB until approved.
-- auto_renew lives on the PACK because the consent captured is "when THIS pack
-- runs out, buy another". A renewal pack inherits the flag from its source.
-- The unique (source_package_id) below is the double-charge guard: the insert
-- IS the lock, exactly as unique (scheduled_session_id, kind) is for 00178.

alter table public.client_packages
  add column if not exists auto_renew boolean not null default false,
  add column if not exists renewed_from_package_id uuid references public.client_packages(id) on delete set null,
  add column if not exists renewal_attempted_at timestamptz;

create table if not exists public.pack_renewal_attempts (
  id uuid primary key default gen_random_uuid(),
  source_package_id uuid not null references public.client_packages(id) on delete cascade,
  new_package_id uuid references public.client_packages(id) on delete set null,
  user_id uuid not null references public.users(id) on delete cascade,
  billing_user_id uuid not null references public.users(id) on delete cascade,
  amount_cents int not null check (amount_cents >= 0),
  status text not null default 'pending'
    check (status in ('pending','succeeded','failed','skipped')),
  stripe_payment_intent_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  unique (source_package_id)
);

create index if not exists idx_pack_renewal_attempts_user
  on public.pack_renewal_attempts(user_id, status);
create index if not exists idx_client_packages_auto_renew
  on public.client_packages(status, auto_renew) where auto_renew = true;

alter table public.pack_renewal_attempts enable row level security;
-- No client read policy, matching session_fee_charges: renewals are coach-managed
-- and the client sees the charge on their statement and in the receipt email.
```

- [ ] **Step 2: Add the types**

In `types/database.ts`, add the three fields to `ClientPackage`:

```typescript
  /** When true, depleting this pack triggers an auto-charge for a clone of it. */
  auto_renew: boolean
  renewed_from_package_id: string | null
  renewal_attempted_at: string | null
```

And after `SessionFeeCharge`:

```typescript
// ─── Pack auto-renew (00207) ─────────────────────────────────────────────────

export type PackRenewalStatus = "pending" | "succeeded" | "failed" | "skipped"

export interface PackRenewalAttempt {
  id: string
  source_package_id: string
  new_package_id: string | null
  /** The trainee whose pack ran out. */
  user_id: string
  /** Whose card was actually charged — the household payer, or the trainee. */
  billing_user_id: string
  amount_cents: number
  status: PackRenewalStatus
  stripe_payment_intent_id: string | null
  failure_reason: string | null
  created_at: string
}
```

- [ ] **Step 3: Add the audit slugs**

In `lib/audit/actions.ts`, after the `pack.marked_paid` entry:

```typescript
  { slug: "pack.auto_renewed", category: "commerce", description: "Pack auto-renewed against a saved card" },
  { slug: "pack.auto_renew_failed", category: "commerce", description: "Pack auto-renewal charge failed" },
  { slug: "pack.auto_renew_enabled", category: "commerce", description: "Auto-renew turned on for a pack" },
  { slug: "pack.auto_renew_disabled", category: "commerce", description: "Auto-renew turned off for a pack" },
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit`
Expected: PASS. If `ClientPackage` is constructed anywhere without the new fields, TypeScript will point at each site — fix those by adding `auto_renew: false, renewed_from_package_id: null, renewal_attempted_at: null`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00207_pack_auto_renew.sql types/database.ts lib/audit/actions.ts
git commit -m "feat(packs): the shape of a renewal that charges itself"
```

---

### Task 2: Attempts DAL and the feature flag

**Files:**
- Create: `lib/db/pack-renewal-attempts.ts`
- Modify: `lib/packs/flags.ts`
- Test: `__tests__/lib/db/pack-renewal-attempts.test.ts`

**Interfaces:**
- Consumes: `PackRenewalAttempt`, `PackRenewalStatus` from Task 1.
- Produces: `createRenewalAttemptIfAbsent(a): Promise<PackRenewalAttempt | null>`, `updateRenewalAttempt(id, patch): Promise<PackRenewalAttempt>`, `getAttemptForPackage(sourcePackageId): Promise<PackRenewalAttempt | null>`, `listRenewalAttempts(limit?): Promise<PackRenewalAttempt[]>`, `packAutoRenewEnabled(): Promise<boolean>`, `PACK_AUTO_RENEW_KEY`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const upsert = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: () => ({ upsert, select: vi.fn(), update: vi.fn() }) }),
}))

describe("createRenewalAttemptIfAbsent", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns null when an attempt already exists for the pack", async () => {
    // ignoreDuplicates means PostgREST returns no row on conflict
    upsert.mockReturnValue({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
    const { createRenewalAttemptIfAbsent } = await import("@/lib/db/pack-renewal-attempts")
    const result = await createRenewalAttemptIfAbsent({
      source_package_id: "pack-1",
      new_package_id: null,
      user_id: "u1",
      billing_user_id: "u1",
      amount_cents: 75000,
      status: "pending",
      stripe_payment_intent_id: null,
      failure_reason: null,
    })
    expect(result).toBeNull()
    expect(upsert).toHaveBeenCalledWith(expect.anything(), {
      onConflict: "source_package_id",
      ignoreDuplicates: true,
    })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run __tests__/lib/db/pack-renewal-attempts.test.ts`
Expected: FAIL — cannot resolve `@/lib/db/pack-renewal-attempts`.

- [ ] **Step 3: Write the DAL**

`lib/db/pack-renewal-attempts.ts`, modelled directly on `lib/db/session-fee-charges.ts`:

```typescript
import { createServiceRoleClient } from "@/lib/supabase"
import type { PackRenewalAttempt } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

/**
 * Insert a renewal attempt, relying on the unique source_package_id index for
 * idempotency. Returns null when an attempt already exists for this pack — the
 * caller MUST treat null as "someone else is handling it" and stop, because the
 * insert is the only thing standing between a race and a double charge.
 */
export async function createRenewalAttemptIfAbsent(a: Omit<PackRenewalAttempt, "id" | "created_at">) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("pack_renewal_attempts")
    .upsert(a, { onConflict: "source_package_id", ignoreDuplicates: true })
    .select()
    .maybeSingle()
  if (error) throw error
  return data as PackRenewalAttempt | null
}

export async function updateRenewalAttempt(id: string, patch: Partial<PackRenewalAttempt>) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("pack_renewal_attempts")
    .update(patch)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as PackRenewalAttempt
}

export async function getAttemptForPackage(sourcePackageId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("pack_renewal_attempts")
    .select("*")
    .eq("source_package_id", sourcePackageId)
    .maybeSingle()
  if (error) throw error
  return data as PackRenewalAttempt | null
}

export async function listRenewalAttempts(limit = 100) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("pack_renewal_attempts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as PackRenewalAttempt[]
}
```

- [ ] **Step 4: Add the flag**

In `lib/packs/flags.ts`, after the fee policy block:

```typescript
// ── Pack auto-renew (DB-backed, default OFF — it moves real money) ────────────
export const PACK_AUTO_RENEW_KEY = "pack_auto_renew_enabled"
export const packAutoRenewEnabled = () => getSetting<boolean>(PACK_AUTO_RENEW_KEY, false)
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `npx vitest run __tests__/lib/db/pack-renewal-attempts.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/pack-renewal-attempts.ts lib/packs/flags.ts __tests__/lib/db/pack-renewal-attempts.test.ts
git commit -m "feat(packs): a ledger for renewal attempts, and the switch that arms them"
```

---

### Task 3: Pure renewal decision logic

**Files:**
- Create: `lib/services/pack-renewal-rules.ts`
- Test: `__tests__/lib/services/pack-renewal-rules.test.ts`

**Interfaces:**
- Consumes: `ClientPackage` from Task 1.
- Produces: `shouldAttemptRenewal(pkg, flagEnabled): RenewalDecision` where `type RenewalDecision = { attempt: true } | { attempt: false; reason: "disabled" | "not_armed" | "not_depleted" | "zero_price" | "expired" }`, and `buildRenewalPack(source, opts): Omit<ClientPackage, "id" | "created_at" | "updated_at">`.

This task is pure functions with no mocks, so the tests can genuinely fail for the right reason.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest"
import { shouldAttemptRenewal, buildRenewalPack } from "@/lib/services/pack-renewal-rules"
import type { ClientPackage } from "@/types/database"

const pack = (over: Partial<ClientPackage> = {}): ClientPackage =>
  ({
    id: "pack-1", client_user_id: "u1", product_id: "prod-1", assignment_id: null,
    session_type: "training", credits_total: 10, credits_used: 10, price_cents: 75000,
    payment_method: "stripe", payment_status: "paid", stripe_session_id: null,
    stripe_payment_id: null, purchased_at: "2026-07-01T00:00:00Z", expires_at: null,
    status: "depleted", last_reminded_threshold: null, notes: null, bill_to_email: null,
    bill_to_emailed_at: null, created_by: null, created_at: "", updated_at: "",
    auto_renew: true, renewed_from_package_id: null, renewal_attempted_at: null,
    ...over,
  }) as ClientPackage

describe("shouldAttemptRenewal", () => {
  it("attempts when armed, depleted, priced and the flag is on", () => {
    expect(shouldAttemptRenewal(pack(), true)).toEqual({ attempt: true })
  })

  it("refuses when the flag is off, even for a perfectly eligible pack", () => {
    expect(shouldAttemptRenewal(pack(), false)).toEqual({ attempt: false, reason: "disabled" })
  })

  it("refuses an unarmed pack", () => {
    expect(shouldAttemptRenewal(pack({ auto_renew: false }), true)).toEqual({
      attempt: false, reason: "not_armed",
    })
  })

  it("refuses while credits remain", () => {
    expect(shouldAttemptRenewal(pack({ credits_used: 9 }), true)).toEqual({
      attempt: false, reason: "not_depleted",
    })
  })

  it("refuses a zero-price pack so a comp pack never bills anyone", () => {
    expect(shouldAttemptRenewal(pack({ price_cents: 0 }), true)).toEqual({
      attempt: false, reason: "zero_price",
    })
  })

  it("refuses an expired pack — expiry is a reason to stop, not to rebuy", () => {
    expect(shouldAttemptRenewal(pack({ status: "expired" }), true)).toEqual({
      attempt: false, reason: "expired",
    })
  })
})

describe("buildRenewalPack", () => {
  it("clones the commercial terms and carries auto_renew forward", () => {
    const next = buildRenewalPack(pack(), { paid: true, now: new Date("2026-08-14T00:00:00Z") })
    expect(next.credits_total).toBe(10)
    expect(next.credits_used).toBe(0)
    expect(next.price_cents).toBe(75000)
    expect(next.session_type).toBe("training")
    expect(next.status).toBe("active")
    expect(next.payment_status).toBe("paid")
    expect(next.auto_renew).toBe(true)
    expect(next.renewed_from_package_id).toBe("pack-1")
  })

  it("marks the clone pending when the charge did not succeed", () => {
    const next = buildRenewalPack(pack(), { paid: false, now: new Date("2026-08-14T00:00:00Z") })
    expect(next.payment_status).toBe("pending")
    expect(next.status).toBe("active")
  })

  it("does not copy the source's stripe ids onto the clone", () => {
    const next = buildRenewalPack(
      pack({ stripe_session_id: "cs_old", stripe_payment_id: "pi_old" }),
      { paid: true, now: new Date("2026-08-14T00:00:00Z") },
    )
    expect(next.stripe_session_id).toBeNull()
    expect(next.stripe_payment_id).toBeNull()
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run __tests__/lib/services/pack-renewal-rules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import type { ClientPackage } from "@/types/database"
import { remainingCredits } from "@/lib/services/session-credits"

export type RenewalDecision =
  | { attempt: true }
  | { attempt: false; reason: "disabled" | "not_armed" | "not_depleted" | "zero_price" | "expired" }

/**
 * Pure gate for "should this pack buy itself again". Ordered cheapest-first so
 * the reason returned is the most fundamental one. Expiry loses to nothing:
 * a pack that ran out of TIME rather than credits is a reason to stop, not to
 * charge someone for another one.
 */
export function shouldAttemptRenewal(pkg: ClientPackage, flagEnabled: boolean): RenewalDecision {
  if (!flagEnabled) return { attempt: false, reason: "disabled" }
  if (!pkg.auto_renew) return { attempt: false, reason: "not_armed" }
  if (pkg.status === "expired") return { attempt: false, reason: "expired" }
  if (remainingCredits(pkg) > 0) return { attempt: false, reason: "not_depleted" }
  if (pkg.price_cents <= 0) return { attempt: false, reason: "zero_price" }
  return { attempt: true }
}

/**
 * The renewal buys a clone of what ran out — same session type, credits and
 * price. Stripe ids are deliberately NOT copied: they identify the old payment,
 * and carrying them over would make getPackageByStripePaymentId return the wrong
 * pack.
 */
export function buildRenewalPack(
  source: ClientPackage,
  opts: { paid: boolean; now: Date },
): Omit<ClientPackage, "id" | "created_at" | "updated_at"> {
  return {
    client_user_id: source.client_user_id,
    product_id: source.product_id,
    assignment_id: null, // a renewal is not automatically tied to the old program
    session_type: source.session_type,
    credits_total: source.credits_total,
    credits_used: 0,
    price_cents: source.price_cents,
    payment_method: "stripe",
    payment_status: opts.paid ? "paid" : "pending",
    stripe_session_id: null,
    stripe_payment_id: null,
    purchased_at: opts.now.toISOString(),
    expires_at: null,
    status: "active",
    last_reminded_threshold: null,
    notes: null,
    bill_to_email: source.bill_to_email,
    bill_to_emailed_at: null,
    created_by: null,
    auto_renew: source.auto_renew,
    renewed_from_package_id: source.id,
    renewal_attempted_at: null,
  }
}
```

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run __tests__/lib/services/pack-renewal-rules.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pack-renewal-rules.ts __tests__/lib/services/pack-renewal-rules.test.ts
git commit -m "feat(packs): decide, without side effects, whether a pack should rebuy itself"
```

---

### Task 4: The charge path

**Files:**
- Create: `lib/services/pack-renewal.ts`
- Test: `__tests__/lib/services/pack-renewal.test.ts`

**Interfaces:**
- Consumes: Task 2 DAL + flag, Task 3 rules, plus existing `resolveBillingUserId`, `getDefaultPaymentMethod`, `chargeSavedCard`, `createClientPackage`, `createPayment`, `recordAudit`, `resolvePackPaymentLink`.
- Produces: `attemptPackRenewal(pkg: ClientPackage): Promise<RenewalOutcome>` where `type RenewalOutcome = { renewed: boolean; reason?: string; newPackageId?: string }`.

Read `lib/services/session-fees.ts:56-136` before starting. This function is deliberately its sibling.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const chargeSavedCard = vi.fn()
const createRenewalAttemptIfAbsent = vi.fn()
const updateRenewalAttempt = vi.fn()
const createClientPackage = vi.fn()
const createPayment = vi.fn()
const recordAudit = vi.fn()
const getDefaultPaymentMethod = vi.fn()
const resolveBillingUserId = vi.fn()
const getUserById = vi.fn()
const resolvePackPaymentLink = vi.fn()
const sendPackPaymentLinkEmail = vi.fn()
const sendPackRenewedEmail = vi.fn()
const createNotification = vi.fn()
const getUsers = vi.fn()
const packAutoRenewEnabled = vi.fn()

vi.mock("@/lib/stripe", () => ({ chargeSavedCard }))
vi.mock("@/lib/db/pack-renewal-attempts", () => ({ createRenewalAttemptIfAbsent, updateRenewalAttempt }))
vi.mock("@/lib/db/client-packages", () => ({ createClientPackage, updateClientPackage: vi.fn() }))
vi.mock("@/lib/db/payments", () => ({ createPayment }))
vi.mock("@/lib/audit/record", () => ({ recordAudit }))
vi.mock("@/lib/db/payment-methods", () => ({ getDefaultPaymentMethod }))
vi.mock("@/lib/services/billing-payer", () => ({ resolveBillingUserId }))
vi.mock("@/lib/db/users", () => ({ getUserById, getUsers }))
vi.mock("@/lib/services/pack-payment-link", () => ({ resolvePackPaymentLink }))
vi.mock("@/lib/email", () => ({ sendPackPaymentLinkEmail, sendPackRenewedEmail }))
vi.mock("@/lib/db/notifications", () => ({ createNotification }))
vi.mock("@/lib/packs/flags", () => ({ packAutoRenewEnabled }))

const pack = (over = {}) => ({
  id: "pack-1", client_user_id: "u1", product_id: "prod-1", assignment_id: null,
  session_type: "training", credits_total: 10, credits_used: 10, price_cents: 75000,
  payment_method: "stripe", payment_status: "paid", stripe_session_id: null,
  stripe_payment_id: null, purchased_at: "", expires_at: null, status: "depleted",
  last_reminded_threshold: null, notes: null, bill_to_email: null, bill_to_emailed_at: null,
  created_by: null, created_at: "", updated_at: "",
  auto_renew: true, renewed_from_package_id: null, renewal_attempted_at: null,
  ...over,
})

describe("attemptPackRenewal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    packAutoRenewEnabled.mockResolvedValue(true)
    createRenewalAttemptIfAbsent.mockResolvedValue({ id: "att-1" })
    resolveBillingUserId.mockResolvedValue("payer-1")
    getUserById.mockResolvedValue({
      id: "payer-1", email: "payer@x.com", first_name: "Pat", stripe_customer_id: "cus_1",
    })
    getDefaultPaymentMethod.mockResolvedValue({ stripe_payment_method_id: "pm_1" })
    createClientPackage.mockResolvedValue({ id: "pack-2" })
    getUsers.mockResolvedValue([])
    resolvePackPaymentLink.mockResolvedValue({ ok: true, url: "https://pay", refreshed: false })
  })

  it("charges the saved card and creates a paid clone", async () => {
    chargeSavedCard.mockResolvedValue({ ok: true, paymentIntentId: "pi_1" })
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out.renewed).toBe(true)
    expect(chargeSavedCard).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "cus_1",
        paymentMethodId: "pm_1",
        amountCents: 75000,
        idempotencyKey: "pack_renew_pack-1",
      }),
    )
    expect(createClientPackage).toHaveBeenCalledWith(
      expect.objectContaining({ payment_status: "paid", credits_used: 0, renewed_from_package_id: "pack-1" }),
    )
    expect(updateRenewalAttempt).toHaveBeenCalledWith(
      "att-1",
      expect.objectContaining({ status: "succeeded", stripe_payment_intent_id: "pi_1", new_package_id: "pack-2" }),
    )
    expect(createPayment).toHaveBeenCalled()
  })

  it("stops without charging when an attempt row already exists", async () => {
    createRenewalAttemptIfAbsent.mockResolvedValue(null)
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out).toEqual({ renewed: false, reason: "already_attempted" })
    expect(chargeSavedCard).not.toHaveBeenCalled()
  })

  it("skips — not fails — when there is no saved card, and sends a link instead", async () => {
    getDefaultPaymentMethod.mockResolvedValue(null)
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out).toEqual({ renewed: false, reason: "no_card", newPackageId: "pack-2" })
    expect(chargeSavedCard).not.toHaveBeenCalled()
    expect(updateRenewalAttempt).toHaveBeenCalledWith("att-1", expect.objectContaining({ status: "skipped" }))
    expect(createClientPackage).toHaveBeenCalledWith(expect.objectContaining({ payment_status: "pending" }))
    expect(sendPackPaymentLinkEmail).toHaveBeenCalled()
  })

  it("falls back to a pending pack and a payment link on decline", async () => {
    chargeSavedCard.mockResolvedValue({ ok: false, reason: "declined", message: "card_declined" })
    getUsers.mockResolvedValue([{ id: "admin-1", role: "admin" }])
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out.renewed).toBe(false)
    expect(out.reason).toBe("declined")
    expect(updateRenewalAttempt).toHaveBeenCalledWith(
      "att-1",
      expect.objectContaining({ status: "failed", failure_reason: "card_declined" }),
    )
    expect(createClientPackage).toHaveBeenCalledWith(expect.objectContaining({ payment_status: "pending" }))
    expect(sendPackPaymentLinkEmail).toHaveBeenCalled()
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ user_id: "admin-1" }))
  })

  it("charges the household payer's card but records the trainee as the user", async () => {
    chargeSavedCard.mockResolvedValue({ ok: true, paymentIntentId: "pi_1" })
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    await attemptPackRenewal(pack() as never)

    expect(getDefaultPaymentMethod).toHaveBeenCalledWith("payer-1")
    expect(createRenewalAttemptIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", billing_user_id: "payer-1" }),
    )
  })

  it("does not charge when the flag is off", async () => {
    packAutoRenewEnabled.mockResolvedValue(false)
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out).toEqual({ renewed: false, reason: "disabled" })
    expect(createRenewalAttemptIfAbsent).not.toHaveBeenCalled()
    expect(chargeSavedCard).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run __tests__/lib/services/pack-renewal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/services/pack-renewal.ts`**

```typescript
// Automatic pack renewal. REAL MONEY — every path is guarded so a charge only
// fires when pack_auto_renew_enabled AND the pack is armed AND depleted AND
// priced AND the payer has a saved card. The unique (source_package_id) index
// plus a pack-stable Stripe idempotency key make double-charging impossible.
//
// Sibling of lib/services/session-fees.ts — read that first; the shape is
// deliberately the same so a reader of one can read the other.
import type { ClientPackage } from "@/types/database"
import { packAutoRenewEnabled } from "@/lib/packs/flags"
import { shouldAttemptRenewal, buildRenewalPack } from "@/lib/services/pack-renewal-rules"
import { createRenewalAttemptIfAbsent, updateRenewalAttempt } from "@/lib/db/pack-renewal-attempts"
import { createClientPackage } from "@/lib/db/client-packages"
import { resolveBillingUserId } from "@/lib/services/billing-payer"
import { getDefaultPaymentMethod } from "@/lib/db/payment-methods"
import { getUserById, getUsers } from "@/lib/db/users"
import { chargeSavedCard } from "@/lib/stripe"
import { createPayment } from "@/lib/db/payments"
import { recordAudit } from "@/lib/audit/record"
import { resolvePackPaymentLink } from "@/lib/services/pack-payment-link"
import { sendPackPaymentLinkEmail, sendPackRenewedEmail } from "@/lib/email"
import { createNotification } from "@/lib/db/notifications"

export type RenewalOutcome = { renewed: boolean; reason?: string; newPackageId?: string }

/** Create the replacement pack as pending and put a payment link in the payer's
 *  inbox. This is the shared fallback for "no card" and "declined" — both land
 *  the client exactly where today's manual flow does. */
async function fallbackToPaymentLink(
  source: ClientPackage,
  now: Date,
  payer: { email: string; first_name: string | null } | null,
  clientName: string,
): Promise<string | undefined> {
  const pending = await createClientPackage(buildRenewalPack(source, { paid: false, now }))
  try {
    const link = await resolvePackPaymentLink(pending)
    if (link.ok && payer?.email) {
      await sendPackPaymentLinkEmail({
        to: payer.email,
        ccClientEmail: null,
        clientName,
        packLabel: `${pending.credits_total}× ${pending.session_type}`,
        amountCents: pending.price_cents,
        url: link.url,
      })
    }
  } catch (err) {
    console.error("[pack-renewal] payment-link fallback failed:", err)
  }
  return pending.id
}

/** Best-effort in-app alert to every admin that a renewal needs a human. */
async function notifyAdmins(title: string, message: string): Promise<void> {
  try {
    const admins = (await getUsers()).filter((u) => u.role === "admin")
    for (const admin of admins) {
      await createNotification({
        user_id: admin.id,
        title,
        message,
        type: "warning",
        is_read: false,
        link: "/admin/clients",
      })
    }
  } catch (err) {
    console.error("[pack-renewal] admin notification failed:", err)
  }
}

export async function attemptPackRenewal(pkg: ClientPackage, now = new Date()): Promise<RenewalOutcome> {
  const decision = shouldAttemptRenewal(pkg, await packAutoRenewEnabled())
  if (!decision.attempt) return { renewed: false, reason: decision.reason }

  // Household billing: the money comes from the resolved payer's card, but the
  // attempt records against the trainee whose pack ran out.
  const billingUserId = await resolveBillingUserId(pkg.client_user_id)

  // Reserve first. null means another trigger already claimed this pack.
  const attempt = await createRenewalAttemptIfAbsent({
    source_package_id: pkg.id,
    new_package_id: null,
    user_id: pkg.client_user_id,
    billing_user_id: billingUserId,
    amount_cents: pkg.price_cents,
    status: "pending",
    stripe_payment_intent_id: null,
    failure_reason: null,
  })
  if (!attempt) return { renewed: false, reason: "already_attempted" }

  const [payer, trainee, card] = await Promise.all([
    getUserById(billingUserId).catch(() => null),
    getUserById(pkg.client_user_id).catch(() => null),
    getDefaultPaymentMethod(billingUserId).catch(() => null),
  ])
  const clientName =
    `${trainee?.first_name ?? ""} ${trainee?.last_name ?? ""}`.trim() || "your athlete"

  if (!payer?.stripe_customer_id || !card) {
    await updateRenewalAttempt(attempt.id, { status: "skipped", failure_reason: "no_card" })
    const newPackageId = await fallbackToPaymentLink(pkg, now, payer, clientName)
    if (newPackageId) await updateRenewalAttempt(attempt.id, { new_package_id: newPackageId })
    await notifyAdmins(
      "Pack renewal needs payment",
      `${clientName}'s pack ran out and there's no card on file — a payment link was sent instead.`,
    )
    return { renewed: false, reason: "no_card", newPackageId }
  }

  const label = `${pkg.credits_total}× ${pkg.session_type} (auto-renewal)`
  const result = await chargeSavedCard({
    customerId: payer.stripe_customer_id,
    paymentMethodId: card.stripe_payment_method_id,
    amountCents: pkg.price_cents,
    description: label,
    idempotencyKey: `pack_renew_${pkg.id}`,
  })

  if (!result.ok) {
    await updateRenewalAttempt(attempt.id, { status: "failed", failure_reason: result.message })
    const newPackageId = await fallbackToPaymentLink(pkg, now, payer, clientName)
    if (newPackageId) await updateRenewalAttempt(attempt.id, { new_package_id: newPackageId })
    void recordAudit({
      action: "pack.auto_renew_failed",
      category: "commerce",
      outcome: "failure",
      target: { type: "client_package", id: pkg.id, label: pkg.session_type },
      metadata: { reason: result.reason, amount_cents: pkg.price_cents, client_user_id: pkg.client_user_id },
    })
    await notifyAdmins(
      "Pack renewal charge failed",
      `${clientName}'s card was declined — a payment link was sent instead.`,
    )
    return { renewed: false, reason: result.reason, newPackageId }
  }

  const created = await createClientPackage(buildRenewalPack(pkg, { paid: true, now }))
  await updateRenewalAttempt(attempt.id, {
    status: "succeeded",
    stripe_payment_intent_id: result.paymentIntentId,
    new_package_id: created.id,
  })

  await createPayment({
    user_id: billingUserId,
    stripe_payment_id: result.paymentIntentId,
    stripe_customer_id: payer.stripe_customer_id,
    amount_cents: pkg.price_cents,
    currency: "usd",
    status: "succeeded",
    description: label,
    // type distinguishes this from the mirror row a manual pack checkout writes,
    // so bookkeeping can tell them apart and not double-count.
    metadata: {
      type: "pack_auto_renewal",
      source_package_id: pkg.id,
      new_package_id: created.id,
      trainee_user_id: pkg.client_user_id,
    },
    gclid: null, gbraid: null, wbraid: null, fbclid: null,
  }).catch(() => {})

  void recordAudit({
    action: "pack.auto_renewed",
    category: "commerce",
    outcome: "success",
    target: { type: "client_package", id: created.id, label: pkg.session_type },
    metadata: { source_package_id: pkg.id, amount_cents: pkg.price_cents, client_user_id: pkg.client_user_id },
  })

  try {
    if (payer.email) {
      await sendPackRenewedEmail({
        to: payer.email,
        ccClientEmail: trainee?.email && trainee.email !== payer.email ? trainee.email : null,
        firstName: payer.first_name ?? "there",
        clientName,
        packLabel: `${pkg.credits_total}× ${pkg.session_type}`,
        amountCents: pkg.price_cents,
      })
    }
  } catch (err) {
    // A receipt failure must never affect the money path.
    console.error("[pack-renewal] receipt email failed:", err)
  }

  return { renewed: true, newPackageId: created.id }
}
```

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run __tests__/lib/services/pack-renewal.test.ts`
Expected: PASS, 6 tests. `sendPackRenewedEmail` does not exist yet — Task 8 adds it; the mock satisfies the import until then. If the import fails at runtime, add a stub export to `lib/email.ts` now and fill it in at Task 8.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pack-renewal.ts __tests__/lib/services/pack-renewal.test.ts
git commit -m "feat(packs): charge the card on file, and fail into the manual flow"
```

---

### Task 5: Triggers — inline on depletion, and the cron sweep

**Files:**
- Modify: `lib/services/session-credits.ts` (after the check-in row is created, ~line 188)
- Modify: `app/api/admin/internal/pack-renewals/route.ts`
- Modify: `lib/db/client-packages.ts` (add `listDepletedAutoRenewPackages`)
- Test: `__tests__/lib/services/checkin-triggers-renewal.test.ts`

**Interfaces:**
- Consumes: `attemptPackRenewal` from Task 4.
- Produces: `listDepletedAutoRenewPackages(): Promise<ClientPackage[]>`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const attemptPackRenewal = vi.fn()
vi.mock("@/lib/services/pack-renewal", () => ({ attemptPackRenewal }))
// ...plus the existing checkInClient mocks from __tests__/lib/services/session-credits.test.ts

describe("check-in triggers renewal", () => {
  beforeEach(() => vi.clearAllMocks())

  it("attempts renewal when the check-in depletes the pack", async () => {
    // arrange: pack with 1 credit left, CAS succeeds, status becomes "depleted"
    attemptPackRenewal.mockResolvedValue({ renewed: true })
    const { checkInClient } = await import("@/lib/services/session-credits")
    const result = await checkInClient({
      clientUserId: "u1", method: "coach_tap", createdBy: null, now: new Date(),
    })
    expect(result.ok).toBe(true)
    expect(attemptPackRenewal).toHaveBeenCalled()
  })

  it("does not attempt renewal when credits remain", async () => {
    // arrange: pack with 5 credits left
    const { checkInClient } = await import("@/lib/services/session-credits")
    await checkInClient({ clientUserId: "u1", method: "coach_tap", createdBy: null, now: new Date() })
    expect(attemptPackRenewal).not.toHaveBeenCalled()
  })

  it("still returns ok when renewal throws — attendance is the primary record", async () => {
    attemptPackRenewal.mockRejectedValue(new Error("stripe exploded"))
    const { checkInClient } = await import("@/lib/services/session-credits")
    const result = await checkInClient({
      clientUserId: "u1", method: "coach_tap", createdBy: null, now: new Date(),
    })
    expect(result.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run __tests__/lib/services/checkin-triggers-renewal.test.ts`
Expected: FAIL — `attemptPackRenewal` not called.

- [ ] **Step 3: Wire the inline trigger**

In `lib/services/session-credits.ts`, after the check-in row is created and after the program-advance block, before returning:

```typescript
    // The pack just ran out. Kick off the renewal charge WITHOUT awaiting it:
    // the check-in has already succeeded, and Stripe latency must never sit in
    // the door-open path. A renewal failure can never fail a check-in.
    if (status === "depleted") {
      void attemptPackRenewal({ ...swapped }, input.now).catch((err) => {
        console.error("[session-credits] auto-renewal failed:", err)
      })
    }
```

Add the import at the top:

```typescript
import { attemptPackRenewal } from "@/lib/services/pack-renewal"
```

- [ ] **Step 4: Add the sweeper query**

In `lib/db/client-packages.ts`:

```typescript
/** Depleted packs that are armed for auto-renew — the cron safety net's input.
 *  Left-joins the attempts table so packs already handled are excluded in SQL
 *  rather than one round-trip per pack. */
export async function listDepletedAutoRenewPackages() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_packages")
    .select("*, pack_renewal_attempts!pack_renewal_attempts_source_package_id_fkey(id)")
    .eq("status", "depleted")
    .eq("auto_renew", true)
  if (error) throw error
  return (data as (ClientPackage & { pack_renewal_attempts: { id: string }[] })[])
    .filter((p) => (p.pack_renewal_attempts?.length ?? 0) === 0)
    .map(({ pack_renewal_attempts: _ignored, ...pkg }) => pkg as ClientPackage)
}
```

- [ ] **Step 5: Wire the cron sweep**

In `app/api/admin/internal/pack-renewals/route.ts`, after the reminder loop and before the coach summary:

```typescript
  // Safety net for the inline trigger in checkInClient: a serverless instance
  // can die before its fire-and-forget renewal lands. Both paths race the same
  // unique (source_package_id) index, so the duplicate simply loses.
  let renewed = 0
  let renewalsFailed = 0
  try {
    const depleted = await listDepletedAutoRenewPackages()
    for (const pkg of depleted) {
      const outcome = await attemptPackRenewal(pkg, now)
      if (outcome.renewed) renewed += 1
      else if (outcome.reason !== "disabled" && outcome.reason !== "already_attempted") renewalsFailed += 1
    }
  } catch (err) {
    console.error("[pack-renewals] auto-renew sweep failed:", err)
  }
```

Add `renewed` and `renewalsFailed` to the JSON response, and the two imports.

- [ ] **Step 6: Run tests and confirm they pass**

Run: `npx vitest run __tests__/lib/services/checkin-triggers-renewal.test.ts __tests__/api/internal/pack-renewals.test.ts`
Expected: PASS. The existing pack-renewals suite must still pass — the sweep is additive and no-ops when the flag is off.

- [ ] **Step 7: Commit**

```bash
git add lib/services/session-credits.ts lib/db/client-packages.ts app/api/admin/internal/pack-renewals/route.ts __tests__/lib/services/checkin-triggers-renewal.test.ts
git commit -m "feat(packs): renew on the check-in that empties the pack, and sweep for the ones that got away"
```

---

### Task 6: Card capture at checkout

**Files:**
- Modify: `lib/stripe.ts:402-480` (`createPackCheckoutSession`)
- Modify: `app/api/stripe/webhook/route.ts` (`handleSessionPackCheckout`)
- Test: `__tests__/lib/stripe/pack-checkout-card-capture.test.ts`

**Interfaces:**
- Consumes: `getOrCreateStripeCustomer(userId, email)` (existing, `lib/stripe.ts:143`).
- Produces: `createPackCheckoutSession` gains an `autoRenew?: boolean` option.

⚠️ **Highest-risk task in the plan.** Read `lib/stripe.ts:435-461` — the comment block explaining why `customer_email` exists — before changing anything. Getting this wrong reintroduces a fixed bug where a parent's payment page showed the athlete's email and the receipt went to the wrong inbox.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const create = vi.fn()
const getOrCreateStripeCustomer = vi.fn()
const resolveBillingUserId = vi.fn()
const getUserById = vi.fn()

vi.mock("stripe", () => ({
  default: class { checkout = { sessions: { create } }; customers = { create: vi.fn() } },
}))
vi.mock("@/lib/services/billing-payer", () => ({ resolveBillingUserId }))
vi.mock("@/lib/db/users", () => ({ getUserById, updateUser: vi.fn() }))

describe("createPackCheckoutSession card capture", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    create.mockResolvedValue({ id: "cs_1", url: "https://pay" })
    resolveBillingUserId.mockResolvedValue("payer-1")
    getUserById.mockResolvedValue({ id: "payer-1", email: "payer@x.com", stripe_customer_id: "cus_payer" })
  })

  it("attaches the PAYER's customer and asks Stripe to save the card", async () => {
    const { createPackCheckoutSession } = await import("@/lib/stripe")
    await createPackCheckoutSession({
      clientUserId: "u1", name: "10x training", sessionType: "training",
      credits: 10, priceCents: 75000, validityDays: null, productId: null, autoRenew: true,
    })
    const arg = create.mock.calls[0][0]
    expect(arg.customer).toBe("cus_payer")
    expect(arg.customer_email).toBeUndefined()
    expect(arg.payment_intent_data.setup_future_usage).toBe("off_session")
    expect(arg.metadata.autoRenew).toBe("true")
  })

  it("keeps customer_email and saves NO card for an account-less payer", async () => {
    const { createPackCheckoutSession } = await import("@/lib/stripe")
    await createPackCheckoutSession({
      clientUserId: "u1", name: "10x training", sessionType: "training",
      credits: 10, priceCents: 75000, validityDays: null, productId: null,
      billToEmail: "parent@x.com",
    })
    const arg = create.mock.calls[0][0]
    expect(arg.customer_email).toBe("parent@x.com")
    expect(arg.customer).toBeUndefined()
    expect(arg.payment_intent_data?.setup_future_usage).toBeUndefined()
  })

  it("never sends customer and customer_email together", async () => {
    const { createPackCheckoutSession } = await import("@/lib/stripe")
    await createPackCheckoutSession({
      clientUserId: "u1", name: "x", sessionType: "training",
      credits: 10, priceCents: 75000, validityDays: null, productId: null,
    })
    const arg = create.mock.calls[0][0]
    expect(Boolean(arg.customer) && Boolean(arg.customer_email)).toBe(false)
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run __tests__/lib/stripe/pack-checkout-card-capture.test.ts`
Expected: FAIL — `customer` is undefined, `customer_email` is set.

- [ ] **Step 3: Implement the branch**

Replace the addressee block in `createPackCheckoutSession`:

```typescript
  // Addressee + card capture.
  //
  // Stripe rejects `customer` and `customer_email` together, so this is a
  // branch, not a merge:
  //
  //   explicit billToEmail  → customer_email, NO card saved. The payer has no
  //                           users row, and saving their card against the
  //                           trainee's user_id would assert a card belongs to
  //                           someone who does not own it — which
  //                           getDefaultPaymentMethod would then charge for
  //                           unrelated fees.
  //   otherwise             → resolve the household payer (or the client) and
  //                           attach their customer, with setup_future_usage so
  //                           the card is reusable for auto-renewal.
  //
  // Do not collapse this back into customer_email-for-everyone: that pinning
  // exists because a parent once opened a link and found the athlete's email
  // locked in, sending the receipt to the wrong inbox.
  let customerEmail: string | undefined
  let customerId: string | undefined
  if (opts.billToEmail) {
    customerEmail = opts.billToEmail
  } else {
    try {
      const billingUserId = await resolveBillingUserId(opts.clientUserId)
      const payer = await getUserById(billingUserId)
      if (payer?.email) customerId = await getOrCreateStripeCustomer(billingUserId, payer.email)
    } catch {
      // Non-fatal — checkout still works, just without a saved card.
    }
  }

  return stripe.checkout.sessions.create({
    mode: "payment",
    line_items,
    ...(customerId ? { customer: customerId } : {}),
    ...(customerEmail ? { customer_email: customerEmail } : {}),
    ...(customerId ? { payment_intent_data: { setup_future_usage: "off_session" as const } } : {}),
    metadata: {
      type: "session_pack",
      clientUserId: opts.clientUserId,
      productId: opts.productId ?? "",
      credits: String(opts.credits),
      autoRenew: opts.autoRenew ? "true" : "false",
      // ...existing metadata unchanged
    },
    // ...existing success_url / cancel_url unchanged
  })
```

Add `autoRenew?: boolean` to the options type.

- [ ] **Step 4: Save the card in the webhook**

In `handleSessionPackCheckout` (`app/api/stripe/webhook/route.ts`), after the pack is created:

```typescript
  // Persist the card the client just used so auto-renewal has something to
  // charge. Best-effort: a pack must never fail to be created because the card
  // could not be stored.
  if (session.setup_intent || session.payment_intent) {
    try {
      const pi = await resolveSessionPaymentIntent(session)
      const pmId = typeof pi?.payment_method === "string" ? pi.payment_method : pi?.payment_method?.id
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id
      if (pmId && customerId) {
        const pm = await stripe.paymentMethods.retrieve(pmId)
        await upsertDefaultPaymentMethod({
          user_id: billingUserId,
          stripe_payment_method_id: pmId,
          brand: pm.card?.brand ?? null,
          last4: pm.card?.last4 ?? null,
          exp_month: pm.card?.exp_month ?? null,
          exp_year: pm.card?.exp_year ?? null,
          is_default: true,
        })
      }
    } catch (err) {
      console.error("[webhook] could not save pack card:", err)
    }
  }
```

And set `auto_renew: session.metadata?.autoRenew === "true"` on the created pack.

- [ ] **Step 5: Run tests and confirm they pass**

Run: `npx vitest run __tests__/lib/stripe/pack-checkout-card-capture.test.ts __tests__/api/session-packs/checkout.test.ts`
Expected: PASS. The existing checkout suite is the regression guard for payer precedence — if it fails, the addressee branch is wrong.

- [ ] **Step 6: Commit**

```bash
git add lib/stripe.ts app/api/stripe/webhook/route.ts __tests__/lib/stripe/pack-checkout-card-capture.test.ts
git commit -m "feat(packs): a pack purchase finally leaves a card behind"
```

---

### Task 7: Arm and disarm endpoints

**Files:**
- Create: `app/api/admin/session-packs/[id]/auto-renew/route.ts`
- Create: `app/api/client/session-packs/[id]/auto-renew/route.ts`
- Test: `__tests__/api/session-packs/auto-renew.test.ts`

**Interfaces:**
- Consumes: `updateClientPackage`, `getClientPackageByIdMaybe`, `canAccessAdminPath`, `recordAudit`.
- Produces: `PATCH` on both routes, body `{ autoRenew: boolean }`, response `{ ok: true, autoRenew: boolean }`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("client auto-renew route", () => {
  it("refuses to touch a pack belonging to someone else", async () => {
    auth.mockResolvedValue({ user: { id: "u2", role: "client" } })
    getClientPackageByIdMaybe.mockResolvedValue({ id: "pack-1", client_user_id: "u1" })
    const { PATCH } = await import("@/app/api/client/session-packs/[id]/auto-renew/route")
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ autoRenew: false }) }),
      { params: Promise.resolve({ id: "pack-1" }) },
    )
    expect(res.status).toBe(403)
    expect(updateClientPackage).not.toHaveBeenCalled()
  })

  it("lets a client disarm their own pack", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "client" } })
    getClientPackageByIdMaybe.mockResolvedValue({ id: "pack-1", client_user_id: "u1" })
    const { PATCH } = await import("@/app/api/client/session-packs/[id]/auto-renew/route")
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ autoRenew: false }) }),
      { params: Promise.resolve({ id: "pack-1" }) },
    )
    expect(res.status).toBe(200)
    expect(updateClientPackage).toHaveBeenCalledWith("pack-1", { auto_renew: false })
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run __tests__/api/session-packs/auto-renew.test.ts`
Expected: FAIL — routes do not exist.

- [ ] **Step 3: Implement both routes**

Admin route follows the `bill-to` route's shape (`canAccessAdminPath` guard, `recordAudit`). Client route guards on ownership:

```typescript
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const pack = await getClientPackageByIdMaybe(id)
    if (!pack) return NextResponse.json({ error: "Pack not found" }, { status: 404 })
    // Ownership, not role: a client may only ever disarm their OWN pack.
    if (pack.client_user_id !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
```

Both call `updateClientPackage(id, { auto_renew })` and record
`pack.auto_renew_enabled` / `pack.auto_renew_disabled`.

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run __tests__/api/session-packs/auto-renew.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/admin/session-packs/[id]/auto-renew/route.ts" "app/api/client/session-packs/[id]/auto-renew/route.ts" __tests__/api/session-packs/auto-renew.test.ts
git commit -m "feat(packs): two ways to arm auto-renew, one way to stop it"
```

---

### Task 8: Emails

**Files:**
- Modify: `lib/email.ts`
- Create: `components/emails/PackRenewedEmail.tsx`
- Test: `__tests__/lib/email/pack-renewed.test.ts`

**Interfaces:**
- Produces: `sendPackRenewedEmail({ to, ccClientEmail, firstName, clientName, packLabel, amountCents })`.

Note: `components/emails/*` is the documented exception to the no-inline-styles rule — HTML email needs them.

- [ ] **Step 1: Write the failing test**

```typescript
it("names the amount charged and how to stop future renewals", async () => {
  const { renderPackRenewedEmail } = await import("@/components/emails/PackRenewedEmail")
  const html = renderPackRenewedEmail({
    firstName: "Pat", clientName: "Sirisha", packLabel: "10× training", amountCents: 75000,
  })
  expect(html).toContain("$750.00")
  expect(html).toContain("Sirisha")
  expect(html).toMatch(/turn off|cancel|stop/i)
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run __tests__/lib/email/pack-renewed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the template and sender**

Follow the existing `sendPackPaymentLinkEmail` shape in `lib/email.ts`. The body must state the amount charged, what it bought, that it was automatic, and how to turn it off — a receipt that does not explain itself is how a surprise charge becomes a chargeback.

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run __tests__/lib/email/pack-renewed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email.ts components/emails/PackRenewedEmail.tsx __tests__/lib/email/pack-renewed.test.ts
git commit -m "feat(packs): a receipt that explains why money moved"
```

---

### Task 9: UI surfaces

**Files:**
- Modify: `components/admin/packs/SellPackDialog.tsx`
- Modify: `components/admin/packs/ClientPackagesPanel.tsx`
- Modify: `components/client/MyCardPanel.tsx`
- Test: `__tests__/components/admin/packs/SellPackDialog.auto-renew.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
it("leaves auto-renew unchecked by default and names the amount in the label", () => {
  render(<SellPackDialog {...props} />)
  const box = screen.getByRole("checkbox", { name: /automatically buy another/i })
  expect(box).not.toBeChecked()
  expect(screen.getByText(/\$750/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run __tests__/components/admin/packs/SellPackDialog.auto-renew.test.tsx`
Expected: FAIL — no such checkbox.

- [ ] **Step 3: Implement**

- `SellPackDialog`: checkbox, default unchecked, label naming credits and price, posted as `autoRenew` to the checkout route.
- `ClientPackagesPanel`: per-pack auto-renew toggle + a `DataTable` of recent attempts (status as `DataTableBadge` — `success` / `danger` / `neutral`).
- `MyCardPanel`: auto-renew state line and an off switch calling the client route.

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run __tests__/components/admin/packs/SellPackDialog.auto-renew.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full compilation gate**

Run: `npm run build > build.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`. Never pipe the build to `tail` — the pipe reports tail's exit code, not the build's.

- [ ] **Step 6: Commit**

```bash
git add components/admin/packs/SellPackDialog.tsx components/admin/packs/ClientPackagesPanel.tsx components/client/MyCardPanel.tsx __tests__/components/admin/packs/SellPackDialog.auto-renew.test.tsx
git commit -m "feat(packs): say plainly what auto-renew will do, and how to stop it"
```

---

## Self-Review

**Spec coverage:** data model → T1; DAL + flag → T2; pure rules → T3; charge path incl. decline/no-card/household payer → T4; inline + cron triggers → T5; card capture + customer trap + account-less payer → T6; arm/disarm endpoints → T7; receipt email → T8; UI surfaces → T9. The add-card email campaign is deliberately excluded — it is a send, not code, and sending is the coach's call.

**Type consistency:** `attemptPackRenewal(pkg, now?)` is called with two args in T5 and defined with an optional second in T4 ✓. `buildRenewalPack(source, { paid, now })` consistent T3/T4 ✓. `createRenewalAttemptIfAbsent` returns `PackRenewalAttempt | null` and every caller treats null as stop ✓. `RenewalOutcome.reason` values (`disabled`, `not_armed`, `not_depleted`, `zero_price`, `expired`, `already_attempted`, `no_card`, `declined`, `error`) — the cron sweep in T5 filters on `disabled` and `already_attempted`, both of which exist ✓.

**Known gap, deliberate:** `sendPackRenewedEmail` is imported in T4 but implemented in T8. T4's tests mock it. If tasks run strictly in order, add a stub export at T4 and fill it at T8 — noted in T4 Step 4.
