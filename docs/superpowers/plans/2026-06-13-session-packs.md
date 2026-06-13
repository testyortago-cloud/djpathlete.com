# Session Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In-person session-pack tracking inside DJP Athlete — clients buy a pack (Stripe/cash/comp), credits deduct on check-in (QR self-serve or coach one-tap), low-balance + expiry reminders nudge client and coach.

**Architecture:** New tables (`session_pack_products`, `client_packages`, `session_checkins`) with a pure credit-math service as the single source of truth; thin DALs; coach API routes + a Stripe-webhook extension for purchases; a public token-gated check-in surface; a daily reminder cron reusing the `onSchedule`→internal-API pattern. Reuses existing `users`, `payments`, `notifications`, `audit_logs`, `system_settings`, Stripe, Resend.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase (service-role DAL), Zod, NextAuth v5, Stripe, Resend, Vitest, Firebase `onSchedule`.

**Conventions to follow (read before starting):**
- DAL files: service-role client, `getClient()` helper, cast results — see [lib/db/notifications.ts](../../../lib/db/notifications.ts).
- Stripe checkout + metadata routing — see [lib/stripe.ts](../../../lib/stripe.ts) and [app/api/stripe/webhook/route.ts](../../../app/api/stripe/webhook/route.ts) (`session.metadata?.type` switch, idempotency via `getPaymentByStripeId`).
- Feature-flag cron gate — `isCronSkipped` in [lib/db/system-settings.ts](../../../lib/db/system-settings.ts).
- Audit — `recordAudit` / `withAudit`, slugs in [lib/audit/actions.ts](../../../lib/audit/actions.ts).
- Migration not applied to live DB until user approves (mirror `00168_workout_sessions`).
- Commit locally on `main`. **No push, no deploy, no `apply_migration`.**

---

## Task 1: Migration + database types

**Files:**
- Create: `supabase/migrations/00170_session_packs.sql`
- Modify: `types/database.ts` (append Session Packs types)

- [ ] **Step 1: Write the migration SQL**

```sql
-- 00170_session_packs.sql — in-person session-pack credit tracking
-- NOTE: written but NOT applied to the live DB until approved.

-- Catalogue of sellable packs
create table if not exists session_pack_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  session_type text not null,
  credits int not null check (credits > 0),
  price_cents int not null check (price_cents >= 0),
  validity_days int check (validity_days is null or validity_days > 0),
  stripe_price_id text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Purchased balance hanging off a client
create table if not exists client_packages (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references users(id) on delete cascade,
  product_id uuid references session_pack_products(id) on delete set null,
  session_type text not null,
  credits_total int not null check (credits_total > 0),
  credits_used int not null default 0 check (credits_used >= 0),
  price_cents int not null check (price_cents >= 0),
  payment_method text not null default 'stripe',   -- stripe | cash | comp
  payment_status text not null default 'pending',  -- pending | paid | not_required | refunded
  stripe_session_id text,
  stripe_payment_id text,
  purchased_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'active',            -- active | depleted | expired | refunded | cancelled
  last_reminded_threshold text,                     -- low | empty | expiring
  notes text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_client_packages_client on client_packages(client_user_id, status);
create index if not exists idx_client_packages_status_expiry on client_packages(status, expires_at);

-- Append-only attendance ledger
create table if not exists session_checkins (
  id uuid primary key default gen_random_uuid(),
  client_package_id uuid not null references client_packages(id) on delete cascade,
  client_user_id uuid not null references users(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  session_date date not null default current_date,
  method text not null default 'coach_tap',         -- qr_self | coach_tap | manual
  credit_delta int not null default -1,
  voided boolean not null default false,
  voided_reason text,
  voided_by uuid references users(id) on delete set null,
  voided_at timestamptz,
  calendar_event_id text,
  created_by uuid references users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_session_checkins_package on session_checkins(client_package_id) where voided = false;
create index if not exists idx_session_checkins_client on session_checkins(client_user_id, checked_in_at desc);

-- updated_at triggers (project uses a shared set_updated_at trigger fn from 00012)
create trigger trg_session_pack_products_updated before update on session_pack_products
  for each row execute function set_updated_at();
create trigger trg_client_packages_updated before update on client_packages
  for each row execute function set_updated_at();
```

> Verify the trigger function name in `00012_create_updated_at_trigger.sql` before finalising; if it differs, match it.

- [ ] **Step 2: Append types to `types/database.ts`**

