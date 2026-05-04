import { initializeApp } from "firebase-admin/app"
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore"
import { onSchedule } from "firebase-functions/v2/scheduler"
import { onRequest } from "firebase-functions/v2/https"
import { defineSecret } from "firebase-functions/params"

// Initialize Firebase Admin
initializeApp()

// Define secrets
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY")
const supabaseUrl = defineSecret("SUPABASE_URL")
const supabaseServiceRoleKey = defineSecret("SUPABASE_SERVICE_ROLE_KEY")
const resendApiKey = defineSecret("RESEND_API_KEY")
const assemblyAiApiKey = defineSecret("ASSEMBLYAI_API_KEY")
const appUrl = defineSecret("APP_URL")
const tavilyApiKey = defineSecret("TAVILY_API_KEY")
const internalCronToken = defineSecret("INTERNAL_CRON_TOKEN")
const falKey = defineSecret("FAL_KEY")
const googleAdsDeveloperToken = defineSecret("GOOGLE_ADS_DEVELOPER_TOKEN")
const googleAdsClientId = defineSecret("GOOGLE_ADS_CLIENT_ID")
const googleAdsClientSecret = defineSecret("GOOGLE_ADS_CLIENT_SECRET")
const googleAdsLoginCustomerId = defineSecret("GOOGLE_ADS_LOGIN_CUSTOMER_ID")

const googleAdsSecrets = [
  supabaseUrl,
  supabaseServiceRoleKey,
  googleAdsDeveloperToken,
  googleAdsClientId,
  googleAdsClientSecret,
  googleAdsLoginCustomerId,
  // Plan 1.2: orchestrator POSTs the AI recommendations trigger after each
  // account's sync completes. Needs INTERNAL_CRON_TOKEN + APP_URL.
  internalCronToken,
  appUrl,
]

const allSecrets = [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey]
const sendSecrets = [supabaseUrl, supabaseServiceRoleKey, resendApiKey]

// ─── Program Generation ────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "program_generation"
// Runs the full 3-agent orchestration pipeline

export const programGeneration = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "program_generation") return

    const { handleProgramGeneration } = await import("./program-generation.js")
    await handleProgramGeneration(event.params.jobId)
  },
)

// ─── Program Chat Builder ──────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "program_chat"
// Multi-turn conversation with tool use (list clients, lookup profile, generate program)

export const programChat = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "program_chat") return

    const { handleProgramChat } = await import("./program-chat.js")
    await handleProgramChat(event.params.jobId)
  },
)

// ─── Admin AI Chat ─────────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "admin_chat"
// Streaming admin business intelligence chat

export const adminChat = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "admin_chat") return

    const { handleAdminChat } = await import("./admin-chat.js")
    await handleAdminChat(event.params.jobId)
  },
)

// ─── Client AI Coach ───────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "ai_coach"
// Two-phase: streams coaching text, then structured analysis

// ─── Blog Generation ────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "blog_generation"
// Structured output: generates complete blog post fields via callAgent

export const blogGeneration = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "blog_generation") return

    const { handleBlogGeneration } = await import("./blog-generation.js")
    await handleBlogGeneration(event.params.jobId)
  },
)

// --- Blog Image Generation ---
// Triggered when a new ai_jobs doc is created with type "blog_image_generation"
// Generates hero + inline images via fal.ai, mirrors to Supabase Storage,
// writes alt text, splices <img> tags into the post HTML.

export const blogImageGeneration = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey, falKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "blog_image_generation") return

    const { handleBlogImageGeneration } = await import("./blog-image-generation.js")
    await handleBlogImageGeneration(event.params.jobId)
  },
)

// --- ai_jobs onUpdate listener ---
// Watches all ai_jobs docs and fans out follow-up jobs on terminal-state
// transitions (currently: blog_generation completed -> blog_image_generation).

export const onAiJobCompleted = onDocumentUpdated(
  {
    document: "ai_jobs/{jobId}",
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    const { handleAiJobCompleted } = await import("./on-ai-job-completed.js")
    await handleAiJobCompleted(event)
  },
)

// ─── Newsletter Generation ──────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "newsletter_generation"
// Structured output: generates subject, preview_text, and content HTML

export const newsletterGeneration = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "newsletter_generation") return

    const { handleNewsletterGeneration } = await import("./newsletter-generation.js")
    await handleNewsletterGeneration(event.params.jobId)
  },
)

// ─── Newsletter Send (Batch) ────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "newsletter_send"
// Handles 10k+ subscribers via Resend Batch API with rate limiting
// Runs up to 9 minutes — cannot timeout on serverless API routes

