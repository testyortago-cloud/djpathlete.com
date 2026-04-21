# Starter AI Automation — Phase 5a: Analytics Data Layer (Plan)

**Spec:** [2026-04-21-starter-ai-automation-phase5a-analytics-data-layer-design.md](../specs/2026-04-21-starter-ai-automation-phase5a-analytics-data-layer-design.md)
**Phase:** 5a of Starter AI Automation
**Est. scope:** 1 migration, 1 DAL, 1 internal API route, 1 scheduled Firebase Function, 4 test files

## Pre-flight

- Confirm branch: `feat/content-studio-phase1` (current). Consider branching off `main` for cleanliness, but this branch is acceptable since it's ahead of main with related work.
- Confirm `gen_random_uuid()` extension is enabled (existing migrations use it — fine).
- Confirm `social_platform` enum exists (migration 00076 — confirmed).

## Step-by-step

### Step 1 — Migration 00089: `social_analytics` table

**File:** `supabase/migrations/00089_social_analytics.sql`

```sql
CREATE TABLE social_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_post_id uuid NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  platform social_platform NOT NULL,
  platform_post_id text NOT NULL,
  impressions bigint,
  engagement bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  views bigint,
  extra jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_analytics_post_recorded_desc
  ON social_analytics (social_post_id, recorded_at DESC);

CREATE INDEX idx_social_analytics_platform_recorded_desc
  ON social_analytics (platform, recorded_at DESC);

COMMENT ON TABLE social_analytics IS
  'Time-series snapshots of engagement metrics per published social_post. One row per post per sync run. Written by the syncPlatformAnalytics Firebase Function.';
```

**Test:** `__tests__/migrations/00089_social_analytics.test.ts` — verify table exists, indexes exist, FK cascade from `social_posts` works.

**Verify:** Run migration against local Supabase branch (via `mcp__supabase__apply_migration` at execution time, or `supabase db push` if running locally). All existing tests still pass.

### Step 2 — Type additions

**File:** `types/database.ts` — add `SocialAnalytics` interface mirroring the table columns. Add `social_analytics` to the `Database["public"]["Tables"]` block if that's the project convention (check existing for pattern — some tables are included, some aren't).

**Verify:** `npx tsc --noEmit -p tsconfig.json` scoped to `types/` passes.

### Step 3 — DAL: `lib/db/social-analytics.ts`

Two exported functions:

```ts
export async function insertSocialAnalytics(
  row: Omit<SocialAnalytics, "id" | "created_at">
): Promise<SocialAnalytics>

export async function listRecentAnalyticsByPost(
  socialPostId: string,
  limit = 30
): Promise<SocialAnalytics[]>
```

Follow the service-role client pattern from neighboring DAL files (e.g., `lib/db/social-posts.ts`).

**Test:** `__tests__/db/social-analytics.test.ts` — insert + list round-trip.

**Verify:** `npx vitest run __tests__/db/social-analytics.test.ts`.

### Step 4 — Internal API route: `/api/admin/internal/sync-post-analytics`

**File:** `app/api/admin/internal/sync-post-analytics/route.ts`

- POST only.
- Auth: require `x-internal-secret` header matching `process.env.INTERNAL_API_SHARED_SECRET`. 401 on mismatch.
- Body: `{ socialPostId: string }` — Zod validated.
- Load post via `getSocialPostById`; 404 if missing.
- 409 if `post.approval_status !== "published"` or `!post.platform_post_id`.
- Resolve plugin from `lib/social/registry.ts`.
- Load connection via `getPlatformConnection(platform)`; if not `connected`, return 200 with `metrics: null`.
- Call `plugin.fetchAnalytics(post.platform_post_id)`. Wrap in try/catch → 502 on error.
- Return `{ socialPostId, platform, platformPostId, metrics }`.

**Test:** `__tests__/api/admin/internal/sync-post-analytics.test.ts` — cover 401, 404, 409, disconnected → null metrics, plugin throws → 502, happy path.

**Verify:** `npx vitest run __tests__/api/admin/internal/sync-post-analytics.test.ts`.

### Step 5 — Firebase Function: `syncPlatformAnalytics`

**File:** `functions/src/sync-platform-analytics.ts`

Structure:

```ts
import { onSchedule } from "firebase-functions/v2/scheduler"
import { defineSecret } from "firebase-functions/params"
import { getSupabase } from "./lib/supabase.js"

const INTERNAL_SECRET = defineSecret("INTERNAL_API_SHARED_SECRET")
const NEXT_APP_URL = defineSecret("NEXT_APP_URL")

export const syncPlatformAnalytics = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "UTC",
    memory: "512MiB",
    timeoutSeconds: 540,
    region: "us-central1",
    secrets: [INTERNAL_SECRET, NEXT_APP_URL /*, + supabase secret */],
  },
  async () => { return await runSyncPlatformAnalytics() },
)

// Exported as pure function for unit testing
export async function runSyncPlatformAnalytics(options?: {
  fetchImpl?: typeof fetch
  supabaseImpl?: ReturnType<typeof getSupabase>
  internalSecret?: string
  appUrl?: string
}): Promise<{ synced: number; skipped: number; failed: number }> {
  // 1. Query published social_posts (cap 500)
  // 2. For each, POST /api/admin/internal/sync-post-analytics
  // 3. On 200 + non-null metrics, insert social_analytics row
  // 4. Increment counters; never throw
  // 5. Return counters for logs
}
```

**Register:** Add `export * from "./sync-platform-analytics.js"` (or named export) to `functions/src/index.ts`.

**Test:** `functions/src/__tests__/sync-platform-analytics.test.ts` — unit test `runSyncPlatformAnalytics` with stubbed fetch + supabase. Cover: happy path (1 post, 1 row inserted), platform disconnected (0 rows), plugin error (0 rows, failed++), no published posts (0/0/0).

**Verify:** `cd functions && npx vitest run src/__tests__/sync-platform-analytics.test.ts`.

### Step 6 — Env vars + secrets

- Add `INTERNAL_API_SHARED_SECRET` to `.env.example` (marked as server-only, not `NEXT_PUBLIC_`).
- Document that it must be set in Vercel + via `firebase functions:secrets:set INTERNAL_API_SHARED_SECRET`.
- Add `NEXT_APP_URL` to same locations (or reuse if already present — check `.env.example`).

**Not executed here** — the engineer running the plan sets these values in their envs. The plan step just adds the example entries.

### Step 7 — Prettier + lint

```bash
npm run format
npm run lint
```

### Step 8 — Commit

One commit per logical layer (migration, DAL, route, function) for clean review. Or one bundled commit if small enough — call based on diff size after step 7.

## Verification gate

All of these must pass before marking 5a done:

```bash
npx tsc --noEmit -p tsconfig.json
npm run lint
npx vitest run __tests__/migrations/00089_social_analytics.test.ts
npx vitest run __tests__/db/social-analytics.test.ts
npx vitest run __tests__/api/admin/internal/sync-post-analytics.test.ts
cd functions && npx vitest run src/__tests__/sync-platform-analytics.test.ts
```

Plus a manual dry-run: invoke the function once via Cloud Scheduler UI (or by hitting the `runSyncPlatformAnalytics` export from a scratch script) against staging data — verify at least one `social_analytics` row appears.

## Out of scope — explicit reminders

- No analytics tabs in `AnalyticsDashboard.tsx`. (5b)
- No email reports. (5c/5d)
- No voice drift / learning loop. (5e/5f)
- No blog or newsletter analytics. (later)
- No backfill of historical data. (optional one-shot, future)
