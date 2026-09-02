# Full Engine Phase 2 — Calendly replaces the GoHighLevel calendar

**Status:** §3 answered 2026-09-03; building on `feat/calendly-booking`
**Date:** 2026-09-01
**Branch:** `feat/calendly-booking` (off `a45ac3c1`)
**Parent:** [docs/full-engine-scope-vs-built.md](../../full-engine-scope-vs-built.md) §5
**Closes scope lines:** "It books consults directly from live calendar availability"
**Owner decision, 2026-09-01:** Calendly, not a native calendar and not GHL.

---

## 1. What this is

This is the last thing keeping GoHighLevel load-bearing.

Every booking in the system arrives through
[app/api/webhooks/ghl-booking/route.ts](../../../app/api/webhooks/ghl-booking/route.ts).
That webhook does four things, and only one of them is obvious:

1. writes a `bookings` row
2. `exitRunsForContact` — a person who books stops being nurtured
3. `enqueueBookingConversion` — the Google Ads conversion
4. `applyPipelineEvent` — the card moves to Consult Booked

**Cancel GoHighLevel today and all four stop.** The pipeline's booking trigger
goes dead, ads stop learning, and people who book keep receiving "still thinking
about it?" emails. None of that is visible as an error; it is simply an event
that never arrives.

So this phase is not "add Calendly". It is "move those four consequences onto a
source you control, then prove GHL can be switched off."

---

## 2. What is true today

`bookings`, migration 00050 — note the shape, it predates the contact spine:

```sql
contact_name, contact_email, contact_phone,
booking_date, duration_minutes,
status CHECK (status IN ('scheduled','completed','cancelled','no_show')),
source text DEFAULT 'ghl',
ghl_contact_id text,
ghl_appointment_id text UNIQUE
```

There is **no `contact_id`**. Bookings are matched to people by email and phone;
`getBookingsForPipelineReconcile` already does it.

There is no availability anywhere in the app — no slots table, no working-hours
config, no public booking route. `bookings` is a record of what GHL decided.

The assistant's `book_consult` returns a link to `CONSULT_PATH = "/contact"` and
says so honestly in its own tool description.

