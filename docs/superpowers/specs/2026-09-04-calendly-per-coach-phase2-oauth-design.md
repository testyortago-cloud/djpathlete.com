# Calendly per coach, phase 2 — per-coach OAuth

**Date:** 2026-09-04
**Branch:** `feat/calendly-per-coach-phase2`, cut from `origin/main` @ `3d688a01`
**Predecessors:** [phase 0 design](2026-09-03-calendly-per-coach-phase0-tenancy-design.md) · [phase 0 status](../../calendly-per-coach-phase0-status.md) · [phase 1 plan](../plans/2026-09-03-calendly-per-coach-phase1-multi-coach-ops.md)

> **Naming collision, read this first.** `2026-09-01-full-engine-phase2-calendly-booking-design.md`
> is a *different* phase 2 — the Calendly booking feature, already built and shipped. This document
> is **calendly-per-coach phase 2**: per-coach OAuth. They share a number and nothing else.

---

## 0. What this closes

Every Calendly integration in this deployment is one account behind four environment variables
(`CALENDLY_API_TOKEN`, `CALENDLY_EVENT_TYPE_URI`, `CALENDLY_SCHEDULING_URL`,
`CALENDLY_WEBHOOK_SIGNING_KEY` — see `lib/calendly/env.ts`). The booking webhook therefore cannot
say which coach a booking belongs to, and says so honestly, in two placeholders:

```ts
// app/api/webhooks/calendly/route.ts:210-211
businessId: platformBusinessId(),
hostId:     await singletonHostId(),
```

Phase 2 makes each coach's own Calendly account a row in `coach_calendar_connections`, and makes
the webhook derive the tenant from the row whose `event_type_uri` matches the delivery.

`coach_calendar_connections` (migration `00240`) already has every column this needs. **Nothing in
the repository writes to it** — three comments mention it and no code touches it. It is a declared
schema waiting for its writer. This phase is that writer.

### Owner decisions, taken 2026-09-04

These were phase 0 §7's open questions. They are settled and are not re-litigated below.

| Question | Decision | What it changes here |
|---|---|---|
| Who pays the Calendly seat | **The coach**, self-paid | The coach is their own data controller. The connect screen says "connect your Calendly", not "we'll provision one". No DJP organization, so no org-scope API calls and no seat billing. |
| What to assume about existing accounts | **Assume nothing; verify on screen** | The connect flow ends with an explicit confirmation step for "Check for conflicts", the one setting no API exposes. |
| Can coaches see each other's bookings | **No** — each coach sees their own | Out of scope for this phase's code (bookings are already business-scoped), but it forbids widening any reader here to cross hosts. |
| What happens to `singletonHostId` | **Rename to `platformHostId()`**, keep it for GHL | Its second caller, the GHL booking webhook, is the calendar Calendly replaces and will never be per-coach. |

### The approach, chosen over two others

**The connection row is the source of truth; the environment becomes a documented ramp.**

The webhook matches the delivery's `event_type` against `coach_calendar_connections`. When nothing
matches but the delivery matches `CALENDLY_EVENT_TYPE_URI`, it falls back to the platform seam and
logs that it did. One platform-owned webhook signing key serves every coach.

Two alternatives were considered and rejected:

- **A hard cutover** — delete the four env vars, OAuth or nothing. Rejected because it puts a flag
  day on a live revenue feed: between the deploy landing and the owner clicking Connect, every real
  booking is 200-ignored. Migrations apply to production automatically on push while Vercel is still
  building, so that window is not hypothetical. It would also strip `CALENDLY_API_BASE`, which is
  the only hook the acceptance script has for pointing at a local fixture server.
- **Per-connection webhook signing keys** — each connection stores its own random key; the webhook
  parses the body, finds the connection, then verifies. Rejected because it inverts the invariant
  that route's header comment is built around ("the order of the first three lines is the security
  model" — verify before reading anything), and buys little: coaches never see the key, so forging
  another coach's delivery already requires access to our vault.

---

## 1. Facts established by probe, not by memory

Everything in this section was verified during design. Where an inherited claim turned out to be
wrong, the correction is recorded, because the wrong version is written down in an earlier document
and someone will read it again.

### 1.1 Calendly's OAuth contract

