# Starter AI Automation — Phase 6: Admin Operations & Handoff (Plan)

**Spec:** [2026-04-21-starter-ai-automation-phase6-code-changes-design.md](../specs/2026-04-21-starter-ai-automation-phase6-code-changes-design.md)

## Steps

1. `lib/cron-catalog.ts` (NEW) — `CRON_CATALOG` array with 5 entries.
2. `supabase/migrations/00092_system_settings.sql` — table + seed `automation_paused=false`.
3. `types/database.ts` — `SystemSetting` interface.
4. `lib/db/system-settings.ts` (NEW) — `getSetting`, `setSetting`, `isAutomationPaused`.
5. `functions/src/lib/system-settings.ts` (NEW) — same helpers for the Firebase side.
6. Add pause check to all 5 pure runners (`sync-platform-analytics`, `send-weekly-content-report`, `send-daily-pulse`, `voice-drift-monitor`, `performance-learning-loop`) — return `{ paused: true, ... }` early when paused.
7. `functions/src/run-job.ts` (NEW) — HTTPS dispatcher.
8. `functions/src/index.ts` — register `runJob` alongside the scheduled functions.
9. `app/api/admin/automation/trigger/route.ts` (NEW) — session-authed dispatcher forwarding to Firebase `runJob`.
10. `app/api/admin/automation/pause/route.ts` (NEW) — session-authed POST to flip `automation_paused`.
11. `app/(admin)/admin/automation/page.tsx` (NEW) — server component catalog + client `PauseToggle` + `RunNowButton`.
12. `components/admin/automation/PauseToggle.tsx` (NEW).
13. `components/admin/automation/RunNowButton.tsx` (NEW).
14. `components/admin/AdminSidebar.tsx` — add "Automation" entry to the AI Automation section.
15. `components/ui/HelpTooltip.tsx` (NEW) + `lib/help-copy.ts` (NEW).
16. Sprinkle `<HelpTooltip>` on: Content Studio pipeline column headers, `<SocialTab>` + `<ContentTab>` KPI labels, `<VoiceDriftCard>` severity legend.
17. `lib/platform-setup-guides.ts` (NEW) + `components/admin/platform-connections/SetupGuide.tsx` (NEW) — 6 short inline guides, expandable under each platform row.
18. `app/(admin)/admin/platform-connections/page.tsx` — inject `<SetupGuide>` under each row.
19. `app/(admin)/admin/content/page.tsx` — add activation banner when zero platforms connected.
20. `.env.example` — consolidate and add comments for `COACH_EMAIL`, `APP_URL`, `INTERNAL_CRON_TOKEN`.
21. Bug sweep: fix `thumbnail_path` in test fixtures (`__tests__/db/video-uploads.test.ts`, content-studio drawer test fixtures, `__tests__/lib/content-studio/drawer-data.test.ts`).
22. Tests per spec §Testing.
23. Apply migration via Supabase MCP.
24. Verification gate (Next tsc, functions tsc, prettier, new vitest suites).

## Out of scope

- Per-function pause toggles.
- Run-history log.
- OAuth flow fixes (those were Phase 2).
- PDF handbook / Loom / training session.
