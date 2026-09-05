# Remove `SINGLETON_BUSINESS_ID` from production code — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every DAL function under `lib/` requires its tenant; every caller supplies one from a session, a row that carries it, or the `platformBusinessId()` seam with an inventory entry — taking the production reference count from 25 to 6 by the brief's exact command.

**Architecture:** Callers are converted first, one entry point per task, while the DAL defaults still exist — so the branch builds at every commit. The defaults are then removed in two mechanical passes, and `tsc` proves no caller was missed. The inventory in `lib/tenancy/platform.ts` is reconciled last and pinned by a structural test.

**Tech Stack:** Next.js 16 App Router, Supabase (service-role client), Vitest (`// @vitest-environment node` on line 1 of every new suite — jsdom cannot start in this repo and reports "no tests"), TypeScript.

**Spec:** [docs/superpowers/specs/2026-09-05-remove-singleton-business-id-design.md](../specs/2026-09-05-remove-singleton-business-id-design.md) — §1 is the classification table, §5 the caller map, §7 the comment-rewrite rule, §10 the decisions to surface.

## Global Constraints

- **Branch / worktree:** `feat/remove-singleton-business-id` at `/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete-singleton-removal`. Do all work there. Never touch the primary checkout at `…/djpathlete` (it is on `main` with other sessions' untracked files).
- **No Claude attribution anywhere** — not in commit messages, not in code comments. This overrides any default trailer instruction.
- **Never add a `SINGLETON_BUSINESS_ID` reference.** A file that needs the platform business calls `platformBusinessId()` from `@/lib/tenancy/platform` and is listed in that file's inventory.
- **One resolution per entry point.** A route/page/component resolves its tenant ONCE at the top and threads it. Never call `platformBusinessId()` twice in one file.
- **Sentinel discipline in tests.** When a test proves a caller goes through the seam, MOCK the seam: `vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))` and assert `"platform-biz"` reached the DAL. A test asserting the real UUID passes for a hard-coded constant too. When the tenant comes from a row, the fixture uses `"22222222-2222-4222-8222-222222222222"` — never the platform id.
- **Every test run must show a NON-ZERO test count.** "Test Files 1 passed / Tests 0" is jsdom silently running nothing. Report the count in the task summary.
- **`tsc` set comparison, not count.** Baseline (251 errors, captured on `0cb030a9`) lives OUTSIDE the repo at `/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/tsc-base-singleton-removal-2026-09-05.txt` (the brief's shape) and `…/tsc-base-full-singleton-removal-2026-09-05.txt` (full sorted error lines). Compare with:
  ```bash
  npx tsc --noEmit 2>&1 | grep -E "error TS" | sort > /tmp/tsc-after-full.txt
  diff "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/tsc-base-full-singleton-removal-2026-09-05.txt" /tmp/tsc-after-full.txt && echo "TSC SET IDENTICAL"
  ```
  A diff line starting with `>` is an error you introduced. A `<` line is one you removed (fine, but say so).
- **`npm run lint` is broken repo-wide** (Next 16 removed `next lint`). Use `npx prettier --check <files you touched>`.
- **Invariants (do not re-litigate):** `users.role` stays `admin | client | editor | staff`. `lib/tenancy/resolve.ts` is the only tenant boundary. Do NOT scope `listGoogleAdsAccounts` or touch anything in `lib/ads/` or under `app/(admin)/admin/ads`. No permission presets/tiers/switchers.
- **Do not push, merge, or open a PR.** Commit on the branch only.

---

### Task 1: Public lead-capture routes, part 1 — `contact`, `shop/leads`, `newsletter`

**Files:**
- Modify: `app/api/contact/route.ts` (import block :1-7; `captureLead` call :61)
- Modify: `app/api/shop/leads/route.ts` (import block :1-11; `captureLead` call :46)
- Modify: `app/api/newsletter/route.ts` (import block :1-13; `resolveNewsletterConsentWording` :36-44; `captureLead` :73; `recordConsent` :86)
- Test: `__tests__/api/spine/contact-spine.test.ts` (extend)
- Test: `__tests__/api/spine/shop-leads-spine.test.ts` (extend)
- Test: `__tests__/api/newsletter/tenant.test.ts` (create)

**Interfaces:**
- Consumes: `platformBusinessId(): string` from `@/lib/tenancy/platform` (exists). `captureLead(input: CaptureLeadInput)` where `CaptureLeadInput.businessId?: string` is still optional until Task 9.
- Produces: nothing other tasks import. Task 11 lists these three files in the inventory.

- [ ] **Step 1: Write the failing tests**

In `__tests__/api/spine/contact-spine.test.ts`, add this mock directly after the existing `vi.mock("@/lib/email", …)` block (before `import { POST }`):

```ts
// The seam is MOCKED to a sentinel, not left real: a route that hard-coded the
// constant instead of calling platformBusinessId() would pass a test that
// asserted the real id, and the whole point of the seam is that phase 4
// changes ONE function.
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))
```

And this describe at the end of the file:

```ts
describe("POST /api/contact — tenant", () => {
  it("files the contact under the business the seam names, resolved once and threaded", async () => {
    const res = await post(VALID_BODY)
    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).toHaveBeenCalledTimes(1)
    expect(mocks.recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
  })
})
```

In `__tests__/api/spine/shop-leads-spine.test.ts`, add the same `vi.mock("@/lib/tenancy/platform", …)` line after the `@/lib/audit/record` mock, and this describe at the end:

```ts
describe("POST /api/shop/leads — tenant", () => {
  it("files the contact under the business the seam names", async () => {
    const res = await POST(req({ email: "buyer@example.com", product_id: PRODUCT_ID, website: "" }, "198.51.100.77"))
    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
  })
})
```

Create `__tests__/api/newsletter/tenant.test.ts`:

```ts
// @vitest-environment node
//
// POST /api/newsletter — WHICH business the subscribe files under.
//
// A public route with no session, so the tenant comes from the seam in
// lib/tenancy/platform.ts. The seam is mocked to a sentinel so this proves the
// route CALLS it: a hard-coded constant would satisfy an assertion on the real
// id just as well. All three writes — the contact, the settings read behind the
// consent wording, and the consent row — must carry the same value, resolved
// once at the top of the handler.
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  addSubscriberWithAttribution: vi.fn(),
  ghlCreateContact: vi.fn(),
  recordContactEvent: vi.fn(),
  recordConsent: vi.fn(),
  getBusinessSettings: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock("@/lib/db/newsletter", () => ({ addSubscriberWithAttribution: h.addSubscriberWithAttribution }))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: h.ghlCreateContact }))
vi.mock("@/lib/db/contacts", () => ({ recordContactEvent: h.recordContactEvent }))
vi.mock("@/lib/db/contact-consents", () => ({ recordConsent: h.recordConsent }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: h.getBusinessSettings }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: h.recordAudit }))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))

import { POST } from "@/app/api/newsletter/route"

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/newsletter", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  h.addSubscriberWithAttribution.mockResolvedValue({ id: "sub-1" })
  h.ghlCreateContact.mockResolvedValue(null)
  h.recordContactEvent.mockResolvedValue({ contactId: "contact-1", created: true, merged: false })
  h.recordConsent.mockResolvedValue(undefined)
  h.getBusinessSettings.mockResolvedValue({ business_id: "platform-biz", display_name: "Acme Fitness" })
})

describe("POST /api/newsletter — tenant", () => {
  it("resolves the tenant once through the seam and threads it into the contact, the settings read and the consent row", async () => {
    const res = await POST(
      req({ email: "sub@example.com", consent_marketing: true, consent_context: "checkbox" }),
      { params: Promise.resolve({}) },
    )
    expect(res.ok).toBe(true)
    expect(h.recordContactEvent).toHaveBeenCalledTimes(1)
    expect(h.recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
    expect(h.getBusinessSettings).toHaveBeenCalledWith("platform-biz")
    expect(h.recordConsent).toHaveBeenCalledTimes(1)
    expect(h.recordConsent.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/api/spine/contact-spine.test.ts __tests__/api/spine/shop-leads-spine.test.ts __tests__/api/newsletter/tenant.test.ts`
Expected: the three new tests FAIL — `recordContactEvent` was called without `businessId` (`toMatchObject` reports the missing key) and `getBusinessSettings` was called with no arguments. Every pre-existing test in the two spine suites still passes. Note the test count (it must be > 0 in every file).

- [ ] **Step 3: Convert `app/api/contact/route.ts`**

Add the import:

```ts
import { platformBusinessId } from "@/lib/tenancy/platform"
```

Immediately after the `result.data` destructuring inside the handler (before the first database write), add:

```ts
    // PUBLIC ROUTE, NO SESSION TO RESOLVE A TENANT FROM. `platformBusinessId()`
    // is the seam until phase 4 resolves a real business off the Host header
    // (lib/tenancy/platform.ts, CANNOT RESOLVE YET). Resolved once here and
    // threaded; the DAL no longer defaults it.
    const businessId = platformBusinessId()
```

Change the capture call to:

```ts
    await captureLead({ source: "contact_form", email, name, businessId })
```

- [ ] **Step 4: Convert `app/api/shop/leads/route.ts`**

Add the same import. After the lead schema parse succeeds and `email`/`product_id` are in scope, add the same four-line comment and `const businessId = platformBusinessId()`. Change the capture call to:

```ts
  await captureLead({ source: "lead_magnet", email, metadata: { product_id }, businessId })
```

- [ ] **Step 5: Convert `app/api/newsletter/route.ts`**

Add the import. Change `resolveNewsletterConsentWording` to take the tenant:

```ts
async function resolveNewsletterConsentWording(
  consentContext: "checkbox" | "inline" | undefined,
  businessId: string,
): Promise<string> {
  if (consentContext !== "checkbox") return NEWSLETTER_CONSENT_WORDING
  const settings = await getBusinessSettings(businessId)
  if (!hasNewsletterConsentDisplayName(settings.display_name)) {
    console.warn("[Newsletter] checkbox consent wording skipped: business_settings.display_name is blank")
    return NEWSLETTER_CONSENT_WORDING
  }
  return renderNewsletterConsentWording(settings.display_name)
}
```

In the handler, right after the `result.success` check, add the seam comment and `const businessId = platformBusinessId()`. Then:

```ts
    const contactId = await captureLead({ source: "newsletter", email: result.data.email, businessId })
```

```ts
        const wordingShown = await resolveNewsletterConsentWording(result.data.consent_context, businessId)
        await recordConsent({
          contactId,
          channel: "email",
          granted: true,
          source: "newsletter",
          wordingShown,
          ip,
          userAgent,
          businessId,
        })
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run __tests__/api/spine/contact-spine.test.ts __tests__/api/spine/shop-leads-spine.test.ts __tests__/api/newsletter/tenant.test.ts __tests__/api/newsletter/attribution-capture.test.ts --environment node`
Expected: all PASS with a non-zero count in each file (attribution-capture is 4 tests; it has no pragma, hence `--environment node` on the command line).

- [ ] **Step 7: Type-check and format**

Run: `npx tsc --noEmit 2>&1 | grep -E "error TS" | sort > /tmp/tsc-after-full.txt && diff "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/tsc-base-full-singleton-removal-2026-09-05.txt" /tmp/tsc-after-full.txt && echo "TSC SET IDENTICAL"`
Expected: `TSC SET IDENTICAL`.
Run: `npx prettier --check app/api/contact/route.ts app/api/shop/leads/route.ts app/api/newsletter/route.ts __tests__/api/newsletter/tenant.test.ts`
Expected: all formatted (run `npx prettier --write` on any that are not).

- [ ] **Step 8: Commit**

```bash
git add app/api/contact/route.ts app/api/shop/leads/route.ts app/api/newsletter/route.ts __tests__/api/spine/contact-spine.test.ts __tests__/api/spine/shop-leads-spine.test.ts __tests__/api/newsletter/tenant.test.ts
git commit -m "refactor(tenancy): contact, shop-lead and newsletter routes resolve their tenant through the seam

Three public entry points that relied on the DAL's singleton default now
resolve platformBusinessId() once at the top of the handler and thread
it into every write. The seam is mocked to a sentinel in the tests so a
hard-coded constant cannot pass them."
```

---

### Task 2: Public lead-capture routes, part 2 — `inquiry`, `events/[id]/signup`, `events/[id]/checkout`

**Files:**
- Modify: `app/api/inquiry/route.ts` (import block :1-18; `captureLead` :149; `recordInquirySmsConsent` :421-441 and its call site)
- Modify: `app/api/events/[id]/signup/route.ts` (imports :1-11; `captureLead` :70; `recordEventSignupSmsConsent` :133-152 and its call)
- Modify: `app/api/events/[id]/checkout/route.ts` (imports :1-10; `captureLead` :94; `recordEventSignupSmsConsent` :148-167 and its call)
- Test: `__tests__/api/spine/inquiry-spine.test.ts` (extend)
- Test: `__tests__/api/spine/event-signup-spine.test.ts` (extend — it covers BOTH event routes)

**Interfaces:**
- Consumes: `platformBusinessId()`; `captureLead`; `recordConsent({ …, businessId?: string })`; `getBusinessSettings(businessId?: string)` (defaults still present until Tasks 9–10).
- Produces: nothing imported elsewhere.

- [ ] **Step 1: Write the failing tests**

In `__tests__/api/spine/inquiry-spine.test.ts`, add after the `@/lib/supabase` mock:

```ts
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))
```

and at the end of the file:

```ts
describe("POST /api/inquiry — tenant", () => {
  it("resolves the tenant once through the seam and threads it into the contact, the settings read and the consent row", async () => {
    await post({ ...VALID_BODY, sms_consent: true })
    await flush()
    expect(mocks.recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
    expect(mocks.getBusinessSettings).toHaveBeenCalledWith("platform-biz")
    expect(mocks.recordConsent.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
  })
})
```

In `__tests__/api/spine/event-signup-spine.test.ts`, add after the `@/lib/supabase` mock:

```ts
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))
```

and at the end of the file:

```ts
describe("event routes — tenant", () => {
  const signupRow = {
    id: "sig-1",
    event_id: "evt-1",
    parent_name: "Alex Parent",
    parent_email: "alex@example.com",
    parent_phone: "5551234567",
    athlete_name: "Sam Athlete",
    athlete_age: 14,
    status: "pending",
  }

  it("signup: resolves the tenant once through the seam and threads it into contact, settings and consent", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce(signupRow)
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(signupReq({ ...validBody, sms_consent: true }), ctx)
    await flush()
    expect(res.status).toBe(201)
    expect(mocks.recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
    expect(mocks.getBusinessSettings).toHaveBeenCalledWith("platform-biz")
    expect(mocks.recordConsent.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
  })

  it("checkout: resolves the tenant once through the seam and threads it into contact, settings and consent", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce(signupRow)
    mocks.createEventCheckoutSession.mockResolvedValueOnce({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" })
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(checkoutReq({ ...validBody, sms_consent: true }), ctx)
    await flush()
    expect(res.ok).toBe(true)
    expect(mocks.recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
    expect(mocks.getBusinessSettings).toHaveBeenCalledWith("platform-biz")
    expect(mocks.recordConsent.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
  })
})
```

If the signup route's success status in the existing suite is not 201, match whatever the suite's own happy-path test asserts — the status is not what this test is about.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run __tests__/api/spine/inquiry-spine.test.ts __tests__/api/spine/event-signup-spine.test.ts`
Expected: the three new tests FAIL on the missing `businessId` / no-argument `getBusinessSettings`; every existing test passes; counts > 0.

- [ ] **Step 3: Convert `app/api/inquiry/route.ts`**

Add `import { platformBusinessId } from "@/lib/tenancy/platform"`. Right after the inquiry schema parse succeeds, add the seam comment (the same four lines as Task 1) and `const businessId = platformBusinessId()`. Thread it:

```ts
    const contactId = await captureLead({
      source: contactSource,
      email,
      phone,
      name,
      attribution: { gclid, gbraid, wbraid, fbclid },
      businessId,
    })
```

Change `recordInquirySmsConsent` to require the tenant and pass it to both calls:

```ts
async function recordInquirySmsConsent(input: {
  contactId: string
  ip: string | null
  userAgent: string | null
  source: ContactEventSource
  businessId: string
}): Promise<void> {
  const settings = await getBusinessSettings(input.businessId)
  if (!hasSmsConsentDisplayName(settings.display_name)) {
    console.warn("[inquiry] sms consent skipped: business_settings.display_name is blank")
    return
  }
  await recordConsent({
    contactId: input.contactId,
    channel: "sms",
    granted: true,
    source: input.source,
    wordingShown: renderSmsConsentWording(settings.display_name),
    ip: input.ip,
    userAgent: input.userAgent,
    businessId: input.businessId,
  })
}
```

and add `businessId` to the object at its call site.

- [ ] **Step 4: Convert both event routes**

In each of `app/api/events/[id]/signup/route.ts` and `app/api/events/[id]/checkout/route.ts`: add the import; after the event is loaded and validated (before `captureLead`), add the seam comment and `const businessId = platformBusinessId()`; add `businessId` to the `captureLead({...})` object; change `recordEventSignupSmsConsent` to take `businessId: string` in its input, call `getBusinessSettings(input.businessId)`, pass `businessId: input.businessId` to `recordConsent`, and add `businessId` at its call site. The two functions are near-identical copies — convert both the same way.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run __tests__/api/spine/inquiry-spine.test.ts __tests__/api/spine/event-signup-spine.test.ts __tests__/api/events/signup.test.ts __tests__/api/events/checkout.test.ts __tests__/api/inquiry/attribution-capture.test.ts --environment node`
Expected: all PASS, counts > 0 in every file.

- [ ] **Step 6: Type-check, format, commit**

Run the tsc set diff (Global Constraints) — expected `TSC SET IDENTICAL`. Run `npx prettier --check` on the three routes and two suites.

```bash
git add app/api/inquiry/route.ts "app/api/events/[id]/signup/route.ts" "app/api/events/[id]/checkout/route.ts" __tests__/api/spine/inquiry-spine.test.ts __tests__/api/spine/event-signup-spine.test.ts
git commit -m "refactor(tenancy): inquiry and event signup routes resolve their tenant through the seam

Each resolves platformBusinessId() once and threads it into the
contact write, the settings read behind the SMS consent wording, and
the consent row, so the wording shown and the wording filed can never
be scoped to different businesses."
```

---

### Task 3: Funnel submit — the route, `capture-contact.ts`, and the two islands

**Files:**
- Modify: `lib/funnels/capture-contact.ts` (input type :16-24; `recordContactEvent` call :27-34)
- Modify: `app/api/funnels/submit/route.ts` (imports :10-29; `captureContactFromSubmission` :143-151; `recordFunnelSmsConsent` :333-352 and its call :162-168)
- Modify: `components/funnels/islands/FormIsland.tsx` (`getBusinessSettings` :50-52)
- Modify: `components/funnels/islands/QuizIsland.tsx` (`getBusinessSettings` :44)
- Test: `__tests__/api/funnel-submit-contact.test.ts` (retarget)
- Test: `__tests__/api/funnels/submit-sms-consent.test.ts` (extend)

**Interfaces:**
- Produces: `captureContactFromSubmission(input: { …; businessId: string })` — REQUIRED from this task on. Its only caller is the submit route, converted here.

- [ ] **Step 1: Retarget `__tests__/api/funnel-submit-contact.test.ts`**

Every `captureContactFromSubmission({...})` call in that file gains `businessId: "platform-biz"`, and the first test's `toHaveBeenCalledWith(expect.objectContaining({...}))` gains `businessId: "platform-biz"` inside the `objectContaining`. (This is the bridge, not a route — it has no seam of its own; it passes through whatever the route resolved.)

- [ ] **Step 2: Write the failing route test**

In `__tests__/api/funnels/submit-sms-consent.test.ts`, add after the `@/lib/events/checkout` mock:

```ts
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))
```

and at the end of the file:

```ts
describe("POST /api/funnels/submit — tenant", () => {
  it("resolves the tenant once through the seam and threads it into the bridge, the settings read and the consent row", async () => {
    const res = await POST(request({ sms_consent: true }))
    await flush()
    expect(res.status).toBe(200)
    expect(captureContactFromSubmission.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
    expect(getBusinessSettings).toHaveBeenCalledWith("platform-biz")
    expect(recordConsent.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run __tests__/api/funnel-submit-contact.test.ts __tests__/api/funnels/submit-sms-consent.test.ts`
Expected: the new route test FAILS (missing `businessId`, no-arg settings read). The retargeted bridge test also FAILS until Step 4 threads the field through.

- [ ] **Step 4: Convert `lib/funnels/capture-contact.ts`**

```ts
export async function captureContactFromSubmission(input: {
  name: string | null
  email: string | null
  phone: string | null
  attributionSessionId: string | null
  funnelId?: string | null
  stepId?: string | null
  payload: Record<string, unknown>
  /**
   * REQUIRED, and deliberately not defaulted. This bridge has no tenant of its
   * own — the submit route resolves one and hands it over. A default here is
   * how a second coach's funnel lead would silently file under the platform.
   */
  businessId: string
}): Promise<string | null> {
  if (!input.email && !input.phone) return null
  try {
    const { contactId } = await recordContactEvent({
      email: input.email,
      phone: input.phone,
      name: input.name,
      source: "funnel_form",
      attributionSessionId: input.attributionSessionId,
      metadata: input.payload,
      businessId: input.businessId,
    })
    return contactId
```

- [ ] **Step 5: Convert `app/api/funnels/submit/route.ts`**

Add `import { platformBusinessId } from "@/lib/tenancy/platform"`. After `parsedBody` is validated (before `createSubmission`), add:

```ts
  // PUBLIC ROUTE, NO SESSION TO RESOLVE A TENANT FROM — and no row to inherit
  // one from either: `funnels`, `funnel_steps` and `funnel_submissions` carry
  // no business_id (no funnel migration mentions the column). `platformBusinessId()`
  // is the seam until phase 4 resolves a real business off the Host header
  // (lib/tenancy/platform.ts, CANNOT RESOLVE YET). Resolved once, threaded.
  const businessId = platformBusinessId()
```

Thread it: add `businessId` to the `captureContactFromSubmission({...})` object; add `businessId` to the `recordFunnelSmsConsent({...})` object; change the helper:

```ts
async function recordFunnelSmsConsent(input: {
  contactId: string
  ip: string | null
  userAgent: string | null
  businessId: string
}): Promise<void> {
  const settings = await getBusinessSettings(input.businessId)
  if (!hasSmsConsentDisplayName(settings.display_name)) {
    console.warn("[funnels/submit] sms consent skipped: business_settings.display_name is blank")
    return
  }
  await recordConsent({
    contactId: input.contactId,
    channel: "sms",
    granted: true,
    source: "funnel_form",
    wordingShown: renderSmsConsentWording(settings.display_name),
    ip: input.ip,
    userAgent: input.userAgent,
    businessId: input.businessId,
  })
}
```

- [ ] **Step 6: Convert the two islands**

In `components/funnels/islands/FormIsland.tsx` add `import { platformBusinessId } from "@/lib/tenancy/platform"` and change the read to:

```tsx
  // Read for the SAME business the submit route files the consent row under —
  // both go through the seam in lib/tenancy/platform.ts (CANNOT RESOLVE YET),
  // so the wording shown and the wording filed cannot name different businesses.
  const businessSettings = fields.some((field) => field.type === "tel")
    ? await getBusinessSettings(platformBusinessId()).catch(() => null)
    : null
```

In `components/funnels/islands/QuizIsland.tsx` add the same import and change the read to `await getBusinessSettings(platformBusinessId()).catch(() => null)` with a one-line comment pointing at the seam (`// Same business as /api/quiz/submit's consent write — see lib/tenancy/platform.ts.`). NOTE for QuizIsland: the submit route will inherit the ATTEMPT's business (Task 4), and the attempt is created by `/api/quiz/progress` under `platformBusinessId()` — so both are the platform today, by the same seam.

- [ ] **Step 7: Run to verify pass, type-check, format, commit**

Run: `npx vitest run __tests__/api/funnel-submit-contact.test.ts __tests__/api/funnels/submit-sms-consent.test.ts __tests__/app/api/funnels/submit-checkout.test.ts`
Expected: all PASS, counts > 0. Then the tsc set diff (`TSC SET IDENTICAL`) and prettier on the six files.

```bash
git add lib/funnels/capture-contact.ts app/api/funnels/submit/route.ts components/funnels/islands/FormIsland.tsx components/funnels/islands/QuizIsland.tsx __tests__/api/funnel-submit-contact.test.ts __tests__/api/funnels/submit-sms-consent.test.ts
git commit -m "refactor(tenancy): funnel submit resolves its tenant once and hands it to the bridge

captureContactFromSubmission now REQUIRES a businessId — the bridge has
no tenant of its own. Funnels carry no business_id on any table, so the
route is an honest seam until phase 4; the two islands read settings
through the same seam so shown and filed wording agree."
```

---

### Task 4: Quiz submit inherits the ATTEMPT's business

**Files:**
- Modify: `lib/db/quizzes.ts` (`QuizAttemptRow` :893-899; `getAttempt` :901-917)
- Modify: `app/api/quiz/submit/route.ts` (after the attempt check :126-129; `recordContactEvent` :244; `applyPipelineEvent` :270; `getBusinessSettings` :285 and :310; `recordConsent` :317)
- Test: `__tests__/lib/quizzes/get-attempt-business.test.ts` (create)
- Test: `__tests__/api/quiz-submit.test.ts` (extend)

**Interfaces:**
- Produces: `QuizAttemptRow.businessId: string` (additive). `getAttempt` selects `business_id`. The other consumer, `app/api/quiz/progress/route.ts`, ignores the new field.

- [ ] **Step 1: Write the failing DAL test**

Create `__tests__/lib/quizzes/get-attempt-business.test.ts`:

```ts
// @vitest-environment node
//
// getAttempt must SELECT and RETURN quiz_attempts.business_id. The submit
// route inherits the attempt's business for every write it makes, which is
// what keeps the attempt, the contact, the pipeline card and the consent row
// on one tenant by construction. A fixture id distinct from the platform's is
// the presence control: the platform id would pass for a route that ignored
// the row and fell back to a default.
import { describe, it, expect, vi } from "vitest"

const OTHER_BUSINESS_ID = "22222222-2222-4222-8222-222222222222"
const selectMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: (cols: string) => {
        selectMock(cols)
        return {
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "a1",
                quiz_id: "q1",
                branch_id: null,
                status: "in_progress",
                answers: [],
                business_id: OTHER_BUSINESS_ID,
              },
              error: null,
            }),
          }),
        }
      },
    }),
  }),
}))

import { getAttempt } from "@/lib/db/quizzes"

describe("getAttempt", () => {
  it("selects and returns the attempt's business_id so the submit route can inherit it", async () => {
    const row = await getAttempt("a1")
    expect(selectMock).toHaveBeenCalledTimes(1)
    expect(selectMock.mock.calls[0][0]).toContain("business_id")
    expect(row?.businessId).toBe(OTHER_BUSINESS_ID)
  })
})
```

- [ ] **Step 2: Write the failing route test**

In `__tests__/api/quiz-submit.test.ts`: add near the other id constants

```ts
// NOT the platform id. The route must take this from the attempt row; a
// fixture equal to the platform id would pass for a default just as well.
const ATTEMPT_BUSINESS_ID = "22222222-2222-4222-8222-222222222222"
```

change the `getAttempt` fixture in `beforeEach` to

```ts
  getAttempt.mockResolvedValue({
    id: ATTEMPT_ID,
    quizId: QUIZ_ID,
    branchId: null,
    status: "in_progress",
    answers: [],
    businessId: ATTEMPT_BUSINESS_ID,
  })
```

and add a test inside the main describe:

```ts
  it("files every write under the ATTEMPT's business — contact, pipeline card, settings read, consent row", async () => {
    await post({ phone: "5551234567", smsConsent: true })
    expect(recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: ATTEMPT_BUSINESS_ID })
    expect(applyPipelineEvent.mock.calls[0][0]).toMatchObject({ businessId: ATTEMPT_BUSINESS_ID })
    expect(getBusinessSettings).toHaveBeenCalledWith(ATTEMPT_BUSINESS_ID)
    expect(recordConsent.mock.calls[0][0]).toMatchObject({ businessId: ATTEMPT_BUSINESS_ID })
  })
```

(The `WORST_ANSWERS` fixture scores red, which is an alerting tier, so `getBusinessSettings` is reached on the alert path as well as the consent path — both must carry the attempt's id.)

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run __tests__/lib/quizzes/get-attempt-business.test.ts __tests__/api/quiz-submit.test.ts`
Expected: the DAL test FAILS (`select` string lacks `business_id`; `businessId` undefined); the route test FAILS (writes carry no `businessId`). Counts > 0.

- [ ] **Step 4: Widen `getAttempt`**

In `lib/db/quizzes.ts`:

```ts
export interface QuizAttemptRow {
  id: string
  quizId: string
  branchId: string | null
  status: string
  answers: QuizAnswer[]
  /**
   * The business the attempt was created under (`quiz_attempts.business_id`,
   * NOT NULL since 00228). /api/quiz/submit inherits it for every write it
   * makes, so the contact, the pipeline card and the consent row land on the
   * same tenant the attempt did — by construction, not by defaults agreeing.
   */
  businessId: string
}

export async function getAttempt(attemptId: string): Promise<QuizAttemptRow | null> {
  const { data, error } = await getClient()
    .from("quiz_attempts")
    .select("id, quiz_id, branch_id, status, answers, business_id")
    .eq("id", attemptId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as Row
  return {
    id: str(row.id),
    quizId: str(row.quiz_id),
    branchId: strOrNull(row.branch_id),
    status: str(row.status),
    answers: Array.isArray(row.answers) ? (row.answers as QuizAnswer[]) : [],
    businessId: str(row.business_id),
  }
}
```

- [ ] **Step 5: Convert the submit route**

Right after the `if (!attempt || attempt.quizId !== body.quizId)` block:

```ts
  // THE TENANT IS THE ATTEMPT'S. `quiz_attempts.business_id` was stamped when
  // /api/quiz/progress created the attempt, so every write below — the
  // contact, the pipeline card, the settings read, the consent row — lands on
  // the business the attempt belongs to, by construction rather than by four
  // defaults happening to agree. A public route, but NOT a caller of
  // platformBusinessId(): it has a row to inherit from.
  const businessId = attempt.businessId
```

Thread it: `businessId,` inside the `recordContactEvent({...})` object and the `applyPipelineEvent({...})` object; both `getBusinessSettings()` become `getBusinessSettings(businessId)`; `businessId,` inside the `recordConsent({...})` object.

- [ ] **Step 6: Run to verify pass, type-check, format, commit**

Run: `npx vitest run __tests__/lib/quizzes/get-attempt-business.test.ts __tests__/api/quiz-submit.test.ts __tests__/api/quiz-submit-funnel-lead.test.ts __tests__/api/quiz-progress.test.ts __tests__/app/api/quiz/preview-submit.test.ts`
Expected: all PASS, counts > 0. tsc set diff identical. Prettier on the four files.

```bash
git add lib/db/quizzes.ts app/api/quiz/submit/route.ts __tests__/lib/quizzes/get-attempt-business.test.ts __tests__/api/quiz-submit.test.ts
git commit -m "refactor(tenancy): quiz submit inherits the attempt's business instead of a default

getAttempt now returns quiz_attempts.business_id, and the submit route
threads it into the contact, the pipeline card, both settings reads and
the consent row. The one public entry point with a row to inherit from
resolves rather than falling to the seam."
```

---

### Task 5: The ask assistant surfaces, the marketing pages, and the two inquiry components

**Files:**
- Modify: `app/api/ask/config/route.ts` (imports :44-48; `getBusinessSettings()` :62)
- Modify: `app/(marketing)/ask/page.tsx` (imports :21-27; `getBusinessSettings()` :49)
- Modify: `app/api/ask/capture/route.ts` (`recordConsent` :374-385 inside `fileMarketingConsent`)
- Modify: `app/(marketing)/camps/[slug]/page.tsx` (`getBusinessSettings()` :69)
- Modify: `app/(marketing)/clinics/[slug]/page.tsx` (`getBusinessSettings()` :60)
- Modify: `components/public/InquiryForm.tsx` (`getBusinessSettings()` :44)
- Modify: `components/public/StepUpInquiryForm.tsx` (imports :8-10; `getBusinessSettings()` :15)
- Test: `__tests__/app/ask-config-route.test.ts` (extend)
- Test: `__tests__/api/ask-capture.test.ts` (extend)

**Interfaces:** consumes `platformBusinessId()`. The pages and components have jsdom-only suites that cannot run in this repo; they are verified by `tsc` and the build in Task 11.

- [ ] **Step 1: Write the failing tests**

In `__tests__/app/ask-config-route.test.ts`, add after the `@/lib/db/businesses` mock:

```ts
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))
```

and a test inside the existing describe (reuse the file's `DISPLAY_NAME` constant):

```ts
  it("reads settings for the business the seam names — a public route with no session", async () => {
    h.getSetting.mockResolvedValue(true)
    h.getBusinessSettings.mockResolvedValue({ display_name: DISPLAY_NAME })
    await GET()
    expect(h.getBusinessSettings).toHaveBeenCalledWith("platform-biz")
  })
```

In `__tests__/api/ask-capture.test.ts`, add directly after the existing test "reads business settings for the consent wording from the conversation's own business":

```ts
  it("files the consent row under the conversation's own business too, not just the settings read", async () => {
    const OTHER_BUSINESS_ID = "22222222-2222-2222-2222-222222222222"
    h.getConversation.mockResolvedValue(conversation({ business_id: OTHER_BUSINESS_ID }))

    await POST(req(submission({ marketingConsent: true })))

    expect(h.recordConsent).toHaveBeenCalledWith(expect.objectContaining({ businessId: OTHER_BUSINESS_ID }))
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run __tests__/app/ask-config-route.test.ts __tests__/api/ask-capture.test.ts`
Expected: both new tests FAIL; everything else passes; counts > 0.

- [ ] **Step 3: Convert `app/api/ask/config/route.ts` and `app/(marketing)/ask/page.tsx`**

Both: add `import { platformBusinessId } from "@/lib/tenancy/platform"` and change the read to `getBusinessSettings(platformBusinessId())` with this comment above it:

```ts
      // PUBLIC, NO SESSION TO RESOLVE A TENANT FROM. `platformBusinessId()` is
      // the seam until phase 4 resolves a real business off the Host header
      // (lib/tenancy/platform.ts, CANNOT RESOLVE YET).
```

In the page the call keeps its `.catch(() => null)`.

- [ ] **Step 4: Convert `app/api/ask/capture/route.ts`**

Inside `fileMarketingConsent`, add `businessId: input.businessId,` to the `recordConsent({...})` object. Add one line to the input's existing doc comment on `businessId`: `Threaded into recordConsent as well as getBusinessSettings — filing the row under a default while reading the wording for the real business was a latent split.`

- [ ] **Step 5: Convert the two marketing pages and the two components**

`app/(marketing)/camps/[slug]/page.tsx`, `app/(marketing)/clinics/[slug]/page.tsx`, `components/public/InquiryForm.tsx`, `components/public/StepUpInquiryForm.tsx`: add the import and change each `getBusinessSettings().catch(() => null)` to `getBusinessSettings(platformBusinessId()).catch(() => null)`, with this one-line comment above:

```ts
  // Same business as the route that files the consent row — through the seam in lib/tenancy/platform.ts.
```

- [ ] **Step 6: Run to verify pass, type-check, format, commit**

Run: `npx vitest run __tests__/app/ask-config-route.test.ts __tests__/api/ask-capture.test.ts __tests__/api/ask.test.ts`
Expected: all PASS, counts > 0. tsc set diff identical (this is what verifies the four jsdom-only surfaces compile). Prettier on all nine files.

```bash
git add app/api/ask/config/route.ts "app/(marketing)/ask/page.tsx" app/api/ask/capture/route.ts "app/(marketing)/camps/[slug]/page.tsx" "app/(marketing)/clinics/[slug]/page.tsx" components/public/InquiryForm.tsx components/public/StepUpInquiryForm.tsx __tests__/app/ask-config-route.test.ts __tests__/api/ask-capture.test.ts
git commit -m "refactor(tenancy): public settings readers name the business they read for

The ask config route and page, the camp and clinic pages, and the two
inquiry components resolve through the seam. ask/capture also files its
consent row under the conversation's business, which it already read
settings for — the two were split."
```

---

### Task 6: The Stripe webhook's capture half — the contact's business first, the seam only for a first-time payer

**Files:**
- Modify: `app/api/stripe/webhook/route.ts` (imports :50-54; `tryCaptureLeadFromCheckout` :146-157; the `checkout.session.completed` case :199-242)
- Test: `__tests__/api/stripe/webhook-capture-tenant.test.ts` (create)

**Interfaces:** consumes `platformBusinessId()`, `findContactWithBusinessByIdentifiers` (returns `{ id, businessId } | null`), `captureLead`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/stripe/webhook-capture-tenant.test.ts`. The mock block is the funnel-purchase suite's, verbatim, plus the four modules this test is about:

```ts
// @vitest-environment node
//
// checkout.session.completed — WHICH business the purchase capture files under.
//
// The webhook has no tenant of its own: one Stripe account serves every
// business. The pipeline half already resolves the payer's contact row and
// takes the business from it. The capture half used to call captureLead with
// no tenant at all, falling to the DAL's default. Now it is the NARROWER
// VARIANT of the platform.ts seam: the contact's business when the payer
// already has a contact row, platformBusinessId() only for a first-time payer.
//
// Three cases, and the third is the one that matters: the contact lookup sits
// inside a try/catch whose job is to keep a payment webhook from 5xx-ing, so
// a THROW there must still leave the capture with a tenant.
import { describe, it, expect, vi, beforeEach } from "vitest"

const OTHER_BUSINESS_ID = "22222222-2222-4222-8222-222222222222"

const verifyMock = vi.fn()
const getSettingMock = vi.fn()
const createPaymentMock = vi.fn(async (_row: unknown) => undefined)
const getPaymentByStripeIdMock = vi.fn(async (_id: unknown): Promise<unknown> => null)
const findContactMock = vi.fn()
const captureLeadMock = vi.fn(async () => "contact-1")

vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (...a: unknown[]) => verifyMock(...a),
  stripe: { refunds: { create: vi.fn() } },
  resolveSessionPaymentIntent: vi.fn(async () => null),
  retrieveSetupCard: vi.fn(),
}))
vi.mock("@/lib/funnels/checkout/grant", () => ({ grantFunnelPurchase: vi.fn() }))
vi.mock("@/lib/funnels/checkout/deps", () => ({ buildGrantDeps: vi.fn(() => ({})) }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: (...a: unknown[]) => getSettingMock(...a) }))
vi.mock("@/lib/db/payments", () => ({
  createPayment: (row: unknown) => createPaymentMock(row),
  getPaymentByStripeId: (id: unknown) => getPaymentByStripeIdMock(id),
  updatePayment: vi.fn(),
}))
vi.mock("@/lib/db/marketing-attribution", () => ({ findAttributionForContact: vi.fn(async () => null) }))
vi.mock("@/lib/db/assignments", () => ({
  createAssignment: vi.fn(),
  getAssignmentByUserAndProgram: vi.fn(),
  updateAssignment: vi.fn(),
}))
vi.mock("@/lib/db/week-access", () => ({ updateWeekAccess: vi.fn(), createWeekAccessBulk: vi.fn() }))
vi.mock("@/lib/db/subscriptions", () => ({
  createSubscription: vi.fn(),
  getSubscriptionByStripeId: vi.fn(async () => null),
  updateSubscriptionByStripeId: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn(), getUserByEmail: vi.fn(async () => null) }))
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))
vi.mock("@/lib/db/event-signups", () => ({
  confirmSignup: vi.fn(),
  cancelSignup: vi.fn(),
  getSignupById: vi.fn(),
  getEventSignupByPaymentIntent: vi.fn(),
}))
vi.mock("@/lib/db/events", () => ({ getEventById: vi.fn() }))
vi.mock("@/lib/email", () => ({
  sendCoachPurchaseNotification: vi.fn(),
  sendEventSignupConfirmedEmail: vi.fn(),
}))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: vi.fn(), ghlTriggerWorkflow: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/ads/conversions", () => ({ enqueuePaymentValueAdjustmentByEmail: vi.fn(async () => undefined) }))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: () => ({ update: () => ({ eq: vi.fn(async () => undefined) }) }) }),
}))
// The four this suite is about.
vi.mock("@/lib/db/contacts", () => ({
  findContactWithBusinessByIdentifiers: (...a: unknown[]) => findContactMock(...a),
}))
vi.mock("@/lib/lead-engine/capture", () => ({ captureLead: (...a: unknown[]) => captureLeadMock(...a) }))
vi.mock("@/lib/db/sequences", () => ({ exitRunsForContact: vi.fn(async () => undefined) }))
vi.mock("@/lib/db/pipeline", () => ({
  applyPipelineEvent: vi.fn(async () => ({ decision: { kind: "noop", reason: "test" }, opportunityId: null })),
}))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))

function session() {
  return {
    id: "cs_capture_1",
    mode: "payment",
    payment_intent: "pi_capture_1",
    customer: "cus_1",
    amount_total: 4900,
    currency: "usd",
    customer_details: { email: "buyer@example.com", name: "Riley Buyer" },
    // `event_signup` on purpose: the capture runs BEFORE the metadata-type
    // dispatch, and this branch returns at once when `event_signup_id` is
    // absent (handleEventSignupCheckout's first guard), so the request never
    // reaches the one-time-checkout path and its unmocked billing modules.
    metadata: { type: "event_signup" },
  }
}

function fire(sessionObject: Record<string, unknown>) {
  verifyMock.mockReturnValueOnce({ type: "checkout.session.completed", id: "evt_1", data: { object: sessionObject } })
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: "{}",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getSettingMock.mockResolvedValue(false)
  getPaymentByStripeIdMock.mockResolvedValue(null)
})

describe("checkout.session.completed — which business the purchase capture files under", () => {
  it("a repeat payer's capture lands on THEIR contact's business", async () => {
    findContactMock.mockResolvedValue({ id: "contact-1", businessId: OTHER_BUSINESS_ID })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire(session()))
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ source: "purchase", businessId: OTHER_BUSINESS_ID })
  })

  it("a first-time payer's capture falls to the platform business through the seam", async () => {
    findContactMock.mockResolvedValue(null)
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire(session()))
    expect(res.status).toBe(200)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ source: "purchase", businessId: "platform-biz" })
  })

  it("a contact lookup that THROWS still leaves the capture with the platform tenant", async () => {
    findContactMock.mockRejectedValue(new Error("contacts read failed"))
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire(session()))
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
  })
})
```

If the run shows an UNMOCKED module reaching for a real Supabase client (a hang or `createServiceRoleClient` error from a module not in this list), mock that module the same way — the funnel-purchase suite's list is the known-good starting set as of `0cb030a9`; the route's import block (:1-60) names every module it touches.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run __tests__/api/stripe/webhook-capture-tenant.test.ts`
Expected: 3 tests; the first two FAIL on the missing `businessId`; the third fails the same way. Count > 0.

- [ ] **Step 3: Convert the route**

Add `import { platformBusinessId } from "@/lib/tenancy/platform"`.

Change `tryCaptureLeadFromCheckout` to take the tenant:

```ts
async function tryCaptureLeadFromCheckout(session: Stripe.Checkout.Session, businessId: string): Promise<void> {
  try {
    await captureLead({
      source: "purchase",
      email: session.customer_details?.email ?? session.customer_email ?? null,
      name: session.customer_details?.name ?? null,
      businessId,
      metadata: { stripe_session_id: session.id },
    })
  } catch (err) {
    console.error("[stripe-webhook] lead capture failed", (err as Error).message)
  }
}
```

In the `checkout.session.completed` case, declare the payer's business ABOVE the existing `try` that resolves the contact, capture it inside, and use it after:

```ts
        // The payer's business, when they already have a contact row. Declared
        // OUTSIDE the try below so a throw inside it (which must never fail a
        // payment webhook) cannot leave the capture without a tenant.
        let payerBusinessId: string | null = null
        try {
          const userId = session.metadata?.userId ?? null
          const email = session.customer_details?.email ?? session.customer_email ?? null
          // … (existing comment) …
          const contact = await findContactWithBusinessByIdentifiers({ userId, email })
          if (contact) {
            const { id: contactId, businessId } = contact
            payerBusinessId = businessId
            await exitRunsForContact(contactId, "payment", businessId)
            // … (existing pipeline block unchanged) …
          }
        } catch (err) {
          console.error("[stripe-webhook] sequence/pipeline hook failed", (err as Error).message)
        }

        // A NARROWER VARIANT of the lib/tenancy/platform.ts seam: the payer's own
        // contact row first — a repeat buyer's capture lands on their coach's
        // business — and platformBusinessId() only for a first-time payer, for
        // whom one Stripe account serving every business genuinely carries no
        // tenant. Listed under that shelf in the inventory.
        await tryCaptureLeadFromCheckout(session, payerBusinessId ?? platformBusinessId())
```

Also rewrite the comment at :379-383 (in the `charge.refunded` case) so it no longer names the removed default: replace `unscoped findContactByIdentifiers (defaulting to SINGLETON_BUSINESS_ID)` with `findContactByIdentifiers with no tenant`.

- [ ] **Step 4: Run to verify pass, then the neighbouring stripe suites**

Run: `npx vitest run __tests__/api/stripe/webhook-capture-tenant.test.ts __tests__/api/stripe/webhook-funnel-purchase.test.ts __tests__/api/stripe/webhook-membership.test.ts __tests__/api/stripe/webhook-external.test.ts`
Expected: all PASS, counts > 0.

- [ ] **Step 5: Type-check, format, commit**

tsc set diff identical; prettier on the route and the test.

```bash
git add app/api/stripe/webhook/route.ts __tests__/api/stripe/webhook-capture-tenant.test.ts
git commit -m "fix(tenancy): the checkout capture files under the payer's business, not a default

tryCaptureLeadFromCheckout called captureLead with no tenant. It now
takes the business from the contact row the pipeline half already
resolved, and falls to platformBusinessId() only for a first-time payer
— the narrower variant of the seam. A throw in the contact lookup still
leaves the capture with a tenant."
```

---

### Task 7: The enrol route resolves the operator's selected business

**Files:**
- Modify: `app/api/admin/sequences/enrol/route.ts` (imports :40-44; the role check :95-97; the "FOLLOW-UP, NOT YET DONE" comment :117-131; the `enrolContactManually` call :134-136)
- Test: `__tests__/api/admin/sequences-enrol.test.ts` (add the node pragma; add resolver mock; extend)

**Interfaces:** consumes `resolveAdminTenantForRequest(req): Promise<{ businessId, choices, isOperator }>` and `NoAccessibleBusinessError` from `@/lib/tenancy/resolve`; `enrolContactManually(contactId, key, { businessId?, onePerContact? })` (businessId still optional until Task 9).

- [ ] **Step 1: Make the suite actually run, and arm the resolver for every existing test**

At the very top of `__tests__/api/admin/sequences-enrol.test.ts`, line 1, add:

```ts
// @vitest-environment node
```

(Without it the file reports "no tests". Its 20 tests pass under node as of `0cb030a9` — verified before this plan was written.)

After the existing `vi.mock("@/lib/audit/record", …)`, add the resolver mock in the house idiom:

```ts
const resolveTenantMock = vi.fn()
vi.mock("@/lib/tenancy/resolve", () => {
  class NoAccessibleBusinessError extends Error {}
  return {
    resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
    NoAccessibleBusinessError,
  }
})
```

Add, after `import { MAX_ENROL_BATCH } …`:

```ts
// The class the route `instanceof`-checks against — imported from the mocked
// module so the two cannot be different constructors.
import { NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

// NOT the platform id: a fixture equal to it would pass for a route that
// dropped the argument and let the DAL default apply.
const OTHER_BUSINESS_ID = "22222222-2222-4222-8222-222222222222"
```

In the existing `beforeEach`, after `enrolContactManuallyMock.mockResolvedValue(...)`, add:

```ts
  resolveTenantMock.mockResolvedValue({ businessId: OTHER_BUSINESS_ID, choices: [], isOperator: true })
```

(`vi.resetAllMocks()` runs first in that hook, so without this line every existing test would throw on `({ businessId } = undefined)`.)

- [ ] **Step 2: Write the failing tests**

Append to the file:

```ts
describe("POST /api/admin/sequences/enrol — the tenant", () => {
  it("looks the key up under the caller's SELECTED business, the same one the picker was populated from", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    const res = await POST(req({ contactIds: ["c1"], sequenceKey: "k" }) as never, NO_PARAMS)
    expect(res.status).toBe(200)
    expect(resolveTenantMock).toHaveBeenCalledTimes(1)
    expect(enrolContactManuallyMock).toHaveBeenCalledWith(
      "c1",
      "k",
      expect.objectContaining({ businessId: OTHER_BUSINESS_ID }),
    )
  })

  it("403s, enrolling nobody, when the caller has no accessible business", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())
    const res = await POST(req({ contactIds: ["c1", "c2"], sequenceKey: "k" }) as never, NO_PARAMS)
    expect(res.status).toBe(403)
    expect(enrolContactManuallyMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run __tests__/api/admin/sequences-enrol.test.ts`
Expected: 22 tests; the two new ones FAIL (`resolveTenantMock` never called; `businessId` absent); the 20 existing ones PASS.

- [ ] **Step 4: Convert the route**

Add to the imports:

```ts
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
```

Directly after the `session.user.role !== "admin"` check:

```ts
    // THE TENANT. The contact-detail page populated its "Add to a sequence"
    // picker with listSequences(businessId) for the caller's SELECTED business
    // (the cookie's choice, else the first), so this route must look the picked
    // key up under the SAME business or the two disagree. They used to: this
    // call let the DAL default apply, so a coach on another business hit a
    // loud sequence_not_found in the ordinary case — but the seeded keys are
    // generic templates (`new_lead_nurture`, `cold_lead_re_engagement`), and a
    // second business provisioned from them COLLIDES: a sequence_runs row
    // written against the platform's sequence, carrying this business's own
    // contact. Same shape as app/api/admin/pipeline/move/route.ts.
    let businessId: string
    try {
      ;({ businessId } = await resolveAdminTenantForRequest(request))
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw err
    }
```

Delete the whole "FOLLOW-UP, NOT YET DONE" comment block (:117-131) — the paragraph above replaces it. Change the call:

```ts
        const outcome = await enrolContactManually(contactId, parsed.sequenceKey, {
          businessId,
          onePerContact: parsed.onePerContact,
        })
```

- [ ] **Step 5: Run to verify pass, type-check, format, commit**

Run: `npx vitest run __tests__/api/admin/sequences-enrol.test.ts`
Expected: 22 passed. tsc set diff identical. Prettier on both files.

```bash
git add app/api/admin/sequences/enrol/route.ts __tests__/api/admin/sequences-enrol.test.ts
git commit -m "fix(tenancy): manual enrolment looks the sequence up under the caller's selected business

The route let enrolContactManually default its tenant, so the key the
operator picked from a business-scoped picker was looked up under the
platform's sequences — a silent success on any colliding seeded key.
It now resolves the tenant the way the pipeline move route does. The
suite gains the node pragma it was missing; it reported no tests before."
```

---

### Task 8: The invite claim, the frozen ads default, and the dead settings fallback

**Files:**
- Modify: `app/api/public/invite/[token]/claim/route.ts` (import :9; comment :80-83; `membershipBusinessId` :96)
- Modify: `lib/db/google-ads-accounts.ts` (import :3; doc comment :20-33; default :36; comment :69)
- Modify: `lib/lead-engine/email.ts` (doc comment :459-462; `settings?` :485 → required; `??` :494)
- Test: `__tests__/api/public/invite-claim.test.ts` (retarget the business-less-invite assertion)
- Test: `__tests__/db/google-ads-accounts-tenancy.test.ts` (retarget the default-branch assertion)
- Test: whichever of `__tests__/lib/lead-engine/email.test.ts` / `__tests__/lib/automation/sequence-tick-*.test.ts` call `sendSequenceEmail` without `settings` — `tsc` will name them

**Interfaces:**
- Produces: `sendSequenceEmail(args: { …; settings: BusinessSettings })` — required. Its one production caller (`lib/automation/sequence-tick-runner.ts:563`) already passes it.

- [ ] **Step 1: Retarget the invite-claim test**

In `__tests__/api/public/invite-claim.test.ts`: add after the `@/lib/db/business-members` mock

```ts
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))
```

change the assertion in "a business-less invite (a plain /admin/team invite) still produces a singleton staff membership" to

```ts
      expect(addBusinessMember).toHaveBeenCalledWith("platform-biz", "newU", "staff")
```

rename that test to `"a business-less invite (a plain /admin/team invite) joins the platform's own business, through the seam"`, and delete the `import { SINGLETON_BUSINESS_ID } …` line if nothing else in the file uses it (`grep -n SINGLETON_BUSINESS_ID` the file — if other tests use it, leave the import).

- [ ] **Step 2: Retarget the google-ads default-branch test**

In `__tests__/db/google-ads-accounts-tenancy.test.ts`, read :36-50. The test around :46 calls `getActiveGoogleAdsAccounts()` with no argument and asserts the applied `business_id` equals the platform id. Add `vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))` beside the file's other mocks and change that expected value to `"platform-biz"`. Leave every other test in the file alone.

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run __tests__/api/public/invite-claim.test.ts __tests__/db/google-ads-accounts-tenancy.test.ts`
Expected: exactly the two retargeted tests FAIL (the routes still use the raw constant); counts > 0.

- [ ] **Step 4: Convert the invite claim route**

Replace `import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"` with `import { platformBusinessId } from "@/lib/tenancy/platform"`. Change the line to:

```ts
  const membershipBusinessId = invite.business_id ?? platformBusinessId()
```

and the sentence in the comment above it from `a plain /admin/team invite is platform staff on the singleton.` to `a plain /admin/team invite is platform staff on the platform's own business — CORRECT BY CONSTRUCTION, and listed as such in lib/tenancy/platform.ts.`

- [ ] **Step 5: Convert the ads default**

In `lib/db/google-ads-accounts.ts`: replace the constants import with `import { platformBusinessId } from "@/lib/tenancy/platform"`; change the signature to

```ts
export async function getActiveGoogleAdsAccounts(
  businessId: string = platformBusinessId(),
): Promise<GoogleAdsAccount[]> {
```

Rewrite the doc comment's first paragraph (:21-27) to:

```ts
/**
 * `businessId` DEFAULTS, and it is the one tenant default left in lib/db —
 * deliberately, and inventoried under DELIBERATELY FROZEN in
 * lib/tenancy/platform.ts. Five callers in the ads subsystem (lib/ads/agent.ts
 * twice, lib/ads/ga4-audiences.ts, lib/ads/conversions.ts's value-adjustment
 * path, app/api/admin/ads/diagnose/route.ts) pass nothing, and that subsystem
 * is scoped as a unit or not at all: /admin/ads and /api/admin/ads are
 * owner-only precisely because listGoogleAdsAccounts above has no tenant
 * filter (docs/superpowers/plans/2026-09-04-ads-owner-only.md). A NEW caller
 * passes one.
```

Keep the second paragraph (the Firebase-twin note) as is. In the `upsertGoogleAdsAccount` comment at :69, change `landed on the column default (SINGLETON_BUSINESS_ID)` to `landed on the column's default (the platform business)`.

- [ ] **Step 6: Delete the dead settings fallback**

In `lib/lead-engine/email.ts`: change `settings?: BusinessSettings` to `settings: BusinessSettings`, change `const settings = args.settings ?? (await getBusinessSettings())` to `const settings = args.settings`, delete the sentence in the doc comment (:459-462) that says it is loaded from `business_settings` when omitted, and remove the `getBusinessSettings` import if it is now unused in that file (check with `grep -n getBusinessSettings lib/lead-engine/email.ts`).

- [ ] **Step 7: Run the tsc set diff; fix the tests it names**

Run the tsc set diff. Expected: `>` lines ONLY in test files that call `sendSequenceEmail` without `settings`. For each, pass a settings fixture — the `SETTINGS` object in `__tests__/api/ask-capture.test.ts:78-93` is a complete `BusinessSettings` to copy. Re-run until `TSC SET IDENTICAL`.

- [ ] **Step 8: Run to verify pass, format, commit**

Run: `npx vitest run __tests__/api/public/invite-claim.test.ts __tests__/db/google-ads-accounts-tenancy.test.ts __tests__/db/google-ads-accounts-upsert.test.ts __tests__/lib/lead-engine/email.test.ts __tests__/lib/automation/sequence-tick-email-env.test.ts __tests__/lib/automation/sequence-tick-send-faults.test.ts --environment node`
Expected: all PASS, counts > 0. Prettier on the three source files and every test touched.

```bash
git add "app/api/public/invite/[token]/claim/route.ts" lib/db/google-ads-accounts.ts lib/lead-engine/email.ts __tests__/api/public/invite-claim.test.ts __tests__/db/google-ads-accounts-tenancy.test.ts
# plus any test files Step 7 touched
git commit -m "refactor(tenancy): the two remaining raw literals go through the seam; a dead settings fallback goes

The invite claim's plain-team-invite branch is correct by construction
and now says so through platformBusinessId(). The ads reader's default
is respelled the same way and inventoried as frozen — its five callers
and the ads subsystem are untouched. sendSequenceEmail's settings
fallback had one caller, which passes settings; it carried a tenant
default for nobody."
```

---

### Task 9: Remove the DAL defaults, group A — contacts, tags, consents, detail, capture, enroll

**Files:**
- Modify: `lib/db/contacts.ts` (import :4; `UpsertContactIdentityInput` :124-130; `RecordContactEventInput` :28-36; :155; :220; :328-331; :358-365)
- Modify: `lib/db/contact-tags.ts` (import :24; :83; :110-121; :140-152; :171-173)
- Modify: `lib/db/contact-consents.ts` (import :2; :10-22; :55-58; :86; :96)
- Modify: `lib/db/contact-detail.ts` (import :50; :471-473)
- Modify: `lib/lead-engine/enroll.ts` (import :8; :75-81; :169-174)
- Modify: `lib/lead-engine/capture.ts` (doc comment :38-45 and `businessId?` :46)
- Modify (comments only, spec §7): `app/api/admin/contacts/[id]/tags/route.ts` :98-104 and :121-127; `app/(admin)/admin/contacts/[id]/page.tsx` :45-51 and :68-72; `lib/lead-engine/import.ts` :30-36; `lib/bookings/ingest.ts` :58-64
- Test: every suite importing these modules (list below) — retarget, never delete

**Interfaces:**
- Produces (all REQUIRED from here on): `UpsertContactIdentityInput.businessId: string`; `RecordContactEventInput.businessId: string`; `getContactUserId(contactId, businessId: string)`; `findContactByIdentifiers({ …, businessId: string })`; `listTags(contactId, businessId: string)`; `tagsForContacts(ids, businessId: string)`; `addTag({ …, businessId: string })`; `removeTag({ …, businessId: string })`; `recordConsent({ …, businessId: string })`; `suppress(id, reason, businessId: string)`; `unsuppress(id, businessId: string)`; `isSuppressed(id, businessId: string)`; `getContactById(id, businessId: string)`; `enrollIfTriggered({ …, businessId: string })`; `enrolContactManually(id, key, opts: { businessId: string; onePerContact?: boolean })`; `CaptureLeadInput.businessId: string`.

- [ ] **Step 1: Confirm every production caller already passes a tenant**

Run, from the worktree root:

```bash
for fn in upsertContactIdentity recordContactEvent getContactUserId findContactByIdentifiers listTags addTag removeTag tagsForContacts recordConsent suppress unsuppress isSuppressed getContactById enrollIfTriggered enrolContactManually captureLead; do echo "## $fn"; grep -rn --include='*.ts' --include='*.tsx' -E "\b$fn\(" app lib components scripts | grep -v -E ":[0-9]+:\s*(export )?(async )?function "; done
```

Read each hit. Every call must already carry `businessId` (Tasks 1–8 did the routes; `lib/bookings/ingest.ts`, `lib/automation/pipeline-reconcile.ts`, `lib/lead-engine/import.ts`, `lib/lead-engine/sms-consent.ts`, `lib/lead-engine/unsubscribe.ts`, the Twilio webhook, and `lib/db/sequences.ts` already did). `components/admin/lead-magnets/LeadMagnetFormDialog.tsx:183 addTag()` is an unrelated local function. Pay attention to `scripts/` — `scripts/enrol-repermission.ts` and `scripts/import-ghl-contacts.ts` call into these modules and are type-checked; if either omits the tenant, pass `SINGLETON_BUSINESS_ID` there (scripts are exempt from the count and that constant is exactly what a one-off platform-data script means). If a production caller omits it, STOP and report — it is a caller the spec's map missed.

- [ ] **Step 2: Remove the defaults**

`lib/db/contacts.ts`: delete the `SINGLETON_BUSINESS_ID` import; `businessId: string` in both input types (no `?`); `const businessId = input.businessId` at :155 and :220; `businessId: string,` at :330; `businessId: string` in `findContactByIdentifiers`'s args type and `const businessId = args.businessId` at :365.

`lib/db/contact-tags.ts`: delete the import; `businessId: string` on `listTags` and `tagsForContacts`; `businessId: string` in `addTag`'s and `removeTag`'s input types; `business_id: input.businessId` and `.eq("business_id", input.businessId)`.

`lib/db/contact-consents.ts`: delete the import; `businessId: string` in `recordConsent`'s input; `business_id: input.businessId`; `businessId: string` on `suppress`, `unsuppress`, `isSuppressed`.

`lib/db/contact-detail.ts`: delete the import; `businessId: string`.

`lib/lead-engine/enroll.ts`: delete the import; `businessId: string` in `enrollIfTriggered`'s args and `const businessId = args.businessId`; `opts: { businessId: string; onePerContact?: boolean }` (drop the `= {}` default) and `const businessId = opts.businessId`.

`lib/lead-engine/capture.ts`: `businessId: string` and replace the doc comment with:

```ts
  /**
   * The tenant this lead belongs to. REQUIRED: every caller resolves one —
   * from a session, from a row that carries it (a chat conversation, a quiz
   * attempt, the payer's contact row), or through the seam in
   * lib/tenancy/platform.ts for the public forms that have neither. A default
   * here is how a coach's lead would silently file under the platform.
   */
```

- [ ] **Step 3: Rewrite the comments the removal makes false (spec §7)**

`app/api/admin/contacts/[id]/tags/route.ts` :98-104 → replace the paragraph with:

```ts
  // SCOPED BY BUSINESS. `getContactById` REQUIRES its tenant; a contact in
  // another business reads as 404, the same answer the detail page gives. A
  // coach holding `contacts` reaches this route, so the read must be theirs.
```

and :121-127 → replace with:

```ts
  // businessId IS RETURNED, not just used for the read gate above. Scoping the
  // lookup and then writing unscoped is worse than not scoping at all: the read
  // proves the coach owns this contact, and the write must file the tag under
  // the SAME business. `addTag`/`removeTag` require it.
```

`app/(admin)/admin/contacts/[id]/page.tsx` :45-51 → replace with:

```tsx
  // Every admin screen resolves its tenant through resolveAdminTenant (see
  // app/(admin)/admin/contacts/page.tsx), and every read below requires it.
```

and :68-72 → replace with:

```tsx
  // SCOPED BY THE SAME businessId AS getContactById JUST ABOVE, so the picker
  // offers this business's own sequences and nothing else's.
```

`lib/lead-engine/import.ts` :30-36 → replace with:

```ts
// `ctx.businessId` is REQUIRED, like every tenant parameter in the Lead
// Engine. The one caller today (scripts/import-ghl-contacts.ts) supplies the
// platform's own id explicitly, because this one-time GHL migration really
// does target only the platform's historical data — a property of the
// script, not something this function should assume.
```

`lib/bookings/ingest.ts` :58-64 → replace with:

```ts
  /**
   * REQUIRED, like every tenant parameter in the Lead Engine now is. This
   * field was the first to lose its default: a booking's four consequences
   * all landed on one business because nobody had to say otherwise. A new
   * field that defaults the tenant is how the next leak ships.
   */
```

- [ ] **Step 4: Run the tsc set diff and retarget what it names**

Run the tsc set diff. Every `>` line must be in `__tests__/` (or `scripts/`, handled in Step 1). For each test that calls one of these functions without a tenant, add `businessId: "<a fixture id already used in that file>"` (or a positional argument) — and where the test asserts `toHaveBeenCalledWith` on a mock of one of these functions, add the field to the expected object. The suites to expect:

- `__tests__/db/contacts-business-resolution.test.ts`, `__tests__/db/contacts-record-event.test.ts`, `__tests__/lib/db/find-contact-by-identifiers.test.ts`
- `__tests__/lib/db/contact-tags.test.ts`, `__tests__/app/api/admin/contacts/tags-route.test.ts`
- `__tests__/db/contact-consents.test.ts`
- `__tests__/lib/db/contact-detail.test.ts`
- `__tests__/lib/lead-engine/enroll.test.ts`
- `__tests__/lib/lead-engine/capture-tenancy.test.ts`, `__tests__/api/spine/newsletter-spine.test.ts`

A test whose NAME claims the default ("defaults to the singleton when omitted") is retargeted into its inverse — "requires the tenant" is a type-level fact now, so the test becomes an assertion that the explicit value is the one applied — not deleted. Re-run until `TSC SET IDENTICAL`.

- [ ] **Step 5: Run the affected suites**

Run: `npx vitest run __tests__/db/contacts-business-resolution.test.ts __tests__/db/contacts-record-event.test.ts __tests__/lib/db/find-contact-by-identifiers.test.ts __tests__/lib/db/contact-tags.test.ts __tests__/app/api/admin/contacts/tags-route.test.ts __tests__/db/contact-consents.test.ts __tests__/lib/db/contact-detail.test.ts __tests__/lib/lead-engine/enroll.test.ts __tests__/lib/lead-engine/capture-tenancy.test.ts __tests__/api/spine/newsletter-spine.test.ts __tests__/lib/bookings __tests__/lib/automation/pipeline-reconcile.test.ts --environment node`
Expected: all PASS, and EVERY file shows a non-zero count. A file showing 0 tests is jsdom-only (`.tsx` suites under `__tests__/app/admin/`) — note it in the report as "type-checked, not run".

- [ ] **Step 6: Prove the count moved**

Run: `git grep -l SINGLETON_BUSINESS_ID -- lib app components | sort`
Expected: exactly `lib/db/google-ads-accounts.ts` is GONE (Task 8), and this task removed `lib/db/contacts.ts`, `lib/db/contact-tags.ts`, `lib/db/contact-consents.ts`, `lib/db/contact-detail.ts`, `lib/lead-engine/enroll.ts`, `lib/lead-engine/capture.ts`, `lib/lead-engine/import.ts`, `lib/bookings/ingest.ts`, `app/api/admin/contacts/[id]/tags/route.ts`, `app/(admin)/admin/contacts/[id]/page.tsx`. Remaining in `lib app components` after this task: `lib/lead-engine/constants.ts`, `lib/tenancy/platform.ts`, `lib/tenancy/resolve.ts`, `lib/db/pipeline.ts`, `lib/db/sequences.ts`, `lib/db/businesses.ts`, `app/(admin)/admin/contacts/page.tsx`, `app/api/admin/pipeline/move/route.ts` (the last five are Task 10's).

- [ ] **Step 7: Format and commit**

Prettier on every file touched.

```bash
git add lib/db/contacts.ts lib/db/contact-tags.ts lib/db/contact-consents.ts lib/db/contact-detail.ts lib/lead-engine/enroll.ts lib/lead-engine/capture.ts "app/api/admin/contacts/[id]/tags/route.ts" "app/(admin)/admin/contacts/[id]/page.tsx" lib/lead-engine/import.ts lib/bookings/ingest.ts
# plus every __tests__ file Step 4 touched, and any scripts/ file Step 1 touched
git commit -m "refactor(tenancy): the contact, tag, consent and enrolment DAL require their tenant

Sixteen functions lose their singleton default. Every production caller
already supplied one after the caller-side sweep, so this is proven by
the type-checker: the error set is identical to the baseline. Comments
that described the removed default now describe the contract."
```

---

### Task 10: Remove the DAL defaults, group B — pipeline, sequences, businesses

**Files:**
- Modify: `lib/db/pipeline.ts` (import :19; defaults at :79, :141, :200, :257, :478, :825, :884, :990 and the two input types)
- Modify: `lib/db/sequences.ts` (import :15; :38, :81, :214, :568 and `recordSend`'s input type)
- Modify: `lib/db/businesses.ts` (import :2; :41)
- Modify (comments only): `app/(admin)/admin/contacts/page.tsx` :103-108; `app/api/admin/pipeline/move/route.ts` :17-19 and :68-70
- Test: every suite importing these modules (list below)

**Interfaces:**
- Produces (REQUIRED): `resolvePipeline(key, businessId: string)`; `readMostRecentOpportunity(contactId, pipelineId, stages, businessId: string)`; `readMostRecentWonOpportunity(…, businessId: string)`; `highestRecordedRefundAmount(chargeId, businessId: string)`; `applyPipelineEvent({ …, businessId: string })`; `listReconciledSourceIds(since, businessId: string)`; `moveOpportunityManually({ …, businessId: string })`; `readBoard(key?, businessId: string)`; `claimDueRuns(limit, token, businessId: string)`; `loadRunContext(run, now, businessId: string)`; `recordSend({ …, businessId: string })`; `listSequences(businessId: string)`; `getBusinessSettings(businessId: string)`.

- [ ] **Step 1: Confirm every production caller passes a tenant**

```bash
for fn in resolvePipeline readMostRecentOpportunity readMostRecentWonOpportunity highestRecordedRefundAmount applyPipelineEvent listReconciledSourceIds moveOpportunityManually readBoard claimDueRuns loadRunContext recordSend listSequences getBusinessSettings; do echo "## $fn"; grep -rn --include='*.ts' --include='*.tsx' -E "\b$fn\(" app lib components scripts | grep -v -E ":[0-9]+:\s*(export )?(async )?function " | grep -v -E "^\S+:[0-9]+:\s*(//|\*)"; done
```

Every hit must carry a tenant. `getBusinessSettings()` with no argument must match NOTHING outside comments after Tasks 1–5 and 8 — if it does, that caller was missed: STOP and report. `readBoard(undefined, businessId)` in the pipeline page is correct as written.

- [ ] **Step 2: Remove the defaults**

`lib/db/pipeline.ts`: delete the import; every `businessId: string = SINGLETON_BUSINESS_ID` becomes `businessId: string`; in `applyPipelineEvent`'s and `moveOpportunityManually`'s input types `businessId?: string` becomes `businessId: string`, and `const businessId = input.businessId ?? SINGLETON_BUSINESS_ID` becomes `const businessId = input.businessId`. `readBoard`'s signature stays `(pipelineKey?: string, businessId: string)` — an optional parameter before a required one is legal and the one caller passes `undefined` explicitly.

`lib/db/sequences.ts`: same treatment for `claimDueRuns`, `loadRunContext`, `listSequences`, and `recordSend`'s input type + `const businessId = args.businessId`.

`lib/db/businesses.ts`: delete the import; `businessId: string`.

- [ ] **Step 3: Rewrite the comments the removal makes false**

`app/(admin)/admin/contacts/page.tsx` :103-108 → replace with:

```tsx
    // SCOPED, like every read on this page. Offering another business's
    // sequences here would let a coach enrol this business's contacts into
    // one of them — a cross-tenant WRITE, not a display bug.
```

`app/api/admin/pipeline/move/route.ts` :17-19: change `and \`moveOpportunityManually\` defaults its \`businessId\` to SINGLETON_BUSINESS_ID — so omitting it here would silently move the OPERATOR'S cards on a coach's request.` to `and \`moveOpportunityManually\` requires a \`businessId\` — the tenant is what stops a coach's request from moving the OPERATOR'S cards.`; :68-70: replace the three-line comment with `// The opportunityId arrives in the request body; the tenant is what scopes it.`

- [ ] **Step 4: Run the tsc set diff and retarget what it names**

Same rule as Task 9 Step 4. Suites to expect:

- `__tests__/db/pipeline.test.ts`, `__tests__/lib/automation/pipeline-reconcile.test.ts`, `__tests__/lib/db/coach-scoped-reads.test.ts`, `__tests__/lib/lead-engine/pipeline-move.test.ts`
- `__tests__/db/sequences.test.ts`, `__tests__/db/sequences-tenancy.test.ts`, `__tests__/lib/db/sequences-list.test.ts`, `__tests__/api/admin/internal/sequence-tick.test.ts`, `__tests__/lib/automation/sequence-tick-*.test.ts`
- `__tests__/db/businesses.test.ts`, and any of the 20 `businesses` importers that CALL `getBusinessSettings()` for real rather than mocking it (most mock)

Re-run until `TSC SET IDENTICAL`.

- [ ] **Step 5: Run the affected suites**

Run: `npx vitest run __tests__/db/pipeline.test.ts __tests__/lib/automation/pipeline-reconcile.test.ts __tests__/lib/db/coach-scoped-reads.test.ts __tests__/lib/lead-engine/pipeline-move.test.ts __tests__/api/admin/pipeline-move.test.ts __tests__/db/sequences.test.ts __tests__/db/sequences-tenancy.test.ts __tests__/lib/db/sequences-list.test.ts __tests__/api/admin/internal/sequence-tick.test.ts __tests__/lib/automation __tests__/db/businesses.test.ts --environment node`
Expected: all PASS, every file non-zero (note any `.tsx` jsdom-only files as type-checked-only).

- [ ] **Step 6: Prove the count moved**

Run: `git grep -l SINGLETON_BUSINESS_ID -- lib app components | sort`
Expected EXACTLY:

```
lib/lead-engine/constants.ts
lib/tenancy/platform.ts
lib/tenancy/resolve.ts
```

Anything else is a miss — find it before committing.

- [ ] **Step 7: Format and commit**

```bash
git add lib/db/pipeline.ts lib/db/sequences.ts lib/db/businesses.ts "app/(admin)/admin/contacts/page.tsx" app/api/admin/pipeline/move/route.ts
# plus every __tests__ file Step 4 touched
git commit -m "refactor(tenancy): the pipeline, sequence and business-settings DAL require their tenant

Thirteen more functions lose their singleton default. Under lib/, app/
and components/ the constant now appears only where it is defined, in
the seam that inventories its callers, and in one history comment."
```

---

### Task 11: The inventory, its structural test, the final measurement and the build

**Files:**
- Modify: `lib/tenancy/platform.ts` (the doc comment on `platformBusinessId`, :4-101)
- Test: `__tests__/lib/tenancy/platform-inventory.test.ts` (create)

**Interfaces:** none. This task pins the seam's contract: every file that CALLS `platformBusinessId()` is named in the inventory.

- [ ] **Step 1: Write the failing structural test**

Create `__tests__/lib/tenancy/platform-inventory.test.ts`:

```ts
// @vitest-environment node
//
// lib/tenancy/platform.ts is a TRUTHFUL INVENTORY: every caller of
// platformBusinessId() is listed there under the shelf that names WHY it
// cannot (or need not) resolve a tenant. Nothing else enforces that the list
// is complete, and a seam whose inventory silently goes stale is worse than
// no inventory — phase 4's sweep is "the CANNOT RESOLVE YET shelf", and a
// caller missing from it is a caller phase 4 will not convert.
//
// This is deliberately a prose assertion on a comment. The callers are found
// on CODE lines only — a comment that mentions platformBusinessId() is not a
// caller — and platform.ts itself is excluded.
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.cwd()
const ROOTS = ["app", "lib", "components"]
const INVENTORY = "lib/tenancy/platform.ts"

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

function isCommentLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")
}

/** Repo-relative paths of every file with platformBusinessId() on a code line. */
function callers(): string[] {
  const hits: string[] = []
  for (const root of ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file)
      if (rel === INVENTORY) continue
      const calls = readFileSync(file, "utf8")
        .split("\n")
        .some((line) => !isCommentLine(line) && line.includes("platformBusinessId()"))
      if (calls) hits.push(rel)
    }
  }
  return hits.sort()
}

describe("lib/tenancy/platform.ts inventory", () => {
  it("has callers to inventory at all (presence control for the test below)", () => {
    expect(callers().length).toBeGreaterThan(10)
  })

  it("names every file that calls platformBusinessId(), so the seam list cannot silently go stale", () => {
    const inventory = readFileSync(join(ROOT, INVENTORY), "utf8")
    const missing = callers().filter((file) => !inventory.includes(file))
    expect(missing).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run __tests__/lib/tenancy/platform-inventory.test.ts`
Expected: the second test FAILS and its diff LISTS every file Tasks 1–8 added that the inventory does not yet name (the newsletter, contact, shop-leads, inquiry, event, funnel, ask, marketing, component, stripe, invite and ads files). That list is the checklist for Step 3. The first test passes.

- [ ] **Step 3: Rewrite the inventory**

In `lib/tenancy/platform.ts`, edit the doc comment on `platformBusinessId`. Keep every existing entry. Add the following, each under the shelf named:

Under **GENUINELY CANNOT RESOLVE A TENANT YET**, after the existing entries:

```
 *   - the public lead-capture surfaces, converted 2026-09-05 when the Lead
 *     Engine DAL stopped defaulting its tenant. Each resolves this ONCE at
 *     the top of its handler and threads it into every write — the contact,
 *     the settings read behind the consent wording, and the consent row —
 *     so the wording shown and the wording filed can never name different
 *     businesses. No session, and no row to inherit from: `funnels`,
 *     `funnel_steps`, `funnel_submissions`, `events`, `event_signups`,
 *     `products` and `shop_leads` carry no business_id (no migration adds
 *     one), so until phase 4 reads the Host header these are the platform's
 *     by seam, not by evidence:
 *       app/api/contact/route.ts
 *       app/api/shop/leads/route.ts
 *       app/api/newsletter/route.ts
 *       app/api/inquiry/route.ts
 *       app/api/events/[id]/signup/route.ts
 *       app/api/events/[id]/checkout/route.ts
 *       app/api/funnels/submit/route.ts
 *       app/api/ask/config/route.ts
 *     and the pages and server components that render the same consent
 *     wording those routes file, which must read the SAME business:
 *       app/(marketing)/ask/page.tsx
 *       app/(marketing)/camps/[slug]/page.tsx
 *       app/(marketing)/clinics/[slug]/page.tsx
 *       components/public/InquiryForm.tsx
 *       components/public/StepUpInquiryForm.tsx
 *       components/funnels/islands/FormIsland.tsx
 *       components/funnels/islands/QuizIsland.tsx
 *     NOT on this list, deliberately: app/api/quiz/submit/route.ts. It is
 *     public too, but it has a row to inherit from — the attempt that
 *     app/api/quiz/progress/route.ts created under this seam carries
 *     business_id — so it resolves rather than calling this. When phase 4
 *     converts the progress route, the submit route follows for free.
```

Under **CORRECT BY CONSTRUCTION**, after the GHL host entry:

```
 *   - the invite claim's plain-team-invite branch
 *     (app/api/public/invite/[token]/claim/route.ts). An invite with no
 *     business_id is a /admin/team invite, which is by definition onto the
 *     platform's own business; the membership row it writes says so.
```

Under **A NARROWER VARIANT OF THE SAME SEAM**, after the Calendly entry:

```
 *   - the Stripe webhook's purchase capture (app/api/stripe/webhook/route.ts).
 *     One Stripe account serves every business, so the webhook has no
 *     tenant of its own. It resolves the payer's contact row first — the
 *     same lookup its pipeline half already makes — and a repeat buyer's
 *     capture lands on their coach's business. Only a FIRST-TIME payer, who
 *     has no contact row anywhere, falls to this.
```

Under **DELIBERATELY FROZEN PENDING A LATER PHASE**, extend the Google Ads entry with a final paragraph:

```
 *     The reader's own default is the same seam: `getActiveGoogleAdsAccounts`
 *     (lib/db/google-ads-accounts.ts) is the one tenant default left in
 *     lib/db, spelled as this function since 2026-09-05, and its five
 *     no-argument callers — lib/ads/agent.ts (twice), lib/ads/ga4-audiences.ts,
 *     lib/ads/conversions.ts, app/api/admin/ads/diagnose/route.ts — are
 *     untouched for the reason above. Scope the subsystem, then the default.
```

And a closing paragraph before the final "Each of those calls this instead…" paragraph:

```
 * TWINS THAT CANNOT CALL THIS: functions/src/lib/tenancy-constants.ts and
 * functions/src/ads/dal.ts carry the literal because `functions/` has
 * rootDir "src" and cannot import lib/. A grep for the constant finds them;
 * they are the Firebase runtime's copy of this seam, not inline literals in
 * the Next.js app. lib/tenancy/resolve.ts also names the constant, in a
 * history comment about the fallback migration 00246 removed — not a use.
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run __tests__/lib/tenancy/platform-inventory.test.ts __tests__/lib/db/bookings.test.ts`
Expected: 2 + N passed. If `missing` still lists a file, its path in the inventory is misspelled (the brackets and parentheses in `app/(marketing)/camps/[slug]/page.tsx` must be exact).

- [ ] **Step 5: The final measurement**

Run, from the worktree:

```bash
git grep -l SINGLETON_BUSINESS_ID HEAD -- '*.ts' '*.tsx' | sed 's#^HEAD:##' | grep -v '^__tests__/\|^scripts/' | sort
```

Expected EXACTLY six lines:

```
functions/src/ads/__tests__/dal.test.ts
functions/src/ads/dal.ts
functions/src/lib/tenancy-constants.ts
lib/lead-engine/constants.ts
lib/tenancy/platform.ts
lib/tenancy/resolve.ts
```

(The first is a test file the brief's filter miscounts — report it as such. 25 → 6 by the brief's command; 24 → 5 by true production count.)

- [ ] **Step 6: The gates**

Run the tsc set diff — `TSC SET IDENTICAL`.
Run: `npm run build 2>&1 | tail -30` — expected a green build; grep its output for every route this branch touched (`grep -E "contact|newsletter|inquiry|events|funnels/submit|quiz/submit|ask|stripe/webhook|sequences/enrol|invite"`) to confirm they compiled.
Run: `npx prettier --check $(git diff --name-only origin/main -- '*.ts' '*.tsx')` — all formatted.

- [ ] **Step 7: Commit**

```bash
git add lib/tenancy/platform.ts __tests__/lib/tenancy/platform-inventory.test.ts
git commit -m "docs(tenancy): the seam inventory names every caller, and a test keeps it that way

platformBusinessId() gained fourteen callers when the public surfaces
stopped relying on DAL defaults; each is listed under the shelf that
says why it cannot resolve a tenant yet. A structural test walks app/,
lib/ and components/ for code-line callers and fails on any the
inventory does not name — nothing else enforced that the list was
complete."
```

---

## Whole-branch review (after Task 11)

Dispatch a reviewer with the spec, this plan, `git diff origin/main..HEAD`, and the deferred-minor list from the task reports. Ask it specifically to:

1. Trace ONE public submission end to end — e.g. `POST /api/inquiry` with `sms_consent: true` — and confirm the same `businessId` value reaches `recordContactEvent`, `getBusinessSettings`, and `recordConsent`, with no second resolution anywhere on the path.
2. Trace the enrol path end to end: the picker on `app/(admin)/admin/contacts/[id]/page.tsx` → the route → `enrolContactManually`, confirming both ends use the same resolver and cookie source.
3. Look BETWEEN the task briefs: is there any caller of a Task 9/10 function that was converted in Tasks 1–8 with a different tenant than a sibling call in the same file?
4. Confirm no `lib/ads/` file and nothing under `app/(admin)/admin/ads` changed (`git diff --stat origin/main..HEAD -- lib/ads "app/(admin)/admin/ads" app/api/admin/ads` must be empty).
5. Confirm the spec's §10 decisions are the only behaviour changes.
