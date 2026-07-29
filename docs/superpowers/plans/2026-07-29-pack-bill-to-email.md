# Pack "bill to" email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a coach address a session-pack payment link to any email (a parent with no account), persist that address on the pack, and email the link to them with the client CC'd.

**Architecture:** Two nullable columns on `client_packages` hold the address and the last-emailed timestamp. `createPackCheckoutSession` gains an optional `billToEmail` that takes precedence over the household payer. Link resolution (reuse the open Stripe session, or mint a fresh one) moves out of the route into `lib/services/pack-payment-link.ts` so the copy-link route, the new email-link route, and the change-address route all share one definition.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres, Stripe Checkout, Resend, Zod, Vitest + Testing Library.

## Global Constraints

- Spec: [docs/superpowers/specs/2026-07-29-pack-bill-to-email-design.md](../specs/2026-07-29-pack-bill-to-email-design.md).
- **No feature flag.** The feature is inert until a coach types an address.
- `metadata.clientUserId` on the Stripe session **must stay the trainee** — it is what the webhook credits.
- Migrations are applied with `mcp__supabase__apply_migration`, never the CLI.
- Never repoint `stripe_session_id` when the existing session is `complete` (409) or when Stripe errors (502).
- Colors/fonts via semantic classes; no hardcoded hex outside `lib/email.ts`, which is HTML-email and already inlines brand hex.
- Commit after every task. Do not push.

---

### Task 1: Migration and type

**Files:**
- Create: `supabase/migrations/00195_pack_bill_to_email.sql`
- Modify: `types/database.ts:2840-2861` (`ClientPackage`)

**Interfaces:**
- Consumes: nothing.
- Produces: `ClientPackage.bill_to_email: string | null`, `ClientPackage.bill_to_emailed_at: string | null`.

- [ ] **Step 1: Write the migration**

```sql
-- 00195_pack_bill_to_email.sql
-- A session pack's Stripe link is addressed to the trainee by default. When a
-- parent/spouse with no account pays, the coach can pin a different address.
-- Nullable + unused until typed, so this is inert on arrival.
alter table client_packages
  add column if not exists bill_to_email text,
  add column if not exists bill_to_emailed_at timestamptz;

comment on column client_packages.bill_to_email is
  'Overrides the Stripe checkout addressee for this pack. NULL = household payer, else the trainee.';
comment on column client_packages.bill_to_emailed_at is
  'When the payment link was last emailed to bill_to_email.';
```

- [ ] **Step 2: Apply it**

Use `mcp__supabase__apply_migration` with name `pack_bill_to_email` and the SQL above.

- [ ] **Step 3: Verify the columns exist**

Run via `mcp__supabase__execute_sql`:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'client_packages' and column_name like 'bill_to%';
```

Expected: two rows, both `is_nullable = YES`.

- [ ] **Step 4: Extend the type**

In `types/database.ts`, inside `interface ClientPackage`, after `notes: string | null`:

```ts
  bill_to_email: string | null
  bill_to_emailed_at: string | null
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (nothing constructs a full `ClientPackage` literal outside `buildPackageInsert`, handled in Task 3).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00195_pack_bill_to_email.sql types/database.ts
git commit -m "feat(packs): add bill_to_email columns to client_packages"
```

---

### Task 2: `billToEmail` beats the household payer

**Files:**
- Modify: `lib/stripe.ts:402-471` (`createPackCheckoutSession`)
- Test: `__tests__/lib/stripe-pack-checkout-payer.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces: `createPackCheckoutSession(opts & { billToEmail?: string | null })`.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe` in `__tests__/lib/stripe-pack-checkout-payer.test.ts`:

```ts
  it("an explicit billToEmail beats a household payer", async () => {
    resolveBillingUserIdMock.mockResolvedValue(PAYER)
    await createPackCheckoutSession({ ...opts, billToEmail: "dad@example.com" })
    expect(createSessionMock.mock.calls[0][0].customer_email).toBe("dad@example.com")
  })

  it("an explicit billToEmail beats the client's own email", async () => {
    resolveBillingUserIdMock.mockResolvedValue(TRAINEE)
    await createPackCheckoutSession({ ...opts, billToEmail: "dad@example.com" })
    expect(createSessionMock.mock.calls[0][0].customer_email).toBe("dad@example.com")
  })

  it("still credits the TRAINEE when billed to an outside email", async () => {
    resolveBillingUserIdMock.mockResolvedValue(TRAINEE)
    await createPackCheckoutSession({ ...opts, billToEmail: "dad@example.com" })
    // The dad has no account. If he ever landed in metadata.clientUserId the
    // webhook would credit the sessions to nobody.
    expect(createSessionMock.mock.calls[0][0].metadata.clientUserId).toBe(TRAINEE)
  })

  it("skips the payer lookup entirely when billToEmail is given", async () => {
    await createPackCheckoutSession({ ...opts, billToEmail: "dad@example.com" })
    // A DB round-trip whose result is discarded is a latency bug on the money path.
    expect(resolveBillingUserIdMock).not.toHaveBeenCalled()
  })
