# Starter AI Automation — Phase 6: Admin Operations & Handoff (Code Changes Design)

**Date:** 2026-04-21
**Status:** Accepted (auto-mode)
**Scope:** Code-side of Phase 6 only. Docs, Loom videos, the PDF handbook, and the live training session are out of scope for this design.

## Goal

Make the Phase 1–5 automation **operable** by the coach: let them see every scheduled job, read why each exists, trigger them on demand, pause them globally, and connect platforms with clear inline instructions.

## What ships

1. **Cron catalog** — single source of truth listing every scheduled function, its cadence, purpose.
2. **System settings table + global pause switch** — one flag, `automation_paused`, that every scheduled runner checks.
3. **`runJob` HTTPS-callable Firebase function** — dispatches to each pure runner by name. Reused for admin "Run now" buttons. Replaces the need for five per-job HTTP endpoints.
4. **Admin dispatcher route** `/api/admin/automation/trigger` — session-authed, forwards to Firebase `runJob` with the Bearer token.
5. **Admin automation page** `/admin/automation` — cron catalog rendered as a table + global pause toggle + "Run now" per job.
6. **Sidebar entry** — "Automation" in the AI Automation section.
7. **Help tooltip system** — `<HelpTooltip>` wrapper + `lib/help-copy.ts` dictionary. Sprinkled across pipeline columns, analytics KPIs, AI Insights, platform-connections status badges.
8. **Per-platform setup guides** — inline expandable rows in the Platform Connections page. One short guide per plugin ("how to create the account" + "how to connect").
9. **Activation empty state** — on `/admin/content` when zero platforms are connected, a banner steering the coach to `/admin/platform-connections`.
10. **`.env.example` sweep** — consolidate and clean up after 5a–5f.
11. **Bug sweep** — fix the `thumbnail_path` required-but-missing errors across video-upload test fixtures.

## Out of scope for this code pass

