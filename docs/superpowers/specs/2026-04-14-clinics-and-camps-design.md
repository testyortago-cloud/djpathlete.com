# Clinics & Camps — Design Spec

**Date:** 2026-04-14
**Status:** Approved design, pending implementation plans

## Summary

Add two public marketing pages (`/clinics` and `/camps`) backed by a shared events CMS in the admin panel. Clinics are 2-hour youth agility workshops with interest-capture signups (offline payment). Camps are 2-week off/pre-season blocks with Stripe-powered guest checkout. Work is sliced into three independently shippable phases.

## Goals

- Give Darren two marketing pages to share externally within days.
- Enable admin-driven event creation, publishing, and signup management without developer involvement.
- Accept paid bookings for camps without forcing parents to create user accounts.
- Keep the data model unified so adding future event types (workshops, clinics at new formats) is additive.

## Non-Goals

- In-app refund handling (use Stripe dashboard).
- Multi-athlete / sibling discounts.
- Recurring-event templates (each event is its own row).
- Per-location structured data (free-text location fields in v1).
- Rich text description editor (plain textarea for now).
- Image upload UI (paste existing URL in v1).
- Email template editor in admin.

## Key Decisions

1. **Two separate pages** at `/clinics` and `/camps` (not a single tabbed page) — different audiences, different SEO, different booking flows.
2. **Adapted to existing brand** — Green Azure + Gray Orange + Lexend, not Darren's dark mockup aesthetic. Mockup provides structure and copy, not visual direction.
3. **Shared `events` table with `type` discriminator** — clinics and camps share 80% of fields. Nullable columns express the differences.
4. **Hybrid signup model** — interest capture for clinics (offline payment, manual confirmation), Stripe Checkout for camps (automated, guest-friendly).
5. **Guest-capable Stripe flow** — new parallel route; existing `/api/stripe/checkout` (auth-required, used for programs) is untouched.
6. **Free-text locations** — no `locations` table yet. Promote to first-class entity later if venues stabilize.
7. **Three-phase rollout** — marketing pages first, admin CMS second, Stripe third. Each phase is independently shippable.

## Data Model

### `events` table

| column                     | type                 | notes                                                  |
| -------------------------- | -------------------- | ------------------------------------------------------ |
| `id`                       | uuid PK              |                                                        |
| `type`                     | text                 | `'clinic' \| 'camp'`                                   |
| `slug`                     | text unique          | URL slug, e.g. `agility-clinic-2026-05-03-richmond`    |
| `title`                    | text                 |                                                        |
| `summary`                  | text                 | short card blurb (1–2 lines)                           |
| `description`              | text                 | long-form plain text                                   |
| `focus_areas`              | text[]               | drives the "what gets coached" section                 |
| `start_date`               | timestamptz          | clinic: start time; camp: first day                    |
| `end_date`                 | timestamptz nullable | clinic: same-day end time; camp: last day              |
| `session_schedule`         | text nullable        | camp only — free-text like "M–F, 9–11am"               |
| `location_name`            | text                 |                                                        |
| `location_address`         | text nullable        |                                                        |
| `location_map_url`         | text nullable        |                                                        |
| `age_min`, `age_max`       | int nullable         |                                                        |
| `capacity`                 | int                  | max signups                                            |
| `signup_count`             | int default 0        | incremented on confirmed signup                        |
| `price_cents`              | int nullable         | null for clinics (offline), set for camps              |
| `stripe_price_id`          | text nullable        | camp only, set when synced to Stripe                   |
| `status`                   | text                 | `'draft' \| 'published' \| 'cancelled' \| 'completed'` |
| `hero_image_url`           | text nullable        |                                                        |
| `created_at`, `updated_at` | timestamptz          |                                                        |

Indices: `status`, `type`, `start_date`, `slug`.

### `event_signups` table

| column                                          | type                     | notes                                                   |
| ----------------------------------------------- | ------------------------ | ------------------------------------------------------- |
| `id`                                            | uuid PK                  |                                                         |
| `event_id`                                      | uuid FK                  |                                                         |
| `signup_type`                                   | text                     | `'interest' \| 'paid'`                                  |
| `parent_name`, `parent_email`, `parent_phone`   | text                     | guest-friendly                                          |
| `athlete_name`, `athlete_age`                   | text, int                |                                                         |
| `sport`                                         | text nullable            |                                                         |
| `notes`                                         | text nullable            |                                                         |
| `status`                                        | text                     | `'pending' \| 'confirmed' \| 'cancelled' \| 'refunded'` |
| `stripe_session_id`, `stripe_payment_intent_id` | text nullable            | camp paid signups                                       |
| `amount_paid_cents`                             | int nullable             |                                                         |
| `user_id`                                       | uuid nullable FK → users | optional link if email matches an account               |
| `created_at`                                    | timestamptz              |                                                         |

