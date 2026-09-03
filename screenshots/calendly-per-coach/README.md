# Phase 0 tenancy proof — Calendly booking, after RLS and NOT NULL

What this proves: after turning on row-level security for `bookings` and making
`business_id`, `host_id` and `end_at` NOT NULL (migrations `00239`–`00243`),
the real admin app still works end to end. This is a browser proof, not a
mocked test — a real signed Calendly webhook was delivered to the running
dev server, and the four screens below are the real admin routes, signed in
as the real dev-clone admin user, reading the row it wrote.

Script: `scripts/capture-phase0-tenancy-screenshots.mjs`. Run with the dev
server up (`npm run dev`, port 3050) against the dev clone only — the script
refuses to run against any other Supabase project.

Each run creates one brand-new contact (through the real public chat capture
route, `/api/ask/capture`) and delivers one new signed Calendly webhook with a
fresh `scheduled_event` URI and a fresh, timestamped invitee email, so the run
is additive and collides with nothing. Nothing is deleted; the
`ca1e0d1e-0002-...` and `aaaaaaaa-0000-...` prefixed rows other demo scripts
own are never touched.

Admin UI is light-only. `.dark` is a class variant these components were
never built against and there is no toggle that applies it, so there is no
second, dark-mode version of these screens to capture.

## The screenshots

1. **`01-admin-bookings-list.png`** — `/admin/bookings`. Proves the bookings
   list still renders after RLS went on. The new row (Sasha Duclos, "via
   Calendly") was written seconds before the shot by the signed webhook; the
   database now refuses to store a booking that doesn't say which business
   owns it, and refuses to hand these rows to anything but the app's own
   service-role connection. The row's own action menu (reschedule/cancel
   links from Calendly) still works.

2. **`02-admin-pipeline-card.png`** — `/admin/pipeline`. Proves the same
   booking still drives the pipeline: a fresh card for the same person landed
   in "Consult Booked" automatically. What changed under the hood and isn't
   visible on screen: the "New Call Booked" notification this booking fires
   now goes only to the members of this one business, not to every admin
   account that exists — the fan-out reads `business_members`, scoped to
   `business_id`, instead of every `role = 'admin'` row.

3. **`03-admin-contact-record.png`** — `/admin/contacts/<id>`. Proves the
   contact record for a brand-new person renders, and the booking appears in
   their timeline. Note for anyone reading the earlier
   `capture-calendly-booking-screenshots.mjs` captions: those say "bookings
   has no contact_id" — that was true when they were written and is **no
   longer true**. This booking's row carries a real `contact_id` (see the
   read-back below); the timeline itself still matches by normalised email
   and phone rather than by that new column, which is a separate, still-open
   gap worth knowing about.

4. **`04-admin-audit-logs-commerce.png`** — `/admin/audit-logs?category=commerce`.
   Proves the audit trail still records a `booking.created` row for a booking
   made after RLS went on, and that the category filter (a URL search param,
   read server-side) narrows the list correctly. The highlighted row is this
   exact booking.

## Read-back

```sql
select id, business_id, host_id, contact_id, end_at, invitee_timezone, source
  from public.bookings order by created_at desc limit 3;
```

| id | business_id | host_id | contact_id | end_at | invitee_timezone | source |
|---|---|---|---|---|---|---|
| `40afe44f-a958-41fc-922c-232324808a6c` | `00000000-0000-0000-0000-000000000001` | `7574d2ac-3697-48b5-8804-03081666c14a` | `645cdfe4-48c6-4933-ac4b-156aa451b9ea` | `2026-09-04 15:38:00+00` | `America/New_York` | `calendly` |
| `0ce52e7f-d8df-4c40-81f6-4c7182191531` | `00000000-0000-0000-0000-000000000001` | `7574d2ac-3697-48b5-8804-03081666c14a` | `3b31a0c2-0f72-4af7-8b0b-9a45d0ff1314` | `2026-09-04 15:30:00+00` | `America/New_York` | `calendly` |
| `87836a9e-120e-4e0d-a101-b4d72230a9bd` | `00000000-0000-0000-0000-000000000001` | `7574d2ac-3697-48b5-8804-03081666c14a` | `ae68da79-1140-43af-9a40-059edbd155d6` | `2026-09-04 15:30:00+00` | `America/New_York` | `calendly` |

The top row (`40afe44f-...`) is the run that produced the four screenshots
above (contact `645cdfe4-...`, "Sasha Duclos"). The other two rows are from
two earlier authoring runs of this same script, made while fixing a locator
bug in screenshot 4 — left in place deliberately (nothing is deleted here)
and visible in screenshot 1 as the two "Priya Whitfield" rows. All three rows
carry non-null `business_id`, `host_id`, `contact_id` and `end_at`, which is
the thing this whole exercise exists to prove: none of the three NOT NULL
columns silently fell back to a default, and `contact_id` — brand new this
phase — resolved correctly every time.

## Marker warnings

None. `markerOn` warns loudly on `MARKER TARGET NOT FOUND` or `MATCHED N
ELEMENTS`; neither fired on the final run. (Two locators needed fixing during
authoring, before any screenshot was accepted: the pipeline card locator
needed `.last()` once two same-named stray contacts existed from earlier
runs, and the bookings-list row locator was switched from matching on name to
matching on email for the same reason — both are noted in the script's
comments.)