export const newsletterSend = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "512MiB",
    region: "us-central1",
    secrets: sendSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "newsletter_send") return

    const { handleNewsletterSend } = await import("./newsletter-send.js")
    await handleNewsletterSend(event.params.jobId)
  },
)

// ─── Week Generation ────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "week_generation"
// Generates a single new week for an existing assigned program

export const weekGeneration = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "week_generation") return

    const { handleWeekGeneration } = await import("./week-generation.js")
    await handleWeekGeneration(event.params.jobId)
  },
)

export const aiCoach = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "ai_coach") return

    const { handleAiCoach } = await import("./ai-coach.js")
    await handleAiCoach(event.params.jobId)
  },
)

// ─── Video Transcription ──────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "video_transcription"

export const transcribeVideo = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "512MiB",
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey, assemblyAiApiKey, appUrl],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "video_transcription") return

    const { handleVideoTranscription } = await import("./transcribe-video.js")
    await handleVideoTranscription(event.params.jobId)
  },
)

// ─── Video Vision (fallback for silent clips) ─────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "video_vision".
// Downloads the video, samples 8 frames via ffmpeg, calls Claude Vision to
// describe what's happening, writes the description to video_transcripts.

export const videoVision = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "2GiB", // ffmpeg + video buffer can be memory-hungry
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey, anthropicApiKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "video_vision") return

    const { handleVideoVision } = await import("./video-vision.js")
    await handleVideoVision(event.params.jobId)
  },
)

// ─── Image Vision (alt-text + analysis) ───────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "image_vision".
// Downloads the image from Firebase Storage, calls Claude Vision for alt-text
// and a structured analysis, writes both back to media_assets.

export const imageVision = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey, anthropicApiKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "image_vision") return

    const { handleImageVision } = await import("./image-vision.js")
    await handleImageVision(event.params.jobId)
  },
)

// ─── Tavily Research ──────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "tavily_research"

export const tavilyResearch = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    secrets: [tavilyApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "tavily_research") return

    const { handleTavilyResearch } = await import("./tavily-research.js")
    await handleTavilyResearch(event.params.jobId)
  },
)

// ─── Tavily Fact Check ────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "tavily_fact_check"

export const tavilyFactCheck = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 180,
    memory: "512MiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "tavily_fact_check") return

    const { handleTavilyFactCheck } = await import("./tavily-fact-check.js")
    await handleTavilyFactCheck(event.params.jobId)
  },
)

// ─── Social Fanout ─────────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "social_fanout"

export const socialFanout = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "social_fanout") return

    const { handleSocialFanout } = await import("./social-fanout.js")
    await handleSocialFanout(event.params.jobId)
  },
)

// ─── Blog From Video ──────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "blog_from_video"

export const blogFromVideo = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: [anthropicApiKey, tavilyApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "blog_from_video") return

    const { handleBlogFromVideo } = await import("./blog-from-video.js")
    await handleBlogFromVideo(event.params.jobId)
  },
)

// ─── Newsletter From Blog ─────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "newsletter_from_blog"

export const newsletterFromBlog = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 300,
    memory: "512MiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "newsletter_from_blog") return

    const { handleNewsletterFromBlog } = await import("./newsletter-from-blog.js")
    await handleNewsletterFromBlog(event.params.jobId)
  },
)

// ─── Tavily Trending Scan ─────────────────────────────────────────────────────
// Triggered weekly via ai_jobs doc with type "tavily_trending_scan"

export const tavilyTrendingScan = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 300,
    memory: "512MiB",
    region: "us-central1",
    secrets: [anthropicApiKey, tavilyApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "tavily_trending_scan") return

    const { handleTavilyTrendingScan } = await import("./tavily-trending-scan.js")
    await handleTavilyTrendingScan(event.params.jobId)
  },
)

// ─── SEO Enhance ──────────────────────────────────────────────────────────────
// Triggered on blog publish via ai_jobs doc with type "seo_enhance"

export const seoEnhance = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 300,
    memory: "512MiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "seo_enhance") return

    const { handleSeoEnhance } = await import("./seo-enhance.js")
    await handleSeoEnhance(event.params.jobId)
  },
)

// ─── Sync Platform Analytics (nightly) ────────────────────────────────────────
// Scheduled daily at 03:00 UTC. Walks every published social_post, asks the
// Next.js side to invoke the matching plugin's fetchAnalytics(), and writes
// one time-series row per non-empty result to social_analytics. Never throws
// on per-post failure — logs counters and continues.

