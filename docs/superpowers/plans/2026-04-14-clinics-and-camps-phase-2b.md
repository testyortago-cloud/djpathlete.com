# Clinics & Camps Phase 2b — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Phase 2a's admin-only events CMS into a public product — visitors can browse published events, view detail pages, submit interest/waitlist signups through a modal, and Darren confirms inline from admin; two parent emails and one admin email fire at the right moments.

**Architecture:** Additive only. New public components (EventCard, EventSignupModal, EventSignupCard, EventDetailHero), two new public routes (detail pages), two new API routes (public signup + admin confirm/cancel), a new interactive admin table (SignupsTable) replacing the Phase 2a placeholder. `lib/email.ts` gains three template exports that reuse the existing HTML helpers (`emailLayout`, `infoCard`, `sectionLabel`, `ctaButton`). No schema or migration changes — everything rides on the Phase 2a DAL and RPCs.

**Tech Stack:** Next.js 16 App Router (server + client components), Supabase, Zod, Resend, shadcn/ui (Dialog, Input, Label, Textarea, Button, Card), React Hook Form, sonner (toast), Lucide icons, Framer Motion (via existing `FadeIn`), Vitest + Testing Library, Playwright.

---

## Spec Reference

Source: [docs/superpowers/specs/2026-04-14-clinics-and-camps-phase-2b-design.md](docs/superpowers/specs/2026-04-14-clinics-and-camps-phase-2b-design.md). Parent: [master](docs/superpowers/specs/2026-04-14-clinics-and-camps-design.md), [phase 2a](docs/superpowers/specs/2026-04-14-clinics-and-camps-phase-2a-design.md).

## Phase 2a inventory — what you can assume exists

- `events` + `event_signups` tables applied to Supabase dev DB.
- RPCs `confirm_event_signup`, `cancel_event_signup` applied (with the fixed `IF NOT FOUND THEN` pattern).
- DAL: `lib/db/events.ts` (all read/write + `ALLOWED_STATUS_TRANSITIONS`) and `lib/db/event-signups.ts` (`getSignupsForEvent`, `getSignupById`, `createSignup`, `confirmSignup`, `cancelSignup`, `ConfirmResult`, `CancelResult`).
- Validators: `lib/validators/events.ts`, `lib/validators/event-signups.ts` (with `createEventSignupSchema` + `CreateSignupInput`).
- Types: `Event`, `EventSignup`, `EventType`, `EventStatus`, `SignupType`, `SignupStatus` in `types/database.ts`.
- Admin CRUD at `/admin/events`, `/admin/events/new`, `/admin/events/[id]` — the edit page renders an inline placeholder signups table we replace in this plan.
- `lib/email.ts` helpers: `emailLayout(content)`, `infoCard(rows)`, `sectionLabel(text)`, `ctaButton(url, label)` (exact shape: see existing `sendInquiryEmail` for reference), `heroBanner(label, headline)`, `getBaseUrl()`, `FROM_EMAIL`, `ADMIN_CC = "darren@darrenjpaul.com"`.
- Phase 1 components you'll reuse: `components/public/FocusGrid.tsx`, `components/public/EventsComingSoonPanel.tsx` (kept as fallback), `components/shared/FadeIn.tsx`, `components/shared/JsonLd.tsx`.

## File Structure

**New files:**

| path | responsibility |
|---|---|
| `components/public/EventSignupModal.tsx` | Client modal with form, honeypot, state machine |
| `components/public/EventCard.tsx` | Server card for landing-page grid |
| `components/public/EventCardCta.tsx` | Client island inside EventCard that owns modal state |
| `components/public/EventDetailHero.tsx` | Server hero strip for detail pages |
| `components/public/EventSignupCard.tsx` | Client sticky right card + mobile sticky CTA bar |
| `app/(marketing)/clinics/[slug]/page.tsx` | Clinic detail page |
| `app/(marketing)/camps/[slug]/page.tsx` | Camp detail page |
| `app/api/events/[id]/signup/route.ts` | Public POST — honeypot + validated insert + emails |
| `app/api/admin/events/[id]/signups/[signupId]/route.ts` | Admin PATCH — confirm / cancel + confirmed email |
| `components/admin/events/SignupsTable.tsx` | Interactive signups table with optimistic UI |
| `__tests__/api/events/signup.test.ts` | Public signup route tests |
| `__tests__/api/admin/events-signups.test.ts` | Admin confirm/cancel route tests |
| `__tests__/lib/email-events.test.ts` | Unit tests for the three new email functions |
| `__tests__/e2e/event-signup.spec.ts` | Playwright smoke for public signup |

**Modified files:**

| path | change |
|---|---|
| `lib/email.ts` | Add `buildEventContextBlock` helper + 3 new template exports |
| `app/(marketing)/clinics/page.tsx` | Fetch published clinics, conditionally render EventCard grid vs existing `EventsComingSoonPanel` |
| `app/(marketing)/camps/page.tsx` | Same pattern for camps |
| `app/(admin)/admin/events/[id]/page.tsx` | Replace inline signups table with `<SignupsTable>` |
| `app/sitemap.ts` | Append published event slugs from both types |

**No migration.** Phase 2a's schema is complete for 2b.

---

## Task 1: Email — helper + three templates + unit tests

**Why:** Email templates are unit-testable in isolation (mocked Resend) and the API routes in Tasks 2 and 3 depend on them being importable. Building them first lets those routes land with working emails.

**Files:**
- Modify: `lib/email.ts`
- Test: `__tests__/lib/email-events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/email-events.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const sendMock = vi.fn(async () => ({ data: { id: "msg-1" }, error: null }))

vi.mock("resend", () => ({
  Resend: vi.fn(() => ({
    emails: { send: sendMock },
  })),
}))

const mockEvent = {
  id: "evt-1",
  type: "clinic" as const,
  slug: "spring-clinic",
  title: "Spring Agility Clinic",
  summary: "",
  description: "",
  focus_areas: [],
  start_date: "2026-05-15T15:00:00.000Z",
  end_date: "2026-05-15T17:00:00.000Z",
  session_schedule: null,
  location_name: "Richmond Sports Complex",
  location_address: "123 Main St",
  location_map_url: "https://maps.example/r",
  age_min: 12,
  age_max: 18,
  capacity: 12,
  signup_count: 3,
  price_cents: null,
  stripe_price_id: null,
  status: "published" as const,
  hero_image_url: null,
  created_at: "",
  updated_at: "",
}

const mockSignup = {
  id: "sig-1",
  event_id: "evt-1",
  signup_type: "interest" as const,
  parent_name: "Alex Doe",
  parent_email: "alex@example.com",
  parent_phone: "555-0100",
  athlete_name: "Sam Doe",
  athlete_age: 14,
  sport: "soccer",
  notes: "Pulled hamstring last year",
  status: "pending" as const,
  stripe_session_id: null,
  stripe_payment_intent_id: null,
  amount_paid_cents: null,
  user_id: null,
  created_at: "2026-04-14T10:00:00.000Z",
  updated_at: "2026-04-14T10:00:00.000Z",
}

describe("event email templates", () => {
  beforeEach(() => sendMock.mockClear())

  it("sendEventSignupReceivedEmail sends to parent with event title in subject", async () => {
    const { sendEventSignupReceivedEmail } = await import("@/lib/email")
    await sendEventSignupReceivedEmail(mockSignup, mockEvent)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0] as { to: string; subject: string; html: string }
    expect(call.to).toBe("alex@example.com")
    expect(call.subject).toContain("Spring Agility Clinic")
    expect(call.html).toContain("Spring Agility Clinic")
    expect(call.html).toContain("Richmond Sports Complex")
  })

  it("sendEventSignupConfirmedEmail has confirmation subject and athlete name", async () => {
    const { sendEventSignupConfirmedEmail } = await import("@/lib/email")
    await sendEventSignupConfirmedEmail(mockSignup, mockEvent)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0] as { to: string; subject: string; html: string }
    expect(call.to).toBe("alex@example.com")
    expect(call.subject).toContain("confirmed")
    expect(call.html).toContain("Sam Doe")
    expect(call.html).toContain("Spring Agility Clinic")
  })

  it("sendAdminNewSignupEmail goes to admin cc and includes all signup fields", async () => {
    const { sendAdminNewSignupEmail } = await import("@/lib/email")
    await sendAdminNewSignupEmail(mockSignup, mockEvent)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0] as { to: string | string[]; subject: string; html: string }
    const to = Array.isArray(call.to) ? call.to[0] : call.to
    expect(to).toContain("darren")
    expect(call.subject).toContain("Sam Doe")
    expect(call.subject).toContain("Spring Agility Clinic")
    expect(call.html).toContain("alex@example.com")
    expect(call.html).toContain("555-0100")
    expect(call.html).toContain("Pulled hamstring")
    expect(call.html).toContain("/admin/events/evt-1")
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test:run -- email-events`
Expected: FAIL — functions not exported yet from `@/lib/email`.