| Fact | Consequence for this design |
|---|---|
| **Refresh tokens are single-use and rotate.** A refresh token is revoked immediately after a successful `POST /oauth/token`. | §3's compare-and-swap exists entirely because of this. |
| **Reusing an outdated refresh token returns HTTP 400/401 with `invalid_grant`.** | `invalid_grant` is the one refresh failure that means "genuinely dead" → `needs_reconnect`. Every other failure leaves status alone. |
| **Access tokens last ~2 hours.** | Refresh proactively off `access_token_expires_at`, not reactively off a 401. |
| **PKCE is supported with `S256`** (`code_challenge_methods_supported: ["S256"]` in Calendly's published authorization-server metadata). | §4 uses real PKCE. |
| **Calendly publishes no granular scopes** — the metadata document has no `scopes_supported`, and a token carries the authorizing user's own permissions. | `granted_scopes` stays an **empty array**. Writing a fabricated scope list into a column named `granted_scopes` would be worse than leaving it empty: a later reader would trust it. |
| **The webhook signing key is chosen by us at subscription time**, not issued by Calendly. | One platform key for all coaches is the existing model, not a compromise introduced here. |
| **Webhook subscriptions require a paid Calendly plan**; `POST /webhook_subscriptions` answers **403** on a Free account. | This is the documented meaning of the `plan_lapsed` status already in `00240`'s CHECK constraint. |

Calendly's published metadata names `https://calendly.com/oauth/authorize` and
`https://calendly.com/oauth/token`, while its refresh-token guide names `https://auth.calendly.com/oauth/token`.
**Both hosts appear in Calendly's own documentation.** The endpoints are therefore module-level
constants with an override, not literals inlined at the call site, and the real host is confirmed
against a live client during implementation rather than asserted here.

### 1.2 Corrections to inherited claims

- **"The three existing Google OAuth flows never check their state nonce" is false.** All three —
  `google-ads`, `gmail`, `gsc` — verify an HMAC-signed state through `verifyState()`
  (`lib/ads/oauth.ts:35`, duplicated in `lib/gsc/oauth.ts`), and the four social flows compare a
  random state against an httpOnly cookie. TikTok additionally performs real PKCE. There is a sound
  pattern here to reuse, not a hole to route around.
- **The real gap in `verifyState` is expiry, not absence.** It validates the HMAC and nothing else,
  so a signed state stays valid forever. That is a genuine pre-existing weakness in three shipped
  flows. **It is named here and deliberately not fixed** — widening this task into three unrelated
  OAuth callbacks is how a booking feature becomes an auth refactor. The Calendly state built here
  checks expiry from the start.
- **`singletonHostId` has two production callers, not one.** `app/api/webhooks/calendly/route.ts:211`
  and `app/api/webhooks/ghl-booking/route.ts:127`. The comment above it says "phase 2 removes its
  only two call sites"; that is true of the *Calendly* one only.
- **`SINGLETON_BUSINESS_ID` is in 26 production files** on `3d688a01` — 61 including 32 test files
  and 3 scripts. An earlier handoff said 25; an earlier draft of this document said 28, and that
  was my own measurement error, recorded here rather than quietly amended. `git grep -l <rev>`
  prints `<rev>:<path>`, so a `grep -v '^scripts/'` filter never matches and the scripts leak into
  the count. Filter on `^__tests__/` and `^scripts/` only after stripping the `<rev>:` prefix:

  ```bash
  git grep -l SINGLETON_BUSINESS_ID <rev> -- '*.ts' '*.tsx' \
    | sed "s/^<rev>://" | grep -v '^__tests__/\|^scripts/' | wc -l
  ```

  This phase takes it from 26 to **25**, by emptying `lib/db/bookings.ts` of it.
- **A neutral `Slot` type is deferred, not forgotten.** `lib/calendly/client.ts` already exports a
  `Slot`. A provider-neutral one has exactly one implementation until the native booking path is
  built, which makes it a rename with no second consumer. It belongs with its second provider.

---

## 2. Data — migration `00250`

`00250` is the next free number, confirmed against `supabase/migrations/` (`00249` is the highest).

### 2.1 Two new columns on `coach_calendar_connections`

```sql
alter table public.coach_calendar_connections
  add column if not exists access_token_expires_at    timestamptz,
  add column if not exists conflict_check_confirmed_at timestamptz;
```

- **`access_token_expires_at`** — Calendly access tokens last about two hours. Storing the
  expiry lets the token accessor refresh *before* a call fails, instead of discovering expiry as a
  401 in the middle of an availability read that the assistant then reports as "calendar
  unreachable".
- **`conflict_check_confirmed_at`** — the coach's own confirmation that "Check for conflicts" is on
  in their Calendly. No API exposes that setting; it is this design's one genuine blind spot, and
  the owner's decision was to close it on screen. A timestamp makes the confirmation auditable —
  who confirmed and when — rather than a piece of copy nobody can verify was ever read.

Both are nullable with no default, so the migration is additive and the previous build tolerates it
for the deploy race.

### 2.2 The `fn_*` quartet

Modelled on `00089`/`00090` (`platform_connections`), which is the repo's established shape for
vault-backed credentials: `SECURITY DEFINER`, `SET search_path = public, vault`, `REVOKE ALL ... FROM
PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO service_role`.

| Function | Key | Returns |
|---|---|---|
| `fn_connect_coach_calendar(...)` | `(business_id, host_id, provider)` | The row, with decrypted credentials |
| `fn_get_coach_calendar_connection(p_host_id, p_provider)` | `(host_id, provider)` | The row, with decrypted credentials |
| `fn_list_coach_calendar_connections(p_business_id)` | `business_id` | Rows **without** credentials |
| `fn_disconnect_coach_calendar(p_host_id, p_provider)` | `(host_id, provider)` | The reset row |

Three things about this quartet differ from the `platform_connections` one, each deliberately:

1. **The secret name is tenant- and host-qualified**, exactly as `00240`'s comment specifies:

   ```sql
   v_secret_name := 'coach_calendar_connections:' || p_business_id || ':' || p_host_id || ':' || p_provider;
   ```

   `fn_connect_platform` names its secret after the plugin alone, so a second tenant connecting the
   same provider silently overwrites the first's token. Not an error — a silent token swap. That is
   the whole reason `coach_calendar_connections` is a new table rather than a widened one.

2. **`get` and `disconnect` key on `(host_id, provider)`, not on the business.** `00240` declares
   `unique (host_id, provider)`; the host is the key and `business_id` rides along for the composite
   foreign key into `booking_hosts(id, business_id)`. Keying a read on `business_id` alone would
   return an arbitrary row the moment a business has two hosts.

3. **`list` does not decrypt.** `fn_list_platform_connections` returns credentials for every row
   because its one caller is an admin screen that predates the split. A list screen has no business
   holding tokens, and a function that returns them invites a caller that logs them.

`fn_disconnect_coach_calendar` deletes the vault secret outright. Phase 0 proved by probe that a
`SECURITY DEFINER` function granted to `service_role` **can** delete from `vault.secrets`
(`rows_deleted = 1` under `set local role service_role`), so no fallback design is needed.

### 2.3 `fn_store_refreshed_calendar_credentials` — the compare-and-swap

Signature, and the reason it is shaped this way, is §3.

```sql
fn_store_refreshed_calendar_credentials(
  p_connection_id          uuid,
  p_expected_refresh_token text,
  p_credentials            jsonb,
  p_access_token_expires_at timestamptz
) returns table (stored boolean, credentials jsonb)
```

### 2.4 Re-runnability

`CREATE POLICY` has no `IF NOT EXISTS`, but `00250` creates no policies — `00240` already enabled
RLS and wrote the `service_role` policy for this table. Every statement here is
`CREATE OR REPLACE FUNCTION` or `ADD COLUMN IF NOT EXISTS`, so the file is safely re-runnable and
needs no `DROP` guard in the local applier.

---

## 3. Token lifecycle

### 3.1 The failure this prevents

Two requests notice an expired access token at the same instant — say the webhook enriching a
booking while the assistant reads availability. Both read the same refresh token and both call
`POST /oauth/token`. Calendly revokes the token on the first success. The second gets
`invalid_grant`.

The naive handler does one of two harmful things: it writes its failure (marking a perfectly healthy
connection `needs_reconnect`, so the coach is told to reconnect a calendar that works), or it writes
a token it obtained from a now-revoked grant. Either way a working connection needs manual repair,
and it happens more often the busier the coach is.

### 3.2 The fix — lock the write, never the network call

`fn_store_refreshed_calendar_credentials` takes `pg_advisory_xact_lock(hashtext(p_connection_id::text))`
and then compares the *stored* refresh token against `p_expected_refresh_token` — the value the
caller started from:

- **Equal** → nobody else rotated. Write the new credentials, stamp `last_refresh_at`, clear
  `last_error`, return `(stored => true, credentials => <new>)`.
- **Not equal** → someone else already rotated, and their token is the live one. **Write nothing.**
  Return `(stored => false, credentials => <theirs>)`, and the loser proceeds with the winner's
  access token instead of bricking the row.

The advisory lock is transaction-scoped and the transaction contains no network call. Holding a lock
across an HTTP request on a pooled connection is how you exhaust the pool; the compare-and-swap is
what makes that unnecessary. The lock still matters — it serialises two simultaneous *writes* so the
comparison and the update cannot interleave.

### 3.3 Classifying a refresh failure

This mirrors the lesson `clearConnectionError` already encodes for `platform_connections`: a single
transient 5xx must not retire a working connection.

| Outcome | Status written | Reasoning |
|---|---|---|
| `invalid_grant` (400/401) | `needs_reconnect`, `last_error` set | The refresh token is genuinely dead. Only the coach can fix it. |
| Any other HTTP failure, or a network error | **unchanged**, `last_error` set | Transient until proven otherwise. |
| Success | `connected`, `last_error` cleared, `last_refresh_at` stamped | |

A caller that cannot obtain a usable token raises the existing `CalendlyUnavailable` rather than
returning `null`. `lib/calendly/client.ts`'s header comment is emphatic that `[]` and a throw are
different answers, and "could not authenticate" is squarely a could-not-read, not an empty calendar.

---

## 4. The OAuth flow

### 4.1 Where the routes live, and why

```
GET /api/admin/bookings/calendar/connect     → redirect to Calendly's consent screen
GET /api/admin/bookings/calendar/callback    → exchange, store, redirect back to the screen
```

Both sit under `/api/admin/bookings`, which `PATH_PERMISSIONS` maps to the `schedule` permission
(`lib/permissions/registry.ts:451`). That is deliberate: the owner's decision is that coaches pay
for and own their own Calendly accounts, so a coach must be able to connect one themselves. Placing
these under `/admin/businesses` — which is in `OWNER_ONLY_PREFIXES` — would mean only DJP could ever
connect a coach's calendar, contradicting the decision.

### 4.2 State, nonce, PKCE

The state is HMAC-signed in the shape of `lib/ads/oauth.ts`, plus the two things that file does not
do:

```ts
type CalendlyOAuthState = {
  business_id: string
  host_id: string
  user_id: string
  nonce: string   // also set as an httpOnly cookie; the callback requires both and compares
  iat: number     // epoch seconds; the callback rejects anything older than 600s
}
```

- **`business_id` and `host_id` are resolved server-side from the session at connect time and travel
  inside the signed payload.** Never a query parameter. A browser-editable tenant on an OAuth
  callback is a cross-tenant write.
- **The nonce cookie is what the existing flows' signature alone cannot give.** A valid HMAC proves
  *we* minted the state; it does not prove *this browser* asked for it. Without the cookie, a signed
  state captured from a redirect chain is replayable — and, since `verifyState` has no expiry,
  replayable indefinitely. Both halves are required and compared.
- **PKCE**: a random `code_verifier` in a second httpOnly cookie, `code_challenge` = base64url(SHA-256)
  sent on the authorize request with `code_challenge_method=S256`, and the verifier sent on the
  exchange.

Both cookies are `httpOnly`, `sameSite: "lax"`, `secure` in production, path-scoped to
`/api/admin/bookings/calendar`, and expire in 10 minutes. The callback deletes both on every exit
path, success or failure — a verifier that outlives its exchange is a reusable one.

### 4.3 What the callback does after the exchange

The callback performs, with an OAuth token, what `scripts/calendly-setup.mjs` already does by hand
with a personal access token:

1. `GET /users/me` → `uri`, `current_organization`, `scheduling_url`, and the user's role.
2. `fn_connect_coach_calendar` with the credentials, those URIs, `granted_scopes` as `{}` (§1.1),
   `access_token_expires_at`, and `connected_by` from the session.
3. Redirect back to `/admin/bookings/calendar` with a result in the query string.

**No event type is chosen here.** Status is `connected` with `event_type_uri` still null. Picking
the consult event type is a *choice*, not a discovery — a coach's account may host several things
and only one of them is the consult — so it is its own step (§6) with its own consequence
(registering the webhook subscription).

### 4.4 Failure paths

| Case | Answer |
|---|---|
| No session, or a role without `schedule` | The permission layer answers before the route runs |
| `error=access_denied` from Calendly (coach declined) | Redirect back with `?calendar=declined`; nothing written |
| State missing, malformed, unsigned, expired, or nonce mismatch | Redirect back with `?calendar=error&reason=state`; nothing written |
| Verifier cookie missing | `?calendar=error&reason=pkce`; nothing written |
| Token exchange non-200 | `?calendar=error&reason=exchange`; nothing written |
| `GET /users/me` non-200 | `?calendar=error&reason=identity`; nothing written |

Every failure writes **nothing** and leaves any existing connection untouched. A failed reconnect
attempt must not destroy a working connection.

---

## 5. The seam — webhook tenant resolution

### 5.1 What changes

`app/api/webhooks/calendly/route.ts` lines 187-191 (the env event-type gate) and 210-211 (the two
placeholders) collapse into one resolution:

```ts
const resolved = await resolveCalendlyTenant(data.scheduled_event.event_type)
```

`resolveCalendlyTenant` returns one of three outcomes:

| Outcome | When | The route's answer |
|---|---|---|
| `{ kind: "connection", businessId, hostId, connectionId }` | A `coach_calendar_connections` row's `event_type_uri` equals the delivery's `event_type` | Ingest against that tenant. **The seam is closed.** |
| `{ kind: "platform" }` | No row matched, but the delivery's `event_type` equals `CALENDLY_EVENT_TYPE_URI` | Ingest against `platformBusinessId()` + `platformHostId()`, after a `console.warn` naming the event type. **The ramp.** |
| `{ kind: "unknown" }` | Neither | 200-ignore, as today |

`platformBusinessId()` and `singletonHostId()` leave this file entirely.

### 5.2 Three properties this must have

**It must never answer 5xx for an unrecognised event type.** Calendly disables a subscription after
24 hours of failed deliveries, and a disabled subscription must be recreated by hand. An event type
we do not know about is somebody else's business, not an error — the same reasoning `00240` gives
for refusing an exclusion constraint.

**A failed read is not "no match".** PostgREST resolves rather than throws: a missing table, a
missing column or a transient failure all arrive as `{ data: null, error }`. Treating that as "no
connection matched" would silently take the ramp and file another coach's booking into the
platform's tenant. The DAL checks `error` explicitly and the resolver propagates it; the route
answers **500** so Calendly retries. This repo has shipped that exact confusion twice, and phase 0's
status document lists it as the defect class to watch.

**It must fail closed on a missing event type.** A delivery with no `event_type` at all cannot be
proven to belong to anyone, so it is `unknown` and ignored — which is what the current env gate
already does, and the property is preserved rather than reinvented.

### 5.3 Why matching on `event_type` is sound

`00240` created a partial unique index for exactly this proof:

```sql
create unique index coach_calendar_connections_event_type_key
  on public.coach_calendar_connections (event_type_uri) where event_type_uri is not null;
```

One event type cannot belong to two connections, so the match is a function, not a heuristic. The
event-type picker in §6 is what populates the column, and a second coach picking an event type
already claimed fails on this index rather than silently stealing the first coach's deliveries.

### 5.4 `singletonHostId` → `platformHostId`

The function moves to `lib/tenancy/platform.ts`, beside `platformBusinessId()`, and joins the
frozen-seam inventory under a new, honest heading: the GHL booking webhook is the calendar Calendly
*replaces*, it will never be per-coach, and so resolving its host from the platform's own business
is correct by construction rather than a caller that cannot resolve.

Its behaviour is unchanged, including the parts that are load-bearing: it returns `null` rather than
throwing on a read failure, and it logs the PostgREST error, because since `00243` made
`bookings.host_id` NOT NULL a null return means the insert will fail with `23502` and that log line
is the only diagnostic distinguishing "no host row" from "the read failed".

---

## 6. The admin screen — `/admin/bookings/calendar`

One page, one card, three states, built from the house `components/ui/data-table.tsx` primitives.
Admin UI in this repo is light-only; `.dark` is a class variant these components were never built
against.

### 6.1 Not connected

What connecting will do, in the plain words the house style calls for — no "OAuth", no
"authorize", no "integration". A Connect button. If the business has no `booking_hosts` row, the
card says so and does not offer Connect, because there is nothing to attach a calendar to.

### 6.2 Connected, no event type chosen

The coach's active event types, from `GET /event_types?user=<uri>&active=true`, each with its name,
duration and public booking page, and a radio to pick the consult. Choosing one:

1. Checks everything registering a subscription needs — the signing key, the callback origin, the
   connection's `calendly_organization_uri` — **before** writing anything.
2. Writes `event_type_uri` and `scheduling_url`.
3. Registers the Calendly webhook subscription — `invitee.created` + `invitee.canceled`, scope
   `user`, our platform signing key, pointing at `<origin>/api/webhooks/calendly` — and stores
   `webhook_subscription_uri` and `webhook_state`.

**Step 1 comes first because of what step 2 leaves behind.** `event_type_uri` is UNIQUE, so it has
to be claimed before the Calendly call (a rejected pick must not leave a subscription we hold no
handle to). That makes the window between step 2 and a stored `webhook_subscription_uri` a state
the screen renders as a finished connection: a green **Connected** badge whose only action is
Disconnect. Any exit inside that window strands the coach on a calendar that will never receive a
booking — and production has no `CALENDLY_WEBHOOK_SIGNING_KEY`, so an unhoisted check would take
that path on the very first pick after go-live. For the same reason, a **transient** registration
failure (the 502 branch) clears `event_type_uri` again, returning the coach to the picker.

**A 403 from that registration means a Free Calendly plan.** That is documented Calendly behaviour
and is what the `plan_lapsed` status in `00240`'s CHECK exists for. The row goes to `plan_lapsed`
and the screen says webhooks need a paid Calendly plan (Standard, Teams or Enterprise) — a specific,
actionable sentence rather than a generic failure the coach cannot act on. This branch **keeps**
`event_type_uri`, unlike the transient one above: the `plan_lapsed` card shows the picker with the
coach's choice already selected, so upgrading and picking again does not mean remembering which
meeting they chose.

A `23505` on `coach_calendar_connections_event_type_key` means another connection already claims
that event type. The screen says which, in words: that event type is already connected to another
coach's calendar.

### 6.3 Connected and chosen

Which Calendly account (name and email), which event type, the webhook subscription's state, a
Disconnect button, and the conflict-check confirmation.

**The subscription's state is re-read on every render, not shown from the row.** `webhook_state` is
written once, at creation, and Calendly disables a subscription after 24 hours of failed deliveries
*without changing its uri* — so the stored value is a snapshot of one moment, and rendering it as
live status is exactly how the card could promise "Calendly tells us as soon as someone books" over
a subscription that stopped delivering weeks ago. The page therefore makes a third wrapped Calendly
read, `getWebhookSubscription`, alongside identity and event types, and writes what it learns to
`webhook_state` + `webhook_checked_at` (its only writer). A 404 records `removed` — our word, since
Calendly has no state for a subscription it no longer holds. A read that *fails* writes nothing and
leaves the last known answer standing: "could not check" and "not delivering" are different answers.

The confirmation reads:

> **Check for conflicts** — Calendly only avoids double-booking you if "Check for conflicts" is
> turned on for the calendar you use. We can't see that setting, so please check it yourself.
> *[Open Calendly's calendar settings]* · ☐ I've checked that it's on

Ticking it stamps `conflict_check_confirmed_at`. Unticked renders a **warning badge**, not an
absence — the failure mode this guards against (a coach double-booked because Calendly never saw
their real commitments) is invisible until it happens, so it must be visible before it does.

**Disconnect** deletes the Calendly webhook subscription, then the vault secret, then resets the row
— in that order, so a failure at any step leaves credentials that can still authenticate the next
attempt. A subscription that Calendly has already removed (404) counts as success.

---

## 7. Availability reads

`readCalendlyConfig()` reads four env vars and knows one account. It gains a per-business sibling:

```ts
calendlyConfigForBusiness(businessId): Promise<CalendlyConfig | null>
```

which resolves the business's connection, refreshes the access token if needed (§3), and returns the
same `CalendlyConfig` shape the existing callers already accept — falling back to `readCalendlyConfig()`
when the business has no connection. Callers are unchanged in shape; only their source of truth
widens.

This is inert today and deliberately so: the public chat assistant resolves its tenant with
`platformBusinessId()` until phase 4 resolves the `Host` header, so the business it asks about is
the platform's own and the answer is the same either way. Building it now means phase 4 changes one
resolver instead of also rediscovering that availability was hard-wired.

---

## 8. Testing

The repository's vitest jsdom environment cannot start a worker (`ERR_REQUIRE_ESM` via
`html-encoding-sniffer` → `@exodus/bytes`), so **783 of 939 test files report "no tests", which is
visually identical to passing**. The owner's decision is that fixing that is out of scope for this
phase. Consequences for the work here:

- Every new test file begins with `// @vitest-environment node` so it actually runs.
- Every run is checked for a **non-zero test count**. "no tests" is a crash, not a pass.
- Component tests for the new screen would land in the dead jsdom lane and silently not run.
  The screen is therefore verified by **driving the real route in a browser** and capturing
  annotated screenshots, which is the house standard for new UI anyway.

What gets tested, and the property each test pins:

| Area | The property |
|---|---|
| `fn_*` quartet | Applied to the dev clone and read back: secret name is tenant+host-qualified; two hosts in one business get two distinct secrets; disconnect actually removes the `vault.secrets` row |
| Compare-and-swap | A stale `p_expected_refresh_token` writes **nothing** and returns the winner's credentials |
| Refresh classification | `invalid_grant` → `needs_reconnect`; a 503 leaves status **unchanged** |
| State/nonce/PKCE | Expired `iat` rejected; nonce-cookie mismatch rejected; a valid signature with no cookie rejected; verifier absent rejected. Each asserts **nothing was written** |
| Tenant resolution | Match → the row's ids; env-only → the ramp with a warn; neither → 200-ignore; **read error → 500, not the ramp** |
| Webhook route | Unrecognised event type never answers 5xx |

Assertions name the **value**, not merely that a value came back: a test that a tenant "was
resolved" passes for the wrong tenant.

---

## 9. Deploy safety

Migrations apply to production automatically on push to main, and nothing sequences that Action
against the Vercel build the same push triggers. The old build runs against the new schema for
several minutes.

`00250` is safe across that window by construction: it adds two **nullable** columns with no
default and creates functions with no existing callers. The previous build names neither column and
calls neither function. There is no `NOT NULL` tightening here and no phase-0-style two-PR sequence
is required.

The ramp in §5.1 is what makes the *code* half safe in the other direction: the new build with no
connection rows yet behaves exactly like the old one.

---

## 10. Out of scope, and why

| Not built | Reason |
|---|---|
| Neutral provider-agnostic `Slot` type | One implementation until the native booking path exists; a rename with no second consumer |
| `webhook_state` refresh cron | The screen checks the subscription when it renders — `getWebhookSubscription` in `app/(admin)/admin/bookings/calendar/page.tsx`, §6.3. A cron for one row per coach is a scheduled job to maintain for information already fetched on demand. The gap this leaves is deliberate and narrow: a subscription that dies is noticed the next time a coach opens the screen, not the moment it dies |
| Expiry checking in the shared `verifyState` | A real pre-existing gap in three shipped flows (§1.2), named so it is not lost. Fixing it belongs in its own change, not inside a booking feature |
| `hasPermission` failing open on an unknown key | Known live footgun in `lib/permissions/registry.ts`; unrelated to this seam and worth its own change |
| Scoping `listGoogleAdsAccounts` | Explicitly its own project; `/admin/ads` is owner-only precisely so this can wait |
| Coach-visible booking lists narrowed to own host | The owner's decision is "coach sees own", but bookings are already business-scoped and narrowing to the host is a reader change with its own review surface |
| Google Calendar as a second provider | `00240`'s `provider` CHECK admits only `calendly` today; widening it is the next provider's task |
