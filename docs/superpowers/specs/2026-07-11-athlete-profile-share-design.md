# Shareable Athlete Profile Card — Design

**Date:** 2026-07-11
**Status:** Approved (user picked: Dark Arena visual, coach-only permanent link, all sections + radar + OG image + PDF, full FIBA physicals). Remaining decisions locked autonomously per away-mode; flagged in "Decisions made autonomously" below.

## What

A public, shareable, FIBA-style athlete profile page for each client — hero identity block, key training stats, personal records, ability radar, current program + career history, and achievement badges — rendered in DJP branding. The coach generates a permanent link from the admin client page and sends it to the client (who can share it onward: family, scouts, socials).

## Why

Clients get a motivating, brag-worthy artifact of their training; DJP gets a branded marketing surface every time a card is shared. All underlying data already exists — this is presentation + a share link, zero schema change.

## Architecture

### Route & access

- **Page:** `app/athlete/[token]/page.tsx` — server component, outside all route groups so `proxy.ts` leaves it public (same as `app/checkin/*`). Bare layout (no navbar/footer), `robots: { index: false, follow: false }`.
- **Token:** stateless HMAC, extending the `lib/qr/checkin-token.ts` pattern with a new namespace prefix. New file `lib/profile-share/token.ts`:
  - `signAthleteProfileToken(clientUserId)` → `base64url("ap.<clientUserId>") + "." + HMAC-SHA256(NEXTAUTH_SECRET)`
  - `verifyAthleteProfileToken(token)` → `{ valid: true, clientUserId } | { valid: false }` via `timingSafeEqual`, rejects non-`ap.` prefixes. No expiry (permanent link).
- **Feature flag:** `client_profile_share_enabled` (DB-backed in `system_settings`, default **OFF**), helper in new `lib/profile-share/flags.ts` following `lib/packs/flags.ts` convention. Togglable at `/admin/automation`.
- **404 semantics (`notFound()`):** invalid/tampered token · flag off · user missing or not role `client` · user status not active · client `is_minor`.

### Data assembly

New `lib/profile-share/data.ts` exporting `getAthleteProfileData(clientUserId): Promise<AthleteProfileData | null>` — one `Promise.all` over existing DAL helpers (pattern: the admin performance print page):

| Card block | Source |
|---|---|
| Identity | `getUserById` (name, `avatar_url`, `created_at`) + `getProfileByUserId` (sport, position, `experience_level`, `height_cm`, `weight_kg` + `weight_unit`, `date_of_birth` → **age only**, `training_years`, `is_minor`) |
| Key stats | `getCompletedSessionCount`, `getWorkoutStreak`, Σ `workout_sessions.volume_load_kg` (paginate per PostgREST 1000-row cap or aggregate server-side), PR count |
| Records — "In the Gym" | weight PRs via `getAchievementsByType(userId, "pr")` filtered to `title === "Weight PR!"`, deduped per exercise (max `metric_value`), top 6 with dates; exercise names batch-resolved from `exercises` (PR titles are generic — name lives behind `exercise_id`) |
| Records — "On the Field" | `getPRsByUser` from `lib/db/performance-tests.ts` (already respects lowest-is-best), top 6, with dates; labels via `TEST_TYPE_LABELS` |
| Radar | **correction (2026-07-11):** feeds from `PerformanceTest[]` (`listByUser`) normalized 0–100 via `lib/coach-intel/test-normalization` (`RADAR_CATEGORIES`: Speed/Power/Strength/Endurance/Mobility) — same as `athlete-radar-card.tsx`. NOT assessment `computed_levels` (that's the assessment engine's separate concept) |
| Program | `getActiveAssignment` + `programs` join; progress = `current_week` / `effectiveTotalWeeks(...)` (**never** raw `total_weeks`); career = `program_assignments` with `status='completed'` (name + completed date) |
| Badges | `computeBadges(BadgeInput)` from `lib/badges` (tiered shelf) + `achievements` rows of type `streak|milestone|completion` (dated milestone list, capped ~8 newest) |

**Never exposed:** injuries, readiness values, form reviews, payment/billing fields, email/contact, raw DOB, internal notes. (Readiness rows feed `BadgeInput` as computation input only — the Recovery Pro badge may display, values never do.)

**Freshness:** live query per view — `export const dynamic = "force-dynamic"` (permanent link + live data beats a stale snapshot, and it avoids caching a pre-flag-flip 404).

### Admin entry point

