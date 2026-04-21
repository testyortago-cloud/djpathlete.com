# Starter AI Automation — Phase 5e: Voice Drift Monitor (Plan)

**Spec:** [2026-04-21-starter-ai-automation-phase5e-voice-drift-monitor-design.md](../specs/2026-04-21-starter-ai-automation-phase5e-voice-drift-monitor-design.md)

## Steps

1. `supabase/migrations/00090_voice_drift_flags.sql` — new table + indexes + RLS.
2. `types/database.ts` — append `VoiceDriftFlag` + `VoiceDriftSeverity` types.
3. `lib/db/voice-drift-flags.ts` (NEW) — `insertVoiceDriftFlag`, `listRecentVoiceDriftFlags({ since?, severity?, limit? })`.
4. `functions/src/ai/schemas.ts` — add `voiceDriftAssessmentSchema`.
5. `functions/src/voice-drift-monitor.ts` (NEW) — `runVoiceDriftMonitor(options)` pure helper + the onSchedule trigger in `index.ts`.
6. `functions/src/index.ts` — register `voiceDriftMonitor` onSchedule Mon 04:00 America/Chicago.
7. `app/api/admin/ai/voice-drift/route.ts` (NEW) — GET admin-authed, returns last 7 days of flags.
8. `components/admin/ai-insights/VoiceDriftCard.tsx` (NEW) — client component, fetches + renders.
9. `components/admin/AiInsightsDashboard.tsx` — mount the new card.
10. Tests per spec §Testing.
11. Apply migration via Supabase MCP.
12. Verification gate.

## Out of scope

- Dismiss/acknowledge flows.
- Pipeline-board badges.
- Auto-rewrite of drifted content.
- Low-severity persistence.
- 5f learning loop (next phase).
