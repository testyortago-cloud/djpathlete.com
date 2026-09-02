# Full Engine phase 2 — Calendly booking: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Bookings arrive from Calendly carrying all four consequences the GoHighLevel webhook produces today (bookings row, sequence exit, ads conversion, pipeline card), and the website assistant's `book_consult` offers real free times from Calendly instead of a link to `/contact`. Done = a booking made through the assistant appears as a pipeline card, exits that person's sequences and fires the ads conversion — driven end to end against the real app on the dev clone, not asserted.

**Architecture:** The GHL route's body is EXTRACTED into `lib/bookings/ingest.ts` and both webhooks call it, so there is one definition of "what a booking means". `lib/calendly/` is a thin typed client (availability + link building + tracking codec + signature check) with no database access. The assistant gains a `slot` fact kind and a `slots` card; slot times enter `groundedValues` so the validator treats a time the way it treats a price. Nothing the model can call writes.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (service-role DAL in `lib/db/`), Zod 4, Vitest (`// @vitest-environment node` only — every jsdom suite in this repo cannot start), Playwright for the acceptance and screenshot scripts.

**Spec:** [docs/superpowers/specs/2026-09-01-full-engine-phase2-calendly-booking-design.md](../specs/2026-09-01-full-engine-phase2-calendly-booking-design.md) — §3.1 (answers) and §8 (corrections) were written on 2026-09-03 before this plan.

## Global Constraints

- **Branch:** `feat/calendly-booking` off `a45ac3c1`. Do not push to `main`; do not deploy; do not merge.
- **Nothing touches production.** `.env.local` points at the dev clone (`anjvztjiokcgiyhobknq`). `.env.prod` is never loaded. Migration 00239 is applied to the dev clone via the Supabase MCP, never via `scripts/migrations/apply.mjs`.
- **Baselines:** `npx tsc --noEmit` reports exactly **251** errors. Compare the count; a falling number hides new errors too. Every jsdom suite reports "no tests" (ERR_REQUIRE_ESM) — pre-existing, not ours; pin `// @vitest-environment node` on every new suite.
- **Targeted tests only** — `npx vitest run <path>`. `npm run lint` does not work (Next 16 removed `next lint`).
- **GHL stays live.** Both webhooks run in parallel; they have different unique keys.
- **No brand literals** in `lib/lead-engine/**`, `app/api/ask/**`, `components/public/AskCards.tsx` (swept by `no-brand-literals.test.ts`, comments included). "Calendly" is not a forbidden literal, but the operator's name is.
- **`lib/lead-engine/chat/tools.ts` may not contain** `.insert(`/`.update(`/`.upsert(`/`.delete(`, `createServiceRoleClient`, `captureLead`, `recordConsent`, `recordContactEvent`, `suppress`, `stripe` — pinned by `chat-tools.test.ts` reading the source.
- **Placeholder ids:** never `aaaaaaaa-0000-4000-8000-…` (those are the seeded demo contacts). This phase's fixtures use the prefix `ca1e0d1e-0002-4000-8000-` and are deleted by that prefix.
- **No Claude attribution** on commits.

---

### Task 1: Migration 00239 + types + env

**Files:** `supabase/migrations/00239_calendly_bookings.sql` (create), `types/database.ts` (Booking), `.env.example`.

- [x] Write the migration with the §8 corrections in its header; partial unique index; NO CHECK on `source`.
- [x] Apply to the dev clone via `mcp__supabase__apply_migration`; read the index definition back with `pg_indexes`.
- [x] Prove §8.1 by running `INSERT … ON CONFLICT (calendly_event_uri) DO UPDATE` against the clone and recording the error.
- [x] Add `calendly_event_uri`, `reschedule_url`, `cancel_url` to `Booking`.
- [x] Document `CALENDLY_API_TOKEN`, `CALENDLY_EVENT_TYPE_URI`, `CALENDLY_SCHEDULING_URL`, `CALENDLY_WEBHOOK_SIGNING_KEY` in `.env.example`.

### Task 2: Extract `lib/bookings/ingest.ts` from the GHL route

**Files:** `lib/bookings/ingest.ts` (create), `app/api/webhooks/ghl-booking/route.ts` (becomes adapter + call), existing tests unchanged: `__tests__/api/webhooks/pipeline-hooks.test.ts`, `sequence-exit-hooks.test.ts`, `ghl-booking-attribution.test.ts`.