"Share profile" action on `/admin/clients/[id]` (in the Quick Actions row, next to the Check-in button): opens a dialog (modeled on `PersonalCheckinLinkDialog`) with the full URL (`${NEXT_PUBLIC_APP_URL ?? NEXTAUTH_URL ?? "https://www.darrenjpaul.com"}/athlete/<token>`), copy button, and QR data-URL (existing `qrcode` package). Visible only when the flag is ON and the client is not a minor. **Correction (2026-07-11):** token signing is deterministic HMAC computed inline in the (admin-gated) server page — exactly like the personal check-in link block — so there is no discrete "generation" event to audit; no `recordAudit` call, matching the check-in precedent. Page views are already tracked by `captureAttribution`.

### OG share image

`app/athlete/[token]/opengraph-image.tsx` using `next/og` `ImageResponse` (net-new in this repo): 1200×630 dark Green Azure card — DJP wordmark, athlete name (accent highlight), sport/position, 2–3 headline stats. Same token verify + flag check; falls back to 404 like the page. `generateMetadata` on the page sets title `"<Name> — DJP Athlete Profile"`, description from sport/stats, `twitter.card: "summary_large_image"` (root layout appends `" | DJP Athlete"` — don't duplicate).

### Print / PDF

Reuse `.print-document` styles (globals.css) + the print-toolbar pattern from `components/admin/performance/print-toolbar.tsx`: a floating "Save as PDF" button triggering `window.print()`, with print CSS flattening the dark hero to print-safe styling.

## UI (Dark Arena — user-approved mockup)

Full mockups persisted at `.superpowers/brainstorm/1895-1783782202/content/` (`visual-style.html`, `full-page-layout.html`). Section order:

1. **Hero** — full-bleed `bg-primary` with dual radial accent glows (recipe: `EventDetailHero`), `djp-eyebrow` "DJP ATHLETE PROFILE", avatar (Supabase `avatars` bucket, initials fallback), Lexend Exa name with accent-colored surname, sport · position · level line, glass mono pills for HT/WT/AGE, "Training with DJP since <month year>".
2. **Key stat tiles** — 4 white cards overlapping the hero edge (workouts, streak, PRs, volume), count-up animation (recipe: `AnimatedStats`), `KeyLiftCard` styling.
3. **Records** — two columns: "In the Gym" / "On the Field", value + date rows, ↑ accent badge when set in last 30 days.
4. **Radar** — Recharts RadarChart via CSS vars (adapt `athlete-radar-card.tsx`).
5. **Program** — current program card with gradient progress bar (WEEK X / Y) + "Career" list of completed programs with dates.
6. **Badges** — tiered medal shelf (bronze/silver/gold ring treatment from `badge-shelf-card.tsx`) + dated milestone rows (icon map from `AchievementCard.tsx`).
7. **Footer CTA** — dark band, DJP logo (`public/logos/logo-icon-light.png`), "Train with Darren J Paul → darrenjpaul.com".

Client components only where interactivity/animation demands (count-up, Framer Motion reveals via `FadeIn`, print button); everything else server-rendered. Semantic color classes only; fonts via existing `font-heading`/`font-body`/`font-mono`. Mobile-first responsive (share targets are phones).

**Empty states:** sections 3–6 each hide when empty; hero + stats always render (0s are honest for a new client). No minimum-data share block.

**Units:** weight in client's `weight_unit`; heights/test values in stored units.

## Error handling

- All failure modes → `notFound()` (single branded 404; no information leak distinguishing "bad token" from "flag off").
- Data assembler: individual source failures degrade to that section's empty state (log, don't 500) — the card renders with what it has; only identity-fetch failure 404s.
- OG image route: on any error return the static fallback behavior (404 → platform default preview).

## Testing

- **Unit:** token sign/verify round-trip, tamper rejection, wrong-prefix (`pc.` vs `ap.`) rejection; data assembler shape with full + sparse fixtures; age computation; PR dedup/merge; volume aggregation pagination.
- **Component:** page section rendering with full data and each empty-state; minor/inactive/flag-off → 404.
- **Existing-suite caveat:** full suite has known pre-existing reds/flakes — run targeted files; snapshot-isolate before blaming the diff.

## Decisions made autonomously (review on return)

1. **Route naming** `/athlete/<token>` over `/p/<token>` — reads better in a shared message.
2. **Minors fully blocked** from share links (`is_minor`) — safest public-page default; easy to relax later.
3. **Badges = both systems**: computed tier shelf (`lib/badges`) + persisted milestone achievements — they complement, not conflict.
4. **Live data** (not snapshot-at-share): a permanent link should show the athlete's current story.
5. **No client-side "share my profile" surface** in v1 (coach-only was picked; client dashboard button is a later follow-up).
6. **No audit rows** — HMAC signing is deterministic and inline in the admin server page (no generation event exists, matching the personal check-in link precedent); page views are covered by existing `captureAttribution`.
7. **Flag default OFF** per project convention — flipping it on at `/admin/automation` is a post-deploy manual step.