### Counter maintenance

`signup_count` is maintained by DAL functions inside transactions — not DB triggers — so capacity logic stays co-located with the code that reads it. The DAL transaction pattern:

```
BEGIN;
  SELECT capacity, signup_count FROM events WHERE id = ? FOR UPDATE;
  -- if signup_count >= capacity, abort
  INSERT INTO event_signups (...);
  UPDATE events SET signup_count = signup_count + 1 WHERE id = ?;
COMMIT;
```

Increment happens on status transition to `confirmed` (admin click for clinics; webhook for camps), not on row creation. This prevents "last spot" abandonment from blocking new signups.

## Phase 1 — Public pages (marketing)

**Scope:** Ship both landing pages with static content + inquiry form CTAs. No migration, no admin interface, no DB reads. When Phase 2 lands, the upcoming-events section starts populating automatically without page changes.

### Routes

- `/clinics` → `app/(marketing)/clinics/page.tsx`
- `/camps` → `app/(marketing)/camps/page.tsx`

### Shared section structure

1. **Hero** — Green Azure background with subtle radial gradient (using `--primary` token), Lexend Exa headline, Gray Orange CTA button, right-side pitch card. Stat row:
   - Clinics: Format (2 Hours) / Age Group (12–18) / Numbers (8–12 Max)
   - Camps: Focus (Overall Performance) / Block (Off / Pre-Season) / Added Value (Insight + Reporting)
2. **What gets coached / developed** — 4-card grid. Phase 1 uses static focus list per page (Acceleration / Deceleration / Change of Direction / Rotation for clinics; Speed + Power / Strength / Movement Quality / Conditioning for camps). Phase 2 lets admin override per event.
3. **How it runs / Technology + feedback**
   - Clinics: numbered 4-step flow (Prep → Coach → Build → Finish)
   - Camps: 4-card "Technology + feedback" block using the Radar icon
4. **Upcoming dates** — in Phase 1 this section renders a static "New dates coming soon — register interest" panel linking to the inquiry form below. Phase 2 replaces the static panel with a grid of `EventCard`s from `getPublishedEvents({ type, from: now })`. The surrounding page layout does not change between phases.
5. **Who it's for** — two-card split (target athlete + outcome). Copy lifted from Darren's mockup.
6. **CTA footer** — inline inquiry form ([components/public/InquiryForm.tsx](components/public/InquiryForm.tsx)) with hidden `interest` field pre-filled to `'clinic'` or `'camp'`.

### New components

- [components/public/EventCard.tsx](components/public/EventCard.tsx) — reusable card, handles "spots left" and "sold out" states. Built in Phase 2 when real event data becomes available. Phase 1 does not need it.
- [components/public/ClinicHero.tsx](components/public/ClinicHero.tsx), [components/public/CampHero.tsx](components/public/CampHero.tsx) — distinct content, shared brand styling.
- [components/public/FocusGrid.tsx](components/public/FocusGrid.tsx) — 4-card grid, accepts focus array prop.
- [components/public/NumberedFlow.tsx](components/public/NumberedFlow.tsx) — numbered steps block.

### SEO (Phase 1)

- Each page: `metadata` export with title/description/OG/Twitter + `Service` JsonLd.
- `sitemap.ts` adds `/clinics` and `/camps`.

## Phase 2 — Admin events CMS

**Scope:** `events` + `event_signups` tables, DAL, validators, full admin CRUD, per-event detail pages, interest signup flow for clinics, email notifications. Camps can be created but their "Book" button shows "Coming soon" until Phase 3.

### Admin routes

| route                                   | purpose                                                 |
| --------------------------------------- | ------------------------------------------------------- |
| `/admin/events`                         | List view — filter by type + status, "New event" button |
| `/admin/events/new`                     | Create form — type selector drives conditional fields   |
| `/admin/events/[id]`                    | Edit form + signups table                               |
| `/admin/events/[id]/signups/[signupId]` | Signup detail — confirm, cancel, add notes              |

List columns: Title • Type • Start date • Location • Signups (`3/10`) • Status • Actions (edit / duplicate / publish / cancel). Default sort: upcoming first. Filters: type, status, title search.