export const syncPlatformAnalytics = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "UTC",
    timeoutSeconds: 540,
    memory: "512MiB",
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey, internalCronToken, appUrl],
  },
  async () => {
    const { runSyncPlatformAnalytics } = await import("./sync-platform-analytics.js")
    const result = await runSyncPlatformAnalytics()
    console.log("[syncPlatformAnalytics]", result)
  },
)

// ─── Send Weekly Content Report (Friday 5 PM Central) ────────────────────────
// Scheduled weekly. Triggers the Next.js internal route which composes the
// email (WeeklyContentReport component → Resend) and delivers it to
// COACH_EMAIL. Kept thin so the React/render/Resend path stays in one stack.

export const sendWeeklyContentReport = onSchedule(
  {
    schedule: "0 17 * * 5",
    timeZone: "America/Chicago",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const { runSendWeeklyContentReport } = await import("./send-weekly-content-report.js")
    const result = await runSendWeeklyContentReport()
    console.log("[sendWeeklyContentReport]", result)
  },
)

// ─── Send Daily Pulse (Mon-Fri 7 AM Central) ─────────────────────────────────
// Scheduled weekday mornings. Triggers the Next.js internal route which
// composes the Daily Pulse (pipeline counters + Monday trending topics)
// and delivers it to COACH_EMAIL.

export const sendDailyPulse = onSchedule(
  {
    schedule: "0 7 * * 1-5",
    timeZone: "America/Chicago",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const { runSendDailyPulse } = await import("./send-daily-pulse.js")
    const result = await runSendDailyPulse()
    console.log("[sendDailyPulse]", result)
  },
)

// ─── Voice Drift Monitor (Mon 4 AM Central) ──────────────────────────────────
// Weekly scan. Claude audits the last 7 days of AI-generated content against
// prompt_templates.voice_profile and writes non-low severity findings to
// voice_drift_flags. Read by /api/admin/ai/voice-drift → AiInsightsDashboard.

export const voiceDriftMonitor = onSchedule(
  {
    schedule: "0 4 * * 1",
    timeZone: "America/Chicago",
    timeoutSeconds: 540,
    memory: "512MiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async () => {
    const { runVoiceDriftMonitor } = await import("./voice-drift-monitor.js")
    const result = await runVoiceDriftMonitor()
    console.log("[voiceDriftMonitor]", result)
  },
)

// ─── Performance Learning Loop (Mon 3 AM Central) ────────────────────────────
// Weekly aggregation. Picks the top-3 performing published social posts per
// platform from the last 30 days (by engagement on the latest snapshot) and
// writes them to prompt_templates.few_shot_examples. No Claude calls — pure
// aggregation from social_analytics. Runs before voiceDriftMonitor so Monday's
// reports can (in future phases) reflect the refreshed examples.

export const performanceLearningLoop = onSchedule(
  {
    schedule: "0 3 * * 1",
    timeZone: "America/Chicago",
    timeoutSeconds: 300,
    memory: "256MiB",
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey],
  },
  async () => {
    const { runPerformanceLearningLoop } = await import("./performance-learning-loop.js")
    const result = await runPerformanceLearningLoop()
    console.log("[performanceLearningLoop]", result)
  },
)

// ─── runJob (Phase 6 HTTPS dispatcher) ───────────────────────────────────────
// Manual-trigger endpoint hit by the admin's "Run now" buttons via the
// Next.js /api/admin/automation/trigger route. Dispatches to the same pure
// runners the scheduled functions use. All secrets included so any runner
// can fire here.

// ─── Google Ads Sync (Nightly 06:00 UTC) ─────────────────────────────────────
// Walks each active row in google_ads_accounts and mirrors its campaigns,
// ad_groups, keywords, ads, daily metrics (last 7 days), and search terms
// into Supabase. UPSERT-driven; safe to re-run. The 7-day rewrite window
// catches Google Ads' attribution lag without re-fetching the full account.
// Plan 1.2 hooks recommendation generation in after this completes.

export const syncGoogleAds = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "UTC",
    timeoutSeconds: 540,
    memory: "512MiB",
    region: "us-central1",
    secrets: googleAdsSecrets,
  },
  async () => {
    const { runSyncGoogleAds } = await import("./sync-google-ads.js")
    const result = await runSyncGoogleAds()
    console.log("[syncGoogleAds]", result)
  },
)

