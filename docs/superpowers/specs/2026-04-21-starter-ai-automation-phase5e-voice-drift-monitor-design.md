# Starter AI Automation — Phase 5e: Voice Drift Monitor (Design)

**Date:** 2026-04-21
**Status:** Accepted (auto-mode)
**Scope:** One weekly scheduled job + one new DB table + one admin UI card.
**Depends on:** 5a pattern (onSchedule). Uses existing `prompt_templates` voice profile (from migration 00081) and existing AI generation outputs.
**Precedes:** 5f (learning loop — uses same scoring signals).

## Goal

Every Monday morning, Claude compares the last week of AI-generated content against the brand voice profile and flags anything that drifts. Flags surface as a card inside the existing `AiInsightsDashboard` so the admin can spot-check and either ignore or adjust the voice prompt before drift compounds.

## Non-goals

- No auto-rewriting of drifted content.
- No blocking the publish pipeline based on flags — informational only.
- No per-platform voice variants — uses the single `voice_profile` template.
- No dismiss/acknowledge UI in this phase — just read + review.
- No inline badges on the pipeline board (that's a future polish).

## Architecture

```
Cloud Scheduler (Mon 04:00 America/Chicago — before Daily Pulse)
       │
       ▼
[voiceDriftMonitor — Firebase Function onSchedule]
       │  1. read prompt_templates where category='voice_profile'
       │  2. pull last 20 AI-generated items (social_posts, blog_posts,
       │     newsletters) with source_* set AND created_at >= now-7d
       │  3. for each, callAgent() → voiceDriftAssessmentSchema
       │  4. insert a voice_drift_flags row when severity != 'low'
       ▼
[voice_drift_flags table (Supabase)]
       ▲
       │   GET /api/admin/ai/voice-drift  (admin session)
       │
[VoiceDriftCard] mounted inside [AiInsightsDashboard]
       reads the last 7 days of flags, groups by entity type
```

**Why a weekly cadence, not nightly:**
- Drift emerges over multiple generations — a single sample isn't informative.
- Claude calls cost money; 20 items/week is a reasonable budget.
- Monday morning gives the admin time to course-correct before the week's content ships.

**Why store flags instead of computing on read:**
- Cheaper: one Claude call per item, persisted. The dashboard just reads rows.
- Historical: flags remain visible even if the voice profile is later edited — useful for understanding what drift looked like then.
- Works when the dashboard is closed: flags land regardless of whether anyone is looking.

## Data model — migration 00090

```sql
CREATE TABLE voice_drift_flags (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type      text NOT NULL CHECK (entity_type IN ('social_post', 'blog_post', 'newsletter')),
  entity_id        uuid NOT NULL,
  drift_score      smallint NOT NULL CHECK (drift_score BETWEEN 0 AND 100),
  severity         text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  issues           jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_preview  text NOT NULL,
  scanned_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_voice_drift_scanned_desc ON voice_drift_flags (scanned_at DESC);
CREATE INDEX idx_voice_drift_entity ON voice_drift_flags (entity_type, entity_id);

ALTER TABLE voice_drift_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage all voice_drift_flags" ...
```

**No FK to entity tables:** the `entity_id` points at whichever table `entity_type` names. A FK would require three separate nullable columns (one per entity type) — unnecessary churn. If the parent row is hard-deleted, the flag dangles harmlessly; the UI filters dangling rows on read by joining lazily.

## Schema for Claude output (functions/src/ai/schemas.ts)

```ts
export const voiceDriftAssessmentSchema = z.object({
  drift_score: z.number().int().min(0).max(100)
    .describe("0 = perfectly on-brand, 100 = completely off-brand"),
  severity: z.enum(["low", "medium", "high"])
    .describe("low <40, medium 40-69, high >=70 — or use editorial judgment"),
  issues: z.array(z.object({
    issue: z.string().describe("Concrete deviation from the voice profile"),
    suggestion: z.string().describe("One-sentence actionable fix"),
  })).describe("Empty when on-brand, otherwise 1-4 items"),
})
```

## Selection logic — last 20 items

Single Supabase call per entity type, then merge + sort:

```
social_posts   WHERE source_video_id IS NOT NULL
                AND created_at >= now() - interval '7 days'
                ORDER BY created_at DESC LIMIT 20

blog_posts     WHERE source_video_id IS NOT NULL
                AND created_at >= now() - interval '7 days'
                ORDER BY created_at DESC LIMIT 10

newsletters    WHERE source_blog_post_id IS NOT NULL
                AND created_at >= now() - interval '7 days'
                ORDER BY created_at DESC LIMIT 5
```

Then globally cap at 20 items (newest first) — avoids runaway costs when the past week was unusually busy.

## Claude invocation

```ts
const systemPrompt = [
  "You are the DJP Athlete brand voice auditor.",
  "Compare the user-supplied sample against the following voice profile.",
  "Report drift as structured JSON per the provided schema.",
  "",
  "--- VOICE PROFILE ---",
  voiceProfile,
].join("\n")

const userMessage = `Assess this ${entityType} for voice drift:\n\n${sample.content}`

const result = await callAgent(systemPrompt, userMessage, voiceDriftAssessmentSchema, {
  model: MODEL_SONNET,
  maxTokens: 600,
  cacheSystemPrompt: true, // voice profile is reused across all 20 calls
})
```

Cache makes the 20 calls materially cheaper.

## Flag persistence rule

Only insert rows when `severity !== 'low'`. Low-drift entries are noise — the dashboard would be cluttered with minor variations. If the admin ever wants to see low-drift trends, we'd extend the filter later.

Also: **one flag row per (entity_id, scan run)**. No upsert, no dedupe — each Monday's scan adds its own snapshot. History is cheap, and mutating old scans would hide how drift evolved.

## Interfaces

### GET `/api/admin/ai/voice-drift`

Admin-authenticated (mirrors `/api/admin/ai/insights` pattern — not cron-guarded).

**Response:**
```ts
{
  flags: Array<{
    id: string
    entity_type: "social_post" | "blog_post" | "newsletter"
    entity_id: string
    drift_score: number
    severity: "low" | "medium" | "high"
    issues: { issue: string; suggestion: string }[]
    content_preview: string
    scanned_at: string
  }>,
  lastScanAt: string | null
}
```

Default filter: last 7 days, ordered `scanned_at DESC`, limit 50.

### Firebase Function

```ts
export const voiceDriftMonitor = onSchedule(
  {
    schedule: "0 4 * * 1",
    timeZone: "America/Chicago",
    timeoutSeconds: 540,
    memory: "512MiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async () => { /* calls runVoiceDriftMonitor() */ },
)
```

Pure helper: `runVoiceDriftMonitor({ supabaseImpl?, claudeImpl?, now?, limit? })` returns counters `{ scanned, flagged, skippedNoVoiceProfile, errors }`.

## UI — `VoiceDriftCard`

Mounted inside the existing `AiInsightsDashboard`. Simple card:

- Header: "Voice drift — last 7 days" + timestamp of most recent scan.
- Empty state: "No drift flagged this week — voice holding steady."
- Otherwise: list items showing severity badge, entity_type, content preview (first 80 chars), and a drift_score pill. Each item expands on click to show the issue/suggestion pairs.

No mutation controls in this phase. The list is read-only.

## Testing

| Layer | Test | File |
|---|---|---|
| Migration | table/indexes/RLS exist, check constraint rejects bad severity | `__tests__/migrations/00090_voice_drift_flags.test.ts` |
| DAL | insert + list round-trip, severity filter honored | `__tests__/db/voice-drift-flags.test.ts` |
| Zod schema | round-trip valid + invalid inputs | covered by shared schema tests style |
| Function | fixture voice profile + stub Claude returning mixed severities → asserts only non-low rows inserted | `functions/src/__tests__/voice-drift-monitor.test.ts` |
| Route | 401 unauth, 200 happy, returns recent flags from DAL | `__tests__/api/admin/ai/voice-drift.test.ts` |
| Component | renders empty state, renders flag list, expands an item | `__tests__/components/admin/ai-insights/VoiceDriftCard.test.tsx` |

## Env / secrets

Reuses existing:
- `ANTHROPIC_API_KEY` (Firebase secret)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Firebase secrets)
- Auth session (for the admin route)

## Rollout

1. Apply migration 00090 (Supabase MCP).
2. Deploy Next.js (Vercel).
3. `firebase deploy --only functions:voiceDriftMonitor`.
4. Manually invoke once via Cloud Scheduler UI — verify rows land in `voice_drift_flags` when there's recent AI content.
5. Visit `/admin/ai-insights` (or wherever `AiInsightsDashboard` mounts) — card renders.
6. Let the Monday cron take over.