### Edit form — conditional by type

- **Shared fields:** title, slug (auto-suggest from title, editable), summary, description (plain textarea), focus areas (tag input), location (name, address, map URL), capacity, hero image URL, status.
- **Clinic:** single datetime picker → derives `start_date` and `end_date` as a 2-hour window, age min/max.
- **Camp:** date range picker, session schedule free-text, age min/max, price (dollars, stored as cents), "Sync to Stripe" button (disabled in Phase 2).

### Public event detail pages

- `/clinics/[slug]` and `/camps/[slug]` — full description, date/time, location with map link, capacity indicator, signup modal.
- `generateStaticParams` over published events; `revalidate = 300`.
- Per-event `Event` JsonLd with `location`, `startDate`, `endDate`, `offers.price` for camps.
- Landing pages get `ItemList` JsonLd listing upcoming events.

### Interest signup flow (clinics)

1. Visitor clicks "Register interest" on a card → modal [components/public/EventSignupForm.tsx](components/public/EventSignupForm.tsx) with parent + athlete fields.
2. Submit → `POST /api/events/[id]/signup` → creates `event_signups` row, `signup_type='interest'`, `status='pending'`. `signup_count` NOT incremented yet.
3. Resend email: confirmation to parent, notification to Darren.
4. Admin opens the signup, clicks "Confirm" → `PATCH /api/admin/events/[id]/signups/[signupId]` flips status to `confirmed`, increments `signup_count` inside a transaction with capacity guard. Parent receives confirmed email.
5. Capacity handling: API rejects new signups when `signup_count + pending_count >= capacity`, returns a payload the client uses to show "Full — join waitlist?". Waitlist signups are stored with a flag visible to the admin.

### DAL + validators

- [lib/db/events.ts](lib/db/events.ts), [lib/db/event-signups.ts](lib/db/event-signups.ts) — service-role client, typed returns, follow existing DAL conventions.
- [lib/validators/events.ts](lib/validators/events.ts), [lib/validators/event-signups.ts](lib/validators/event-signups.ts) — Zod schemas mirroring the DB shape with discriminated unions on `type`.

### Admin navigation

Add "Events" to the admin sidebar between "Bookings" and "Clients". Clinic/camp events are distinct from 1-on-1 bookings and get their own top-level slot.

### Emails (Phase 2)

Three templates via existing Resend integration:

- `event-signup-received` → parent on submit
- `event-signup-confirmed` → parent on admin confirm
- `admin-new-signup-notification` → Darren on every new signup

Hardcoded templates in v1; editor deferred.

### Migration

`supabase/migrations/<next-number>-create-events.sql` — both tables, indices, no seed data.

## Phase 3 — Stripe camp checkout

**Scope:** enable the "Book camp" button on published camps. Clinics stay on interest-capture permanently.

### Guest-capable checkout

Existing `/api/stripe/checkout` requires `auth()`. Phase 3 adds a parallel, guest-capable path. The existing route is untouched.

### New routes