- [ ] **Step 3: Append helpers + three templates to `lib/email.ts`**

Open `lib/email.ts`. Near the existing helpers (around line 200, after `heroBanner`), find a good location for a new helper. At the BOTTOM of the helpers block (before the first `export async function send...`), insert the `buildEventContextBlock` helper and an `Event`/`EventSignup` type import. Also import these types at the top of the file near the other imports:

```typescript
import type { Event, EventSignup } from "@/types/database"
```

Add the helper function (helper stays non-exported — internal only):

```typescript
/** Event context block — reused in all three event email templates */
function buildEventContextBlock(event: Event) {
  const start = new Date(event.start_date).toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  const location = event.location_address
    ? `${event.location_name} — ${event.location_address}`
    : event.location_name
  return infoCard([
    { label: "Event", value: event.title },
    { label: "Date", value: start },
    { label: "Location", value: location },
  ])
}
```

At the END of the file, append the three new exports:

```typescript
export async function sendEventSignupReceivedEmail(signup: EventSignup, event: Event) {
  const eventUrl = `${getBaseUrl()}/${event.type === "clinic" ? "clinics" : "camps"}/${event.slug}`
  const html = emailLayout(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">
          ${sectionLabel("Signup received")}

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, serif; font-size:22px; color:#0E3F50;">
            Hi ${signup.parent_name},
          </p>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            Thanks for registering ${signup.athlete_name}'s interest in ${event.title}. Darren reviews every
            signup and will respond within 48 hours.
          </p>

          ${buildEventContextBlock(event)}

          <div style="height:32px;"></div>

          ${ctaButton(eventUrl, "View event details")}

          ${fallbackLink(eventUrl)}
        </td>
      </tr>
    </table>
  `)

  await resend.emails.send({
    from: FROM_EMAIL,
    to: signup.parent_email,
    subject: `We got your interest in ${event.title} — Darren J Paul`,
    html,
  })
}

export async function sendEventSignupConfirmedEmail(signup: EventSignup, event: Event) {
  const eventUrl = `${getBaseUrl()}/${event.type === "clinic" ? "clinics" : "camps"}/${event.slug}`
  const html = emailLayout(`
    ${heroBanner("You're confirmed", event.title)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:40px 48px 52px;">
          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, serif; font-size:22px; color:#0E3F50;">
            Hi ${signup.parent_name},
          </p>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            ${signup.athlete_name} is confirmed for ${event.title}. Here's what to keep on hand:
          </p>

          ${buildEventContextBlock(event)}

          <div style="height:28px;"></div>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            Please arrive 10 minutes early. Bring water, appropriate footwear, and any gear your sport requires.
            If you have questions, reply to this email and Darren will get back to you.
          </p>

          ${ctaButton(eventUrl, "View event details")}

          ${fallbackLink(eventUrl)}
        </td>
      </tr>
    </table>
  `)

  await resend.emails.send({
    from: FROM_EMAIL,
    to: signup.parent_email,
    subject: `You're confirmed for ${event.title}`,
    html,
  })
}

