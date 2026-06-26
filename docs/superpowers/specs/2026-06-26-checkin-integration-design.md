# Check-in Integration — Design

**Date:** 2026-06-26
**Status:** Approved (brainstorm), implementing

## Problem

The Session Packs **check-in** feature is surfaced through a standalone **"Check-ins"** sidebar item (`/admin/today`). It feels disconnected from the rest of coaching: check-in is a per-client action, but it lives in its own tab. The boss wants check-in to feel **linked into Clients and the client's assigned program**, reached by a clear **action button**, not a separate sidebar tab.

What already exists today:

- `/admin/today` page (the sidebar tab) renders two things:
  1. A **self check-in QR** (boss displays it; clients scan, tap their name on `/checkin`, and a credit comes off).
  2. A searchable **roster** of every active-pack client, each with a one-tap "Check in" button.
- The client detail page already embeds `ClientPackagesPanel` (Check in / Sell pack / Undo, shows linked program "advances on check-in").

## Decisions (from brainstorm)

- **Primary check-in moment:** on the **client's page**.
- **Self check-in QR:** keep it, reached from the **Clients list** header (not its own tab).
- **Program link:** the **client's assigned program** area shows the linked pack's progress.
- **Admin roster:** **dropped** (the "check everyone in from one list" view). The boss checks in from the client's page; the roster is not rehomed. (The public `/checkin` scan flow and its roster API are untouched.)

## Design

### 1. Remove the standalone surface
- Delete the `Check-ins → /admin/today` item from the Coaching section in `components/admin/admin-nav.ts`.
- Delete `app/(admin)/admin/today/page.tsx` and `components/admin/packs/TodayCheckinList.tsx`.
- Repoint the renewal-reminder email link in `app/api/admin/internal/pack-renewals/route.ts` from `/admin/today` to `/admin/clients`.

### 2. One source of truth for pack data (`lib/services/client-packs-view.ts`)
New module, extracted from the existing `GET /api/admin/session-packs` route logic so both share it:

- `PackWithCheckins = ClientPackage & { checkins: SessionCheckin[]; program_name: string | null }` (exported; the panel imports this instead of redefining it).
- `loadClientPacksView(clientUserId): Promise<PackWithCheckins[]>` — packages (newest first) each with check-in history and the linked program name. The GET route is refactored to call this (no behavior change).
- `summarizeClientPacks(packs, now): ClientPacksSummary` — **pure**, unit-tested:
  - `activeRemaining: number` — sum of remaining credits across packs that would actually be deducted (status `active`, not expired, `remaining > 0`), mirroring `getActivePackageForClient`.
  - `hasActiveCredits: boolean` (`activeRemaining > 0`).
  - `byAssignment: Map<assignmentId, { remaining; total }>` — per linked assignment, summed over those same active packs. Used for the program badge. (A `Map` is fine here because it is consumed only by server-rendered code, never passed across the client boundary.)
  - Reuses `remainingCredits` / `isExpired` from `lib/services/session-credits.ts` (single source of truth).

### 3. Prominent check-in action button (client page)
- The client page (`app/(admin)/admin/clients/[id]/page.tsx`, a server component) loads `packs = await loadClientPacksView(id)` and computes the summary once.
- New client component `components/admin/packs/ClientCheckinButton.tsx` placed in the existing **Quick Actions** row:
  - Props: `clientUserId: string`, `hasActiveCredits: boolean` (both serializable).
  - Renders a primary **Check in** button **only when `hasActiveCredits`**. POSTs `/api/admin/session-packs/checkin`, toasts the result (`remaining` / "already checked in" / error), then `router.refresh()`.
  - When there are no active credits it renders nothing — the panel's **Sell pack** is the path to create one.

### 4. Program-link badge
- `ProgramsSection` (in the client page) receives the `byAssignment` map. For each assignment present in the map it renders an accent line under the program name: `🎟 {remaining} / {total} sessions · advances on check-in`. Server-rendered; no new client component.
- No per-row check-in button (check-in stays the single Quick-Actions button — avoids button proliferation).

### 5. Panel becomes a seeded, refresh-driven view
- `ClientPackagesPanel` takes `initialPacks: PackWithCheckins[]` and renders directly from that prop (no client-side fetch / `useEffect` load).
- Check-in / sell / undo call `router.refresh()` so the server re-pulls and every consumer (header button, program badge, panel) stays consistent.
- **Its own "Check in" button is removed** — the prominent Quick-Actions button is now the single check-in entry point. The panel keeps **Sell pack**, per-check-in **Undo**, linked-program display, and history.

### 6. Self check-in QR on the Clients list
- `app/(admin)/admin/clients/page.tsx` (server) resolves the admin via `auth()`, signs a token (`signCheckinToken`), builds the `/checkin?token=…` URL and a QR data-URL (`qrcode`), and passes them to the header.
- `ClientsPageHeader` gains `qrDataUrl` / `checkinUrl` props and renders a new `components/admin/packs/SelfCheckinQrDialog.tsx` button ("Self check-in QR") beside "Add Client". The dialog shows the QR image + "Copy check-in link" (markup lifted from the old `TodayCheckinList` QR card).

## Data flow

```
Client page (server)
  loadClientPacksView(id) ──▶ packs ──▶ ClientPackagesPanel (initialPacks)
        │                         └────▶ summarizeClientPacks(now)
        │                                   ├─ hasActiveCredits ─▶ ClientCheckinButton
        │                                   └─ byAssignment ─────▶ ProgramsSection badge
  any mutation (check-in / sell / undo) ─▶ router.refresh() ─▶ server re-pulls ─▶ all three update
```

## Out of scope / unchanged
- Public `/checkin` self-check-in page, `app/api/checkin/roster/route.ts`, `signCheckinToken`/`verifyCheckinToken`, the check-in/void services, audit actions, and migrations. No DB or API contract changes (the GET route's response shape is preserved).

## Testing
- **Unit (TDD):** `summarizeClientPacks` — active vs expired vs depleted packs, multiple packs, multiple packs on one assignment, no packs.
- **Component:** `ClientCheckinButton` — hidden when no credits; POSTs + toasts + refreshes on click when credits exist.
- **Regression:** existing session-packs / checkin / checkout / orchestration suites stay green; the GET route refactor is covered by its current behavior (response shape unchanged).
- Full `npm run test:run` + TypeScript check on production source must be green.

## Risks
- **Two-buttons confusion** — mitigated by removing the panel's check-in button; one prominent entry point.
- **Stale panel after header check-in** — mitigated by `router.refresh()` re-pulling server data instead of independent client state.
- **Map across client boundary** — avoided; the map is consumed only server-side.