| route                                     | purpose                                                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/events/[id]/checkout`          | Creates Stripe Checkout Session for a camp. Accepts guest payload, creates pending `event_signups` row, returns `sessionUrl`. No auth. |
| `POST /api/admin/events/[id]/stripe-sync` | Creates Stripe Product + Price, writes `stripe_price_id` back to event. Admin-only.                                                    |
| `/camps/[slug]/success`                   | Success screen reads `session_id`, shows confirmation from the updated signup row.                                                     |

Existing `POST /api/stripe/webhook` is **extended** with a `checkout.session.completed` handler branch keyed on `metadata.event_signup_id`. Existing program-purchase branch untouched.

### Flow

1. Visitor clicks "Book camp" → modal with parent/athlete form.
2. Submit → `POST /api/events/[id]/checkout` creates `event_signups` row (`signup_type='paid'`, `status='pending'`) → creates Stripe Session with:
   - `line_items[0].price = event.stripe_price_id`
   - `customer_email = parent_email`
   - `metadata.event_signup_id = <row id>`
   - `success_url = /camps/[slug]/success?session_id={CHECKOUT_SESSION_ID}`
   - `cancel_url = /camps/[slug]`
   - Returns `sessionUrl`.
3. Server-side capacity guard before creating the session: reject if `signup_count + (count of pending paid signups created within the last hour) >= capacity`. Pending-but-unfinalized Stripe checkouts reserve a spot for up to one hour (see "Abandoned checkouts" below).
4. Stripe Checkout collects payment. On success, webhook flips signup to `paid` + `confirmed`, increments `signup_count`, sends confirmation email.
5. Stripe redirects to success page, which reads the signup and renders confirmation.

### Stripe product sync (admin side)

- "Sync to Stripe" button (dead in Phase 2) creates Product + Price, writes `stripe_price_id`.
- Price changes after sync create a new Price object (Stripe rule) — handler does this automatically and updates stored id.
- Cancelling an event archives the Stripe product.

### Edge cases

- **Abandoned checkouts:** pending rows older than 1 hour with no webhook confirmation are swept to `status='cancelled'`. Implementation choice (scheduled Firebase function vs. on-read sweep) deferred to implementation plan based on what exists.
- **Webhook-before-redirect race:** benign — success page reads `confirmed` signup, renders confirmation.
- **Last-spot race:** capacity check happens inside the DAL transaction that creates the pending signup (same `FOR UPDATE` lock pattern as interest signups), not in the handler. Prevents two parallel requests both claiming the last spot.
- **Refunds:** manual via Stripe dashboard in v1.
- **Full camp:** button disables, shows "Join waitlist" → writes `signup_type='interest'` row. Same pattern as clinic waitlist.

## Routing Summary

| route                                   | phase | purpose              |
| --------------------------------------- | ----- | -------------------- |
| `/clinics`                              | 1     | landing page         |
| `/camps`                                | 1     | landing page         |
| `/clinics/[slug]`                       | 2     | event detail         |
| `/camps/[slug]`                         | 2     | event detail         |
| `/camps/[slug]/success`                 | 3     | Stripe post-checkout |
| `/admin/events`                         | 2     | list                 |
| `/admin/events/new`                     | 2     | create               |
| `/admin/events/[id]`                    | 2     | edit + signups       |
| `/admin/events/[id]/signups/[signupId]` | 2     | signup detail        |

| API route                                         | phase                      |
| ------------------------------------------------- | -------------------------- |
| `POST /api/events/[id]/signup`                    | 2                          |
| `POST /api/events/[id]/checkout`                  | 3                          |
| `POST /api/admin/events`                          | 2                          |
| `PATCH /api/admin/events/[id]`                    | 2                          |
| `POST /api/admin/events/[id]/stripe-sync`         | 3                          |
| `PATCH /api/admin/events/[id]/signups/[signupId]` | 2                          |
| `POST /api/stripe/webhook`                        | 3 (extended, not replaced) |

## Navigation

Add "Clinics" and "Camps" to [components/SiteNavbar.tsx](components/SiteNavbar.tsx) as top-level items alongside "In-Person", "Online", "Services". Mobile nav inherits.

## SEO

- **Phase 1:** metadata + `Service` JsonLd on each landing page. Sitemap entries.
- **Phase 2:** `ItemList` JsonLd on landing pages, per-event `Event` JsonLd on detail pages, published event slugs added to `sitemap.ts`. `revalidate = 300` on detail pages.
- **Phase 3:** `Event.offers.price` populated for camps.

## Testing

- **Phase 1:** component tests for `EventCard`, `FocusGrid`, `NumberedFlow`. Playwright smoke test hitting `/clinics` and `/camps`.
- **Phase 2:** DAL tests for `events.ts` and `event-signups.ts` — capacity enforcement, status transitions, counter increments, race-condition test using concurrent inserts. Admin form tests. API route tests for signup + admin CRUD. Playwright test for signup modal → admin confirm → email sent.
- **Phase 3:** webhook handler tests with mocked Stripe `checkout.session.completed` events. Capacity-guard test at checkout creation. Abandoned-signup sweep test. End-to-end Stripe test mode run.

## Dependencies

Nothing new. Reuses shadcn (card, button, dialog, input, select, textarea, tabs), React Hook Form + Zod, Lucide, Framer Motion, Supabase (service-role client for admin/DAL), NextAuth (admin auth only — public routes are guest), Stripe SDK, Resend.

## Phase Boundaries — What Ships When

**Phase 1 ships:** two public landing pages with static content + inquiry-form CTAs. No DB changes. Darren has shareable URLs immediately.

**Phase 2 ships:** admin events CMS, per-event public detail pages, interest signup flow for clinics, email notifications. Camps can be created and displayed but "Book" button shows "Coming soon".

**Phase 3 ships:** Stripe guest checkout for camps, webhook confirmation, success screen, Stripe product sync. Optional — can be deferred indefinitely if interest-capture is sufficient.

Each phase is independently shippable, reviewable, and rollback-safe.