```

Also fix the misnamed existing test — rename `"still pins SOME email when the payer lookup throws — never leaves it blank to Link autofill"` to:

```ts
  it("leaves customer_email unset when the payer lookup throws, rather than failing the sale", async () => {
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run __tests__/lib/stripe-pack-checkout-payer.test.ts`
Expected: the four new tests FAIL (`customer_email` is `trainee@example.com` / `payer@example.com`, and `resolveBillingUserId` was called).

- [ ] **Step 3: Implement**

In `lib/stripe.ts`, add to the `createPackCheckoutSession` opts type, after `stripePriceId?: string | null`:

```ts
  /** Explicit addressee (a parent with no account). Beats the household payer. */
  billToEmail?: string | null
```

Replace the payer-resolution block (currently `let customerEmail ... }`) with:

```ts
  // Addressee precedence: explicit per-pack override → household payer → the
  // client themselves. Stripe locks a supplied customer_email, so this IS who
  // the receipt reaches. Without any of them Stripe Link autofills whichever
  // account lives in the browser that opens the link (historically the coach's).
  let customerEmail: string | undefined = opts.billToEmail ?? undefined
  if (!customerEmail) {
    try {
      const billingUserId = await resolveBillingUserId(opts.clientUserId)
      const payer = await getUserById(billingUserId)
      customerEmail = payer?.email ?? undefined
    } catch {
      // Non-fatal — checkout still works, just without the prefilled email.
    }
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run __tests__/lib/stripe-pack-checkout-payer.test.ts`
Expected: PASS, all 8.

- [ ] **Step 5: Commit**

```bash
git add lib/stripe.ts __tests__/lib/stripe-pack-checkout-payer.test.ts
git commit -m "feat(packs): let an explicit billToEmail override the household payer"
```

---

### Task 3: Persist the address when selling

**Files:**
- Modify: `lib/validators/session-packs.ts:21-33` (`sellPackSchema`)
- Modify: `lib/services/session-credits.ts:71-115` (`buildPackageInsert`)
- Modify: `app/api/admin/session-packs/checkout/route.ts:87-118`
- Test: `__tests__/lib/services/session-credits-bill-to.test.ts` (create)

**Interfaces:**
- Consumes: Task 2's `billToEmail`.
- Produces: `sellPackSchema` accepts `billToEmail?: string`; `buildPackageInsert` accepts `billToEmail?: string | null` and emits `bill_to_email` + `bill_to_emailed_at: null`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/services/session-credits-bill-to.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { buildPackageInsert } from "@/lib/services/session-credits"
import { sellPackSchema } from "@/lib/validators/session-packs"

const base = {
  clientUserId: "11111111-1111-4111-8111-111111111111",
  productId: null,
  sessionType: "1-on-1",
  credits: 10,
  priceCents: 150000,
  validityDays: null,
  paymentMethod: "stripe" as const,
  createdBy: null,
  now: new Date("2026-07-29T00:00:00Z"),
}

describe("buildPackageInsert — bill_to_email", () => {
  it("carries an explicit address onto the row", () => {
    const row = buildPackageInsert({ ...base, billToEmail: "dad@example.com" })
    expect(row.bill_to_email).toBe("dad@example.com")
  })

  it("defaults to null so the payer/client resolution still applies", () => {
    expect(buildPackageInsert(base).bill_to_email).toBeNull()
  })

  it("never pre-stamps the emailed timestamp", () => {
    // A non-null value here would make the UI claim a link was sent that never was.
    expect(buildPackageInsert({ ...base, billToEmail: "dad@example.com" }).bill_to_emailed_at).toBeNull()
  })
})

describe("sellPackSchema — billToEmail", () => {
  const valid = { clientUserId: base.clientUserId, paymentMethod: "stripe", productId: base.clientUserId }

  it("accepts a valid address", () => {
    const r = sellPackSchema.safeParse({ ...valid, billToEmail: "dad@example.com" })
    expect(r.success).toBe(true)
  })

  it("rejects a malformed address rather than pinning garbage into Stripe", () => {
    const r = sellPackSchema.safeParse({ ...valid, billToEmail: "not-an-email" })
    expect(r.success).toBe(false)
  })

  it("is optional", () => {
    expect(sellPackSchema.safeParse(valid).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/services/session-credits-bill-to.test.ts`
Expected: FAIL — `bill_to_email` undefined, malformed address accepted.

- [ ] **Step 3: Implement the validator**

In `lib/validators/session-packs.ts`, inside `sellPackSchema`'s object, after `notes`:

```ts
    /** Address the Stripe link to someone else (a parent with no account). */
    billToEmail: z.string().email().optional(),
```

- [ ] **Step 4: Implement `buildPackageInsert`**

Add to the opts type after `notes?: string | null`:

```ts
  billToEmail?: string | null
```

And to the returned object after `notes: opts.notes ?? null`:

```ts
    bill_to_email: opts.billToEmail ?? null,
    bill_to_emailed_at: null,
```

- [ ] **Step 5: Wire the checkout route**

In `app/api/admin/session-packs/checkout/route.ts`, pass it to both calls. In the `createPackCheckoutSession({...})` call add:

```ts
        billToEmail: input.billToEmail ?? null,
```

and in the `buildPackageInsert({...})` call inside the stripe branch add:

```ts
          billToEmail: input.billToEmail ?? null,
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run __tests__/lib/services/session-credits-bill-to.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add lib/validators/session-packs.ts lib/services/session-credits.ts app/api/admin/session-packs/checkout/route.ts __tests__/lib/services/session-credits-bill-to.test.ts
git commit -m "feat(packs): persist bill_to_email when selling a pack"
```

---

### Task 4: Share link resolution, and keep the address on a re-mint

**Files:**
- Create: `lib/services/pack-payment-link.ts`
- Modify: `app/api/admin/session-packs/[id]/payment-link/route.ts`
- Test: `__tests__/lib/services/pack-payment-link.test.ts` (create)

**Interfaces:**
- Consumes: Task 2's `billToEmail`, Task 1's columns.
- Produces: `resolvePackPaymentLink(pack: ClientPackage): Promise<PackLinkResult>` where
  `PackLinkResult = { ok: true; url: string; refreshed: boolean } | { ok: false; status: number; error: string }`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/services/pack-payment-link.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const retrieveMock = vi.fn()
const createPackCheckoutSessionMock = vi.fn()
const updateClientPackageMock = vi.fn()

vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { retrieve: (...a: unknown[]) => retrieveMock(...a) } } },
  createPackCheckoutSession: (...a: unknown[]) => createPackCheckoutSessionMock(...a),
}))
vi.mock("@/lib/db/client-packages", () => ({
  updateClientPackage: (...a: unknown[]) => updateClientPackageMock(...a),
}))

