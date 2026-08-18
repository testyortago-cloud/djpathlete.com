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
  | "gsc-nightly-sync"
  | "seo-agent-weekly"
  | "outcome-tracker-daily"
  | "ads-outcome-tracker-daily"
  | "session-pack-renewals"
  | "sequence-tick"

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
   * The system_settings key that holds the on/off boolean for this cron's
   * per-job toggle. Independent from the global automation_paused kill
   * switch — the cron skips when EITHER global pause is on OR this toggle
   * is off.
   */
  enabledKey: string
  /**
   * Default value when no system_settings row exists for enabledKey yet.
   * Existing crons default to true (preserves their always-on behavior);
   * new opt-in crons (like auto-blog) default to false.
   */
  defaultEnabled: boolean
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
    enabledKey: "cron_analytics_sync_enabled",
    defaultEnabled: true,
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
    enabledKey: "cron_performance_loop_enabled",
    defaultEnabled: true,
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
    enabledKey: "cron_voice_drift_enabled",
    defaultEnabled: true,
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
    enabledKey: "cron_daily_pulse_enabled",
    defaultEnabled: true,
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
    enabledKey: "cron_weekly_report_enabled",
    defaultEnabled: true,
  },
  {
    name: "auto-blog-generation",
    label: "Auto-generate blog post (Tue/Thu)",
    description:
      "Every Tuesday and Thursday morning, picks the highest-ranked unused topic from your topic suggestions, runs keyword + content-angle research, and queues an AI blog draft. The draft lands in your blog list — review and publish when ready. OFF by default; flip the toggle to enable.",
    schedule: "0 13 * * 2,4",
    timezone: "UTC",
    humanSchedule: "Every Tuesday and Thursday at 8:00 AM EST / 9:00 AM EDT (13:00 UTC)",
    firebaseFunction: "(handled by Next.js route + ai_jobs doc trigger)",
    phase: "blog-quality",
    enabledKey: "cron_auto_blog_enabled",
    defaultEnabled: false,
  },
  {
    name: "gsc-nightly-sync",
    label: "Sync Google Search Console nightly",
    description:
      "Every night, pulls the last three days of search performance from Google Search Console — queries, pages, impressions, clicks, and average position — so the SEO agent has fresh data to reason over.",
    schedule: "15 3 * * *",
    timezone: "UTC",
    humanSchedule: "Every night at 3:15 AM UTC",
    firebaseFunction: "gscSyncCron",
    phase: "seo-agent-1",
    enabledKey: "cron_gsc_sync_enabled",
    defaultEnabled: false,
  },
  {
    name: "seo-agent-weekly",
    label: "SEO Agent weekly run",
    description:
      "Every Sunday afternoon, the SEO agent reviews your Google Search Console data, blog inventory, and prior decisions, then picks the two highest-leverage actions for the week — a new post, a refresh, an internal-link sweep, or a human flag. Skips silently until GSC has 28+ days of data.",
    schedule: "0 14 * * 0",
    timezone: "UTC",
    humanSchedule: "Every Sunday at 2:00 PM UTC",
    firebaseFunction: "seoAgentCron",
    phase: "seo-agent-4",
    enabledKey: "cron_seo_agent_enabled",
    defaultEnabled: false,
  },
  {
    name: "outcome-tracker-daily",
    label: "SEO outcome tracker (daily)",
    description:
      "Every morning, finds SEO agent decisions made 14+ days ago and measures their outcomes — clicks before vs after, position before vs after — so the agent learns which tactics are working on your site.",
    schedule: "15 4 * * *",
    timezone: "UTC",
    humanSchedule: "Every morning at 4:15 AM UTC",
    firebaseFunction: "outcomeTrackerCron",
    phase: "seo-agent-5",
    enabledKey: "cron_outcome_tracker_enabled",
    defaultEnabled: false,
  },
  {
    name: "ads-outcome-tracker-daily",
    label: "Ads outcome tracker (daily)",
    description:
      "Every morning, finds ads agent memos whose 14-day measurement window has closed and computes their outcomes — CTR, CPC, conversions, and spend before vs after — so the agent learns which paid-media tactics are working.",
    schedule: "30 4 * * *",
    timezone: "UTC",
    humanSchedule: "Every morning at 4:30 AM UTC",
    firebaseFunction: "adsOutcomeTrackerCron",
    phase: "ads-agent-5",
    enabledKey: "cron_ads_outcome_tracker_enabled",
    defaultEnabled: false,
  },
  {
    name: "session-pack-renewals",
    label: "Session pack renewal reminders",
    description:
      "Every morning, finds in-person session packs that are running low, empty, or expiring soon and nudges the client (email + in-app) and you, so renewals get sorted before they run out. Requires Session Packs to be on.",
    schedule: "0 9 * * *",
    timezone: "UTC",
    humanSchedule: "Every morning at 9:00 AM UTC",
    firebaseFunction: "packRenewalScanCron",
    phase: "session-packs",
    enabledKey: "cron_pack_renewals_enabled",
    defaultEnabled: false,
  },
  {
    name: "sequence-tick",
    label: "Follow-up sequences",
    description:
      "Every five minutes, checks which leads are due their next follow-up email and sends it — respecting quiet hours in their timezone, a daily limit of one message per person, and anyone who has unsubscribed.",
    schedule: "*/5 * * * *",
    timezone: "UTC",
    humanSchedule: "Every 5 minutes",
    firebaseFunction: "sequenceTickCron",
    phase: "lead-engine-1b",
    enabledKey: "cron_sequence_tick_enabled",
    defaultEnabled: false,
  },
] as const
