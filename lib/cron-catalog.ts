// lib/cron-catalog.ts
// Single source of truth for every scheduled Firebase function shipped in
// Phase 5. Used by the admin /admin/automation page to render the catalog +
// "Run now" buttons. When adding or removing a scheduled function, update this
// file AND functions/src/index.ts — they must stay in sync.

export type CronJobName =
  | "sync-platform-analytics"
  | "send-weekly-content-report"
  | "send-daily-pulse"
  | "voice-drift-monitor"
  | "performance-learning-loop"

export interface CronJob {
  name: CronJobName
  label: string
  description: string
  schedule: string
  timezone: string
  humanSchedule: string
  firebaseFunction: string
  phase: string
}

export const CRON_CATALOG: readonly CronJob[] = [
  {
    name: "sync-platform-analytics",
    label: "Platform analytics sync",
    description:
      "Pulls per-post engagement from every connected platform (Facebook, Instagram, YouTube). Writes one time-series snapshot per post to social_analytics.",
    schedule: "0 3 * * *",
    timezone: "UTC",
    humanSchedule: "Nightly at 3:00 AM UTC",
    firebaseFunction: "syncPlatformAnalytics",
    phase: "5a",
  },
  {
    name: "performance-learning-loop",
    label: "Performance learning loop",
    description:
      "Picks the top 3 performing posts per platform from the last 30 days and stores them as few-shot examples on the matching prompt_templates row.",
    schedule: "0 3 * * 1",
    timezone: "America/Chicago",
    humanSchedule: "Mondays at 3:00 AM Central",
    firebaseFunction: "performanceLearningLoop",
    phase: "5f",
  },
  {
    name: "voice-drift-monitor",
    label: "Voice drift monitor",
    description:
      "Claude audits the last 7 days of AI-generated content against the voice_profile template. Non-low severity findings land in voice_drift_flags (visible in AI Insights).",
    schedule: "0 4 * * 1",
    timezone: "America/Chicago",
    humanSchedule: "Mondays at 4:00 AM Central",
    firebaseFunction: "voiceDriftMonitor",
    phase: "5e",
  },
  {
    name: "send-daily-pulse",
    label: "Daily Pulse email",
    description: "Short weekday-morning digest to the coach: pipeline counters + Monday-only Tavily trending topics.",
    schedule: "0 7 * * 1-5",
    timezone: "America/Chicago",
    humanSchedule: "Weekdays at 7:00 AM Central",
    firebaseFunction: "sendDailyPulse",
    phase: "5d",
  },
  {
    name: "send-weekly-content-report",
    label: "Weekly Content Report email",
    description: "Friday afternoon wrap: social KPIs, top 5 posts, fact-check flags. Emailed to COACH_EMAIL.",
    schedule: "0 17 * * 5",
    timezone: "America/Chicago",
    humanSchedule: "Fridays at 5:00 PM Central",
    firebaseFunction: "sendWeeklyContentReport",
    phase: "5c",
  },
] as const