**Interface:**
```ts
export type BookingIngestInput = {
  source: "ghl" | "calendly"
  key: { column: "ghl_appointment_id" | "calendly_event_uri"; value: string } | null
  contact: { name: string; email: string; phone: string | null }
  bookingDate: string; durationMinutes: number; status: BookingStatus; notes: string | null
  clickIds: { gclid: string | null; gbraid: string | null; wbraid: string | null; fbclid: string | null }
  columns?: Partial<Pick<Booking, "ghl_contact_id" | "calendly_event_uri" | "reschedule_url" | "cancel_url">>
  /** Calendly's cancel-half of a reschedule: row is cancelled, pipeline/sequences untouched. */
  rescheduled?: boolean
  actor: string            // "ghl" | "calendly" — audit actor email
  auditSource: string      // "ghl_webhook" | "calendly_webhook"
  request?: Request
}
export async function ingestBooking(input: BookingIngestInput): Promise<{ action: "created" | "updated"; bookingId: string | null }>
```

- [x] Move the body (contact resolution → exit/pipeline in one catch; click-id fallback; read-by-key/update-or-insert with audit; ads enqueue on create; admin notifications) into `ingestBooking`, byte-for-byte in behaviour. Add the `23505` re-read path and the `rescheduled` skip.
- [x] GHL route: keep its schema, its field normalisation and its status map; build the input; answer 201/200 exactly as before.
- [x] Run the three existing GHL suites — they now exercise the extracted target through the route. All green or explain why.
- [x] Mutation: comment out `exitRunsForContact` in the ingest → `sequence-exit-hooks` must go red. Restore.

### Task 3: `lib/calendly/` — client, link builder, tracking codec, signature

**Files:** `lib/calendly/client.ts`, `lib/calendly/links.ts`, `lib/calendly/tracking.ts`, `lib/calendly/signature.ts`, `lib/calendly/env.ts`, tests under `__tests__/lib/calendly/` against recorded fixtures.

- [x] `listAvailableTimes({ eventTypeUri, from, to, fetch? })` → `Slot[]` (`startAt`, `schedulingUrl`, `inviteesRemaining`). Throws `CalendlyUnavailable` (typed, carries status) on network/4xx/5xx/unparseable — never `[]` for "could not read". Clamps the range to 7 days. Empty collection → `[]`.
- [x] `schedulingLink(url, { name, email, tracking })` — appends `name`, `email`, `utm_*` as query params, preserving any existing query on a per-slot URL.
- [x] `encodeTracking({ gclid, gbraid, wbraid, fbclid, conversationId })` ↔ `decodeTracking(payload.tracking)` round-trip; unknown content decodes to nulls.
- [x] `verifyCalendlySignature({ header, rawBody, signingKey, now })` — `t=`,`v1=` parse, HMAC-SHA256 over `t.body`, `timingSafeEqual`, 180 s tolerance both directions.
- [x] Tests: recorded availability fixture, empty fixture, 401/500 → `CalendlyUnavailable`, signature good/bad/stale/malformed, tracking round-trip.

### Task 4: `app/api/webhooks/calendly/route.ts`

**Files:** the route; `__tests__/api/webhooks/calendly-booking.test.ts`; append a Calendly `describe` to `pipeline-hooks.test.ts` and `sequence-exit-hooks.test.ts` reusing their mocks (retargeting the GHL assertions at the second caller).

- [x] 403 `{"error":"calendly not configured"}` before reading the body when the signing key is unset; 403 on bad/stale signature. Raw body via `request.text()` BEFORE `JSON.parse`.
- [x] Zod schema with `.loose()`/passthrough for the envelope; `invitee.created` → scheduled; `invitee.canceled` → cancelled (+ `rescheduled` flag). Phone from `location.location` when `location.type === "outbound_call"`, else `text_reminder_number`, normalised to E.164.
- [x] Click ids from `decodeTracking(payload.tracking)`; conversation id kept in notes/audit metadata.
- [x] Ignore other event names with 200 `{ignored:true}`. Filter on `CALENDLY_EVENT_TYPE_URI` when set (other event types on the account are not consults) — log and 200.
- [x] Tests: signature gates; created → `ingestBooking` called with the right shape; canceled → status cancelled; canceled+rescheduled → pipeline NOT called; redelivery → 200 updated.

### Task 5: The assistant — `book_consult` offers real times

**Files:** `lib/lead-engine/chat/facts.ts` (slot fact + `slotForms`), `lib/lead-engine/chat/tools.ts` (`slots` card, executor context, `book_consult`), `lib/lead-engine/chat/prompt.ts`, `app/api/ask/route.ts` (executor context: timezone, captured contact, tracking), `components/public/AskCards.tsx` (`SlotsCard`, external consult link), tests in `chat-tools.test.ts` + a new `chat-slots.test.ts`.

