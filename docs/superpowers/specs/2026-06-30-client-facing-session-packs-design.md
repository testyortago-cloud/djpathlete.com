# Client-Facing Session Packs — Design

**Date:** 2026-06-30
**Status:** Approved (autonomous build authorized)

## Problem

The session-packs / check-in feature is currently **coach-only**. The athlete (role `client`) has no visibility into their credits and no self-service. Three confirmed gaps (verified against `app/(client)/` + `components/client/`):

1. **No balance UI** — a client never sees how many sessions they have left except for one line on the post-check-in success screen.
2. **No client-owned check-in** — the only client-facing check-in is the **public** `/checkin?token=` QR page, which is gated by token only (not login) and lets the visitor tap **any** name from a roster (`/api/checkin/roster`). Identity is self-asserted.
3. **No self-purchase** — packs are sold exclusively by admins (`POST /api/admin/session-packs/checkout`); the Stripe return URL goes to the admin page. A client cannot buy more sessions.

## Goal

Give the client three things, shipped as **three independently-deployable phases** under one coherent design:

- **Phase 1** — read-only "My Sessions" balance widget.
- **Phase 2** — guarded client self check-in (presence + identity).
- **Phase 3** — client self-purchase of packs (Stripe), packs stay unlinked.

## Cross-Cutting Principles

- **Identity from the session, never the body.** Every new client endpoint derives `userId` from `auth()` (the NextAuth session), never from request input. This is the security backbone and also fixes the existing "tap anyone's name" weakness for logged-in users.
- **Reuse the pure credit math.** `remainingCredits()`, `isExpired()`, `summarizeClientPacks()`, `buildPackageInsert()` in `lib/services/*` are the single source of truth. No new balance math.
- **Feature flags are DB-backed** (`system_settings`, admin-togglable — per project convention). New flags:
  - `client_pack_balance_enabled` (Phase 1)
  - `client_self_checkin_enabled` (Phase 2)
  - `client_self_purchase_enabled` (Phase 3)
  - **All default OFF** when the row is absent (read-with-safe-default), so nothing activates in prod until seeded + flipped. No prod migration needs to be applied for the code to be safe.
- **No duplicated DAL.** Client loaders reuse `lib/db/client-packages.ts`, `lib/db/session-checkins.ts`, `lib/db/session-pack-products.ts`.

---

## Phase 1 — "My Sessions" balance widget (read-only)

### What the client sees
Remaining credits, nearest expiry, and recent check-in history. No mutations.

### Components & data flow
- **Loader** `loadMyPacksView()` added to `lib/services/client-packs-view.ts`: resolves the session user via `auth()`, then reuses `listPackagesForClient(userId)` + per-pack `listCheckinsForPackage()` enrichment and the pure `summarizeClientPacks()`. Returns the same `PackWithCheckins[]` + summary shape the admin page already consumes — scoped to the authenticated user. Service-role client is fine because the id comes from the verified session, not input.
- **`components/client/MySessionsCard.tsx`** — compact dashboard card: "N sessions left" + nearest expiry + link to the full page. Renders nothing (or a muted "no active sessions") when the client has no active credits. Added to `app/(client)/client/dashboard/page.tsx`.
- **`app/(client)/client/sessions/page.tsx`** — full server component page: active packs (remaining/total, session type, expiry), read-only check-in history (date + method), and depleted/expired packs collapsed/muted. Add a nav entry in the client nav.
- **Gating:** behind `client_pack_balance_enabled`. When off, the card/page are hidden (card renders null; page redirects to the dashboard).

### Empty state
"No active sessions — contact your coach." (Becomes a Buy CTA once Phase 3 ships and `client_self_purchase_enabled` is on.)

### Tests
- `loadMyPacksView` returns the correct summary for the session user and ignores other users' packs.
- `MySessionsCard` renders the count when credits exist and null when zero/flag-off.

---

## Phase 2 — Guarded client self check-in

### Approach
Make the **existing `/checkin` page identity-aware** instead of adding a camera/scanner. The phone's OS camera already opens `/checkin?token=…`. When that page is opened by a visitor with a logged-in **client** session, it skips the roster and shows a single **"Check in as \<FirstName\>"** button plus their current balance.

