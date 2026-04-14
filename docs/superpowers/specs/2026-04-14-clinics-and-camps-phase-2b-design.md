# Clinics & Camps Phase 2b — Public Integration + Signup Flow Design Spec

**Date:** 2026-04-14
**Status:** Approved design, pending implementation plan
**Parent specs:** [2026-04-14-clinics-and-camps-design.md](2026-04-14-clinics-and-camps-design.md) (master), [2026-04-14-clinics-and-camps-phase-2a-design.md](2026-04-14-clinics-and-camps-phase-2a-design.md) (2a)
**Previous phase:** Phase 2a merged at commit `52786ab`, tagged `phase-2a-clinics-camps-complete`.

## Summary

Phase 2b turns the Phase 2a admin CMS into a visitor-facing product. Landing pages `/clinics` and `/camps` render live event cards when events are published. Each published event gets a detail page with a sticky signup card. A modal signup form writes a pending `event_signups` row, triggers two Resend emails (parent acknowledgment + admin notification), and shows up in the admin signups table where Darren confirms or cancels inline.

Camp "Book" buttons remain disabled in 2b with a "Coming soon" tooltip — paid camp checkout ships in Phase 3.

## Goals

- Let visitors discover upcoming clinics and camps on the existing landing pages without clicking into a per-event page.
- Provide a conversion-focused per-event detail page with a persistent signup CTA.
- Capture parent + athlete interest via a low-friction modal form that stays on the page.
- Give Darren a one-click confirm/cancel workflow in admin, backed by the Phase 2a capacity-guard RPCs.
- Send parent + admin notification emails using the existing branded Resend integration in `lib/email.ts`.
- Keep guest signups spam-resistant with a honeypot field; defer rate limiting / captcha until real abuse shows up.

## Non-Goals (deferred to 3 or later)

- Stripe camp checkout — Phase 3.
- Rate limiting (IP bucket / Upstash) — revisit when admin inbox is noisy.
- hCaptcha / Turnstile — revisit if honeypot proves insufficient.
- Cancel-reason capture in admin — promote to a hybrid modal only if Darren wants an audit trail.
- `notified_at` tracking on signups for failed emails — add only if we see real email failures in production.
- Separate waitlist data model — waitlist entries are identical `signup_type='interest'` rows. Admin distinguishes them visually only.
- Dedicated admin signup detail page (`/admin/events/[id]/signups/[signupId]`) — folded into inline actions on the edit page.

## Key Decisions (locked during brainstorming)

1. **Two-column detail page** with sticky signup card (right column on desktop; sticky bottom bar on mobile).
2. **Modal signup UX** — one `EventSignupModal` component, used from both landing-page `EventCard` and detail-page `EventSignupCard`. No dedicated signup route. Success state renders inside the modal.
3. **Inline admin confirm/cancel** — no separate signup detail page. Row-level buttons with optimistic UI. `confirm()` browser prompt on cancel only.
4. **Honeypot + nothing else** for spam protection in 2b. Silent success (200) when the hidden field is filled so bots don't learn the check exists.
5. **Email failure is non-fatal** — `Promise.allSettled` at the call site. Signup row is the source of truth.
6. **Pending signups don't consume capacity** — capacity is enforced only at `confirm_event_signup` (Phase 2a RPC). A "Full — join waitlist" button exists for UX but writes the same `signup_type='interest'` row.

## Public UI

### `components/public/EventCard.tsx`

Server component. Props: `{ event: Event }`. Renders a card with:

- Hero image (fallback gradient when `hero_image_url` is null)
- Type badge (clinic / camp)
- Title (`font-heading text-2xl`)
- Date row: formatted `start_date` + location name with Lucide `CalendarDays` and `MapPin` icons
- Capacity indicator: `{signup_count}/{capacity} booked` with a thin progress bar in accent color when <= 2 spots left; "Full — join waitlist" label when at capacity
- Camps only: price line formatted from `price_cents / 100`
- CTA button rules:
  - **Clinic, spots available** — "Register your interest" → opens `EventSignupModal`
  - **Clinic, at capacity** — "Full — join waitlist" → opens modal with `isWaitlist` prop
  - **Camp** — "Book — coming soon", disabled, tooltip: "Paid camp booking opens in Phase 3"
  - **Camp, at capacity** — "Full — join waitlist" → opens modal (same interest-capture path)