- PDF handbook, Loom recordings, the training session.
- Walkthroughs for creating new accounts from scratch (TikTok / LinkedIn sign-up flows) beyond a short inline checklist.
- Per-function pause toggles (global pause only).
- Per-function health/last-run dashboards.
- Manual trigger for `publish-due` (that one already runs every 5 min — a manual button doesn't add value).

## Architecture

### Pause gate

```
[Firebase scheduled function fires]
       ↓
[pure runner starts]
       ↓
[SELECT value FROM system_settings WHERE key='automation_paused']
       ↓
  true  → log "paused, skipping" + return { paused: true, … }
  false → continue
```

The pause is checked **inside** each runner (not outside). Benefits:
- Manual triggers go through the same runner, same gate.
- One place to change logic later (e.g., per-platform exceptions).
- Cheap (one Supabase read per run).

### Manual trigger flow

```
[Admin clicks "Run now"]
       ↓
[POST /api/admin/automation/trigger { jobName }]
       ↓ admin session auth
[POST https://<firebase-region>-<project>.cloudfunctions.net/runJob]
       ↓ Bearer INTERNAL_CRON_TOKEN
[runJob HTTPS function]
       ↓ switch(jobName) → import + invoke matching runner
[runner returns counters]
       ↓
[counters bubble back to admin UI toast]
```

## Data model

**Migration 00092 — `system_settings`:**

```sql
CREATE TABLE system_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system_settings (key, value, description) VALUES
  ('automation_paused', 'false'::jsonb,
   'When true, all scheduled automation runners (analytics sync, daily pulse, weekly report, voice drift, learning loop) skip their runs. Flip back to false to resume.');
```

Single-row-per-key. Extensible (future flags slot in without another migration).

## Interfaces

### `lib/cron-catalog.ts`

```ts
export interface CronJob {
  name: string                          // "sync-platform-analytics"
  label: string                         // "Platform analytics sync"
  description: string                   // "Pulls engagement..."
  schedule: string                      // "0 3 * * *"
  timezone: string                      // "UTC"
  humanSchedule: string                 // "Daily at 3 AM UTC"
  firebaseFunction: string              // "syncPlatformAnalytics"
  manualTrigger: "firebase" | "next-internal" | "none"
}

export const CRON_CATALOG: CronJob[]
```

Rendered once, used by the admin page and (later) the Loom script.

### `lib/db/system-settings.ts`

```ts
export async function getSetting<T>(key: string, fallback: T): Promise<T>
export async function setSetting(key: string, value: unknown, updatedBy?: string): Promise<void>
export async function isAutomationPaused(): Promise<boolean>
```

Mirror in `functions/src/lib/system-settings.ts` so the Firebase runners can check without going through Next.js.

### `functions/src/run-job.ts` — HTTPS function

```ts
export const runJob = onRequest(
  { secrets: [...], region: "us-central1", timeoutSeconds: 540, memory: "512MiB" },
  async (req, res) => {
    // Bearer INTERNAL_CRON_TOKEN check
    // switch(req.body.jobName) on:
    //   "sync-platform-analytics"       → runSyncPlatformAnalytics()
    //   "send-weekly-content-report"    → runSendWeeklyContentReport()
    //   "send-daily-pulse"              → runSendDailyPulse()
    //   "voice-drift-monitor"           → runVoiceDriftMonitor()
    //   "performance-learning-loop"     → runPerformanceLearningLoop()
    // Returns counters from the runner as JSON.
  },
)
```

### Admin dispatcher — `/api/admin/automation/trigger`

POST `{ jobName: string }`. Session-authed (admin only). Forwards to Firebase `runJob` with Bearer. Returns the runner's counters.

### Admin page — `/admin/automation`

Server component renders the cron catalog. Client pieces:
- `<PauseToggle />` — reads + writes `automation_paused` via a server action or internal route.
- `<RunNowButton jobName="..." />` — POSTs the dispatcher, shows toast with counters.

### `<HelpTooltip />`

```tsx
<HelpTooltip label="Impressions">
  Total times posts appeared in feeds, summed across the latest snapshot per
  post. Higher is broader reach; not the same as engagement.
</HelpTooltip>
```

Renders the label followed by a small `HelpCircle` icon on hover. Uses the existing shadcn `<Tooltip>` primitive.

### Per-platform setup guides

`components/admin/platform-connections/SetupGuide.tsx` — one expandable `<details>` element per platform. Content pulled from `lib/platform-setup-guides.ts` (a string constant per plugin). No MDX dependency.

### Activation empty state

On `/admin/content` (existing page), when `getConnectedPlatformCount() === 0`, render a banner above the pipeline: _"You can generate content without connecting platforms — but posts can't actually publish until at least one is connected. [Connect a platform →]"_

## Testing

| Layer | Test | File |
|---|---|---|
| System settings DAL | round-trip read/write + `isAutomationPaused()` default | `__tests__/db/system-settings.test.ts` |
| Pause gate (runner) | runner returns `{ paused: true }` without scanning when flag is on | `functions/src/__tests__/pause-gate.test.ts` |
| `runJob` HTTPS | 401 bad Bearer, 400 unknown jobName, 200 on dispatch | `functions/src/__tests__/run-job.test.ts` |
| Admin dispatcher | 403 non-admin, 200 happy path, forwards Bearer correctly | `__tests__/api/admin/automation/trigger.test.ts` |
| `<HelpTooltip />` | renders content on hover (RTL: check trigger + content) | `__tests__/components/ui/HelpTooltip.test.tsx` |
| Cron catalog | has exactly 5 entries matching deployed schedules | `__tests__/lib/cron-catalog.test.ts` |

## Rollout

1. Apply migration 00092 via Supabase MCP.
2. Deploy Next.js (Vercel).
3. `firebase deploy --only functions` (picks up `runJob` + pause check in existing scheduled funcs).
4. Visit `/admin/automation`. Verify cron catalog renders and pause toggle works.
5. Click "Run now" on the analytics sync. Verify counters come back.
6. Walk through Platform Connections — verify each plugin has its inline guide.
7. Hand off to Darren.

## Follow-ups (explicitly deferred)

- Per-function pause toggles.
- Run-history log (who ran what, when).
- Real OAuth flows for each plugin (these are existing Phase 2 deliverables, just need inspection).
- Replacing `@react-email` (no deps added in Phase 5) with something richer if emails grow in complexity.