```ts
// ─── Session Packs ───────────────────────────────────────────────────────────
export type PackPaymentMethod = "stripe" | "cash" | "comp"
export type PackPaymentStatus = "pending" | "paid" | "not_required" | "refunded"
export type ClientPackageStatus = "active" | "depleted" | "expired" | "refunded" | "cancelled"
export type CheckinMethod = "qr_self" | "coach_tap" | "manual"
export type PackReminderThreshold = "low" | "empty" | "expiring"

export interface SessionPackProduct {
  id: string
  name: string
  session_type: string
  credits: number
  price_cents: number
  validity_days: number | null
  stripe_price_id: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ClientPackage {
  id: string
  client_user_id: string
  product_id: string | null
  session_type: string
  credits_total: number
  credits_used: number
  price_cents: number
  payment_method: PackPaymentMethod
  payment_status: PackPaymentStatus
  stripe_session_id: string | null
  stripe_payment_id: string | null
  purchased_at: string
  expires_at: string | null
  status: ClientPackageStatus
  last_reminded_threshold: PackReminderThreshold | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SessionCheckin {
  id: string
  client_package_id: string
  client_user_id: string
  checked_in_at: string
  session_date: string
  method: CheckinMethod
  credit_delta: number
  voided: boolean
  voided_reason: string | null
  voided_by: string | null
  voided_at: string | null
  calendar_event_id: string | null
  created_by: string | null
  notes: string | null
  created_at: string
}
```

- [ ] **Step 3: Type-check** — Run: `npx tsc --noEmit` → expect no NEW errors referencing these types.
- [ ] **Step 4: Commit** — `git add supabase/migrations/00170_session_packs.sql types/database.ts && git commit -m "feat(packs): migration + types for session packs"`

---

## Task 2: Zod validators

**Files:**
- Create: `lib/validators/session-packs.ts`
- Test: `__tests__/lib/validators/session-packs.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest"
import { sellPackSchema, checkinSchema, packProductSchema } from "@/lib/validators/session-packs"

describe("sellPackSchema", () => {
  it("accepts a catalogue purchase", () => {
    expect(sellPackSchema.safeParse({ clientUserId: crypto.randomUUID(), productId: crypto.randomUUID(), paymentMethod: "stripe" }).success).toBe(true)
  })
  it("accepts an ad-hoc pack", () => {
    const r = sellPackSchema.safeParse({ clientUserId: crypto.randomUUID(), adhoc: { sessionType: "1-on-1", credits: 10, priceCents: 50000, validityDays: 90 }, paymentMethod: "cash" })
    expect(r.success).toBe(true)
  })
  it("rejects when neither productId nor adhoc given", () => {
    expect(sellPackSchema.safeParse({ clientUserId: crypto.randomUUID(), paymentMethod: "stripe" }).success).toBe(false)
  })
  it("rejects zero credits", () => {
    expect(packProductSchema.safeParse({ name: "x", sessionType: "1-on-1", credits: 0, priceCents: 100 }).success).toBe(false)
  })
})

describe("checkinSchema", () => {
  it("accepts a client id", () => {
    expect(checkinSchema.safeParse({ clientUserId: crypto.randomUUID(), token: "abc.def" }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run → FAIL** — `npm run test:run -- session-packs` → "Cannot find module".
- [ ] **Step 3: Implement**

```ts
import { z } from "zod"