**Calendly is already half-adopted.** It is on the funnel builder's redirect
allowlist by explicit owner decision —
[lib/funnels/islands.ts:60](../../../lib/funnels/islands.ts#L60) — because
"booking pages live off-site (Calendly)". This phase makes official what the
funnels already do.

---

## 3. Verify these three things before building anything

My knowledge of Calendly's API tiers may be stale, and two of these change the
design rather than the code. **Check them against current Calendly docs on day
one** (the `context7` MCP server has live docs; use it rather than memory):

| Question | Why it changes the design |
|---|---|
| Does the account's plan include **webhook subscriptions**? | If not, there is no push. Bookings would have to be polled, which changes §4.3 from a webhook to a cron and makes "the card moves when a consult is booked" delayed rather than immediate. |
| Does it include the **available-times** endpoint, and what is its date-range limit? | If availability cannot be read, `book_consult` returns a scheduling link instead of real slots — still an improvement on today, but not the scope sentence. |
| What is the exact **signature scheme** on the webhook? | It must be verified before the body is trusted. See §5. |

### 3.1 Answers — checked 2026-09-03 against Calendly's live developer docs

Read through the `context7` MCP (`/websites/developer_calendly`, high-reputation
source) plus two direct fetches of calendly.com help pages. Nothing below is
from memory; where the docs disagreed with each other, both readings are given.

**Before the three: the account itself.** There is no Calendly credential
anywhere in this repo — not in `.env.local`, not in `.env.example`, not in any
Vercel environment (`vercel env ls` lists the six `GHL_*` names and nothing
Calendly-shaped). So "does the ACCOUNT's plan include X" cannot be inspected
from here; the docs answer what each plan includes, and the owner has to say
which plan the account is on. `scripts/calendly-setup.mjs` asks Calendly
directly (`GET /users/me`, then `POST /webhook_subscriptions`) the moment a
token exists — the plan question is answered by that call succeeding or
returning 403, not by anybody's recollection.

| Question | Answer from the docs | What it means here |
|---|---|---|
| **1. Webhook subscriptions?** | *"For webhooks, the Calendly user account needs a paid subscription on the Standard, Teams, or Enterprise plan."* (FAQ.) *"Webhook access is restricted to paid premium subscriptions and above."* (Getting Started.) API GET/POST calls are available *"on any subscription plan, including the Free plan"*. | Push exists on every paid tier and on none of the free ones. **§4.4 is built as a webhook**, because a paid plan is a prerequisite of choosing Calendly as the load-bearing booking source at all — a Free account has no way to tell this app that anything was booked. If the owner's account turns out to be Free, the fallback is a polling cron over `GET /scheduled_events?min_start_time=…` (also available on Free), and "the card moves when a consult is booked" becomes "within N minutes". That cron is NOT built; the setup script reports which world we are in. |
| **2. Available-times endpoint, and its range limit?** | `GET https://api.calendly.com/event_type_available_times?event_type=<uri>&start_time=<iso>&end_time=<iso>`, scope `availability:read`. `start_time`/`end_time` are required and *"must be in the future"*. **Range limit: the docs disagree** — the endpoint reference says *"Date range can be no greater than 31 days"*; the Scheduling Link Examples recipe says *"cannot span more than 7 days; longer ranges necessitate additional API calls"*. Each slot comes back as `{ status: "available", invitees_remaining, start_time, scheduling_url }` — the `scheduling_url` lands on THAT slot's booking form. No plan gate is documented (GET endpoints are Free-plan-inclusive). | Availability CAN be read, so `book_consult` offers real times. The client asks for **7 days**, the stricter of the two readings, so it is correct under either. It does not page beyond that: seven days of a consult calendar is more than the card shows anyway. The per-slot `scheduling_url` is what the slot buttons link to (with prefill appended), so clicking a time lands the visitor on that exact time, not on the month view. |
| **3. Webhook signature scheme?** | Header `Calendly-Webhook-Signature: t=<unix seconds>,v1=<hex>`. `v1` is **HMAC-SHA256** keyed by the *webhook signing key* over the string `t + "." + <raw request body>`. The signing key is chosen by us at subscription time (`signing_key` on `POST /webhook_subscriptions`, personal-access-token flow). Docs recommend rejecting timestamps older than a **3-minute** tolerance to stop replays. | **Nothing about the URL is signed** — this is where it differs from Twilio, whose HMAC covers the full request URL and broke on apex-vs-www. The body must be read as raw text BEFORE `JSON.parse`, because a re-serialised body is not the signed bytes. `lib/calendly/signature.ts` implements exactly this: parse `t`/`v1`, constant-time compare, reject `|now - t| > 180s`. |

**Also learned, and relevant to the design:**

- **Prefill is by query string** on any scheduling link: `?name=`, `?email=`,
  `?first_name=`, `?last_name=`, `?a1..a10=` (custom questions), `?guests=`,
  `?location=`. Spaces as `%20`. UTM parameters (`utm_source`, `utm_medium`,
  `utm_campaign`, `utm_content`, `utm_term`) are also accepted and *"available
  in the webhook payload"* under `payload.tracking` — the docs say outright
  they *"can be used to track custom data like user IDs"*. That is the channel
  the click ids travel through (see §8.4).
- **A reschedule is TWO deliveries**, not one: `invitee.canceled` for the old
  invitee with `payload.rescheduled: true` and `payload.new_invitee` set, and
  `invitee.created` for the new one with `payload.old_invitee` set, under a NEW
  `scheduled_event.uri`. Order of arrival is not guaranteed. See §8.2.
- **Calendly now has a booking-creation endpoint**, `POST /invitees` ("Scheduling
  API", written up as "schedule events with AI agents"). It is deliberately NOT
  used: `tools.ts`'s load-bearing property is that no tool the model can call
  has a write path, and `__tests__/lib/lead-engine/chat-tools.test.ts` pins it.
  Owner decision 5 stands — Calendly books, the assistant points.
- `GET /webhook_subscriptions/sample_data` exists (scope `webhooks:read`) and
  returns a sample delivery. The setup script calls it so the parser's shape
  can be checked against the real thing before the first live booking.

**Do not start §4.4 until the first is answered.** Everything else can proceed.

---

## 4. What to build

### 4.1 Schema

```sql
-- 002xx_calendly_bookings.sql
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS calendly_event_uri text,
  ADD COLUMN IF NOT EXISTS reschedule_url     text,
  ADD COLUMN IF NOT EXISTS cancel_url         text;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_calendly_event_uri_key
  ON public.bookings (calendly_event_uri)
  WHERE calendly_event_uri IS NOT NULL;
```

**A new column, not a reuse of `ghl_appointment_id`.** This repo already settled
this argument once: migration 00235 rejected writing `'opp:<uuid>'` into
`stripe_session_id` on the grounds that *"a column named for Stripe holding
things that are not Stripe ids is a lie to every future reader."* Same rule.

The unique index is **partial** — `WHERE … IS NOT NULL` — because every existing
GHL row has a null there and a plain `UNIQUE` would reject all but one of them.

`reschedule_url` / `cancel_url` come back on the webhook payload and are the only
way for the admin to act on a booking without logging into Calendly.

### 4.2 Reading availability

`lib/calendly/client.ts`:

```ts
listAvailableTimes(eventTypeUri, from, to): Promise<Slot[]>
schedulingLink(eventTypeUri, prefill?: { name?, email? }): string
```

Availability is read **at request time and never cached in our database**. A
stored copy of someone's calendar is wrong within minutes and there is no
invalidation signal. The same reasoning `stalenessOf` uses in the pipeline —
computed at read time, never stored.

If the endpoint is unavailable per §3, `listAvailableTimes` throws a typed
`CalendlyUnavailable` and the assistant falls back to the link. **It must not
return `[]`** — an empty array means "no free slots", which is a real answer and
a different one. (`null` and `[]` are different answers; this repo has been bitten
by conflating them.)

### 4.3 Prefilling, so the booking is not anonymous

The whole value of the assistant booking is that it already knows who it is
talking to. `schedulingLink` takes the name and email the chat captured and
prefills them, so the Calendly invitee comes back with the identifiers that match
an existing contact.

Without prefill, a booking arrives with whatever the visitor retypes, the
email-and-phone match misses, and the pipeline card is created for a *new*
contact — a duplicate of the person who was just on the site. That is the failure
this phase exists to avoid, and it is silent.

### 4.4 The webhook

`app/api/webhooks/calendly/route.ts`, handling `invitee.created` and
`invitee.canceled`.

**It must do the same four things the GHL webhook does.** Write them by calling
the same functions, not by reimplementing:

```ts
await recordBooking({ ...fromCalendly, source: "calendly" })
await exitRunsForContact(contactId)
await enqueueBookingConversion(...)
await applyPipelineEvent({ kind: "booking", status, occurredAt })
```

The cleanest way to guarantee that is to extract the GHL route's body into
`lib/bookings/ingest.ts` and have **both** routes call it — the same move
migration 00235 made for `grantFunnelPurchase`, and for the same reason: two
implementations of "what a booking means" is two sets of rules, and you find out
which one was more careful at the worst moment.

`applyPipelineEvent` should be passed an explicit `pipelineKey` once Phase 4
lands. Until then it defaults to `coaching`, which is correct for consults.

### 4.5 The assistant

`book_consult` changes from "return a link" to:

- **slots available** → return up to N real times plus a prefilled link, and let
  the card render them
- **no slots in range** → say so plainly, and return the link anyway
- **Calendly unreachable** → return the link, and never say a time

The tool description must change with it. The current one instructs the model
*"You cannot book anything yourself"* — leave that sentence in. It is still true:
Calendly books, the assistant points. What changes is that it can now point at a
specific time.

**Do not let the assistant state a time that did not come from a lookup.** This
is exactly the class of bug `validate.ts`'s grounded-value check already catches
for prices and camp dates. Add returned slot times to `groundedValues`.

---

## 5. Traps

- **Verify the signature before trusting the body.** This repo has a scar here:
  Twilio's HMAC covers the full request URL, so an apex-vs-`www` mismatch failed
  every check. Calendly's scheme is different — it signs a timestamp and the raw
  body — so read the raw body **before** any JSON parsing, and reject on a stale
  timestamp as well as a bad digest. Do not assume the Twilio fix transfers.
- **Cancelling GHL is a separate, later, deliberate step.** Run both webhooks in
  parallel first. Two sources writing bookings is fine — they have different
  unique keys and cannot collide.
- **`bookings` has no `contact_id`.** Resist adding one in this phase as a
  drive-by; it changes the reconciler's matching predicate and that is its own
  piece of work with its own backfill.
- **A booking that arrives twice must not create two cards.** Calendly can
  redeliver. The partial unique index on `calendly_event_uri` is the guard —
  the ingest must upsert on it, not blind-insert.
- **Name the reader before writing a column.** `reschedule_url` and `cancel_url`
  are only worth storing if something renders them. If the admin booking screen
  is not in this phase, either add the buttons or drop the columns.

---

## 6. Tasks

1. Answer the three questions in §3, in writing, in this file.
2. Migration `002xx_calendly_bookings.sql`, applied to the dev clone and read back.
3. `lib/calendly/client.ts` + typed errors. Unit-tested against recorded
   fixtures, not the live API.
4. Extract `lib/bookings/ingest.ts` from the GHL route. **Retarget the GHL
   route's existing tests at it** rather than writing new ones — pointing an
   existing suite at a refactored target is what caught both real bugs in the
   one-board merge.
5. `app/api/webhooks/calendly/route.ts` with signature verification.
6. Rework `book_consult` + its tool description + `groundedValues`.
7. Environment: `CALENDLY_API_TOKEN`, `CALENDLY_EVENT_TYPE_URI`,
   `CALENDLY_WEBHOOK_SIGNING_KEY`. Add to `.env.example` with comments.
   **Set all three in Production, Preview AND Development** — `vercel env add
   --force` splits a multi-target entry, and this session has already been caught
   by that once; list every environment afterwards, not the one you targeted.
8. Drive it end to end in a browser: chat → real slot → Calendly → webhook →
   pipeline card. Screenshot the card that results.

---

## 7. Out of scope

- Rebuilding the chat bubble onto funnel pages. That is a one-line decision
  ([parent doc](../../full-engine-scope-vs-built.md) §5) and its own change.
- An admin booking screen. `/admin/bookings` API exists; a UI for it is separate.
- Migrating historical GHL appointments. They are already in `bookings`.
- Cancelling GoHighLevel. Parallel-run first — and remember GHL still holds the
  consent records, which cannot be recovered after cancellation.

---

## 8. Corrections found while building (2026-09-03)

Phase 1 found two things in its own spec that were simply wrong. This phase
found five. Each is recorded here AND in the header of migration 00239, so the
next reader meets the correction before the sketch.

### 8.1 "The ingest must upsert on it" cannot be a PostgREST upsert

§5 says the partial unique index is the redelivery guard and *"the ingest must
upsert on it, not blind-insert."* Supabase's `.upsert(row, { onConflict:
"calendly_event_uri" })` compiles to `INSERT … ON CONFLICT (calendly_event_uri)
DO UPDATE`, and Postgres will only infer a **partial** unique index as the
arbiter when the statement repeats the index predicate — `ON CONFLICT
(calendly_event_uri) WHERE calendly_event_uri IS NOT NULL` — which PostgREST
cannot express. Sent as written it fails with *"there is no unique or exclusion
constraint matching the ON CONFLICT specification"*. So the ingest does what
the GHL route already does: read by key, update if found, insert if not — and
treats a `23505` on the insert (two redeliveries racing past the read) as "the
other one won", re-reads, and takes the update path. The index is still the
guard; the statement around it is different from the one the spec named.

### 8.2 §4.4 names two events with one meaning each; a reschedule is both, and the cancel half must not close the card

The spec maps `invitee.created` → scheduled and `invitee.canceled` → cancelled.
A reschedule delivers BOTH — a cancel for the old invitee carrying
`rescheduled: true`, a create for the new one — under a new
`scheduled_event.uri`, in no guaranteed order. Fed straight through, the cancel
half runs `applyPipelineEvent({status:"cancelled"})`, which `decideMove` turns
into close-lost `booking_cancelled`; if it lands second, a person who just
moved their consult by a day has a Lost card. The adapter therefore marks the
old row `cancelled` (with a note pointing at the new invitee) and **skips the
pipeline and sequence consequences** for a cancel with `rescheduled: true` —
the paired `invitee.created` carries the booking forward. Audit slug
`booking.rescheduled`, not `booking.cancelled`.

### 8.3 `schedulingLink(eventTypeUri, prefill)` has the wrong first argument

§4.2 sketches `schedulingLink(eventTypeUri, …)`. An event type's API URI
(`https://api.calendly.com/event_types/<uuid>`) is not a page a visitor can
open; the public booking page is a separate `scheduling_url` on the event-type
resource (and a per-slot one on each available time). So the link builder takes
a **scheduling URL**, not the API URI, and the env carries both:
`CALENDLY_EVENT_TYPE_URI` for the availability call and
`CALENDLY_SCHEDULING_URL` for the fallback link. The slot buttons use each
slot's own `scheduling_url` from the availability response, so the visitor
lands on that time rather than on the month view.