// ─── AI Ads Agent — Strategist Memo (Wed 13:00 UTC = 06:00 PT) ───────────────
// Plan 1.5g v1. Builds a structured weekly strategist memo from the full
// account snapshot (campaigns, recs, conversions, audiences, pipeline) and
// emails it to COACH_EMAIL. Memo also persists to google_ads_agent_memos
// for the in-app archive at /admin/ads/agent.

export const runAgentStrategist = onSchedule(
  {
    schedule: "0 13 * * 3",
    timeZone: "UTC",
    timeoutSeconds: 540,
    memory: "512MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[runAgentStrategist] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/ads/agent-strategist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[runAgentStrategist]", res.status, body)
    } catch (err) {
      console.error("[runAgentStrategist] failed:", err)
    }
  },
)

// ─── Pipeline Weekly Funnel Report (Tue 13:00 UTC = 06:00 PT) ────────────────
// Plan 1.5f. Visit → signup → booking → payment funnel digest, with delta
// vs prior week, top campaigns by revenue, and a Claude insights paragraph.
// Sent to COACH_EMAIL via Resend.

export const sendWeeklyPipelineReport = onSchedule(
  {
    schedule: "0 13 * * 2",
    timeZone: "UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[sendWeeklyPipelineReport] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/ads/weekly-pipeline-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[sendWeeklyPipelineReport]", res.status, body)
    } catch (err) {
      console.error("[sendWeeklyPipelineReport] failed:", err)
    }
  },
)

// ─── Google Ads Customer Match Audience Sync (Daily 07:00 UTC) ───────────────
// Walks each active google_ads_user_lists row, computes desired membership
// from local source tables (bookers, subscribers), hashes emails, and pushes
// the delta to Google Ads via OfflineUserDataJob. Plan 1.5b. Idempotent —
// the local mirror tracks what we've pushed so subsequent runs only send
// changes.

export const syncCustomerMatchAudiences = onSchedule(
  {
    schedule: "0 7 * * *",
    timeZone: "UTC",
    timeoutSeconds: 540,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[syncCustomerMatchAudiences] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/ads/sync-audiences`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[syncCustomerMatchAudiences]", res.status, body)
    } catch (err) {
      console.error("[syncCustomerMatchAudiences] failed:", err)
    }
  },
)

// ─── Google Ads Conversions Worker (every 15 min) ────────────────────────────
// Drains the durable pending-conversions queue. Click conversions enqueued
// from booking webhooks + value adjustments enqueued from Stripe webhooks.
// Plan 1.5c + 1.5d. Gracefully no-ops when GOOGLE_ADS_DEVELOPER_TOKEN is
// unset (rows stay pending for the cutover).

export const processGoogleAdsConversions = onSchedule(
  {
    schedule: "*/15 * * * *",
    timeZone: "UTC",
    timeoutSeconds: 300,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[processGoogleAdsConversions] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/ads/process-conversions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[processGoogleAdsConversions]", res.status, body)
    } catch (err) {
      console.error("[processGoogleAdsConversions] failed:", err)
    }
  },
)

// ─── Google Ads Weekly Report (Monday 13:00 UTC = 06:00 PT) ──────────────────
// Posts to the Next.js internal route, which builds the digest (totals + top
// campaigns + worst keywords + pending recs + Claude insights paragraph) and
// sends via Resend to COACH_EMAIL. Plan 1.4.

export const sendWeeklyAdsReport = onSchedule(
  {
    schedule: "0 13 * * 1",
    timeZone: "UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[sendWeeklyAdsReport] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/ads/weekly-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[sendWeeklyAdsReport]", res.status, body)
    } catch (err) {
      console.error("[sendWeeklyAdsReport] failed:", err)
    }
  },
)

// ─── Google Ads Sync — manual trigger ────────────────────────────────────────
// Admin "Sync now" button enqueues an ai_jobs doc with type "google_ads_sync";
// this handler picks it up and runs the same pure orchestrator. The Firestore
// doc surface lets the admin UI poll for completion later if needed.

export const googleAdsManualSync = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "512MiB",
    region: "us-central1",
    secrets: googleAdsSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "google_ads_sync") return

    const { runSyncGoogleAds } = await import("./sync-google-ads.js")
    const result = await runSyncGoogleAds()
    console.log("[googleAdsManualSync]", event.params.jobId, result)
  },
)

export const runJob = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey, internalCronToken, appUrl, resendApiKey],
  },
  async (req, res) => {
    const { handleRunJob } = await import("./run-job.js")
    await handleRunJob(req, res)
  },
)