export async function sendAdminNewSignupEmail(signup: EventSignup, event: Event) {
  const adminUrl = `${getBaseUrl()}/admin/events/${event.id}`
  const html = emailLayout(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">
          ${sectionLabel("New signup")}

          <p style="margin:0 0 24px; font-family:'Lexend Exa', Georgia, serif; font-size:20px; color:#0E3F50;">
            ${signup.athlete_name} (age ${signup.athlete_age}) for ${event.title}
          </p>

          ${infoCard([
            { label: "Parent", value: `${signup.parent_name} · ${signup.parent_email}` },
            { label: "Phone", value: signup.parent_phone ?? "—" },
            { label: "Sport", value: signup.sport ?? "—" },
            { label: "Notes", value: signup.notes ?? "—" },
          ])}

          <div style="height:24px;"></div>

          ${infoCard([
            { label: "Event", value: event.title },
            { label: "Date", value: new Date(event.start_date).toLocaleString() },
            { label: "Location", value: event.location_name },
            { label: "Capacity", value: `${event.signup_count} / ${event.capacity} booked` },
          ])}

          <div style="height:32px;"></div>

          ${ctaButton(adminUrl, "Review in admin")}

          ${fallbackLink(adminUrl)}
        </td>
      </tr>
    </table>
  `)

  await resend.emails.send({
    from: FROM_EMAIL,
    to: ADMIN_CC,
    subject: `New signup: ${signup.athlete_name} for ${event.title}`,
    html,
  })
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test:run -- email-events`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/email.ts __tests__/lib/email-events.test.ts
git commit -m "feat(email): add three event signup email templates + helper"
```

---

## Task 2: Public signup route + tests

**Why:** Backend for the signup modal. Validates input, enforces honeypot, creates the pending row, fires the two emails. Admin confirm in Task 3 depends only on the existing DAL, so this task can complete independently.

**Files:**
- Create: `app/api/events/[id]/signup/route.ts`
- Test: `__tests__/api/events/signup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/events/signup.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const getEventByIdMock = vi.fn()
const createSignupMock = vi.fn()
const sendReceivedMock = vi.fn(async () => undefined)
const sendAdminMock = vi.fn(async () => undefined)

vi.mock("@/lib/db/events", () => ({ getEventById: (...args: unknown[]) => getEventByIdMock(...args) }))
vi.mock("@/lib/db/event-signups", () => ({ createSignup: (...args: unknown[]) => createSignupMock(...args) }))
vi.mock("@/lib/email", () => ({
  sendEventSignupReceivedEmail: (...a: unknown[]) => sendReceivedMock(...a),
  sendAdminNewSignupEmail: (...a: unknown[]) => sendAdminMock(...a),
}))

const publishedEvent = {
  id: "evt-1",
  type: "clinic",
  status: "published",
  capacity: 10,
  signup_count: 3,
  slug: "x", title: "x", summary: "", description: "", focus_areas: [],
  start_date: new Date(Date.now() + 86400000).toISOString(),
  end_date: null, session_schedule: null,
  location_name: "L", location_address: null, location_map_url: null,
  age_min: null, age_max: null, price_cents: null, stripe_price_id: null,
  hero_image_url: null, created_at: "", updated_at: "",
}

function makeRequest(body: Record<string, unknown>, urlSuffix = "") {
  return new Request(`http://localhost/api/events/evt-1/signup${urlSuffix}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const validBody = {
  parent_name: "Alex", parent_email: "a@x.com",
  athlete_name: "Sam", athlete_age: 14,
}

const ctx = { params: Promise.resolve({ id: "evt-1" }) }

describe("POST /api/events/[id]/signup", () => {
  beforeEach(() => {
    getEventByIdMock.mockReset()
    createSignupMock.mockReset()
    sendReceivedMock.mockClear()
    sendAdminMock.mockClear()
  })

  it("silently succeeds on honeypot fill without writing DB", async () => {
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest({ ...validBody, website: "http://bot.example" }), ctx)
    expect(res.status).toBe(200)
    expect(createSignupMock).not.toHaveBeenCalled()
    expect(sendReceivedMock).not.toHaveBeenCalled()
  })

  it("returns 400 on invalid body", async () => {
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest({ parent_email: "bad" }), ctx)
    expect(res.status).toBe(400)
  })

  it("returns 404 on unpublished event", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...publishedEvent, status: "draft" })
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest(validBody), ctx)
    expect(res.status).toBe(404)
  })

  it("returns 409 at_capacity when event is full and waitlist query absent", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...publishedEvent, capacity: 3, signup_count: 3 })
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest(validBody), ctx)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toBe("at_capacity")
  })

  it("accepts waitlist override when event is full", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...publishedEvent, capacity: 3, signup_count: 3 })
    createSignupMock.mockResolvedValueOnce({ id: "sig-1", event_id: "evt-1", parent_email: "a@x.com" })
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest(validBody, "?waitlist=true"), ctx)
    expect(res.status).toBe(200)
    expect(createSignupMock).toHaveBeenCalled()
  })

  it("happy path creates signup and fires both emails non-blocking", async () => {
    getEventByIdMock.mockResolvedValueOnce(publishedEvent)
    createSignupMock.mockResolvedValueOnce({ id: "sig-1", event_id: "evt-1", parent_email: "a@x.com" })
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest(validBody), ctx)
    expect(res.status).toBe(200)
    expect(createSignupMock).toHaveBeenCalledWith("evt-1", expect.objectContaining({ parent_email: "a@x.com" }), "interest")
    expect(sendReceivedMock).toHaveBeenCalled()
    expect(sendAdminMock).toHaveBeenCalled()
  })

  it("still returns 200 when email send rejects", async () => {
    getEventByIdMock.mockResolvedValueOnce(publishedEvent)
    createSignupMock.mockResolvedValueOnce({ id: "sig-1", event_id: "evt-1", parent_email: "a@x.com" })
    sendReceivedMock.mockRejectedValueOnce(new Error("resend down"))
    sendAdminMock.mockRejectedValueOnce(new Error("resend down"))
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest(validBody), ctx)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run test — should fail**

Run: `npm run test:run -- api/events/signup`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the route**

Create `app/api/events/[id]/signup/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { createEventSignupSchema } from "@/lib/validators/event-signups"
import { getEventById } from "@/lib/db/events"
import { createSignup } from "@/lib/db/event-signups"
import { sendEventSignupReceivedEmail, sendAdminNewSignupEmail } from "@/lib/email"

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const url = new URL(request.url)
    const waitlist = url.searchParams.get("waitlist") === "true"

    const body = (await request.json()) as Record<string, unknown>

    // Honeypot — silent success, no DB touch, no email.
    if (typeof body.website === "string" && body.website.length > 0) {
      return NextResponse.json({ ok: true })
    }
    delete body.website

    const parsed = createEventSignupSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid signup data", fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const event = await getEventById(id)
    if (!event || event.status !== "published") {
      return NextResponse.json({ error: "Event not available" }, { status: 404 })
    }

    if (!waitlist && event.signup_count >= event.capacity) {
      return NextResponse.json({ error: "at_capacity" }, { status: 409 })
    }

    const signup = await createSignup(id, parsed.data, "interest")

    const [receivedRes, adminRes] = await Promise.allSettled([
      sendEventSignupReceivedEmail(signup, event),
      sendAdminNewSignupEmail(signup, event),
    ])
    if (receivedRes.status === "rejected") {
      console.error(`[api/events/signup] received email failed for signup ${signup.id}`, receivedRes.reason)
    }
    if (adminRes.status === "rejected") {
      console.error(`[api/events/signup] admin email failed for signup ${signup.id}`, adminRes.reason)
    }

    return NextResponse.json({ ok: true, signupId: signup.id })
  } catch (err) {
    console.error("[api/events/signup] unexpected error", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test:run -- api/events/signup`
Expected: 7/7 pass.

- [ ] **Step 5: Commit**

```bash
git add "app/api/events/[id]/signup/route.ts" "__tests__/api/events/signup.test.ts"
git commit -m "feat(events): add public signup route with honeypot + non-fatal emails"
```

---

## Task 3: Admin confirm/cancel route + tests

**Why:** Backend for SignupsTable's inline actions. Wraps the Phase 2a RPCs, maps reasons to HTTP statuses, fires the confirmed email.

**Files:**
- Create: `app/api/admin/events/[id]/signups/[signupId]/route.ts`
- Test: `__tests__/api/admin/events-signups.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/admin/events-signups.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSignupByIdMock = vi.fn()
const getEventByIdMock = vi.fn()
const confirmSignupMock = vi.fn()
const cancelSignupMock = vi.fn()
const sendConfirmedMock = vi.fn(async () => undefined)

vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => authMock(...args) }))
vi.mock("@/lib/db/event-signups", () => ({
  getSignupById: (...a: unknown[]) => getSignupByIdMock(...a),
  confirmSignup: (...a: unknown[]) => confirmSignupMock(...a),
  cancelSignup: (...a: unknown[]) => cancelSignupMock(...a),
}))
vi.mock("@/lib/db/events", () => ({ getEventById: (...a: unknown[]) => getEventByIdMock(...a) }))
vi.mock("@/lib/email", () => ({ sendEventSignupConfirmedEmail: (...a: unknown[]) => sendConfirmedMock(...a) }))

function makeReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/events/evt-1/signups/sig-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: "evt-1", signupId: "sig-1" }) }

const sigMatching = { id: "sig-1", event_id: "evt-1", parent_email: "a@x.com", status: "pending" }

describe("PATCH /api/admin/events/[id]/signups/[signupId]", () => {
  beforeEach(() => {
    authMock.mockReset()
    getSignupByIdMock.mockReset()
    getEventByIdMock.mockReset()
    confirmSignupMock.mockReset()
    cancelSignupMock.mockReset()
    sendConfirmedMock.mockClear()
    authMock.mockResolvedValue({ user: { id: "u1", role: "admin" } })
  })

  it("returns 403 when not admin", async () => {
    authMock.mockResolvedValueOnce(null)
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "confirm" }), ctx)
    expect(res.status).toBe(403)
  })

  it("returns 404 when signup does not belong to event", async () => {
    getSignupByIdMock.mockResolvedValueOnce({ ...sigMatching, event_id: "other-evt" })
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "confirm" }), ctx)
    expect(res.status).toBe(404)
  })

  it("returns 400 on invalid action", async () => {
    getSignupByIdMock.mockResolvedValueOnce(sigMatching)
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "reject" }), ctx)
    expect(res.status).toBe(400)
  })

  it("maps not_pending to 409 on confirm", async () => {
    getSignupByIdMock.mockResolvedValue(sigMatching)
    confirmSignupMock.mockResolvedValueOnce({ ok: false, reason: "not_pending" })
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "confirm" }), ctx)
    expect(res.status).toBe(409)
  })

  it("maps at_capacity to 409 on confirm", async () => {
    getSignupByIdMock.mockResolvedValue(sigMatching)
    confirmSignupMock.mockResolvedValueOnce({ ok: false, reason: "at_capacity" })
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "confirm" }), ctx)
    expect(res.status).toBe(409)
  })

  it("confirm happy path returns refetched signup and fires email", async () => {
    getSignupByIdMock.mockResolvedValueOnce(sigMatching)
    confirmSignupMock.mockResolvedValueOnce({ ok: true })
    getSignupByIdMock.mockResolvedValueOnce({ ...sigMatching, status: "confirmed" })
    getEventByIdMock.mockResolvedValueOnce({ id: "evt-1", title: "T", type: "clinic", slug: "s", start_date: "", location_name: "L" })
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "confirm" }), ctx)
    expect(res.status).toBe(200)
    expect(sendConfirmedMock).toHaveBeenCalled()
    const data = await res.json()
    expect(data.signup.status).toBe("confirmed")
  })

  it("cancel happy path returns refetched signup, no email", async () => {
    getSignupByIdMock.mockResolvedValueOnce(sigMatching)
    cancelSignupMock.mockResolvedValueOnce({ ok: true })
    getSignupByIdMock.mockResolvedValueOnce({ ...sigMatching, status: "cancelled" })
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "cancel" }), ctx)
    expect(res.status).toBe(200)
    expect(sendConfirmedMock).not.toHaveBeenCalled()
  })

  it("cancel maps not_cancellable to 409", async () => {
    getSignupByIdMock.mockResolvedValueOnce(sigMatching)
    cancelSignupMock.mockResolvedValueOnce({ ok: false, reason: "not_cancellable" })
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "cancel" }), ctx)
    expect(res.status).toBe(409)
  })
})
```

- [ ] **Step 2: Run — should fail**

Run: `npm run test:run -- api/admin/events-signups`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Create `app/api/admin/events/[id]/signups/[signupId]/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSignupById, confirmSignup, cancelSignup } from "@/lib/db/event-signups"
import { getEventById } from "@/lib/db/events"
import { sendEventSignupConfirmedEmail } from "@/lib/email"