### 8.4 The click ids have no path from the chat to the booking — the spec did not notice

The GHL webhook gets `gclid` either in its payload or by
`findAttributionByEmail`, which joins `marketing_attribution → users` — so it
only ever matches somebody with a `users` row, which a chat visitor is not.
Calendly's payload has no click-id field. Without a path, every assistant
booking would fire ZERO ads conversions, silently, which is one of the four
consequences this phase exists to carry. The path is the one Calendly documents
for exactly this: UTM parameters on the scheduling link come back under
`payload.tracking`. `lib/calendly/tracking.ts` encodes `gclid/gbraid/wbraid/
fbclid` (read from the visitor's attribution cookie's session row) plus the
conversation id into `utm_content`/`utm_term`, and decodes them off the
webhook. Round-trip pinned by a test.

### 8.5 Prefill comes from the captured contact, never from a tool argument

§4.3 says prefill "the name and email the chat captured". The tempting
implementation gives `book_consult` `name`/`email` input parameters. Those
would be MODEL-authored — the one thing this surface keeps off the visitor's
screen — and a prompt-injected email in the prefill sends the confirmation to
whoever the injection named. So the executor is handed the identity
server-side: the route reads `chat_conversations.contact_id` (set by
`/api/ask/capture`) → `contacts.name/email`, and the tool takes no identity
input at all. No captured contact means an un-prefilled link, which is exactly
what GHL's link did, and the email/phone match still runs on whatever the
visitor types.