import { resolvePackPaymentLink } from "@/lib/services/pack-payment-link"
import type { ClientPackage } from "@/types/database"

const pack = {
  id: "pack-1",
  client_user_id: "client-1",
  product_id: null,
  session_type: "1-on-1",
  credits_total: 10,
  price_cents: 150000,
  payment_method: "stripe",
  payment_status: "pending",
  stripe_session_id: "cs_old",
  bill_to_email: "dad@example.com",
} as unknown as ClientPackage

beforeEach(() => {
  vi.clearAllMocks()
  createPackCheckoutSessionMock.mockResolvedValue({ id: "cs_new", url: "https://stripe.test/cs_new" })
})

describe("resolvePackPaymentLink", () => {
  it("returns the still-open session untouched", async () => {
    retrieveMock.mockResolvedValue({ status: "open", url: "https://stripe.test/cs_old" })
    const r = await resolvePackPaymentLink(pack)
    expect(r).toEqual({ ok: true, url: "https://stripe.test/cs_old", refreshed: false })
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it("re-mints an expired session WITH the pack's bill-to address", async () => {
    retrieveMock.mockResolvedValue({ status: "expired" })
    const r = await resolvePackPaymentLink(pack)
    expect(r).toEqual({ ok: true, url: "https://stripe.test/cs_new", refreshed: true })
    // The regression this whole column exists to prevent: a re-minted link
    // silently reverting to the trainee's inbox.
    expect(createPackCheckoutSessionMock.mock.calls[0][0].billToEmail).toBe("dad@example.com")
    expect(updateClientPackageMock).toHaveBeenCalledWith("pack-1", { stripe_session_id: "cs_new" })
  })

  it("refuses to repoint a completed session", async () => {
    retrieveMock.mockResolvedValue({ status: "complete" })
    const r = await resolvePackPaymentLink(pack)
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("502s on a Stripe error instead of minting a competing session", async () => {
    retrieveMock.mockRejectedValue(new Error("stripe down"))
    const r = await resolvePackPaymentLink(pack)
    expect(r).toMatchObject({ ok: false, status: 502 })
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it("409s for a pack that is not awaiting a card payment", async () => {
    const r = await resolvePackPaymentLink({ ...pack, payment_status: "paid" } as ClientPackage)
    expect(r).toMatchObject({ ok: false, status: 409 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/services/pack-payment-link.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `lib/services/pack-payment-link.ts`:

```ts
import type { ClientPackage } from "@/types/database"
import { stripe, createPackCheckoutSession } from "@/lib/stripe"
import { updateClientPackage } from "@/lib/db/client-packages"

export type PackLinkResult =
  | { ok: true; url: string; refreshed: boolean }
  | { ok: false; status: number; error: string }

/**
 * The shareable Checkout URL for a pack awaiting card payment.
 *
 * Returns the existing session's URL while it is still open. A fresh session is
 * minted ONLY when the old one is verifiably dead ("expired") — never on a
 * transient Stripe error, and never when the old session is "complete" (paid,
 * webhook in flight): repointing stripe_session_id in either case would strand
 * the real payment and put the webhook into a retry loop.
 *
 * Shared by the copy-link, email-link and change-address routes so "what is
 * this pack's link" has exactly one definition.
 */
export async function resolvePackPaymentLink(pack: ClientPackage): Promise<PackLinkResult> {
  if (pack.payment_method !== "stripe" || pack.payment_status !== "pending") {
    return { ok: false, status: 409, error: "This pack is not awaiting a card payment" }
  }

  if (pack.stripe_session_id) {
    let existing
    try {
      existing = await stripe.checkout.sessions.retrieve(pack.stripe_session_id)
    } catch (err) {
      console.warn("[pack link] could not retrieve existing checkout session:", err)
      return {
        ok: false,
        status: 502,
        error: "Couldn't check the existing payment link with Stripe — try again in a moment",
      }
    }
    if (existing.status === "open" && existing.url) {
      return { ok: true, url: existing.url, refreshed: false }
    }
    if (existing.status === "complete") {
      return {
        ok: false,
        status: 409,
        error: "This pack was already paid — it may take a moment to show as paid here",
      }
    }
    // status "expired" (or open-without-url, which shouldn't happen) → mint fresh below.
  }

  const checkout = await createPackCheckoutSession({
    clientUserId: pack.client_user_id,
    name: `${pack.credits_total}× ${pack.session_type}`,
    sessionType: pack.session_type,
    credits: pack.credits_total,
    priceCents: pack.price_cents,
    validityDays: null,
    productId: pack.product_id,
    billToEmail: pack.bill_to_email,
    // The link is paid by the CLIENT — land them on their own packs page.
    returnUrl: "/client/sessions",
    cancelUrl: "/client/sessions",
  })
  await updateClientPackage(pack.id, { stripe_session_id: checkout.id })
  return { ok: true, url: checkout.url!, refreshed: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/lib/services/pack-payment-link.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Rewrite the payment-link route on top of it**

Replace the body of `POST` in `app/api/admin/session-packs/[id]/payment-link/route.ts` (keeping the auth guard, the 404, the audit call and the file's doc comment) so the Stripe branching is gone:

```ts
    const pack = await getClientPackageByIdMaybe(id)
    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 })
    }

    const link = await resolvePackPaymentLink(pack)
    if (!link.ok) {
      return NextResponse.json({ error: link.error }, { status: link.status })
    }
    if (!link.refreshed) {
      return NextResponse.json({ url: link.url, refreshed: false })
    }

    void recordAudit({
      action: "pack.payment_link_refreshed",
      category: "commerce",
      outcome: "success",
      target: { type: "client_package", id, label: pack.session_type },
      metadata: { client_user_id: pack.client_user_id },
      request,
    })

    return NextResponse.json({ url: link.url, refreshed: true })
```

Update the imports: drop `stripe`, `createPackCheckoutSession` and `updateClientPackage`; add
`import { resolvePackPaymentLink } from "@/lib/services/pack-payment-link"`.

- [ ] **Step 6: Run the pack suite**

Run: `npx vitest run __tests__ --silent -t "pack"`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add lib/services/pack-payment-link.ts app/api/admin/session-packs/\[id\]/payment-link/route.ts __tests__/lib/services/pack-payment-link.test.ts
git commit -m "refactor(packs): extract pack payment-link resolution, keep bill-to on re-mint"
```

---

### Task 5: Email the link, CC the client

**Files:**
- Modify: `lib/email.ts` (append a new sender near the other pack/billing emails)
- Modify: `lib/audit/actions.ts:220` (add one slug)
- Create: `app/api/admin/session-packs/[id]/email-link/route.ts`
- Test: `__tests__/lib/email-pack-payment-link.test.ts` (create)

**Interfaces:**
- Consumes: `resolvePackPaymentLink` (Task 4).
- Produces: `sendPackPaymentLinkEmail(opts: { to: string; ccClientEmail: string | null; clientName: string; packLabel: string; amountCents: number; url: string }): Promise<void>`; audit slug `pack.payment_link_emailed`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/email-pack-payment-link.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const sendMock = vi.fn()
vi.mock("resend", () => ({ Resend: class { emails = { send: (...a: unknown[]) => sendMock(...a) } } }))

import { sendPackPaymentLinkEmail } from "@/lib/email"

const base = {
  to: "dad@example.com",
  ccClientEmail: "luca@example.com",
  clientName: "Luca",
  packLabel: "10× Performance training",
  amountCents: 150000,
  url: "https://stripe.test/cs_1",
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RESEND_API_KEY = "re_test"
  sendMock.mockResolvedValue({ error: null })
})

describe("sendPackPaymentLinkEmail", () => {
  it("addresses the payer and CCs the client", async () => {
    await sendPackPaymentLinkEmail(base)
    const arg = sendMock.mock.calls[0][0]
    expect(arg.to).toBe("dad@example.com")
    expect(arg.cc).toBe("luca@example.com")
  })

  it("drops the CC when the payer IS the client", async () => {
    // Otherwise an ordinary sale CCs someone their own email.
    await sendPackPaymentLinkEmail({ ...base, ccClientEmail: "dad@example.com" })
    expect(sendMock.mock.calls[0][0].cc).toBeUndefined()
  })

  it("drops the CC when the client has no email", async () => {
    await sendPackPaymentLinkEmail({ ...base, ccClientEmail: null })
    expect(sendMock.mock.calls[0][0].cc).toBeUndefined()
  })

  it("puts the payment URL and the amount in the body", async () => {
    await sendPackPaymentLinkEmail(base)
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toContain("https://stripe.test/cs_1")
    expect(html).toContain("$1,500.00")
  })

  it("throws when Resend reports an error, so the coach learns the send failed", async () => {
    sendMock.mockResolvedValue({ error: { message: "bad recipient" } })
    await expect(sendPackPaymentLinkEmail(base)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/email-pack-payment-link.test.ts`
Expected: FAIL — `sendPackPaymentLinkEmail` is not exported.

- [ ] **Step 3: Implement the sender**

Append to `lib/email.ts`:

```ts
/**
 * Send a session-pack payment link to whoever is paying. `to` is the pack's
 * bill-to address (a parent with no account, typically); the client is CC'd so
 * they can see what was sent on their behalf — dropped when it would duplicate
 * `to`, matching the ADMIN_CC guard used elsewhere in this file.
 *
 * Throws on failure: the coach is standing in front of the client and must know
 * immediately if the link never went out.
 */
export async function sendPackPaymentLinkEmail(opts: {
  to: string
  ccClientEmail: string | null
  clientName: string
  packLabel: string
  amountCents: number
  url: string
}) {
  const amount = `$${(opts.amountCents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

  const html = emailLayout(`
    ${heroBanner("Payment Request", `Training sessions for ${opts.clientName}`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          <p style="margin:0 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            Here's the secure payment link for ${opts.clientName}'s training sessions. It's handled by Stripe — we never see your card details.
          </p>

          ${infoCard([
            { label: "For", value: opts.clientName },
            { label: "Package", value: opts.packLabel },
            { label: "Amount", value: amount },
          ])}

          <div style="margin:32px 0 0;">
            ${ctaButton(opts.url, "Pay now")}
          </div>

          <p style="margin:28px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:13px; color:#a09b94; line-height:1.8;">
            If the button doesn't work, paste this into your browser:<br />
            <span style="color:#5c5750; word-break:break-all;">${opts.url}</span>
          </p>

        </td>
      </tr>
    </table>
  `)

  const cc = opts.ccClientEmail && opts.ccClientEmail !== opts.to ? opts.ccClientEmail : undefined

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: opts.to,
    cc,
    subject: `Payment link — ${opts.packLabel} for ${opts.clientName}`,
    html,
  })
  if (error) {
    console.error("[sendPackPaymentLinkEmail] resend error:", error)
    throw new Error("Failed to send the payment link email")
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/lib/email-pack-payment-link.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the audit slug**

In `lib/audit/actions.ts`, after the `pack.payment_link_refreshed` entry:

```ts
  { slug: "pack.payment_link_emailed", category: "commerce", description: "Session pack payment link emailed to the payer" },
```

- [ ] **Step 6: Add the route**

Create `app/api/admin/session-packs/[id]/email-link/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getClientPackageByIdMaybe, updateClientPackage } from "@/lib/db/client-packages"
import { getUserById } from "@/lib/db/users"
import { resolvePackPaymentLink } from "@/lib/services/pack-payment-link"
import { sendPackPaymentLinkEmail } from "@/lib/email"
import { recordAudit } from "@/lib/audit/record"

/**
 * POST — email this pack's payment link to whoever is paying.
 *
 * Resolves the link through the same path as "Copy payment link" rather than
 * minting a second, competing session. Sends blocking: the coach is usually
 * standing with the client and must know at once if delivery failed.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const { id } = await ctx.params

    const pack = await getClientPackageByIdMaybe(id)
    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 })
    }

    const client = await getUserById(pack.client_user_id).catch(() => null)
    const to = pack.bill_to_email ?? client?.email ?? null
    if (!to) {
      return NextResponse.json({ error: "No email to send this link to" }, { status: 409 })
    }

    const link = await resolvePackPaymentLink(pack)
    if (!link.ok) {
      return NextResponse.json({ error: link.error }, { status: link.status })
    }

    const clientName = `${client?.first_name ?? ""} ${client?.last_name ?? ""}`.trim() || "your athlete"
    try {
      await sendPackPaymentLinkEmail({
        to,
        ccClientEmail: client?.email ?? null,
        clientName,
        packLabel: `${pack.credits_total}× ${pack.session_type}`,
        amountCents: pack.price_cents,
        url: link.url,
      })
    } catch {
      return NextResponse.json({ error: "Couldn't send the email — copy the link and send it manually" }, { status: 502 })
    }

    const emailedAt = new Date().toISOString()
    await updateClientPackage(id, { bill_to_emailed_at: emailedAt })

    void recordAudit({
      action: "pack.payment_link_emailed",
      category: "commerce",
      outcome: "success",
      target: { type: "client_package", id, label: pack.session_type },
      metadata: { client_user_id: pack.client_user_id, sent_to: to, refreshed: link.refreshed },
      request,
    })

    return NextResponse.json({ ok: true, sentTo: to, emailedAt })
  } catch (error) {
    console.error("Email pack payment link error:", error)
    return NextResponse.json({ error: "Failed to email the payment link" }, { status: 500 })
  }
}
```

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add lib/email.ts lib/audit/actions.ts app/api/admin/session-packs/\[id\]/email-link/route.ts __tests__/lib/email-pack-payment-link.test.ts
git commit -m "feat(packs): email a pack payment link to the payer, CC the client"
```

---

### Task 6: Change the address on a pending pack

**Files:**
- Modify: `lib/services/pack-payment-link.ts` (add `changePackBillTo`)
- Create: `app/api/admin/session-packs/[id]/bill-to/route.ts`
- Modify: `lib/audit/actions.ts` (one more slug)
- Test: `__tests__/lib/services/pack-bill-to-change.test.ts` (create)

**Interfaces:**
- Consumes: Task 4's module.
- Produces: `changePackBillTo(pack: ClientPackage, billToEmail: string | null): Promise<PackLinkResult>`; audit slug `pack.bill_to_changed`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/services/pack-bill-to-change.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const retrieveMock = vi.fn()
const expireMock = vi.fn()
const createPackCheckoutSessionMock = vi.fn()
const updateClientPackageMock = vi.fn()

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        retrieve: (...a: unknown[]) => retrieveMock(...a),
        expire: (...a: unknown[]) => expireMock(...a),
      },
    },
  },
  createPackCheckoutSession: (...a: unknown[]) => createPackCheckoutSessionMock(...a),
}))
vi.mock("@/lib/db/client-packages", () => ({
  updateClientPackage: (...a: unknown[]) => updateClientPackageMock(...a),
}))

import { changePackBillTo } from "@/lib/services/pack-payment-link"
import type { ClientPackage } from "@/types/database"

const pack = {
  id: "pack-1",
  client_user_id: "client-1",
  product_id: null,
  session_type: "Performance training",
  credits_total: 10,
  price_cents: 150000,
  payment_method: "stripe",
  payment_status: "pending",
  stripe_session_id: "cs_old",
  bill_to_email: null,
} as unknown as ClientPackage

beforeEach(() => {
  vi.clearAllMocks()
  createPackCheckoutSessionMock.mockResolvedValue({ id: "cs_new", url: "https://stripe.test/cs_new" })
  expireMock.mockResolvedValue({})
})

describe("changePackBillTo", () => {
  it("expires the open session and mints one addressed to the new payer", async () => {
    retrieveMock.mockResolvedValue({ status: "open", url: "https://stripe.test/cs_old" })
    const r = await changePackBillTo(pack, "dad@example.com")
    expect(expireMock).toHaveBeenCalledWith("cs_old")
    expect(createPackCheckoutSessionMock.mock.calls[0][0].billToEmail).toBe("dad@example.com")
    expect(r).toMatchObject({ ok: true, refreshed: true })
  })

  it("persists the new address alongside the new session id", async () => {
    retrieveMock.mockResolvedValue({ status: "open", url: "https://stripe.test/cs_old" })
    await changePackBillTo(pack, "dad@example.com")
    expect(updateClientPackageMock).toHaveBeenCalledWith("pack-1", {
      bill_to_email: "dad@example.com",
      stripe_session_id: "cs_new",
      bill_to_emailed_at: null,
    })
  })

  it("refuses when the session is already paid", async () => {
    retrieveMock.mockResolvedValue({ status: "complete" })
    const r = await changePackBillTo(pack, "dad@example.com")
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(expireMock).not.toHaveBeenCalled()
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("502s rather than guessing when Stripe is unreachable", async () => {
    retrieveMock.mockRejectedValue(new Error("stripe down"))
    const r = await changePackBillTo(pack, "dad@example.com")
    expect(r).toMatchObject({ ok: false, status: 502 })
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("502s when the old session cannot be expired, leaving two live links impossible", async () => {
    retrieveMock.mockResolvedValue({ status: "open", url: "https://stripe.test/cs_old" })
    expireMock.mockRejectedValue(new Error("nope"))
    const r = await changePackBillTo(pack, "dad@example.com")
    expect(r).toMatchObject({ ok: false, status: 502 })
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it("clears the address back to null", async () => {
    retrieveMock.mockResolvedValue({ status: "expired" })
    await changePackBillTo({ ...pack, bill_to_email: "dad@example.com" } as ClientPackage, null)
    expect(createPackCheckoutSessionMock.mock.calls[0][0].billToEmail).toBeNull()
    expect(updateClientPackageMock.mock.calls[0][1].bill_to_email).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/services/pack-bill-to-change.test.ts`
Expected: FAIL — `changePackBillTo` is not exported.

- [ ] **Step 3: Implement**

Append to `lib/services/pack-payment-link.ts`:

```ts
/**
 * Re-address a pack that is still awaiting payment.
 *
 * A pinned customer_email is baked into the Checkout session at creation, so
 * changing the addressee means killing the old session and minting a new one.
 * Same guards as deleting a pending pack: never touch a `complete` session, and
 * never proceed on a Stripe error — a second live link for one pack is worse
 * than a failed edit.
 */
export async function changePackBillTo(
  pack: ClientPackage,
  billToEmail: string | null,
): Promise<PackLinkResult> {
  if (pack.payment_method !== "stripe" || pack.payment_status !== "pending") {
    return { ok: false, status: 409, error: "This pack is not awaiting a card payment" }
  }

  if (pack.stripe_session_id) {
    let existing
    try {
      existing = await stripe.checkout.sessions.retrieve(pack.stripe_session_id)
    } catch (err) {
      console.warn("[pack bill-to] could not retrieve existing checkout session:", err)
      return {
        ok: false,
        status: 502,
        error: "Couldn't check the existing payment link with Stripe — try again in a moment",
      }
    }
    if (existing.status === "complete") {
      return {
        ok: false,
        status: 409,
        error: "This pack was already paid — refresh the page instead of changing its billing email",
      }
    }
    if (existing.status === "open") {
      try {
        await stripe.checkout.sessions.expire(pack.stripe_session_id)
      } catch (err) {
        console.warn("[pack bill-to] could not expire existing checkout session:", err)
        return {
          ok: false,
          status: 502,
          error: "Couldn't cancel the old payment link — try again in a moment",
        }
      }
    }
  }

  const checkout = await createPackCheckoutSession({
    clientUserId: pack.client_user_id,
    name: `${pack.credits_total}× ${pack.session_type}`,
    sessionType: pack.session_type,
    credits: pack.credits_total,
    priceCents: pack.price_cents,
    validityDays: null,
    productId: pack.product_id,
    billToEmail,
    returnUrl: "/client/sessions",
    cancelUrl: "/client/sessions",
  })

  // bill_to_emailed_at resets: the address this pack was last emailed to is no
  // longer the address it is billed to.
  await updateClientPackage(pack.id, {
    bill_to_email: billToEmail,
    stripe_session_id: checkout.id,
    bill_to_emailed_at: null,
  })

  return { ok: true, url: checkout.url!, refreshed: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/lib/services/pack-bill-to-change.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the audit slug**

In `lib/audit/actions.ts`, after `pack.payment_link_emailed`:

```ts
  { slug: "pack.bill_to_changed", category: "commerce", description: "Session pack billing email changed (payment link re-issued)" },
```

- [ ] **Step 6: Add the route**

Create `app/api/admin/session-packs/[id]/bill-to/route.ts`:

```ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getClientPackageByIdMaybe } from "@/lib/db/client-packages"
import { changePackBillTo } from "@/lib/services/pack-payment-link"
import { recordAudit } from "@/lib/audit/record"

const bodySchema = z.object({ billToEmail: z.string().email().nullable() })

/**
 * PATCH — change (or clear) who this pack's payment link is addressed to.
 * Re-issues the Stripe link, so the previously shared URL stops working.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const { id } = await ctx.params

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 })
    }

    const pack = await getClientPackageByIdMaybe(id)
    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 })
    }

    const result = await changePackBillTo(pack, parsed.data.billToEmail)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    void recordAudit({
      action: "pack.bill_to_changed",
      category: "commerce",
      outcome: "success",
      target: { type: "client_package", id, label: pack.session_type },
      metadata: {
        client_user_id: pack.client_user_id,
        bill_to_email: parsed.data.billToEmail,
        previous_bill_to_email: pack.bill_to_email,
      },
      request,
    })

    return NextResponse.json({ url: result.url, billToEmail: parsed.data.billToEmail })
  } catch (error) {
    console.error("Change pack bill-to error:", error)
    return NextResponse.json({ error: "Failed to change the billing email" }, { status: 500 })
  }
}
```

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add lib/services/pack-payment-link.ts lib/audit/actions.ts app/api/admin/session-packs/\[id\]/bill-to/route.ts __tests__/lib/services/pack-bill-to-change.test.ts
git commit -m "feat(packs): re-address a pending pack's payment link"
```

---

### Task 7: UI

**Files:**
- Modify: `components/admin/packs/SellPackDialog.tsx`
- Modify: `components/admin/packs/ClientPackagesPanel.tsx`
- Test: `__tests__/components/admin/packs/SellPackDialog.bill-to.test.tsx` (create)

**Interfaces:**
- Consumes: `billToEmail` on the sell payload (Task 3), `POST .../email-link` (Task 5), `PATCH .../bill-to` (Task 6).
- Produces: no exports beyond the existing components.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/packs/SellPackDialog.bill-to.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SellPackDialog } from "@/components/admin/packs/SellPackDialog"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const CLIENT = "11111111-1111-4111-8111-111111111111"

function mockFetch(impl: (url: string, init?: RequestInit) => unknown) {
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => impl(url, init),
  })) as unknown as typeof fetch
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

describe("SellPackDialog — bill to someone else", () => {
  it("sends billToEmail with the sale when the box is checked", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    mockFetch((url, init) => {
      if (url.includes("/checkout")) {
        calls.push({ url, body: JSON.parse(String(init?.body)) })
        return { url: "https://stripe.test/cs_1" }
      }
      return { products: [], programs: [] }
    })

    const user = userEvent.setup()
    render(<SellPackDialog clientUserId={CLIENT} onSold={() => {}} trigger={<button>Sell pack</button>} />)
    await user.click(screen.getByText("Sell pack"))

    await user.click(await screen.findByLabelText(/someone else is paying/i))
    await user.type(screen.getByLabelText(/billing email/i), "dad@example.com")
    await user.click(screen.getByRole("button", { name: /create payment link/i }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body.billToEmail).toBe("dad@example.com")
  })

  it("omits billToEmail entirely when the box is left unchecked", async () => {
    const calls: { body: Record<string, unknown> }[] = []
    mockFetch((url, init) => {
      if (url.includes("/checkout")) {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return { url: "https://stripe.test/cs_1" }
      }
      return { products: [], programs: [] }
    })

    const user = userEvent.setup()
    render(<SellPackDialog clientUserId={CLIENT} onSold={() => {}} trigger={<button>Sell pack</button>} />)
    await user.click(screen.getByText("Sell pack"))
    await user.click(await screen.findByRole("button", { name: /create payment link/i }))

    await waitFor(() => expect(calls).toHaveLength(1))
    // Sending "" would fail the .email() validator and break ordinary sales.
    expect("billToEmail" in calls[0].body).toBe(false)
  })

  it("shows who the finished link is addressed to", async () => {
    mockFetch((url) => (url.includes("/checkout") ? { url: "https://stripe.test/cs_1" } : { products: [], programs: [] }))

    const user = userEvent.setup()
    render(<SellPackDialog clientUserId={CLIENT} onSold={() => {}} trigger={<button>Sell pack</button>} />)
    await user.click(screen.getByText("Sell pack"))
    await user.click(await screen.findByLabelText(/someone else is paying/i))
    await user.type(screen.getByLabelText(/billing email/i), "dad@example.com")
    await user.click(screen.getByRole("button", { name: /create payment link/i }))

    expect(await screen.findByText(/dad@example.com/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/components/admin/packs/SellPackDialog.bill-to.test.tsx`
Expected: FAIL — no "Someone else is paying" control.

- [ ] **Step 3: Implement the dialog changes**

In `components/admin/packs/SellPackDialog.tsx`:

Add state next to the other `useState` calls:

```tsx
  const [billToOther, setBillToOther] = useState(false)
  const [billToEmail, setBillToEmail] = useState("")
```

Reset both in `handleOpenChange` alongside `setCreatedLink(null)`:

```tsx
      setBillToOther(false)
      setBillToEmail("")
```

In `submit()`, after the `programId` line, add — note it is omitted rather than sent empty, so an
unchecked box can never fail the `.email()` validator:

```tsx
      const trimmedBillTo = billToEmail.trim()
      if (paymentMethod === "stripe" && billToOther) {
        if (!trimmedBillTo) {
          toast.error("Enter the billing email, or untick “Someone else is paying”")
          return
        }
        body.billToEmail = trimmedBillTo
      }
```

In the Payment section, after the `cash_owed` hint, add:

```tsx
            {paymentMethod === "stripe" && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={billToOther}
                    onChange={(e) => setBillToOther(e.target.checked)}
                    className="size-4 rounded border-border"
                  />
                  Someone else is paying
                </label>
                {billToOther && (
                  <div className="space-y-1.5">
                    <Label htmlFor="billTo">Billing email</Label>
                    <Input
                      id="billTo"
                      type="email"
                      value={billToEmail}
                      onChange={(e) => setBillToEmail(e.target.value)}
                      placeholder="parent@example.com"
                    />
                    <p className="text-xs text-muted-foreground">
                      The payment page and the receipt go to this address. The pack still belongs to the client.
                    </p>
                  </div>
                )}
              </div>
            )}
```

On the created-link screen, replace the "It's addressed to their email" paragraph with a version that
names the actual addressee:

```tsx
            <p className="text-sm text-muted-foreground">
              Send this link to whoever is paying (WhatsApp, text, email). Don&apos;t pay through it yourself.
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Billed to </span>
              <span className="font-medium text-foreground">{billToEmail.trim() || "the client"}</span>
            </p>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/components/admin/packs/SellPackDialog.bill-to.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the pack-row controls**

In `components/admin/packs/ClientPackagesPanel.tsx` add two handlers next to `copyPaymentLink`:

```tsx
  async function emailPaymentLink(packId: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/session-packs/${packId}/email-link`, { method: "POST" })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? "Could not email the payment link")
        return
      }
      toast.success(`Payment link emailed to ${d.sentTo}`)
      router.refresh()
    } catch {
      toast.error("Network error — the link was not emailed")
    } finally {
      setBusy(false)
    }
  }

  async function changeBillTo(packId: string, current: string | null) {
    const next = window.prompt(
      "Email the payment link should be addressed to (blank = the client). This re-issues the link, so the old one stops working.",
      current ?? "",
    )
    if (next === null) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/session-packs/${packId}/bill-to`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ billToEmail: next.trim() || null }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? "Could not change the billing email")
        return
      }
      toast.success(next.trim() ? `Now billed to ${next.trim()}` : "Now billed to the client")
      router.refresh()
    } catch {
      toast.error("Network error — the billing email was not changed")
    } finally {
      setBusy(false)
    }
  }
```

Add `Mail` and `UserPen` to the `lucide-react` import, then extend the pending-Stripe block's button
row with:

```tsx
                    <Button size="sm" variant="outline" onClick={() => emailPaymentLink(p.id)} disabled={busy}>
                      <Mail className="size-3.5" />
                      Email link
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => changeBillTo(p.id, p.bill_to_email)} disabled={busy}>
                      <UserPen className="size-3.5" />
                      Change billing email
                    </Button>
```

and replace that block's trailing hint paragraph with:

```tsx
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Billed to{" "}
                    <span className="text-foreground">{p.bill_to_email ?? "the client"}</span>
                    {p.bill_to_emailed_at ? ` · emailed ${fmtDate(p.bill_to_emailed_at)}` : ""}. The pack shows as
                    paid automatically once they pay, or mark it paid yourself if the money came another way.
                  </p>
```

- [ ] **Step 6: Run the component suite**

Run: `npx vitest run __tests__/components/admin/packs`
Expected: PASS, no regressions in the existing pack component tests.

- [ ] **Step 7: Commit**

```bash
git add components/admin/packs __tests__/components/admin/packs/SellPackDialog.bill-to.test.tsx
git commit -m "feat(packs): bill-to controls on the sell dialog and pack row"
```

---

### Task 8: Full verification

**Files:** none changed unless a failure surfaces.

- [ ] **Step 1: Full test suite**

Run: `npm run test:run`
Expected: no NEW failures versus the pre-change baseline. Per
`docs`/memory, the Stripe-webhook tests load-flake by wall-clock timeout under
parallel load — confirm any red there reproduces on `main` before blaming this work.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: compiles, and the three new routes appear in the route table:
`/api/admin/session-packs/[id]/email-link`, `/api/admin/session-packs/[id]/bill-to`.

Do NOT chain this behind `npm run test:run` with `&&` — known-red tests exit non-zero and would
skip the build.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "test(packs): fixes from full-suite verification"
```

## Self-Review

**Spec coverage:** data model → Task 1; resolution order → Task 2; persist on sell → Task 3; re-mint keeps address → Task 4; emailing with CC → Task 5; change on existing pack → Task 6; UI → Task 7; testing → each task plus Task 8. The spec's `COACH_EMAIL` warning is deliberately **dropped**: `COACH_EMAIL` is a server-side constant not exposed to the sell dialog, and plumbing it through for a non-blocking warning is not worth a new prop on a money-path component. The coach typing their own address still gets a working link — the original bug was an *unpinned* email autofilling, which cannot happen once any address is pinned.

**Placeholders:** none — every step carries the code it needs.

**Type consistency:** `billToEmail` (camelCase) is the API/param name throughout; `bill_to_email` / `bill_to_emailed_at` (snake_case) are the DB columns throughout. `PackLinkResult` is defined once in Task 4 and reused in Task 6.