- [x] `Fact` gains `{ kind: "slot"; startAt: string; timezone: string }`. `valuesForFact` grounds date forms AND time forms computed IN THE GIVEN TIMEZONE (not UTC — a 7 pm Eastern slot is the next day in UTC).
- [x] `Card` gains `{ kind: "slots"; timezone: string; href: string; slots: Array<{ startAt: string; href: string }> }`; `isWayForward` counts it; `visitorSafeCards` leaves it alone (no model-authored field).
- [x] `createToolExecutor(ctx?: { timezone?: string; visitor?: { name: string | null; email: string | null } | null; tracking?: Tracking | null; availability?: typeof listAvailableTimes })` — defaults keep the existing test's zero-arg call working.
- [x] `book_consult`: not configured → consult card with `/contact` (today's behaviour, unchanged copy). Configured: `listAvailableTimes` next 7 days → up to 6 slots → `slots` card + slot facts + result text listing the times in the business timezone; `[]` → consult card with the prefilled link and copy saying no free times in the next week; `CalendlyUnavailable` → consult card with prefilled link, copy says nothing about times. Never throws.
- [x] Tool description and system prompt updated; "You cannot book anything yourself" retained verbatim.
- [x] Route: reads `contacts.name/email` for `conversation.contact_id` (via `readContactIdentity`), the attribution row for `conversation.attribution_session_id` (via `getAttributionBySession`), and `settings.timezone`; hands them to the executor. Failures degrade to no prefill / no tracking, never a failed turn.
- [x] `AskCards.tsx`: `SlotsCard` renders each time as an `<a target="_blank" rel="noopener noreferrer">` formatted with `Intl.DateTimeFormat` in the card's timezone (formatting only — no derivation); `ConsultCard` uses `<a>` for an absolute href.

### Task 6: `/admin/bookings` shows the two links

**Files:** `components/admin/BookingList.tsx`.

- [x] Row actions gain "Reschedule in Calendly" / "Cancel in Calendly" `<a>` entries when the row carries the URLs. A `via Calendly` hint beside the contact for `source === "calendly"`.

### Task 7: Scripts

**Files:** `scripts/calendly-setup.mjs`, `scripts/seed-calendly-booking-demo.mjs`, `scripts/verify-calendly-booking-acceptance.mjs`, `scripts/capture-calendly-booking-screenshots.mjs`, `scripts/_calendly-webhook-lib.mjs` (shared signer for scripts).

- [x] Setup: given `CALENDLY_API_TOKEN`, prints `GET /users/me`, lists event types with both URIs, fetches `/webhook_subscriptions/sample_data`, and (with `--register <public url>`) creates the subscription with the signing key. Read-only unless `--register`.
- [x] Seed (dev-clone-only, ref guard, prefix `ca1e0d1e-0002-4000-8000-`): a contact with an ACTIVE `sequence_run`, a `marketing_attribution` row with a known gclid, chat assistant flag ON, and `CALENDLY_*` env presence check. Deletes by prefix first, so it is re-runnable.
- [x] Acceptance: drives `/ask` in Playwright with a stubbed Calendly availability endpoint (the dev server is pointed at a local fixture server via `CALENDLY_API_BASE`), asserts the slot card renders real slot times, that the link is prefilled with the captured contact's email and carries the gclid in `utm_content`; then POSTs a correctly SIGNED `invitee.created` for one of those slots to the running app and asserts, after full page reloads: bookings row (source calendly, gclid set), pipeline card in Consult Booked on `/admin/pipeline`, sequence run `exited` with reason `booking`, one `google_ads_conversion_uploads` row, audit row `booking.created`. Then redelivers the same payload → still one row, one card. Then a `rescheduled` cancel → old row cancelled, card still open. Then a real cancel → card lost. Then a stale-timestamp and a bad-digest delivery → 403 and nothing written.
- [x] Screenshots into `screenshots/calendly-booking/` with burned-in markers (markers placed OUTSIDE the element they name): the slot card on `/ask`, the fallback card, the pipeline card, the bookings row with the Calendly actions, the contact record's booking on the timeline.

### Task 8: Verification, review, journal

- [x] `npx tsc --noEmit 2>&1 | grep -c "error TS"` → must equal 251.
- [x] Targeted suites green; mutation sweep on the ingest (exit, pipeline, enqueue, 23505 path, rescheduled skip) and on the signature (tolerance, digest).
- [x] Subagent code review of the diff; fix findings.
- [x] JOURNAL.md entry (newest first, `[Feature build-out]`, mistakes + lessons). Not staged.
- [x] Commit(s) on the branch (`f3809b43` + review follow-up). Stop before merging.