### 8.6 "Name the reader" — `reschedule_url` / `cancel_url` DO get one

§5 says either add the buttons or drop the columns. The admin booking screen is
out of scope, but `/admin/bookings` already exists (`components/admin/
BookingList.tsx`), so the two links are added to its row actions for rows that
carry them. Two `<a>` tags, no new screen.

### 8.7 The pipeline never recorded WHY a card closed

Not a spec error — a pre-existing gap the acceptance run found. `decideMove`
has always named the reason a card closes (`payment_received`,
`booking_cancelled`, `booking_no_show`) and `opportunities.outcome_reason`
has existed for it since 00219, but `applyPipelineEvent`'s close branch never
wrote it: the refund branch writes `refunded`/`partially_refunded`, the merge
function writes `merged_into_survivor`, and a cancelled consult closed as
`lost / null` on the GHL path as well as this one. One line in
[lib/db/pipeline.ts](../../../lib/db/pipeline.ts) now writes
`decision.reason`; `__tests__/db/pipeline.test.ts` pins both the won and the
lost case.

### 8.8 What "proven end to end" means without a Calendly account

No Calendly credential exists anywhere in this repo (§3.1), so the proof runs
against a local fixture that plays Calendly's two surfaces exactly as
documented — the availability endpoint's response shape, and a webhook
delivery signed `t.<raw body>` with HMAC-SHA256 — while everything on our side
of the wire is real: the browser, `/api/ask`, the model, the tool, the cards,
the webhook route, the ingest, the dev-clone database and the admin screens.
`scripts/verify-calendly-booking-acceptance.mjs` asserts 58 checks that way,
including the four consequences read straight off the database, redelivery,
both halves of a reschedule, an outright cancel, and the three refusals
(stale, wrong key, unsigned). What it cannot prove is the shape of a REAL
Calendly delivery; `scripts/calendly-setup.mjs` fetches Calendly's own
`sample_data` for that the moment a token exists, and the route's parser is
`.loose()` so an extra field is not a failure.