The button is a client island inside the otherwise-server EventCard — lifted into a `<EventCardCta>` sub-component that imports the modal.

### Landing page refactor

`app/(marketing)/clinics/page.tsx` and `.../camps/page.tsx`: only the "Upcoming dates" section changes. Fetch published events via `getPublishedEvents({ type })` in the server component and conditionally render:

```tsx
{events.length > 0
  ? <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">{events.map(e => <EventCard key={e.id} event={e} />)}</div>
  : <EventsComingSoonPanel type="clinic" />}
```

`EventsComingSoonPanel` remains as the zero-state fallback.

### Detail pages — `/clinics/[slug]` and `/camps/[slug]`

**Routing:**
- `generateStaticParams` → `getPublishedEvents({ type })` returns slugs
- `revalidate = 300` (5 minutes)
- `getEventBySlug(slug)` → `notFound()` if null, wrong type, or status !== 'published'

**Layout (two-column, sticky right):**

- **Full-width hero strip** (shared `EventDetailHero` component): Green Azure background with subtle radial gradient, breadcrumb, H1 = event title, chips for Date / Location / Duration or Block.
- **Left column (main):**
  - Description — `event.description` rendered as paragraphs (split on `\n\n` for now; rich text deferred)
  - Focus areas — horizontal chip row (each chip styled like `bg-primary/10 text-primary rounded-full px-3 py-1`) since `focus_areas` is a flat `string[]` without bodies
  - Who-it-is-for — static copy specific to type (lifted from the landing page's existing WHO_ITS_FOR constant; keep in the detail page file for now — promote if a third callsite appears)
  - Location card — name, address, map link if present
- **Right column (sticky on `lg` breakpoint: `lg:sticky lg:top-24`):** `EventSignupCard` component. Shows hero image (if any), formatted date/time, location name, capacity indicator, price (camps), and the CTA button. Same button rules as `EventCard`.
- **Mobile sticky bar:** below `lg`, the right column content doesn't sticky. Instead a `<div className="fixed bottom-0 inset-x-0 lg:hidden ...">` bar renders just the CTA button so it's always tappable.

**Components added:**
- `components/public/EventCard.tsx` + `components/public/EventCardCta.tsx` (client)
- `components/public/EventDetailHero.tsx` — hero strip used only on detail pages
- `components/public/EventSignupCard.tsx` — right column + mobile bar (client, owns the modal state)
- `components/public/EventSignupModal.tsx` — the modal itself (client)

### SEO

- Per-event metadata export (title, description, openGraph.images with hero image if set)
- `Event` JsonLd on detail pages: `@type: Event`, `name`, `startDate`, `endDate`, `location.name` + `location.address`, `offers.price` (camps only), `organizer`
- `ItemList` JsonLd on landing pages when events exist
- `app/sitemap.ts` extends: loop over published clinics + camps and emit `/clinics/[slug]` + `/camps/[slug]` with `changeFrequency: "daily"`, `priority: 0.7`

## Signup flow

### `components/public/EventSignupModal.tsx`

Client component wrapping shadcn `Dialog`.

Props: `{ event: Pick<Event, "id" | "title" | "type" | "start_date" | "capacity" | "signup_count">, open: boolean, onOpenChange: (open: boolean) => void, isWaitlist?: boolean }`.

Internal state machine: `form → submitting → success | error`.

**Fields:** parent name*, parent email*, parent phone, athlete name*, athlete age* (6–21), sport, notes. Mirrors Phase 2a's `createEventSignupSchema` exactly.

**Honeypot:** hidden `<input name="website">` — visually hidden via `className="absolute opacity-0 pointer-events-none h-0 w-0"`, `tabIndex={-1}`, `autoComplete="off"`, `aria-hidden="true"`. Not in the Zod schema; checked at the API route.

**Submit:** `POST /api/events/[id]/signup` with JSON. On success, renders a check-mark + "We'll be in touch within 48 hours" message and a Close button. On `409 { error: "at_capacity" }`, renders "Sorry, this event just filled up — would you like to join the waitlist?" with a button that re-submits with query `?waitlist=true`.

**Waitlist copy:** when `isWaitlist` is true, modal title is "Join the waitlist" and body explains that Darren will contact them if a spot opens.

### `POST /api/events/[id]/signup` (public, no auth)

**Request:** JSON body matching `createEventSignupSchema` plus optional `website` (honeypot).

**Flow:**

1. Parse params (`await ctx.params`).
2. Parse body. If `body.website` is a non-empty string, return `200 { ok: true }` without DB write. **Silent drop.**
3. Strip `website` from body, then Zod-validate against `createEventSignupSchema`. 400 on failure with `fieldErrors`.
4. `getEventById(eventId)`. 404 if null or `event.status !== 'published'`.
5. Capacity guard: if `event.signup_count >= event.capacity` AND query string does NOT have `waitlist=true`, return `409 { error: "at_capacity" }`.
6. `createSignup(eventId, validated, 'interest')` → persists pending row.
7. Fire two emails via `Promise.allSettled`:
   - `sendEventSignupReceivedEmail(signup, event)` → parent
   - `sendAdminNewSignupEmail(signup, event)` → Darren (`ADMIN_CC`)
   Log any rejection via `console.error` with signup id + function name.
8. Return `200 { ok: true, signupId: signup.id }`.

**Error handling:** 400/404/409 paths as above. Unhandled errors return 500 with a generic message, logged.

## Admin confirm/cancel

### `components/admin/events/SignupsTable.tsx` (new client component, replaces inline table on edit page)

Props: `{ initialSignups: EventSignup[], eventId: string }`. Owns local state; returns the updated signup from each API call and replaces it in place.

**Columns:** Athlete · Age · Parent · Email · Phone · Sport · Type · Status · Actions.

**Actions per row:**
- Status `pending` → "Confirm" (primary) + "Cancel" (outline)
- Status `confirmed` → "Cancel" only
- Status `cancelled` / `refunded` → no buttons

**Optimistic UI:** on click, flip the row's status locally, fire the PATCH, on error revert local state and show a sonner error toast (project already uses sonner — see `app/layout.tsx` or similar for the `<Toaster>` setup).

**Confirm action** — no extra prompt. **Cancel action** — `if (!confirm("Cancel this signup?")) return`.

**Row expansion:** include `notes` as a secondary line under the athlete name when present (no toggle needed — just render below the athlete name in a muted style). Keeps the table simple without hiding useful info.

The edit page (`app/(admin)/admin/events/[id]/page.tsx`) currently renders the signups section. Replace the inline `<table>` JSX with `<SignupsTable initialSignups={signups} eventId={event.id} />`. Empty-state stays the same.

### `PATCH /api/admin/events/[id]/signups/[signupId]` (admin-only)

**Request:** JSON body `{ action: "confirm" | "cancel" }`.

**Flow:**

1. Auth guard — 403 if not admin.
2. Parse `id` and `signupId` from async params.
3. `getSignupById(signupId)` → 404 if null or `signup.event_id !== id`.
4. Dispatch:
   - `confirm` → `confirmSignup(signupId)`. Map `{ok: false, reason}` to HTTP:
     - `not_found` → 404
     - `not_pending` → 409 `{ error: "Signup is already confirmed or cancelled" }`
     - `at_capacity` → 409 `{ error: "Event is at capacity — cannot confirm more signups" }`
   - `cancel` → `cancelSignup(signupId)`. Map:
     - `not_found` → 404
     - `not_cancellable` → 409 `{ error: "Signup cannot be cancelled from its current state" }`
5. On successful `confirm`, fire `sendEventSignupConfirmedEmail(signup, event)` via `Promise.allSettled`. Non-fatal.
6. Refetch the signup row and return `200 { signup }`.

Invalid `action` values → 400.

## Emails

### Additions to `lib/email.ts`

Follow the existing `sendInquiryEmail` / `sendInquiryAutoReply` pattern — each is an async function using the `emailLayout()` wrapper and `resend.emails.send()`.

1. **`sendEventSignupReceivedEmail(signup: EventSignup, event: Event)`** (parent, public signup)
   - Subject: `We got your interest in ${event.title} — Darren J Paul`
   - Body: short acknowledgment, event context block (title, date, location), "Darren reviews every signup and responds within 48 hours", link to the event detail page.

2. **`sendEventSignupConfirmedEmail(signup: EventSignup, event: Event)`** (parent, admin confirm)
   - Subject: `You're confirmed for ${event.title}`
   - Body: confirmation copy with athlete name, event context (title, date + time, location name + address + map link), 1–2 lines of what-to-expect, contact line.

3. **`sendAdminNewSignupEmail(signup: EventSignup, event: Event)`** (Darren, public signup)
   - To: `ADMIN_CC` (existing const, `darren@darrenjpaul.com`)
   - Subject: `New signup: ${signup.athlete_name} for ${event.title}`
   - Body: all signup fields (parent name/email/phone, athlete name/age, sport, notes), event context with `${signup_count}/${capacity}` counter, direct admin link `${getBaseUrl()}/admin/events/${event.id}`.

**Shared helper:** `buildEventContextBlock(event: Event): string` returns the recurring "Event · Date · Location" HTML block used in all three templates. One source of truth for the event summary formatting.

## SEO summary

- **Detail page metadata:** per-event `title`, `description` (from summary), OpenGraph image (from `hero_image_url`).
- **Detail page JsonLd:** `Event` schema with all required fields.
- **Landing page JsonLd:** `ItemList` when published events exist; skip when array is empty.
- **`app/sitemap.ts`:** extend with loops over published clinic + camp slugs. Follow existing blog-loop pattern.

## File inventory

### New files

- `components/public/EventCard.tsx`
- `components/public/EventCardCta.tsx` (client island inside EventCard)
- `components/public/EventDetailHero.tsx`
- `components/public/EventSignupCard.tsx` (client — owns modal state)
- `components/public/EventSignupModal.tsx` (client)
- `app/(marketing)/clinics/[slug]/page.tsx`
- `app/(marketing)/camps/[slug]/page.tsx`
- `app/api/events/[id]/signup/route.ts`
- `app/api/admin/events/[id]/signups/[signupId]/route.ts`
- `components/admin/events/SignupsTable.tsx`
- `__tests__/api/events/signup.test.ts` — public signup route tests
- `__tests__/api/admin/events-signups.test.ts` — admin confirm/cancel tests
- `__tests__/lib/email.test.ts` — unit tests for 3 new email functions (with mocked Resend)
- `__tests__/e2e/event-signup.spec.ts` — Playwright smoke: visitor visits /clinics/[slug], opens modal, submits, sees success

### Modified files

- `app/(marketing)/clinics/page.tsx` — fetch + conditional render EventCard grid vs. ComingSoon panel
- `app/(marketing)/camps/page.tsx` — same pattern
- `app/(admin)/admin/events/[id]/page.tsx` — replace inline signups table with `<SignupsTable>`
- `app/sitemap.ts` — append published event slugs
- `lib/email.ts` — three new exports + `buildEventContextBlock` helper

### No migration in 2b

All schema and RPCs already exist from Phase 2a. Storage bucket already exists.

## Testing

- **Unit:** three email templates with Resend mocked; assertions on `to`, subject string, and key body fields.
- **API route tests:** public signup honeypot silent drop, 400 validation, 404 unpublished event, 409 at-capacity path, 200 happy path. Admin confirm/cancel: 403 non-admin, 404 wrong event, 409 each RPC reason, 200 happy paths. Mock `auth()` per Phase 2a pattern.
- **E2E:** Playwright smoke hitting a published event on `/clinics`, opening modal, filling the form, submitting. Gated behind env vars like Phase 2a — real DB + email sends are too flaky for CI.

## Dependencies

Nothing new. Reuses shadcn (Dialog, Input, Label, Textarea, Button, Card), sonner for toasts, React Hook Form + Zod for the modal form, Lucide icons, Resend (existing), Supabase (existing).

## What ships after Phase 2b

- Parents discover published clinics and camps on `/clinics` and `/camps`, click through to a detail page, fill the modal form, get a confirmation email.
- Darren receives an admin notification email with a direct link to the new signup and confirms/cancels inline from the admin table. Parents get a "you're confirmed" email on admin confirm.
- Camp detail pages render but the book button is disabled pending Phase 3.
- Everything Phase 2a built is now user-visible, all under the same Phase 2a capacity primitives.