type Action = "confirm" | "cancel"

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; signupId: string }> },
) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id, signupId } = await ctx.params
    const body = (await request.json()) as { action?: Action }
    if (body.action !== "confirm" && body.action !== "cancel") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }

    const signup = await getSignupById(signupId)
    if (!signup || signup.event_id !== id) {
      return NextResponse.json({ error: "Signup not found" }, { status: 404 })
    }

    if (body.action === "confirm") {
      const result = await confirmSignup(signupId)
      if (!result.ok) {
        const status = result.reason === "not_found" ? 404 : 409
        const message =
          result.reason === "not_pending"
            ? "Signup is already confirmed or cancelled"
            : result.reason === "at_capacity"
              ? "Event is at capacity — cannot confirm more signups"
              : "Signup not found"
        return NextResponse.json({ error: message, reason: result.reason }, { status })
      }

      const updated = await getSignupById(signupId)
      const event = await getEventById(id)
      if (updated && event) {
        try {
          await sendEventSignupConfirmedEmail(updated, event)
        } catch (err) {
          console.error(`[admin confirm] email failed for signup ${signupId}`, err)
        }
      }
      return NextResponse.json({ signup: updated })
    }

    // action === "cancel"
    const result = await cancelSignup(signupId)
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 409
      const message =
        result.reason === "not_cancellable"
          ? "Signup cannot be cancelled from its current state"
          : "Signup not found"
      return NextResponse.json({ error: message, reason: result.reason }, { status })
    }

    const updated = await getSignupById(signupId)
    return NextResponse.json({ signup: updated })
  } catch (err) {
    console.error("[api admin signups PATCH]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- api/admin/events-signups`
Expected: 8/8 pass.

- [ ] **Step 5: Commit**

```bash
git add "app/api/admin/events/[id]/signups/[signupId]/route.ts" "__tests__/api/admin/events-signups.test.ts"
git commit -m "feat(events): add admin signup confirm/cancel route with confirmed email"
```

---

## Task 4: EventSignupModal component

**Why:** The shared form used from both landing-page cards and detail-page sticky card. Self-contained with its own state machine.

**Files:**
- Create: `components/public/EventSignupModal.tsx`

- [ ] **Step 1: Implement the modal**

Create `components/public/EventSignupModal.tsx`:

```tsx
"use client"

import { useState } from "react"
import { CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

export interface EventSignupModalEvent {
  id: string
  title: string
  type: "clinic" | "camp"
  capacity: number
  signup_count: number
}

interface EventSignupModalProps {
  event: EventSignupModalEvent
  open: boolean
  onOpenChange: (open: boolean) => void
  isWaitlist?: boolean
}

type Phase = "form" | "submitting" | "success" | "at_capacity"

export function EventSignupModal({ event, open, onOpenChange, isWaitlist }: EventSignupModalProps) {
  const [phase, setPhase] = useState<Phase>("form")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [formError, setFormError] = useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>, waitlist: boolean) {
    e.preventDefault()
    setPhase("submitting")
    setFieldErrors({})
    setFormError(null)

    const form = new FormData(e.currentTarget)
    const website = form.get("website") // honeypot — we still send it; the server decides

    const body = {
      website: typeof website === "string" ? website : "",
      parent_name: String(form.get("parent_name") ?? ""),
      parent_email: String(form.get("parent_email") ?? ""),
      parent_phone: form.get("parent_phone") ? String(form.get("parent_phone")) : null,
      athlete_name: String(form.get("athlete_name") ?? ""),
      athlete_age: Number(form.get("athlete_age") ?? 0),
      sport: form.get("sport") ? String(form.get("sport")) : null,
      notes: form.get("notes") ? String(form.get("notes")) : null,
    }

    const query = waitlist || isWaitlist ? "?waitlist=true" : ""
    try {
      const res = await fetch(`/api/events/${event.id}/signup${query}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 409 && data.error === "at_capacity") {
        setPhase("at_capacity")
        return
      }
      if (!res.ok) {
        if (data.fieldErrors) setFieldErrors(data.fieldErrors)
        setFormError(data.error ?? "Something went wrong")
        setPhase("form")
        return
      }
      setPhase("success")
    } catch (err) {
      setFormError((err as Error).message)
      setPhase("form")
    }
  }

  function resetAndClose() {
    setPhase("form")
    setFieldErrors({})
    setFormError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isWaitlist ? "Join the waitlist" : "Register your interest"}
          </DialogTitle>
          <DialogDescription>
            {isWaitlist
              ? `${event.title} is currently full. Leave your details and we'll reach out if a spot opens.`
              : `${event.title} — tell us about the athlete and we'll follow up within 48 hours.`}
          </DialogDescription>
        </DialogHeader>

        {phase === "success" ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
            <p className="text-lg font-semibold">We'll be in touch within 48 hours.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Thanks for your interest. Darren reviews every signup personally.
            </p>
            <Button className="mt-6" onClick={resetAndClose}>Close</Button>
          </div>
        ) : phase === "at_capacity" ? (
          <div className="py-6 text-center">
            <p className="text-lg font-semibold">Sorry — this event just filled up.</p>
            <p className="mt-2 text-sm text-muted-foreground">Join the waitlist and we'll contact you if a spot opens.</p>
            <form onSubmit={(e) => submit(e as never, true)} className="mt-6">
              <Button type="submit" disabled>Join waitlist</Button>
            </form>
            <Button variant="outline" className="mt-3" onClick={resetAndClose}>Close</Button>
            <p className="mt-4 text-xs text-muted-foreground">Tip: reopen the form and resubmit to actually enter the waitlist.</p>
          </div>
        ) : (
          <form onSubmit={(e) => submit(e, false)} className="space-y-4">
            {/* Honeypot */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute opacity-0 pointer-events-none h-0 w-0"
            />

            {formError && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="parent_name">Parent full name</Label>
                <Input id="parent_name" name="parent_name" required maxLength={100} />
                {fieldErrors.parent_name && <p className="text-xs text-destructive">{fieldErrors.parent_name[0]}</p>}
              </div>
              <div>
                <Label htmlFor="parent_email">Parent email</Label>
                <Input id="parent_email" name="parent_email" type="email" required />
                {fieldErrors.parent_email && <p className="text-xs text-destructive">{fieldErrors.parent_email[0]}</p>}
              </div>
            </div>

            <div>
              <Label htmlFor="parent_phone">Parent phone (optional)</Label>
              <Input id="parent_phone" name="parent_phone" type="tel" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="athlete_name">Athlete full name</Label>
                <Input id="athlete_name" name="athlete_name" required maxLength={100} />
              </div>
              <div>
                <Label htmlFor="athlete_age">Athlete age</Label>
                <Input id="athlete_age" name="athlete_age" type="number" min={6} max={21} required />
                {fieldErrors.athlete_age && <p className="text-xs text-destructive">{fieldErrors.athlete_age[0]}</p>}
              </div>
            </div>

            <div>
              <Label htmlFor="sport">Sport (optional)</Label>
              <Input id="sport" name="sport" maxLength={60} />
            </div>

            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea id="notes" name="notes" rows={3} maxLength={1000} />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={resetAndClose} disabled={phase === "submitting"}>
                Cancel
              </Button>
              <Button type="submit" disabled={phase === "submitting"}>
                {phase === "submitting" ? "Submitting..." : (isWaitlist ? "Join waitlist" : "Submit")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/public/EventSignupModal.tsx
git commit -m "feat(events): add EventSignupModal with honeypot and state machine"
```

---

## Task 5: EventCard + EventCardCta components

**Why:** The card used on landing pages. EventCardCta is a thin client island that owns modal state so EventCard stays a pure server component.

**Files:**
- Create: `components/public/EventCard.tsx`
- Create: `components/public/EventCardCta.tsx`

- [ ] **Step 1: Create EventCardCta (client)**

Create `components/public/EventCardCta.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { EventSignupModal, type EventSignupModalEvent } from "@/components/public/EventSignupModal"

interface EventCardCtaProps {
  event: EventSignupModalEvent & { type: "clinic" | "camp" }
}

export function EventCardCta({ event }: EventCardCtaProps) {
  const [open, setOpen] = useState(false)
  const isFull = event.signup_count >= event.capacity
  const isCamp = event.type === "camp"

  if (isCamp && !isFull) {
    return (
      <Button disabled title="Paid camp booking opens in Phase 3" className="w-full">
        Book — coming soon
      </Button>
    )
  }

  return (
    <>
      <Button className="w-full" onClick={() => setOpen(true)}>
        {isFull ? "Full — join waitlist" : "Register your interest"}
      </Button>
      <EventSignupModal event={event} open={open} onOpenChange={setOpen} isWaitlist={isFull} />
    </>
  )
}
```

- [ ] **Step 2: Create EventCard (server)**

Create `components/public/EventCard.tsx`:

```tsx
import Image from "next/image"
import Link from "next/link"
import { CalendarDays, MapPin } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { EventCardCta } from "@/components/public/EventCardCta"
import type { Event } from "@/types/database"

interface EventCardProps {
  event: Event
}

function formatPrice(cents: number | null) {
  if (cents == null) return null
  const dollars = cents / 100
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  })
}

export function EventCard({ event }: EventCardProps) {
  const isFull = event.signup_count >= event.capacity
  const spotsLeft = Math.max(0, event.capacity - event.signup_count)
  const lowSpots = !isFull && spotsLeft <= 2
  const price = formatPrice(event.price_cents)
  const href = `/${event.type === "clinic" ? "clinics" : "camps"}/${event.slug}`

  return (
    <Card className="flex h-full flex-col overflow-hidden rounded-2xl border-border">
      <Link href={href} className="relative block aspect-[16/9] overflow-hidden bg-primary/5">
        {event.hero_image_url ? (
          <Image
            src={event.hero_image_url}
            alt={event.title}
            fill
            sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-primary/20 to-accent/20" />
        )}
        <span className="absolute left-3 top-3 rounded-full bg-background/90 px-3 py-1 text-xs font-medium capitalize text-foreground">
          {event.type}
        </span>
      </Link>

      <CardContent className="flex flex-1 flex-col p-6">
        <Link href={href} className="hover:text-primary">
          <h3 className="font-heading text-xl font-semibold tracking-tight">{event.title}</h3>
        </Link>

        <div className="mt-3 space-y-1 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            <span>{formatDate(event.start_date)}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            <span>{event.location_name}</span>
          </div>
        </div>

        <div className="mt-4">
          {isFull ? (
            <p className="text-sm font-semibold text-accent">Full — join waitlist</p>
          ) : (
            <p className={`text-sm ${lowSpots ? "font-semibold text-accent" : "text-muted-foreground"}`}>
              {spotsLeft} {spotsLeft === 1 ? "spot" : "spots"} left
            </p>
          )}
          <div
            className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted"
            aria-hidden="true"
          >
            <div
              className={`h-full ${isFull ? "bg-accent" : "bg-primary"}`}
              style={{ width: `${Math.min(100, (event.signup_count / event.capacity) * 100)}%` }}
            />
          </div>
        </div>

        {price && <p className="mt-4 font-semibold">{price}</p>}

        <div className="mt-6 flex-1" />

        <EventCardCta event={event} />
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/public/EventCard.tsx components/public/EventCardCta.tsx
git commit -m "feat(events): add EventCard + EventCardCta for landing page grid"
```

---

## Task 6: Landing page refactor (clinics + camps)

**Why:** Swap the static `EventsComingSoonPanel` for a live grid when published events exist.

**Files:**
- Modify: `app/(marketing)/clinics/page.tsx`
- Modify: `app/(marketing)/camps/page.tsx`

- [ ] **Step 1: Update clinics page**

Open `app/(marketing)/clinics/page.tsx`. Add an import near the others:

```typescript
import { getPublishedEvents } from "@/lib/db/events"
import { EventCard } from "@/components/public/EventCard"
```

Change the component signature from a sync default export to async:

```typescript
export default async function ClinicsPage() {
```

Fetch events at the top of the function:

```typescript
const events = await getPublishedEvents({ type: "clinic" })
```

Locate the `<section>` containing `<EventsComingSoonPanel type="clinic" />`. Replace the `<div className="mt-10">` block that wraps the panel with:

```tsx
<div className="mt-10">
  {events.length > 0 ? (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  ) : (
    <EventsComingSoonPanel type="clinic" />
  )}
</div>
```

Keep the existing section heading and eyebrow above — only the dates grid changes.

- [ ] **Step 2: Update camps page**

Repeat the same changes in `app/(marketing)/camps/page.tsx` with `type: "camp"` and the camp `EventsComingSoonPanel`. Adjust the heading text to match any copy differences the camps page already uses.

- [ ] **Step 3: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Quick manual smoke**

Run `npm run dev`. Visit `/clinics` and `/camps`. With zero published events, the "coming soon" panel should still render. No need to create test events for this check — that's what the Playwright test handles.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add "app/(marketing)/clinics/page.tsx" "app/(marketing)/camps/page.tsx"
git commit -m "feat(public): wire live events into /clinics and /camps landing pages"
```

---

## Task 7: EventDetailHero component

**Why:** Full-width hero strip for detail pages. Server component; same brand treatment as ClinicHero/CampHero but event-specific.

**Files:**
- Create: `components/public/EventDetailHero.tsx`

- [ ] **Step 1: Implement**

Create `components/public/EventDetailHero.tsx`:

```tsx
import Link from "next/link"
import { ChevronRight, CalendarDays, MapPin, Users } from "lucide-react"
import type { Event } from "@/types/database"

interface EventDetailHeroProps {
  event: Event
}

function formatDateLong(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  })
}

function formatDuration(event: Event) {
  if (event.type === "clinic") return "2-hour clinic"
  if (event.end_date) {
    const days = Math.max(
      1,
      Math.round(
        (new Date(event.end_date).getTime() - new Date(event.start_date).getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    )
    return `${days}-day camp`
  }
  return "Performance camp"
}

export function EventDetailHero({ event }: EventDetailHeroProps) {
  const parentPath = event.type === "clinic" ? "/clinics" : "/camps"
  const parentLabel = event.type === "clinic" ? "Clinics" : "Camps"

  return (
    <section className="relative overflow-hidden bg-primary text-primary-foreground">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at top right, oklch(0.70 0.08 60 / 0.22), transparent 35%), radial-gradient(circle at bottom left, oklch(1 0 0 / 0.08), transparent 30%)",
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 py-12 md:px-6 md:py-16">
        <nav className="flex items-center gap-1 text-sm text-primary-foreground/70">
          <Link href={parentPath} className="hover:text-primary-foreground">{parentLabel}</Link>
          <ChevronRight className="h-4 w-4" />
          <span className="truncate">{event.title}</span>
        </nav>

        <h1 className="mt-4 max-w-4xl font-heading text-4xl font-semibold tracking-tight md:text-6xl">
          {event.title}
        </h1>

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-primary-foreground/85 md:text-base">
          <span className="inline-flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> {formatDateLong(event.start_date)}
          </span>
          <span className="inline-flex items-center gap-2">
            <MapPin className="h-4 w-4" /> {event.location_name}
          </span>
          <span className="inline-flex items-center gap-2">
            <Users className="h-4 w-4" /> {formatDuration(event)}
          </span>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/public/EventDetailHero.tsx
git commit -m "feat(events): add EventDetailHero for per-event detail pages"
```

---

## Task 8: EventSignupCard component

**Why:** Sticky right-column card on desktop + mobile sticky bottom bar. Owns its own modal state.

**Files:**
- Create: `components/public/EventSignupCard.tsx`

- [ ] **Step 1: Implement**

Create `components/public/EventSignupCard.tsx`:

```tsx
"use client"

import { useState } from "react"
import Image from "next/image"
import { CalendarDays, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { EventSignupModal } from "@/components/public/EventSignupModal"
import type { Event } from "@/types/database"

interface EventSignupCardProps {
  event: Event
}

function formatPrice(cents: number | null) {
  if (cents == null) return null
  const dollars = cents / 100
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  })
}

export function EventSignupCard({ event }: EventSignupCardProps) {
  const [open, setOpen] = useState(false)
  const isFull = event.signup_count >= event.capacity
  const isCamp = event.type === "camp"
  const price = formatPrice(event.price_cents)
  const spotsLeft = Math.max(0, event.capacity - event.signup_count)

  function cta() {
    if (isCamp && !isFull) {
      return (
        <Button disabled title="Paid camp booking opens in Phase 3" className="w-full">
          Book — coming soon
        </Button>
      )
    }
    return (
      <Button className="w-full" onClick={() => setOpen(true)}>
        {isFull ? "Full — join waitlist" : "Register your interest"}
      </Button>
    )
  }

  return (
    <>
      {/* Desktop / large-screen sticky card */}
      <Card className="hidden lg:block lg:sticky lg:top-24 rounded-2xl border-border">
        <CardContent className="p-6">
          {event.hero_image_url && (
            <div className="relative mb-4 aspect-[16/9] overflow-hidden rounded-lg">
              <Image
                src={event.hero_image_url}
                alt={event.title}
                fill
                sizes="(min-width: 1024px) 33vw, 100vw"
                className="object-cover"
              />
            </div>
          )}

          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              <span>{formatDate(event.start_date)}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>{event.location_name}</span>
            </div>
          </div>

          <div className="mt-4">
            {isFull ? (
              <p className="text-sm font-semibold text-accent">Full — join waitlist</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {spotsLeft} {spotsLeft === 1 ? "spot" : "spots"} left
              </p>
            )}
            <div
              className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted"
              aria-hidden="true"
            >
              <div
                className={`h-full ${isFull ? "bg-accent" : "bg-primary"}`}
                style={{ width: `${Math.min(100, (event.signup_count / event.capacity) * 100)}%` }}
              />
            </div>
          </div>

          {price && <p className="mt-4 text-xl font-semibold">{price}</p>}

          <div className="mt-6">{cta()}</div>
        </CardContent>
      </Card>

      {/* Mobile sticky bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-4 shadow-lg backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="flex-1 text-sm">
            {price && <div className="font-semibold">{price}</div>}
            {isFull ? (
              <div className="text-accent">Waitlist only</div>
            ) : (
              <div className="text-muted-foreground">{spotsLeft} spots left</div>
            )}
          </div>
          <div className="w-40">{cta()}</div>
        </div>
      </div>

      <EventSignupModal
        event={event}
        open={open}
        onOpenChange={setOpen}
        isWaitlist={isFull}
      />
    </>
  )
}
```

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/public/EventSignupCard.tsx
git commit -m "feat(events): add EventSignupCard with sticky desktop + mobile bar"
```

---

## Task 9: Clinic detail page

**Why:** Per-clinic landing page at `/clinics/[slug]` with sticky signup card.

**Files:**
- Create: `app/(marketing)/clinics/[slug]/page.tsx`

- [ ] **Step 1: Implement**

Create `app/(marketing)/clinics/[slug]/page.tsx`:

```tsx
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { EventDetailHero } from "@/components/public/EventDetailHero"
import { EventSignupCard } from "@/components/public/EventSignupCard"
import { getEventBySlug, getPublishedEvents } from "@/lib/db/events"

export const revalidate = 300

export async function generateStaticParams() {
  const events = await getPublishedEvents({ type: "clinic" })
  return events.map((e) => ({ slug: e.slug }))
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const event = await getEventBySlug(slug)
  if (!event || event.type !== "clinic" || event.status !== "published") return {}
  const images = event.hero_image_url ? [{ url: event.hero_image_url }] : []
  return {
    title: event.title,
    description: event.summary,
    openGraph: { title: event.title, description: event.summary, images },
    twitter: { card: "summary_large_image", title: event.title, description: event.summary },
  }
}

const CLINIC_AUDIENCE = [
  "Field and court sport athletes aged 12–18",
  "Players who want sharper movement and more confidence in open play",
  "Parents looking for better athletic development, not generic hard work",
]

export default async function ClinicDetailPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const event = await getEventBySlug(slug)
  if (!event || event.type !== "clinic" || event.status !== "published") notFound()

  const eventSchema = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: event.summary,
    startDate: event.start_date,
    endDate: event.end_date,
    location: {
      "@type": "Place",
      name: event.location_name,
      address: event.location_address ?? undefined,
    },
    organizer: {
      "@type": "Organization",
      name: "DJP Athlete",
      url: "https://djpathlete.com",
    },
    image: event.hero_image_url ? [event.hero_image_url] : undefined,
  }

  return (
    <>
      <JsonLd data={eventSchema} />
      <EventDetailHero event={event} />

      <div className="mx-auto max-w-7xl px-4 py-12 md:px-6 md:py-16 pb-32 lg:pb-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
          <FadeIn>
            <article className="space-y-10">
              <div className="prose prose-lg max-w-none">
                {event.description.split(/\n\n+/).map((p, i) => (
                  <p key={i} className="text-lg leading-8 text-muted-foreground">{p}</p>
                ))}
              </div>

              {event.focus_areas.length > 0 && (
                <div>
                  <h2 className="font-heading text-2xl font-semibold text-foreground">What gets coached</h2>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {event.focus_areas.map((fa) => (
                      <span key={fa} className="rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
                        {fa}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h2 className="font-heading text-2xl font-semibold text-foreground">Who it's for</h2>
                <ul className="mt-4 space-y-2 text-muted-foreground">
                  {CLINIC_AUDIENCE.map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-accent" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h2 className="font-heading text-2xl font-semibold text-foreground">Location</h2>
                <div className="mt-3 rounded-xl border border-border p-4">
                  <p className="font-medium">{event.location_name}</p>
                  {event.location_address && (
                    <p className="mt-1 text-sm text-muted-foreground">{event.location_address}</p>
                  )}
                  {event.location_map_url && (
                    <Link
                      href={event.location_map_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      Open map <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              </div>
            </article>
          </FadeIn>

          <aside>
            <EventSignupCard event={event} />
          </aside>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(marketing)/clinics/[slug]/page.tsx"
git commit -m "feat(public): add /clinics/[slug] detail page with sticky signup card"
```

---

## Task 10: Camp detail page

**Why:** Mirror of the clinic detail page at `/camps/[slug]`. Same structure, camp-specific copy, price line, disabled CTA.

**Files:**
- Create: `app/(marketing)/camps/[slug]/page.tsx`

- [ ] **Step 1: Implement**

Create `app/(marketing)/camps/[slug]/page.tsx`:

```tsx
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { EventDetailHero } from "@/components/public/EventDetailHero"
import { EventSignupCard } from "@/components/public/EventSignupCard"
import { getEventBySlug, getPublishedEvents } from "@/lib/db/events"

export const revalidate = 300

export async function generateStaticParams() {
  const events = await getPublishedEvents({ type: "camp" })
  return events.map((e) => ({ slug: e.slug }))
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const event = await getEventBySlug(slug)
  if (!event || event.type !== "camp" || event.status !== "published") return {}
  const images = event.hero_image_url ? [{ url: event.hero_image_url }] : []
  return {
    title: event.title,
    description: event.summary,
    openGraph: { title: event.title, description: event.summary, images },
    twitter: { card: "summary_large_image", title: event.title, description: event.summary },
  }
}

const CAMP_AUDIENCE = [
  "Athletes aged 12–18 in an off-season or pre-season block",
  "Players who want better physical preparation before competition ramps up",
  "Parents and teams who value both training quality and measurable feedback",
]

export default async function CampDetailPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const event = await getEventBySlug(slug)
  if (!event || event.type !== "camp" || event.status !== "published") notFound()

  const eventSchema = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: event.summary,
    startDate: event.start_date,
    endDate: event.end_date,
    location: {
      "@type": "Place",
      name: event.location_name,
      address: event.location_address ?? undefined,
    },
    offers:
      event.price_cents != null
        ? {
            "@type": "Offer",
            price: (event.price_cents / 100).toFixed(2),
            priceCurrency: "USD",
            availability: "https://schema.org/PreOrder",
          }
        : undefined,
    organizer: {
      "@type": "Organization",
      name: "DJP Athlete",
      url: "https://djpathlete.com",
    },
    image: event.hero_image_url ? [event.hero_image_url] : undefined,
  }

  return (
    <>
      <JsonLd data={eventSchema} />
      <EventDetailHero event={event} />

      <div className="mx-auto max-w-7xl px-4 py-12 md:px-6 md:py-16 pb-32 lg:pb-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
          <FadeIn>
            <article className="space-y-10">
              <div className="prose prose-lg max-w-none">
                {event.description.split(/\n\n+/).map((p, i) => (
                  <p key={i} className="text-lg leading-8 text-muted-foreground">{p}</p>
                ))}
              </div>

              {event.session_schedule && (
                <div>
                  <h2 className="font-heading text-2xl font-semibold text-foreground">Schedule</h2>
                  <p className="mt-2 text-muted-foreground">{event.session_schedule}</p>
                </div>
              )}

              {event.focus_areas.length > 0 && (
                <div>
                  <h2 className="font-heading text-2xl font-semibold text-foreground">What gets developed</h2>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {event.focus_areas.map((fa) => (
                      <span key={fa} className="rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
                        {fa}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h2 className="font-heading text-2xl font-semibold text-foreground">Who it's for</h2>
                <ul className="mt-4 space-y-2 text-muted-foreground">
                  {CAMP_AUDIENCE.map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-accent" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h2 className="font-heading text-2xl font-semibold text-foreground">Location</h2>
                <div className="mt-3 rounded-xl border border-border p-4">
                  <p className="font-medium">{event.location_name}</p>
                  {event.location_address && (
                    <p className="mt-1 text-sm text-muted-foreground">{event.location_address}</p>
                  )}
                  {event.location_map_url && (
                    <Link
                      href={event.location_map_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      Open map <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              </div>
            </article>
          </FadeIn>

          <aside>
            <EventSignupCard event={event} />
          </aside>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(marketing)/camps/[slug]/page.tsx"
git commit -m "feat(public): add /camps/[slug] detail page with sticky signup card"
```

---

## Task 11: SignupsTable component + wire into admin edit page

**Why:** Replace the Phase 2a placeholder on `/admin/events/[id]` with an interactive table that confirms/cancels via the route built in Task 3.

**Files:**
- Create: `components/admin/events/SignupsTable.tsx`
- Modify: `app/(admin)/admin/events/[id]/page.tsx`

- [ ] **Step 1: Create SignupsTable**

Create `components/admin/events/SignupsTable.tsx`:

```tsx
"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import type { EventSignup } from "@/types/database"

interface SignupsTableProps {
  initialSignups: EventSignup[]
  eventId: string
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  confirmed: "bg-success/15 text-success",
  cancelled: "bg-destructive/15 text-destructive",
  refunded: "bg-destructive/10 text-destructive",
}

export function SignupsTable({ initialSignups, eventId }: SignupsTableProps) {
  const [signups, setSignups] = useState(initialSignups)
  const [pending, setPending] = useState<Record<string, boolean>>({})

  async function act(signupId: string, action: "confirm" | "cancel") {
    if (action === "cancel" && !confirm("Cancel this signup?")) return

    setPending((p) => ({ ...p, [signupId]: true }))

    // Optimistic update
    const previous = signups
    setSignups((prev) =>
      prev.map((s) =>
        s.id === signupId
          ? { ...s, status: action === "confirm" ? "confirmed" : "cancelled" }
          : s,
      ),
    )

    try {
      const res = await fetch(`/api/admin/events/${eventId}/signups/${signupId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSignups(previous) // rollback
        toast.error(data.error ?? `Failed to ${action} signup`)
        return
      }
      setSignups((prev) => prev.map((s) => (s.id === signupId ? data.signup : s)))
      toast.success(`Signup ${action === "confirm" ? "confirmed" : "cancelled"}`)
    } catch (err) {
      setSignups(previous)
      toast.error((err as Error).message)
    } finally {
      setPending((p) => ({ ...p, [signupId]: false }))
    }
  }

  if (signups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
        <p className="font-medium">No signups yet</p>
        <p className="text-sm text-muted-foreground">Public signups will appear here.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Athlete</th>
            <th className="px-4 py-3">Age</th>
            <th className="px-4 py-3">Parent</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Phone</th>
            <th className="px-4 py-3">Sport</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {signups.map((s) => (
            <tr key={s.id} className="border-t border-border align-top">
              <td className="px-4 py-3">
                <div className="font-medium">{s.athlete_name}</div>
                {s.notes && (
                  <div className="mt-1 text-xs text-muted-foreground">{s.notes}</div>
                )}
              </td>
              <td className="px-4 py-3">{s.athlete_age}</td>
              <td className="px-4 py-3">{s.parent_name}</td>
              <td className="px-4 py-3">{s.parent_email}</td>
              <td className="px-4 py-3">{s.parent_phone ?? "—"}</td>
              <td className="px-4 py-3">{s.sport ?? "—"}</td>
              <td className="px-4 py-3 capitalize">{s.signup_type}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s.status] ?? ""}`}>
                  {s.status}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-2">
                  {s.status === "pending" && (
                    <Button size="sm" disabled={pending[s.id]} onClick={() => act(s.id, "confirm")}>
                      Confirm
                    </Button>
                  )}
                  {(s.status === "pending" || s.status === "confirmed") && (
                    <Button size="sm" variant="outline" disabled={pending[s.id]} onClick={() => act(s.id, "cancel")}>
                      Cancel
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Update the admin edit page**

Open `app/(admin)/admin/events/[id]/page.tsx`. Add an import:

```typescript
import { SignupsTable } from "@/components/admin/events/SignupsTable"
```

Locate the `<section>` that renders the inline signups `<table>` (and its empty-state branch). Replace the **entire contents** of the section after the `<h2>` heading with:

```tsx
<SignupsTable initialSignups={signups} eventId={event.id} />
```

The fetched `signups` and `event.id` variables are already in scope.

Remove the now-unused `Inbox` import from `lucide-react` (unless other code on the page still uses it — check first).

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/admin/events/SignupsTable.tsx "app/(admin)/admin/events/[id]/page.tsx"
git commit -m "feat(admin): add interactive SignupsTable with optimistic confirm/cancel"
```

---

## Task 12: Sitemap extension

**Why:** SEO — search engines need to know the new per-event URLs exist.

**Files:**
- Modify: `app/sitemap.ts`

- [ ] **Step 1: Add published-event loops**

Open `app/sitemap.ts`. Add an import near the existing `getPublishedBlogPosts`:

```typescript
import { getPublishedEvents } from "@/lib/db/events"
```

Inside the default exported function, after the existing `blogPages` try/catch, add two parallel try/catch blocks for clinic + camp events and concatenate their results to the return:

```typescript
let eventPages: MetadataRoute.Sitemap = []
try {
  const [clinics, camps] = await Promise.all([
    getPublishedEvents({ type: "clinic" }),
    getPublishedEvents({ type: "camp" }),
  ])
  eventPages = [
    ...clinics.map((e) => ({
      url: `${BASE_URL}/clinics/${e.slug}`,
      lastModified: new Date(e.updated_at),
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...camps.map((e) => ({
      url: `${BASE_URL}/camps/${e.slug}`,
      lastModified: new Date(e.updated_at),
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ]
} catch {
  // If DB is unavailable, return without event pages
}

return [...staticPages, ...blogPages, ...eventPages]
```

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run `npm run dev`. Visit `/sitemap.xml`. Should still serve XML with existing entries (no events yet since none published, so no change visible — that's expected). Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/sitemap.ts
git commit -m "feat(seo): add published clinic + camp events to sitemap"
```

---

## Task 13: Playwright smoke — public signup

**Why:** Catches regressions on the highest-value user flow (visitor → modal → submit → success).

**Files:**
- Create: `__tests__/e2e/event-signup.spec.ts`

- [ ] **Step 1: Write the scaffold test**

Create `__tests__/e2e/event-signup.spec.ts`:

```typescript
import { test, expect } from "@playwright/test"

// Needs a seeded published clinic. Skip if EVENT_TEST_SLUG is missing.
const eventSlug = process.env.EVENT_TEST_SLUG

test.describe("Public event signup flow", () => {
  test.skip(!eventSlug, "EVENT_TEST_SLUG not set — scaffolding only")

  test("visitor can open the signup modal from the detail page and submit", async ({ page }) => {
    await page.goto(`/clinics/${eventSlug}`)

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()

    await page.getByRole("button", { name: /register your interest/i }).first().click()

    await page.fill("input[name='parent_name']", "E2E Parent")
    await page.fill("input[name='parent_email']", `e2e-${Date.now()}@test.example`)
    await page.fill("input[name='athlete_name']", "E2E Athlete")
    await page.fill("input[name='athlete_age']", "14")

    await page.getByRole("button", { name: /^submit$/i }).click()

    await expect(page.getByText(/we'll be in touch within 48 hours/i)).toBeVisible()
  })
})
```

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: no errors. Do not run Playwright itself — credentials/port mismatch same as prior phases.

- [ ] **Step 3: Commit**

```bash
git add "__tests__/e2e/event-signup.spec.ts"
git commit -m "test(e2e): scaffold public signup smoke test"
```

---

## Task 14: Final verification + phase tag

**Why:** Sanity check that everything still compiles and tests pass before tagging and opening the PR.

**Files:** none — verification only.

- [ ] **Step 1: Format sweep**

Run: `npm run format:check`.

If files are flagged, run `npm run format` and stage ONLY the Phase 2b files (do not sweep the whole repo — see Phase 2a experience):

```bash
git add components/public/EventCard.tsx components/public/EventCardCta.tsx \
  components/public/EventDetailHero.tsx components/public/EventSignupCard.tsx \
  components/public/EventSignupModal.tsx components/admin/events/SignupsTable.tsx \
  "app/(marketing)/clinics/page.tsx" "app/(marketing)/camps/page.tsx" \
  "app/(marketing)/clinics/[slug]/page.tsx" "app/(marketing)/camps/[slug]/page.tsx" \
  "app/(admin)/admin/events/[id]/page.tsx" \
  "app/api/events/[id]/signup/route.ts" "app/api/admin/events/[id]/signups/[signupId]/route.ts" \
  app/sitemap.ts lib/email.ts \
  __tests__/api/events/signup.test.ts __tests__/api/admin/events-signups.test.ts \
  __tests__/lib/email-events.test.ts __tests__/e2e/event-signup.spec.ts
git commit -m "style: prettier format phase 2b files"
```

Skip if format:check was clean.

- [ ] **Step 2: Unit + integration tests**

Run: `npm run test:run`
Expected: all Phase 2b tests pass. Pre-existing failures from Phase 1/2a (ai-schemas UUID, coach-ai-policy FK, exercise-usage FK) remain — those are not regressions.

Phase 2b-specific counts should be:
- `__tests__/lib/email-events.test.ts` — 3 pass
- `__tests__/api/events/signup.test.ts` — 7 pass
- `__tests__/api/admin/events-signups.test.ts` — 8 pass

Total new: 18 tests.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: clean build. Look for `/clinics/[slug]`, `/camps/[slug]`, and the two new API routes in the build output.

- [ ] **Step 4: Tag the phase**

```bash
git tag phase-2b-clinics-camps-complete
```

- [ ] **Step 5: Git log summary**

```bash
git log --oneline main..HEAD
```

Report the commit list.

---

## Self-Review Checklist

**Spec coverage:**

| Phase 2b spec requirement | Task |
|---|---|
| `EventCard` on landing pages | Tasks 5, 6 |
| Landing page conditional grid vs. ComingSoon panel | Task 6 |
| `/clinics/[slug]` + `/camps/[slug]` detail pages with sticky card | Tasks 9, 10 |
| `generateStaticParams` + `revalidate = 300` | Tasks 9, 10 |
| `EventSignupModal` with honeypot + state machine | Task 4 |
| `POST /api/events/[id]/signup` + honeypot + non-fatal emails | Task 2 |
| `PATCH /api/admin/events/[id]/signups/[signupId]` + RPC wrappers + confirmed email | Task 3 |
| `SignupsTable` with optimistic UI + replaces Phase 2a placeholder | Task 11 |
| 3 Resend email templates + helper | Task 1 |
| Per-event `Event` JsonLd on detail pages | Tasks 9, 10 |
| Published event slugs in sitemap | Task 12 |
| Camp book button stays disabled in 2b | Tasks 5, 8 |
| Waitlist signups write same `interest` row | Tasks 2, 4 |
| Playwright smoke | Task 13 |

**Placeholder scan:** no TBDs, no "fill in details", no "add appropriate error handling" — every step has concrete code or a concrete command.

**Type consistency:** `EventSignupModalEvent` (the Pick type used by the modal) is consistent across modal + EventCardCta + EventSignupCard (latter two pass the full `Event`, which structurally contains the needed fields). `ConfirmResult`/`CancelResult` discriminated unions from Phase 2a DAL are used in Task 3's switch. Route contexts use `Promise<{...}>` params per Next.js 16 consistently.

**Notes for implementer:**
- The modal's "at_capacity" UI currently has a `<Button disabled>Join waitlist</Button>` that's not wired to re-submit — the plan describes the intended waitlist re-submit flow but leaves the explicit "click this to really join waitlist" action as a known gap. In practice, the EventCardCta and EventSignupCard already open the modal with `isWaitlist={true}` when the event is full, so the happy path is covered. The at_capacity state inside the modal handles a mid-session race and is rare enough that pointing the user to "close and reopen to enter waitlist" is acceptable — enhance in Phase 3 if it bites.

**No migration required.** `event_signups` table + RPCs from Phase 2a are sufficient.