- The **QR token proves presence** (possessing today's on-site code; HMAC, ≤1-day age — unchanged).
- The **session proves identity** (`auth()`), so no name-picking and no impersonation.

### Components & data flow
- **`POST /api/checkin/self`** (new): reads `auth()` for the client id **and** `verifyCheckinToken(token)` for presence. On both valid → `checkInClient({ clientUserId: session.user.id, method: "qr_self", createdBy: session.user.id })`. Rejects: 401 invalid/expired token, 401 no session, 403 if session role ≠ `client`. Ignores any body-supplied client id entirely.
- **`components/checkin/CheckinClient.tsx`**: when the page detects a logged-in client (passed from the server page via a `me` prop resolved with `auth()`), render the single self-check-in button → `POST /api/checkin/self`. Otherwise fall back to the existing roster flow (walk-ins without the app), unchanged.
- **`app/checkin/page.tsx`**: resolve `auth()` server-side; pass `me` (id + first name) to `CheckinClient` when the visitor is a client.
- **Gating:** the self path is behind `client_self_checkin_enabled`. When off, the page always shows the legacy roster (backward compatible).

### Reuse / safety
- Existing 4-hour idempotency window prevents accidental double-deduct.
- `method` stays `qr_self`; audit records `pack.checkin` with self-initiated metadata.
- **Rejected alternative:** an in-portal QR-scanner library — more code and dependencies for no benefit over the OS camera opening the URL.

### Tests
- `/api/checkin/self`: valid token + client session → checks in as the session user; bad token → 401; no session → 401; non-client role → 403; body-supplied id is ignored (uses session id).

---

## Phase 3 — Client self-purchase (Stripe; packs stay unlinked)

### Prerequisite (flagged)
`session_pack_products` is **empty** and there is **no admin page** to manage it (only `app/api/admin/session-packs/products/route.ts`). Phase 3 therefore includes a small **admin catalogue manager** so the coach can create the products the storefront sells. `createPackCheckoutSession` (lib/stripe.ts:401) already supports **inline `price_data`** from `price_cents`, so a pre-made Stripe price id is optional.

### Components & data flow
- **Admin catalogue manager** `app/(admin)/admin/session-packs/products/page.tsx` (+ wire to the existing products API, extending it with create/update/deactivate as needed): list, create, edit, activate/deactivate `session_pack_products` (name, session_type, credits, price, validity_days, sort_order, is_active).
- **Client storefront** `app/(client)/client/sessions/buy/page.tsx`: lists **active** products (name, credits, price, validity). Linked from the Phase 1 sessions page / empty state.
- **`POST /api/client/session-packs/checkout`** (new, role `client`): derives `userId` from `auth()`; validates the chosen `productId` exists and `is_active`; creates a **pending** pack via the shared `buildPackageInsert`/`createClientPackage` path (`payment_method: "stripe"`, `assignment_id: null` — unlinked per decision); calls `createPackCheckoutSession` with a **client** return URL (`/client/sessions?purchase=success`). Returns the Stripe URL for the client to pay.
- **Webhook:** unchanged. The existing `checkout.session.completed` handler promotes pending→paid via `activatePaidPackage`, keyed by `stripe_session_id` (no admin assumption). Inline pricing means no pre-made price required.
- **Coach notification:** best-effort notify the coach when a client self-purchases (so new credits aren't a surprise). Non-blocking.
- **Gating:** storefront + endpoint behind `client_self_purchase_enabled` (default off until catalogue seeded).

### Constraints
- **Stripe only** for self-serve (no client-initiated cash/comp).
- Packs created this way are **unlinked** (`assignment_id: null`); the coach can manually link later via the existing admin flow.

### Tests
- `/api/client/session-packs/checkout`: auth-derived id; rejects inactive/unknown product (400/404); rejects non-client (403); creates a pending stripe pack with `assignment_id: null` and returns the URL.
- Admin products API: create/update/deactivate happy paths + admin gating.

---

## Shipping order
Phase 1 (safe, immediate value) → Phase 2 (security win + convenience) → Phase 3 (revenue; needs catalogue groundwork). Each phase is independently flag-gated and independently shippable.

## Out of scope (YAGNI)
- Client-initiated cash/comp purchases.
- Auto-linking self-purchased packs to programs.
- In-app native QR scanner.
- Refunds/cancellations from the client side (remains an admin/Stripe operation).

## Verification
- New unit tests per phase (mirroring `__tests__/api/session-packs/` mocked-DAL style + `__tests__/lib/services/` for loaders).
- Full `vitest run` green before completion.
- Manual click-through deferred to post-push (prod), since flags ship off.