export const packProductSchema = z.object({
  name: z.string().min(1),
  sessionType: z.string().min(1),
  credits: z.number().int().positive(),
  priceCents: z.number().int().nonnegative(),
  validityDays: z.number().int().positive().nullable().optional(),
  stripePriceId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

const adhocPackSchema = z.object({
  sessionType: z.string().min(1),
  credits: z.number().int().positive(),
  priceCents: z.number().int().nonnegative(),
  validityDays: z.number().int().positive().nullable().optional(),
})

export const sellPackSchema = z
  .object({
    clientUserId: z.string().uuid(),
    productId: z.string().uuid().optional(),
    adhoc: adhocPackSchema.optional(),
    paymentMethod: z.enum(["stripe", "cash", "comp"]),
    returnUrl: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine((d) => !!d.productId || !!d.adhoc, { message: "Provide productId or adhoc pack" })

export const checkinSchema = z.object({
  clientUserId: z.string().uuid(),
  token: z.string().min(1),
  method: z.enum(["qr_self", "coach_tap", "manual"]).optional(),
})

export const voidCheckinSchema = z.object({
  checkinId: z.string().uuid(),
  reason: z.string().optional(),
})

export type SellPackInput = z.infer<typeof sellPackSchema>
export type PackProductInput = z.infer<typeof packProductSchema>
```

- [ ] **Step 4: Run → PASS** — `npm run test:run -- session-packs`
- [ ] **Step 5: Commit** — `git add lib/validators/session-packs.ts __tests__/lib/validators/session-packs.test.ts && git commit -m "feat(packs): zod validators"`

---

## Task 3: Pure credit math

**Files:**
- Create: `lib/services/session-credits.ts` (pure section only this task)
- Test: `__tests__/lib/services/session-credits.test.ts`

The pure functions are the single source of truth for balance. No DB here.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest"
import {
  remainingCredits, isExpired, packStatusAfter, reminderThreshold, expiresAtFrom,
} from "@/lib/services/session-credits"

describe("remainingCredits", () => {
  it("subtracts used from total", () => {
    expect(remainingCredits({ credits_total: 10, credits_used: 3 } as any)).toBe(7)
  })
  it("never goes negative", () => {
    expect(remainingCredits({ credits_total: 5, credits_used: 9 } as any)).toBe(0)
  })
})

describe("isExpired", () => {
  const now = new Date("2026-06-13T12:00:00Z")
  it("false when expires_at null", () => {
    expect(isExpired({ expires_at: null } as any, now)).toBe(false)
  })
  it("true when past", () => {
    expect(isExpired({ expires_at: "2026-06-01T00:00:00Z" } as any, now)).toBe(true)
  })
  it("false when future", () => {
    expect(isExpired({ expires_at: "2026-12-01T00:00:00Z" } as any, now)).toBe(false)
  })
})

describe("packStatusAfter", () => {
  it("depleted at zero remaining", () => {
    expect(packStatusAfter({ credits_total: 3, credits_used: 3, expires_at: null } as any, new Date())).toBe("depleted")
  })
  it("active with credits left", () => {
    expect(packStatusAfter({ credits_total: 3, credits_used: 1, expires_at: null } as any, new Date())).toBe("active")
  })
  it("expired beats depleted", () => {
    expect(packStatusAfter({ credits_total: 3, credits_used: 0, expires_at: "2000-01-01" } as any, new Date())).toBe("expired")
  })
})

describe("reminderThreshold", () => {
  const now = new Date("2026-06-13T00:00:00Z")
  it("empty at 0 remaining", () => {
    expect(reminderThreshold({ credits_total: 10, credits_used: 10, expires_at: null } as any, now, 2, 7)).toBe("empty")
  })
  it("low at <= lowAt remaining", () => {
    expect(reminderThreshold({ credits_total: 10, credits_used: 8, expires_at: null } as any, now, 2, 7)).toBe("low")
  })
  it("expiring within window", () => {
    expect(reminderThreshold({ credits_total: 10, credits_used: 1, expires_at: "2026-06-17T00:00:00Z" } as any, now, 2, 7)).toBe("expiring")
  })
  it("null when healthy", () => {
    expect(reminderThreshold({ credits_total: 10, credits_used: 1, expires_at: null } as any, now, 2, 7)).toBeNull()
  })
})
```

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement the pure section**

```ts
import type { ClientPackage, ClientPackageStatus, PackReminderThreshold } from "@/types/database"

type PackLike = Pick<ClientPackage, "credits_total" | "credits_used" | "expires_at">

export function remainingCredits(p: Pick<ClientPackage, "credits_total" | "credits_used">): number {
  return Math.max(0, p.credits_total - p.credits_used)
}

export function isExpired(p: Pick<ClientPackage, "expires_at">, now: Date): boolean {
  if (!p.expires_at) return false
  return new Date(p.expires_at).getTime() <= now.getTime()
}

export function packStatusAfter(p: PackLike, now: Date): ClientPackageStatus {
  if (isExpired(p, now)) return "expired"
  return remainingCredits(p) <= 0 ? "depleted" : "active"
}

/** Highest-priority reminder threshold this pack has reached, or null. */
export function reminderThreshold(
  p: PackLike, now: Date, lowAt: number, expiryDays: number,
): PackReminderThreshold | null {
  if (isExpired(p, now)) return null // already expired — not a renewal nudge
  const rem = remainingCredits(p)
  if (rem <= 0) return "empty"
  if (p.expires_at) {
    const days = (new Date(p.expires_at).getTime() - now.getTime()) / 86_400_000
    if (days <= expiryDays) return "expiring"
  }
  if (rem <= lowAt) return "low"
  return null
}

/** purchased_at + validityDays → ISO expires_at, or null when no validity. */
export function expiresAtFrom(purchasedAtIso: string, validityDays: number | null): string | null {
  if (validityDays == null) return null
  const d = new Date(purchasedAtIso)
  d.setUTCDate(d.getUTCDate() + validityDays)
  return d.toISOString()
}
```

- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** — `git add lib/services/session-credits.ts __tests__/lib/services/session-credits.test.ts && git commit -m "feat(packs): pure credit-math service"`

---

## Task 4: QR check-in token

**Files:**
- Create: `lib/qr/checkin-token.ts`
- Test: `__tests__/lib/qr/checkin-token.test.ts`

HMAC token embedded in the coach QR. `{coachId, day}` signed with `NEXTAUTH_SECRET`; verify rejects tampered or stale (older than `maxAgeDays`, default 2) tokens.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, beforeAll } from "vitest"
import { signCheckinToken, verifyCheckinToken } from "@/lib/qr/checkin-token"

beforeAll(() => { process.env.NEXTAUTH_SECRET = "test-secret" })

describe("checkin token", () => {
  it("round-trips a valid token", () => {
    const t = signCheckinToken("coach-1", new Date("2026-06-13T00:00:00Z"))
    const r = verifyCheckinToken(t, new Date("2026-06-13T10:00:00Z"))
    expect(r).toEqual({ valid: true, coachId: "coach-1" })
  })
  it("rejects a tampered token", () => {
    const t = signCheckinToken("coach-1", new Date("2026-06-13T00:00:00Z"))
    expect(verifyCheckinToken(t + "x", new Date()).valid).toBe(false)
  })
  it("rejects a stale token", () => {
    const t = signCheckinToken("coach-1", new Date("2026-06-01T00:00:00Z"))
    expect(verifyCheckinToken(t, new Date("2026-06-13T00:00:00Z")).valid).toBe(false)
  })
})
```

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**

```ts
import { createHmac, timingSafeEqual } from "crypto"

function secret(): string {
  return process.env.NEXTAUTH_SECRET ?? "dev-insecure-secret"
}

function dayStamp(d: Date): string {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}

/** token = base64url(coachId.day).hmac */
export function signCheckinToken(coachId: string, now: Date): string {
  const payload = `${coachId}.${dayStamp(now)}`
  const b64 = Buffer.from(payload).toString("base64url")
  const sig = createHmac("sha256", secret()).update(b64).digest("base64url")
  return `${b64}.${sig}`
}

export type VerifyResult = { valid: true; coachId: string } | { valid: false }

export function verifyCheckinToken(token: string, now: Date, maxAgeDays = 2): VerifyResult {
  const parts = token.split(".")
  if (parts.length !== 2) return { valid: false }
  const [b64, sig] = parts
  const expected = createHmac("sha256", secret()).update(b64).digest("base64url")
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false }
  const decoded = Buffer.from(b64, "base64url").toString()
  const [coachId, day] = decoded.split(".")
  if (!coachId || !day) return { valid: false }
  const ageDays = (now.getTime() - new Date(`${day}T00:00:00Z`).getTime()) / 86_400_000
  if (ageDays < 0 || ageDays > maxAgeDays) return { valid: false }
  return { valid: true, coachId }
}
```

- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** — `git add lib/qr/checkin-token.ts __tests__/lib/qr/checkin-token.test.ts && git commit -m "feat(packs): signed QR check-in token"`

---

## Task 5: Data access layers

**Files:**
- Create: `lib/db/session-pack-products.ts`, `lib/db/client-packages.ts`, `lib/db/session-checkins.ts`

Mirror [lib/db/notifications.ts](../../../lib/db/notifications.ts) exactly (service-role `getClient()`, cast results). No tests this task (thin wrappers; covered via service integration tests in Task 6).

- [ ] **Step 1: `session-pack-products.ts`** — `listActiveProducts()`, `getProductById(id)`, `createProduct(p)`, `updateProduct(id, patch)`. Table `session_pack_products`, cast to `SessionPackProduct`.

- [ ] **Step 2: `client-packages.ts`**

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { ClientPackage } from "@/types/database"
function getClient() { return createServiceRoleClient() }

export async function createClientPackage(p: Omit<ClientPackage, "id" | "created_at" | "updated_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_packages").insert(p).select().single()
  if (error) throw error
  return data as ClientPackage
}
export async function getClientPackageById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_packages").select("*").eq("id", id).single()
  if (error) throw error
  return data as ClientPackage
}
export async function listPackagesForClient(clientUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_packages").select("*")
    .eq("client_user_id", clientUserId).order("purchased_at", { ascending: false })
  if (error) throw error
  return data as ClientPackage[]
}
/** Oldest active, non-expired pack with credits remaining — the one to deduct from. */
export async function getActivePackageForClient(clientUserId: string, nowIso: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_packages").select("*")
    .eq("client_user_id", clientUserId).eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("purchased_at", { ascending: true })
  if (error) throw error
  return (data as ClientPackage[]).find((p) => p.credits_used < p.credits_total) ?? null
}
export async function updateClientPackage(id: string, patch: Partial<ClientPackage>) {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_packages").update(patch).eq("id", id).select().single()
  if (error) throw error
  return data as ClientPackage
}
export async function getPackageByStripeSession(sessionId: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_packages").select("*").eq("stripe_session_id", sessionId).maybeSingle()
  if (error) throw error
  return data as ClientPackage | null
}
/** Active packs for the renewal scanner. */
export async function listActivePackages() {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_packages").select("*").eq("status", "active")
  if (error) throw error
  return data as ClientPackage[]
}
/** Active-pack clients for the Today screen / self-check-in roster. */
export async function listActivePackClients() {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_packages")
    .select("*, users!inner(id, first_name, last_name, email)")
    .eq("status", "active")
  if (error) throw error
  return data as (ClientPackage & { users: { id: string; first_name: string; last_name: string; email: string } })[]
}
```

- [ ] **Step 3: `session-checkins.ts`** — `createCheckin(c)`, `getCheckinById(id)`, `listCheckinsForPackage(packageId)`, `countActiveCheckinsForPackage(packageId)` (`voided=false`), `recentNonVoidedForPackage(packageId, sinceIso)` (idempotency window), `voidCheckin(id, {voided_by, voided_reason})`. Cast to `SessionCheckin`.

- [ ] **Step 4: tsc** — `npx tsc --noEmit` (no new errors).
- [ ] **Step 5: Commit** — `git add lib/db/session-pack-products.ts lib/db/client-packages.ts lib/db/session-checkins.ts && git commit -m "feat(packs): data access layers"`

---

## Task 6: Service orchestration (check-in / void / sell)

**Files:**
- Modify: `lib/services/session-credits.ts` (append orchestration)
- Test: `__tests__/lib/services/session-credits.orchestration.test.ts` (mock the DALs with `vi.mock`)

Orchestration uses the pure functions + DALs. Functions:

```ts
export interface CheckInResult { ok: boolean; reason?: "no_credits" | "duplicate"; checkin?: SessionCheckin; remaining?: number; packageId?: string }

// checkInClient({ clientUserId, method, createdBy, now, idempotencyWindowMs })
//  - getActivePackageForClient; if none → { ok:false, reason:"no_credits" }
//  - recentNonVoidedForPackage within window → { ok:true, reason:"duplicate", existing }
//  - createCheckin(method, -1); credits_used+1; status=packStatusAfter; return remaining
export async function checkInClient(input: {...}): Promise<CheckInResult>

// voidCheckin({ checkinId, voidedBy, reason, now }) → restores credit, re-activates pack if depleted
export async function voidCheckinAndRestore(input: {...}): Promise<{ ok: boolean }>

// creditPaidPack(pkg) — promote pending→paid+active, used by webhook/cash path
```

- [ ] **Step 1: Write failing tests** — mock `@/lib/db/client-packages` and `@/lib/db/session-checkins`:
  - check-in deducts (remaining decreases, status active);
  - check-in to last credit → status `depleted`;
  - check-in with no active package → `{ ok:false, reason:"no_credits" }`;
  - second check-in within window → `{ ok:true, reason:"duplicate" }`;
  - void restores credit and flips `depleted`→`active`.

Example:

```ts
import { vi, describe, it, expect, beforeEach } from "vitest"
vi.mock("@/lib/db/client-packages")
vi.mock("@/lib/db/session-checkins")
import * as packs from "@/lib/db/client-packages"
import * as checkins from "@/lib/db/session-checkins"
import { checkInClient } from "@/lib/services/session-credits"

beforeEach(() => vi.resetAllMocks())

it("rejects when no active package", async () => {
  vi.mocked(packs.getActivePackageForClient).mockResolvedValue(null)
  const r = await checkInClient({ clientUserId: "c1", method: "coach_tap", createdBy: "coach", now: new Date() })
  expect(r).toEqual({ ok: false, reason: "no_credits" })
})

it("deducts a credit on check-in", async () => {
  vi.mocked(packs.getActivePackageForClient).mockResolvedValue({ id: "p1", credits_total: 10, credits_used: 3, expires_at: null } as any)
  vi.mocked(checkins.recentNonVoidedForPackage).mockResolvedValue(null)
  vi.mocked(checkins.createCheckin).mockResolvedValue({ id: "ck1" } as any)
  vi.mocked(packs.updateClientPackage).mockResolvedValue({} as any)
  const r = await checkInClient({ clientUserId: "c1", method: "coach_tap", createdBy: "coach", now: new Date() })
  expect(r.ok).toBe(true)
  expect(r.remaining).toBe(6)
  expect(packs.updateClientPackage).toHaveBeenCalledWith("p1", expect.objectContaining({ credits_used: 4, status: "active" }))
})
```

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement orchestration** in `lib/services/session-credits.ts` using pure fns + DALs (default `idempotencyWindowMs = 4*60*60*1000`).
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** — `git commit -am "feat(packs): check-in/void/credit orchestration"`

---

## Task 7: Audit slugs + flag constants

**Files:**
- Modify: `lib/audit/actions.ts` (add rows)
- Create: `lib/packs/flags.ts`

- [ ] **Step 1: Add audit rows** to the `AUDIT_ACTIONS` array:

```ts
  // session packs
  { slug: "pack.sold", category: "commerce", description: "Session pack sold to a client" },
  { slug: "pack.checkin", category: "client_action", description: "Client checked in; credit deducted" },
  { slug: "pack.checkin_voided", category: "client_action", description: "Check-in voided; credit restored" },
  { slug: "pack.refunded", category: "commerce", description: "Session pack refunded" },
  { slug: "pack.expired", category: "system", description: "Session pack expired" },
```

- [ ] **Step 2: Flag keys + getters** (`lib/packs/flags.ts`):

```ts
import { getSetting } from "@/lib/db/system-settings"
export const PACKS_ENABLED_KEY = "feature_session_packs_enabled"
export const QR_CHECKIN_ENABLED_KEY = "feature_qr_checkin_enabled"
export const PACK_RENEWALS_CRON_KEY = "cron_pack_renewals_enabled"
export const PACK_REMINDER_LOW_KEY = "pack_reminder_low_at"
export const PACK_REMINDER_EXPIRY_KEY = "pack_reminder_expiry_days"
export const packsEnabled = () => getSetting<boolean>(PACKS_ENABLED_KEY, false)
export const qrCheckinEnabled = () => getSetting<boolean>(QR_CHECKIN_ENABLED_KEY, false)
```

- [ ] **Step 3: tsc** — `npx tsc --noEmit`.
- [ ] **Step 4: Commit** — `git commit -am "feat(packs): audit slugs + feature flags"`

---

## Task 8: Coach API — sell pack (Stripe + cash/comp), list

**Files:**
- Create: `lib/stripe.ts` extension `createPackCheckoutSession(...)` (append to existing file)
- Create: `app/api/admin/session-packs/checkout/route.ts`, `app/api/admin/session-packs/route.ts` (POST cash/comp create + GET list for a client)
- Test: `__tests__/api/session-packs/checkout.test.ts`

`createPackCheckoutSession` mirrors `createWeekCheckoutSession`: `mode:"payment"`, inline `price_data` (or `price: stripePriceId`), `metadata: { type: "session_pack", clientUserId, productId, credits, validityDays, sessionType, priceCents }`, success → `/admin/clients/{clientUserId}?pack=purchased`.

- [ ] **Step 1: Failing test** — POST checkout returns `{ url }` for a catalogue product (mock stripe + DAL); cash path creates a `client_packages` row with `payment_status:"paid"`, `status:"active"`; comp → `not_required`. Auth required (admin).
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement.** Checkout route: `auth()` admin guard, `sellPackSchema.parse`, resolve product or adhoc, if `paymentMethod==="stripe"` create a pending `client_packages` row + checkout session (stamp `stripe_session_id`) and return url; else create pack directly (`creditPaidPack`-style), record `pack.sold` audit. `GET /api/admin/session-packs?clientUserId=` → `listPackagesForClient`.
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** — `git commit -am "feat(packs): sell-pack API (stripe + cash/comp) + list"`

---

## Task 9: Stripe webhook — credit pack on purchase + refund

**Files:**
- Modify: `app/api/stripe/webhook/route.ts`
- Test: `__tests__/api/stripe/session-pack-webhook.test.ts`

- [ ] **Step 1: Failing test** — a `checkout.session.completed` with `metadata.type==="session_pack"` and a matching pending pack → pack promoted to `paid`/`active`, `expires_at` set, `payments` row created, second delivery is idempotent.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — in the `checkout.session.completed` switch add, before the subscription/one-time branch:

```ts
if (session.metadata?.type === "session_pack") {
  await handleSessionPackCheckout(session)
  await tryEnqueueAdsValueAdjustment(session)
  break
}
```

`handleSessionPackCheckout`: idempotency via `getPackageByStripeSession(session.id)`; if pack still `pending`, `updateClientPackage` → `payment_status:"paid"`, `status:"active"`, `stripe_payment_id`, `expires_at` from `expiresAtFrom(purchased_at, validityDays)`; `createPayment({... description:"Session pack", metadata:{ type:"session_pack", client_package_id }})`; `recordAudit("pack.sold","commerce", ...)`. In `charge.refunded`, after the existing payment lookup, if a pack carries that `stripe_payment_id`, set pack `refunded`/`cancelled` + `pack.refunded` audit.
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** — `git commit -am "feat(packs): webhook credits pack on purchase + refund"`

---

## Task 10: Public check-in surface

**Files:**
- Create: `app/api/checkin/route.ts` (POST), `app/api/checkin/roster/route.ts` (GET active-pack roster, token-gated)
- Create: `app/checkin/page.tsx` (client component)
- Test: `__tests__/api/checkin/checkin.test.ts`

- [ ] **Step 1: Failing test** — POST `/api/checkin` with a valid token + clientUserId deducts via `checkInClient` (mock service); invalid token → 401; no-credits → 409.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — POST: `checkinSchema.parse`, `verifyCheckinToken(token, new Date())`; reject if invalid or `qrCheckinEnabled()` false; call `checkInClient({ clientUserId, method:"qr_self", createdBy:null, now:new Date() })`; map `no_credits`→409, `duplicate`→200 idempotent, ok→200 `{ remaining }`; `recordAudit("pack.checkin","client_action")`. Roster GET: verify token → `listActivePackClients()` minimal fields. Page: read `?token`, if authed client auto-resolve else fetch roster + searchable tap-list → confirm → POST → show remaining.
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** — `git commit -am "feat(packs): public QR self-check-in surface"`

---

## Task 11: Reminder scanner (pure)

**Files:**
- Create: `lib/automation/pack-renewal-scanner.ts`
- Test: `__tests__/lib/automation/pack-renewal-scanner.test.ts`

```ts
import type { ClientPackage } from "@/types/database"
import { reminderThreshold } from "@/lib/services/session-credits"

export interface PackReminder { pkg: ClientPackage; threshold: "low" | "empty" | "expiring" }

const ORDER = { empty: 3, expiring: 2, low: 1 } as const

/** Packs that reached a NEW (higher than last-sent) threshold. Pure. */
export function selectPacksNeedingReminder(
  pkgs: ClientPackage[], now: Date, lowAt: number, expiryDays: number,
): PackReminder[] {
  const out: PackReminder[] = []
  for (const pkg of pkgs) {
    const th = reminderThreshold(pkg, now, lowAt, expiryDays)
    if (!th) continue
    const last = pkg.last_reminded_threshold
    if (last && ORDER[last] >= ORDER[th]) continue // already nudged at >= this severity
    out.push({ pkg, threshold: th })
  }
  return out
}
```

- [ ] **Step 1: Failing tests** — empty/low/expiring selection; skips when `last_reminded_threshold` already ≥ severity; re-selects when severity escalates (low→empty).
- [ ] **Step 2–4: TDD to green.**
- [ ] **Step 5: Commit** — `git commit -am "feat(packs): pure renewal-reminder selector"`

---

## Task 12: Reminder email + internal route

**Files:**
- Modify: `lib/email.ts` (add `sendPackRenewalEmail`)
- Create: `app/api/admin/internal/pack-renewals/route.ts`
- Test: `__tests__/api/internal/pack-renewals.test.ts`

`sendPackRenewalEmail({ to, firstName, threshold, remaining, sessionType })` — follow the existing Resend helper signature in `lib/email.ts` (read `sendProgramReadyEmail`). Internal route: bearer/secret guard like other `/api/admin/internal/*` routes; `isCronSkipped({ enabledKey: PACK_RENEWALS_CRON_KEY, defaultEnabled: false })`; load thresholds from settings; `listActivePackages()` → `selectPacksNeedingReminder` → for each: client email + `createNotification` (client in-app) + coach notification (email to `COACH_EMAIL`) → `updateClientPackage(last_reminded_threshold)`; return counts.

- [ ] **Step 1: Failing test** — given 3 active packs (one empty, one healthy, one already-nudged), route sends exactly one reminder and stamps it (mock DAL + email).
- [ ] **Step 2–4: TDD to green.**
- [ ] **Step 5: Commit** — `git commit -am "feat(packs): renewal email + internal cron route"`

---

## Task 13: Firebase cron + catalogue wiring

**Files:**
- Modify: `functions/src/index.ts` (add `packRenewalScanCron`)
- Modify: `lib/cron-catalog.ts` and the automation-health expected list (mirror an existing daily cron, e.g. `clientRiskScanCron`)

- [ ] **Step 1:** Add `onSchedule` (`"0 9 * * *"`, UTC) that POSTs the internal route with the shared secret — copy an existing internal-cron function in `functions/src/index.ts` verbatim and swap path/name.
- [ ] **Step 2:** Register in `cron-catalog.ts` + automation-health expected list so a silent failure surfaces.
- [ ] **Step 3:** `npx tsc --noEmit` in root; `cd functions && npm run build` to ensure the function compiles.
- [ ] **Step 4: Commit** — `git commit -am "feat(packs): daily renewal cron + catalogue"`

---

## Task 14: Coach UI — Packages panel on client page

**Files:**
- Create: `components/admin/packs/ClientPackagesPanel.tsx`, `components/admin/packs/SellPackDialog.tsx`
- Modify: `app/(admin)/admin/clients/[id]/page.tsx` (render the panel, gated by `packsEnabled()`)

- [ ] **Step 1:** Server-load `listPackagesForClient(id)` + `listActiveProducts()`; render balance per active pack (`remainingCredits`), history (check-ins), **Check in** (POST coach_tap), **Sell pack** (opens dialog → `/api/admin/session-packs/checkout` or cash/comp), **Void** on a check-in. Use existing shadcn `Card`/`Dialog`/`Button`; no hardcoded colours (semantic classes).
- [ ] **Step 2:** Gate the panel behind `feature_session_packs_enabled`.
- [ ] **Step 3:** `npm run test:run` + `npx tsc --noEmit` clean.
- [ ] **Step 4: Commit** — `git commit -am "feat(packs): client-page packages panel + sell dialog"`

---

## Task 15: Coach UI — Today check-in screen

**Files:**
- Create: `app/(admin)/admin/today/page.tsx`, `components/admin/packs/TodayCheckinList.tsx`
- Modify: `components/admin/admin-nav.ts` (add "Today" link, gated)

- [ ] **Step 1:** List active-pack clients (`listActivePackClients`), search box, one-tap **Check in** per client (coach_tap), and a **Show QR** action that renders the coach check-in QR (the signed token URL `/checkin?token=...`) using a lightweight inline QR (e.g. `qrcode` data-url or an `<img>` to a QR endpoint). Confirm before deduct; toast remaining via Sonner.
- [ ] **Step 2:** Add nav link behind the flag.
- [ ] **Step 3:** Tests/tsc clean.
- [ ] **Step 4: Commit** — `git commit -am "feat(packs): Today check-in screen + QR display"`

---

## Task 16: Final wiring + full verification

- [ ] **Step 1:** `npm run test:run` — all green.
- [ ] **Step 2:** `npm run lint` — clean (fix warnings introduced).
- [ ] **Step 3:** `npx tsc --noEmit` — no new prod-source errors.
- [ ] **Step 4:** `npm run build` — succeeds.
- [ ] **Step 5:** Commit any fixes — `git commit -am "chore(packs): lint/type/build green"`.

---

## Self-Review (completed by author)

- **Spec coverage:** catalogue→T1/8; purchased balance→T1/5; ledger→T1/5; credit math→T3; check-in (qr+tap)→T6/10/14/15; sell via Stripe+cash/comp→T8/9; reminders (email+coach+in-app)→T11/12/13; expiry→T3/11; refund→T9; flags→T7; audit→T7/8/9/10; QR token→T4. Calendar two-way sync intentionally deferred (Phase 2 — separate plan). ✅
- **Placeholders:** core logic (T1–4, 6, 11) has full code; routes/UI (T8–10, 14–15) specify exact behaviour + the existing pattern to mirror, no vague "handle errors". ✅
- **Type consistency:** `remainingCredits`/`isExpired`/`packStatusAfter`/`reminderThreshold`/`expiresAtFrom`/`checkInClient`/`voidCheckinAndRestore`/`selectPacksNeedingReminder` names used consistently across T3/6/11. `client_packages.last_reminded_threshold` ∈ {low,empty,expiring} matches `PackReminderThreshold`. ✅
