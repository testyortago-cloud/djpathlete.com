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
  | "auto-blog-generation"

export interface CronJob {
  name: CronJobName
  label: string
  description: string
  schedule: string
  timezone: string
  humanSchedule: string
  firebaseFunction: string
  phase: string
  /**
   * When set, this cron job has a per-job enabled toggle in addition to the
   * global automation_paused kill switch. The value is the system_settings
   * key that holds the boolean. Default value is false (opt-in).
   */
  enabledKey?: string
}

export const CRON_CATALOG: readonly CronJob[] = [
  {
    name: "sync-platform-analytics",
    label: "Social media stats update",
    description:
      "Every night, checks how each of your posts is performing on Facebook, Instagram, and YouTube — views, likes, comments, and shares — and saves the numbers so you can see how content is trending over time.",
    schedule: "0 3 * * *",
    timezone: "UTC",
    humanSchedule: "Every night at 3:00 AM UTC",
    firebaseFunction: "syncPlatformAnalytics",
    phase: "5a",
  },
  {
    name: "performance-learning-loop",
    label: "AI learns from your best posts",
    description:
      "Every Monday, finds your top 3 best-performing posts on each platform over the last 30 days and teaches the AI to use them as examples — so new content keeps sounding like what your audience already loves.",
    schedule: "0 3 * * 1",
    timezone: "America/Chicago",
    humanSchedule: "Every Monday at 3:00 AM Central",
    firebaseFunction: "performanceLearningLoop",
    phase: "5f",
  },
  {
    name: "voice-drift-monitor",
    label: "Brand voice check",
    description:
      "Every Monday, the AI reviews the content generated over the past week and checks that it still sounds like your brand voice. Anything that drifts off-voice shows up on the AI Insights page for your review.",
    schedule: "0 4 * * 1",
    timezone: "America/Chicago",
    humanSchedule: "Every Monday at 4:00 AM Central",
    firebaseFunction: "voiceDriftMonitor",
    phase: "5e",
  },
  {
    name: "send-daily-pulse",
    label: "Daily morning email to coach",
    description:
      "A short weekday-morning email showing how many posts are in the pipeline, plus a fresh list of trending topics every Monday.",
    schedule: "0 7 * * 1-5",
    timezone: "America/Chicago",
    humanSchedule: "Weekday mornings at 7:00 AM Central",
    firebaseFunction: "sendDailyPulse",
    phase: "5d",
  },
  {
    name: "send-weekly-content-report",
    label: "Weekly performance recap email",
    description:
      "A Friday afternoon recap emailed to the coach: how your social media performed this week, your top 5 posts, and anything the AI flagged for fact-checking.",
    schedule: "0 17 * * 5",
    timezone: "America/Chicago",
    humanSchedule: "Every Friday at 5:00 PM Central",
    firebaseFunction: "sendWeeklyContentReport",
    phase: "5c",
  },
  {
    name: "auto-blog-generation",
    label: "Auto-generate blog post (Tue/Thu)",
    description:
      "Every Tuesday and Thursday morning, picks the highest-ranked unused topic from your topic suggestions, runs keyword + content-angle research, and queues an AI blog draft. The draft lands in your blog list — review and publish when ready. OFF by default; flip the toggle to enable.",
    schedule: "0 13 * * 2,4",
    timezone: "UTC",
    humanSchedule: "Every Tuesday and Thursday at 7:00 AM Central (13:00 UTC)",
    firebaseFunction: "(handled by Next.js route + ai_jobs doc trigger)",
    phase: "blog-quality",
    enabledKey: "cron_auto_blog_enabled",
  },
] as const