### 8.9 Local runs share one rate-limit bucket

`/api/ask` keys its per-hour limits on `sha256(ip + salt)`. Under `next dev`
every request arrives with `x-forwarded-for: ::1`, so every local browser,
script and curl-with-the-header on the machine is ONE visitor to the limiter,
and a second acceptance run within the hour 429s. (A bare curl with no
forwarded header hashes the literal `unknown` — a different bucket, which is
what the seed's first version cleared, wrongly, while printing "cleared 0".
Grouping `chat_conversations` by `ip_hash` is how the real bucket was found.)
The seed now clears every local spelling's rows (and only those) on the dev
clone; the process-local pre-filter in `lib/shop/rate-limit.ts` resets with the
dev server. Neither matters in production, where every visitor has an address.

### 8.10 Review findings, and what changed (2026-09-03)

An independent review of the finished branch found nine things; three would
have shipped bugs. All nine are fixed and pinned.

1. **The validator had no clock-time rule.** "9:00 AM" reached the bare-numeral
   step as `9` and `00`, both under the small-number ceiling, so the assistant
   could name a time nobody looked up — the exact thing decision 6 forbids. The
   test that claimed to cover it was tripping on the DATE beside the time.
   `validate.ts` now extracts clock times (`9:00 AM`, `4pm`, `19:30`) before the
   numeral step and checks them whole, as `ungrounded_time`; FAQ/testimonial
   prose and event datetimes ground the times they contain so the truth is not
   blocked. The visitor's own numerals do NOT ground a time — a visitor cannot
   supply availability. Recombination (a real time on the wrong real day) is
   not caught: the validator grounds tokens, not tuples, as it always has for
   dates and prices; stated in the test rather than claimed otherwise.
2. **A late retry of `invitee.created` after a cancel reopened the card.**
   Calendly retries deliveries that time out; the ingest ran the pipeline
   consequence before reading the row, so a retried create after a cancel made
   a second open card and flipped the row back to `scheduled`. The ingest now
   reads by key first and, for an immutable "created" event
   (`ignoreIfTerminal`, set only by the Calendly adapter), acknowledges a
   delivery for a terminal row without touching anything. GHL status changes
   keep their old behaviour.
3. **The create half of a reschedule fired a second ads conversion and a second
   "New Call Booked".** The adapter now passes `rescheduledFrom` (the replaced
   invitee); the ingest skips the conversion and the notification for it and
   audits `booking.rescheduled`. A first-seen CANCELLED row (create lost, or
   webhook registered late) likewise converts and notifies nothing.
4. Minor: event-type filter fails closed when `event_type` is absent; the
   "403 before the body is read" test now spies the request's body readers
   (a stream-pull probe observed nothing — undici pulls at construction);
   the setup script refuses to register a duplicate subscription; the seed's
   docstring says exactly what its clear touches.

Acceptance grew from 58 to 63 checks (one conversion across a reschedule;
`booking.rescheduled` on the new row; a stale create after a cancel leaves the
row cancelled and the card lost).
