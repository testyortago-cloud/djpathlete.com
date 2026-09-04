import { initializeApp } from "firebase-admin/app"
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore"
import { onSchedule } from "firebase-functions/v2/scheduler"
import { onRequest } from "firebase-functions/v2/https"
import { onObjectFinalized } from "firebase-functions/v2/storage"
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
const coachEmail = defineSecret("COACH_EMAIL")
const resendFromEmail = defineSecret("RESEND_FROM_EMAIL")
const brollWebhookSecret = defineSecret("BROLL_WEBHOOK_SECRET")

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

const allSecrets = [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey, resendApiKey, coachEmail, resendFromEmail]
// resendFromEmail is REQUIRED here even though this list is otherwise minimal.
// A secret that is declared but not bound to a function is simply absent from
// process.env inside it, so `?? "<default>"` silently wins — newsletterSend sent
// every batch from the unverified apex for exactly this reason, and no value in
// the secret store could have fixed it.
const sendSecrets = [supabaseUrl, supabaseServiceRoleKey, resendApiKey, resendFromEmail]

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

// ─── Program From Excel ─────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "program_from_excel"
// Interprets an uploaded spreadsheet, resolves exercises, and builds a program

export const programFromExcel = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "program_from_excel") return

    const { handleProgramFromExcel } = await import("./program-from-excel.js")
    await handleProgramFromExcel(event.params.jobId)
  },
)

// ─── Statement Import ───────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "statement_import"
// AI Bookkeeper Phase 2: categorizes/structures an uploaded bank/Venmo
// statement (CSV or PDF) into ledger-ready rows for review.

export const statementImport = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "statement_import") return

    const { handleStatementImport } = await import("./statement-import.js")
    await handleStatementImport(event.params.jobId)
  },
)

// ─── Receipt Scan ───────────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "receipt_scan"
// AI Bookkeeper Phase 3: downloads a receipt from the private bucket and
// extracts vendor/amount/date/category. Images are sharp-resized for vision;
// PDF invoices skip sharp and go to Claude as a document block.

export const receiptScan = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "receipt_scan") return

    const { handleReceiptScan } = await import("./receipt-scan.js")
    await handleReceiptScan(event.params.jobId)
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

// ─── Blog Refresh ───────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "blog_refresh"
// Loads existing blog_posts row, regenerates with iteration context, UPDATEs
// the row in place, forces status="draft" for coach review.

export const blogRefresh = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "blog_refresh") return

    const { handleBlogRefresh } = await import("./blog-refresh.js")
    await handleBlogRefresh(event.params.jobId)
  },
)

// ─── Internal Link Sweep ────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "internal_link_sweep"
// For a target post, iterates candidate posts, asks Claude per-candidate for
// a natural anchor, splices up to 2 successful inbound link insertions.

export const internalLinkSweep = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "internal_link_sweep") return

    const { handleInternalLinkSweep } = await import("./internal-link-sweep.js")
    await handleInternalLinkSweep(event.params.jobId)
  },
)

// ─── SEO Agent Run ──────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "seo_agent_run".
// Runs the four-step orchestration (gather → reason → execute → remember).

export const seoAgent = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "seo_agent_run") return

    const { handleSeoAgent } = await import("./seo-agent.js")
    await handleSeoAgent(event.params.jobId)
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

// --- Split Reel: b-roll generation (select moments -> fal queue submit) ---
export const brollGeneration = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey, falKey, assemblyAiApiKey, appUrl, brollWebhookSecret],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "broll_generation") return

    const { handleBrollGeneration } = await import("./broll-generation.js")
    await handleBrollGeneration(event.params.jobId)
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
    // Supabase secrets for the handler's chains (e.g. chainSocialFanout).
    secrets: [supabaseUrl, supabaseServiceRoleKey],
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

// 540s is the HARD CEILING for event-triggered (Eventarc) gen2 functions — only
// HTTP functions can go to 3600s, and deploy rejects anything higher here. So the
// fix for over-long runs is not more time; it is failing cleanly inside the time
// we have. WEEK_GENERATION_BUDGET_MS (450s) blows first and leaves ~90s for the
// catch path to record status="failed" and email the coach. Previously the
// platform kill landed first, skipping the catch and wedging the job forever.
//
// If heavy runs (deep programs + a curated exercise pool) genuinely need more
// than 7.5 min, the trigger has to move to Cloud Tasks (onTaskDispatched, 1800s)
// — raising timeoutSeconds here cannot work.
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

// ─── Captioned Cut Render ────────────────────────────────────────────────────
// Triggered when an ai_jobs doc is created with type "video_caption_render".
// Claims the job and launches the captioned-cut Cloud Run Job.
export const captionRender = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "video_caption_render") return
    const { handleCaptionRenderTrigger } = await import("./caption-render-trigger.js")
    await handleCaptionRenderTrigger(event.params.jobId)
  },
)

// Triggered when an ai_jobs doc is created with type "split_reel_render".
// Claims the job and launches the SAME render-worker Cloud Run Job with
// RENDER_MODE=split_reel so the worker takes the Split Reel path.
export const splitReelRender = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "split_reel_render") return
    const { handleSplitReelRender } = await import("./split-reel-render-trigger.js")
    await handleSplitReelRender(event.params.jobId)
  },
)

// ─── Transcode Form-Review Voice Messages ─────────────────────────────────────
// Triggered when a new audio object lands in form-review-audio/. Chrome on PC
// records voice messages as audio/webm;codecs=opus — which iOS Safari cannot
// decode (no Opus/WebM support on iOS). We transcode webm → AAC in mp4
// container so the audio plays on every browser, then rewrite the attachment
// row to point at the new file.

export const transcodeFormReviewAudioFn = onObjectFinalized(
  {
    bucket: undefined, // default bucket
    timeoutSeconds: 120,
    memory: "1GiB", // ffmpeg's webm decoder + AAC encoder fits comfortably
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const filePath = event.data.name
    const contentType = event.data.contentType ?? ""

    // Only act on objects under form-review-audio/ that are still webm.
    if (!filePath.startsWith("form-review-audio/")) return
    if (!filePath.endsWith(".webm") && !contentType.startsWith("audio/webm")) return

    const { transcodeFormReviewAudio } = await import("./transcode-form-review-audio.js")
    await transcodeFormReviewAudio(filePath, contentType)
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

// ─── Image Caption Generation ─────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "image_caption_generation".

export const imageCaptionGeneration = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 300,
    memory: "1GiB",
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey, anthropicApiKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "image_caption_generation") return

    const { handleImageCaptionGeneration } = await import("./image-caption-generation.js")
    await handleImageCaptionGeneration(event.params.jobId)
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

// ─── Topic Research Scan ──────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "topic_research_scan".
// On-demand version of the weekly trending scan, scoped to a single admin-typed
// topic. Writes candidate topics into the job result for the admin to preview
// and select — does NOT write to content_calendar directly.

export const topicResearchScan = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    secrets: [anthropicApiKey, tavilyApiKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "topic_research_scan") return

    const { handleTopicResearchScan } = await import("./topic-research-scan.js")
    await handleTopicResearchScan(event.params.jobId)
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

// ─── Social Agent (autonomous) ────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "social_agent_run".
// Picks a blog topic and drafts a LinkedIn post via writer + reviewer agents.
// Output is a draft social_post that lands in the admin approval queue.

export const socialAgent = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "social_agent_run") return

    const { handleSocialAgentRun } = await import("./social-agent.js")
    await handleSocialAgentRun(event.params.jobId)
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
    const { getSupabase } = await import("./lib/supabase.js")
    const { logCronStart, logCronEnd } = await import("./lib/cron-runs.js")
    const { runSyncGoogleAds } = await import("./sync-google-ads.js")

    // syncGoogleAds has been in the health scanner's EXPECTED_CRONS all along,
    // but never wrote a cron_runs row — and the scanner skips crons with no
    // recorded success ("never run yet — don't false-alert"), so it was
    // invisible by construction. Without this the watchdog cannot ever fire.
    const supabase = getSupabase()
    const runId = await logCronStart(supabase, "syncGoogleAds")
    try {
      const result = await runSyncGoogleAds()
      await logCronEnd(supabase, runId, "success", result as unknown as Record<string, unknown>)
      console.log("[syncGoogleAds]", result)
    } catch (err) {
      await logCronEnd(supabase, runId, "failed", { message: (err as Error).message })
      throw err
    }
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
    // supabaseUrl/ServiceRoleKey are required by the getSupabase() call below.
    // They were missing when cron_runs logging was added here on 2026-07-14,
    // and Firebase only injects secrets a function declares — so getSupabase()
    // threw on the first statement, before logCronStart could record anything.
    // The function died silently every Wednesday for five weeks and the health
    // scanner could not see it, because "no rows at all" was its blind spot.
    secrets: [supabaseUrl, supabaseServiceRoleKey, internalCronToken, appUrl],
  },
  async () => {
    const { getSupabase } = await import("./lib/supabase.js")
    const { logCronStart, logCronEnd } = await import("./lib/cron-runs.js")
    const supabase = getSupabase()
    const runId = await logCronStart(supabase, "runAgentStrategist")

    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      const message = "APP_URL or INTERNAL_CRON_TOKEN missing — abort"
      console.error(`[runAgentStrategist] ${message}`)
      await logCronEnd(supabase, runId, "failed", { message })
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/ads/agent-strategist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      // Previously this neither checked res.ok nor rethrew, so a 500 from the
      // route logged to console and the run still counted as healthy. A memo
      // blocked by preflight is a *successful run with a degraded outcome* —
      // record the reasons in detail rather than throwing, so a permanently
      // stale memo is visible in /admin/insights instead of only on screen.
      if (!res.ok) {
        await logCronEnd(supabase, runId, "failed", { http_status: res.status, ...body })
        throw new Error(`agent-strategist returned HTTP ${res.status}`)
      }
      await logCronEnd(supabase, runId, "success", { http_status: res.status, ...body })
      console.log("[runAgentStrategist]", res.status, body)
    } catch (err) {
      await logCronEnd(supabase, runId, "failed", { message: (err as Error).message })
      console.error("[runAgentStrategist] failed:", err)
      throw err
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

// ─── Auto-Generate Blog Post (Tue/Thu 13:00 UTC) ─────────────────────────────
// Replaces .github/workflows/auto-blog-cron.yml. Hits the Next.js
// /api/admin/internal/auto-blog route, which enqueues a blog_generation
// ai_job (subject to automation_paused + cron_auto_blog_enabled gates).
// 13:00 UTC = 7 AM Central (winter) / 8 AM Central (summer).

export const autoBlogCron = onSchedule(
  {
    schedule: "0 13 * * 2,4",
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
      console.error("[autoBlogCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/auto-blog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[autoBlogCron]", res.status, body)
    } catch (err) {
      console.error("[autoBlogCron] failed:", err)
    }
  },
)

// ─── Publish Due Posts (every 5 min) ─────────────────────────────────────────
// Replaces .github/workflows/publish-due-cron.yml. Triggers the publish-due
// route which promotes any social_post rows whose scheduled_at <= now from
// "scheduled" to "published".

export const publishDuePostsCron = onSchedule(
  {
    schedule: "*/5 * * * *",
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
      console.error("[publishDuePostsCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/publish-due`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[publishDuePostsCron]", res.status, body)
    } catch (err) {
      console.error("[publishDuePostsCron] failed:", err)
    }
  },
)

// ─── Content Schedule (every 5 min) ──────────────────────────────────────────
// Publishes blog posts and sends newsletters whose scheduled_at has arrived.
// Sibling of publishDuePostsCron, which does the same for social posts.

export const contentScheduleCron = onSchedule(
  {
    schedule: "*/5 * * * *",
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
      console.error("[contentScheduleCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/content-schedule-due`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[contentScheduleCron]", res.status, body)
    } catch (err) {
      console.error("[contentScheduleCron] failed:", err)
    }
  },
)

// ─── Tavily Trending Cron (Mon 06:00 UTC) ────────────────────────────────────
// Replaces .github/workflows/tavily-trending-cron.yml. POSTs to the Next.js
// /api/admin/internal/tavily-trending route, which enqueues a
// tavily_trending_scan ai_job (handled by tavilyTrendingScan above).

export const tavilyTrendingCron = onSchedule(
  {
    schedule: "0 6 * * 1",
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
      console.error("[tavilyTrendingCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/tavily-trending`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[tavilyTrendingCron]", res.status, body)
    } catch (err) {
      console.error("[tavilyTrendingCron] failed:", err)
    }
  },
)

// ─── SEO Agent Weekly (Sun 14:00 UTC) ───────────────────────────────────────
// Calls /api/admin/internal/seo-agent which enqueues a seo_agent_run ai_job.
// Subject to automation_paused + cron_seo_agent_enabled gates inside the route.

export const seoAgentCron = onSchedule(
  {
    schedule: "0 14 * * 0",
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
      console.error("[seoAgentCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/seo-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[seoAgentCron]", res.status, body)
    } catch (err) {
      console.error("[seoAgentCron] failed:", err)
    }
  },
)

// ─── SEO Outcome Tracker (Daily 04:00 UTC) ──────────────────────────────────
// Calls /api/admin/internal/outcome-tracker which backfills outcome_metrics
// for seo_agent_memos older than 14 days, closing the agent's learning loop.
// Subject to automation_paused + cron_outcome_tracker_enabled gates inside
// the route (defaults to false — opt-in once Phase 5 is deployed).

export const outcomeTrackerCron = onSchedule(
  {
    // 04:15 UTC (staggered from 04:00 to separate from voiceDriftMonitor's
    // Monday firing).
    schedule: "15 4 * * *",
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
      console.error("[outcomeTrackerCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/outcome-tracker`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[outcomeTrackerCron]", res.status, body)
    } catch (err) {
      console.error("[outcomeTrackerCron] failed:", err)
    }
  },
)

// ─── Ads Agent Outcome Tracker (Daily 04:30 UTC) ─────────────────────────────
// Calls /api/admin/internal/ads/outcome-tracker which, for each
// google_ads_agent_memos row with outcome_status='pending' and created_at
// older than 14 days, measures per-action before/after deltas, tags
// attribution as clean or ambiguous, persists outcome_metrics, and flips
// outcome_status to 'measured' once any action is measurable (or all are
// past the 30-day expiry window). Closes the ads-agent learning loop.
// Staggered to 04:30 UTC so it doesn't collide with the SEO
// outcomeTrackerCron at 04:15.

export const adsOutcomeTrackerCron = onSchedule(
  {
    schedule: "30 4 * * *",
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
      console.error("[adsOutcomeTrackerCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/ads/outcome-tracker`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[adsOutcomeTrackerCron]", res.status, body)
    } catch (err) {
      console.error("[adsOutcomeTrackerCron] failed:", err)
    }
  },
)

// ─── GSC Nightly Sync (03:00 UTC daily) ──────────────────────────────────────
// POSTs to the Next.js /api/admin/internal/gsc-sync route. Subject to
// automation_paused + cron_gsc_sync_enabled gates inside the route
// (cron_gsc_sync_enabled defaults to false — flip on from /admin/automation
// once GSC is connected).

export const gscSyncCron = onSchedule(
  {
    // 03:15 UTC (staggered from 03:00 to separate from syncPlatformAnalytics +
    // performanceLearningLoop in ops dashboards).
    schedule: "15 3 * * *",
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
      console.error("[gscSyncCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/gsc-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[gscSyncCron]", res.status, body)
    } catch (err) {
      console.error("[gscSyncCron] failed:", err)
    }
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

// ─── Performance Critic (ai_jobs handler) ────────────────────────────────────
export const performanceCritic = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "512MiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "performance_critic_run") return
    const { runPerformanceCritic } = await import("./performance-critic.js")
    const result = await runPerformanceCritic()
    console.log("[performanceCritic]", event.params.jobId, result)
    const { getFirestore, FieldValue } = await import("firebase-admin/firestore")
    await getFirestore().collection("ai_jobs").doc(event.params.jobId).update({
      status: "completed",
      result,
      updatedAt: FieldValue.serverTimestamp(),
    })
  },
)

// ─── Chief Strategist (ai_jobs handler) ──────────────────────────────────────
export const chiefStrategist = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "512MiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "chief_strategist_run") return
    const { runChiefStrategist } = await import("./chief-strategist.js")
    const result = await runChiefStrategist()
    console.log("[chiefStrategist]", event.params.jobId, result)
    const { getFirestore, FieldValue } = await import("firebase-admin/firestore")
    await getFirestore().collection("ai_jobs").doc(event.params.jobId).update({
      status: "completed",
      result,
      updatedAt: FieldValue.serverTimestamp(),
    })
  },
)

// ─── Performance Critic Cron (Sat 13:00 UTC) ────────────────────────────────
export const performanceCriticCron = onSchedule(
  {
    schedule: "0 13 * * 6",
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
      console.error("[performanceCriticCron] APP_URL or INTERNAL_CRON_TOKEN missing")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/strategy-critic`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      console.log("[performanceCriticCron]", res.status, await res.json().catch(() => ({})))
    } catch (err) {
      console.error("[performanceCriticCron] failed:", err)
    }
  },
)

// ─── Chief Strategist Cron (Sun 10:00 UTC) ───────────────────────────────────
export const chiefStrategistCron = onSchedule(
  {
    schedule: "0 10 * * 0",
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
      console.error("[chiefStrategistCron] APP_URL or INTERNAL_CRON_TOKEN missing")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/strategy-chief`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      console.log("[chiefStrategistCron]", res.status, await res.json().catch(() => ({})))
    } catch (err) {
      console.error("[chiefStrategistCron] failed:", err)
    }
  },
)

// ─── Social Outcome Tracker (ai_jobs handler) ────────────────────────────────
export const socialOutcomeTracker = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 300,
    memory: "256MiB",
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "social_outcome_tracker_run") return
    const { runSocialOutcomeTracker } = await import("./social-outcome-tracker.js")
    const result = await runSocialOutcomeTracker()
    console.log("[socialOutcomeTracker]", event.params.jobId, result)
    const { getFirestore, FieldValue } = await import("firebase-admin/firestore")
    await getFirestore().collection("ai_jobs").doc(event.params.jobId).update({
      status: "completed",
      result,
      updatedAt: FieldValue.serverTimestamp(),
    })
  },
)

// ─── Social Agent Cron (Tue + Thu 13:00 UTC) ─────────────────────────────────
export const socialAgentCron = onSchedule(
  {
    schedule: "0 13 * * 2,4",
    timeZone: "UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) return
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/social-agent-cron`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      console.log("[socialAgentCron]", res.status, await res.json().catch(() => ({})))
    } catch (err) {
      console.error("[socialAgentCron] failed:", err)
    }
  },
)

// ─── Inbox SLA (Mon-Fri 06:00 UTC) ───────────────────────────────────────────
// Plan: docs/superpowers/plans/2026-05-16-broader-automations.md Phase 5.
// Runs an hour before Daily Pulse (07:00 Central) so the latest inbox-health
// snapshot is available for the email.

// ─── Funnel run-window closer (daily 04:00 UTC) ──────────────────────────────
// Takes offline any published funnel whose run window has closed and whose
// owner ticked "take the funnel offline when the run ends".
//
// THE ONLY SCHEDULED JOB HERE THAT CHANGES WHAT A VISITOR SEES — the rest write
// snapshot rows. Gated by `cron_funnel_window_enabled` in system_settings,
// which ships FALSE; the route enforces that, not this file.

export const funnelWindowCron = onSchedule(
  {
    schedule: "0 4 * * *",
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
      console.error("[funnelWindowCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/funnel-window`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[funnelWindowCron]", res.status, body)
    } catch (err) {
      console.error("[funnelWindowCron] failed:", err)
    }
  },
)

// ─── Lead Engine sequence tick (every 5 min, UTC) ───────────────────────────
// Stage 1b: claims due sequence_runs and executes their next step (send an
// email, wait, branch, exit, etc). Ships OFF by default via
// cron_sequence_tick_enabled — the route no-ops until a human switches it on.
// Spec: docs/superpowers/specs/2026-08-18-lead-engine-stage1b-sequence-engine-design.md §4.

export const sequenceTickCron = onSchedule(
  {
    schedule: "*/5 * * * *",
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
      console.error("[sequenceTickCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/sequence-tick`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[sequenceTickCron]", res.status, body)
    } catch (err) {
      console.error("[sequenceTickCron] failed:", err)
    }
  },
)

// ─── Lead Engine pipeline reconciler (hourly, UTC) ──────────────────────────
// Stage 1c: a hook that throws AFTER its booking/payment row is already
// written loses a board card permanently — this catches it up. Ships OFF by
// default via cron_pipeline_reconcile_enabled.
// Spec: docs/superpowers/specs/2026-08-19-lead-engine-stage1c-pipeline-design.md §6.

export const pipelineReconcileCron = onSchedule(
  {
    schedule: "20 * * * *",
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
      console.error("[pipelineReconcileCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/pipeline-reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[pipelineReconcileCron]", res.status, body)
    } catch (err) {
      console.error("[pipelineReconcileCron] failed:", err)
    }
  },
)

export const inboxSlaCron = onSchedule(
  {
    schedule: "0 6 * * 1-5",
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
      console.error("[inboxSlaCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/inbox-sla`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[inboxSlaCron]", res.status, body)
    } catch (err) {
      console.error("[inboxSlaCron] failed:", err)
    }
  },
)

// ─── Content → Revenue Attribution (Sun 22:00 UTC) ──────────────────────────
// Plan: docs/superpowers/plans/2026-05-16-broader-automations.md Phase 4.
// Joins blog_posts × GSC × marketing_attribution × payments. Runs after the
// Friday content report but before chiefStrategistCron at Sun 10:00 — wait,
// 22:00 UTC Sunday is AFTER 10:00 UTC Sunday so chief won't see this week's
// row until next week's brief. Acceptable: data lag of 7d.

export const contentAttributionCron = onSchedule(
  {
    schedule: "0 22 * * 0",
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
      console.error("[contentAttributionCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/content-attribution`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[contentAttributionCron]", res.status, body)
    } catch (err) {
      console.error("[contentAttributionCron] failed:", err)
    }
  },
)

// ─── Automation Health Watchdog (daily 08:00 UTC) ───────────────────────────
// Plan: docs/superpowers/plans/2026-05-16-broader-automations.md Phase 3.
// Scans Firestore ai_jobs + Supabase cron_runs, persists an
// automation_health_snapshots row. Emails an alert when severity=critical.

export const automationHealthCron = onSchedule(
  {
    schedule: "0 8 * * *",
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
      console.error("[automationHealthCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/automation-health`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[automationHealthCron]", res.status, body)
    } catch (err) {
      console.error("[automationHealthCron] failed:", err)
    }
  },
)

// ─── Revenue Digest (Mon 13:00 UTC = 06:00 PT) ───────────────────────────────
// Plan: docs/superpowers/plans/2026-05-16-broader-automations.md Phase 2.
// POSTs to /api/admin/internal/revenue-digest which aggregates one week of
// subscriptions + payments into a revenue_snapshots row and emails the result
// to COACH_EMAIL. Subject to automation_paused + cron_revenue_digest_enabled
// gates (defaults to false — flip on from /admin/automation once verified).

export const revenueDigestCron = onSchedule(
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
      console.error("[revenueDigestCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/revenue-digest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[revenueDigestCron]", res.status, body)
    } catch (err) {
      console.error("[revenueDigestCron] failed:", err)
    }
  },
)

// ─── Client Risk Scan (daily 05:00 UTC) ──────────────────────────────────────
// Plan: docs/superpowers/plans/2026-05-16-broader-automations.md Phase 1.
// POSTs to /api/admin/internal/client-risk-scan which walks active clients,
// collects engagement signals, scores risk, and upserts one row per client
// into client_engagement_snapshots. Read by /admin/insights/client-risk and
// the Daily Pulse email. Subject to automation_paused +
// cron_client_risk_scan_enabled gates inside the route (defaults to false —
// flip on from /admin/automation once verified).

export const clientRiskScanCron = onSchedule(
  {
    schedule: "0 5 * * *",
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
      console.error("[clientRiskScanCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/client-risk-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[clientRiskScanCron]", res.status, body)
    } catch (err) {
      console.error("[clientRiskScanCron] failed:", err)
    }
  },
)

// ─── Session Pack Renewal Scan (daily 09:00 UTC) ─────────────────────────────
// Plan: docs/superpowers/plans/2026-06-13-session-packs.md (Phase 1).
// POSTs to /api/admin/internal/pack-renewals which finds low/empty/expiring
// session packs and nudges the client (email + in-app) and the coach. Subject to
// automation_paused + cron_pack_renewals_enabled gates inside the route
// (defaults to false — flip on from /admin/automation once verified).

export const packRenewalScanCron = onSchedule(
  {
    schedule: "0 9 * * *",
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
      console.error("[packRenewalScanCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/pack-renewals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[packRenewalScanCron]", res.status, body)
    } catch (err) {
      console.error("[packRenewalScanCron] failed:", err)
    }
  },
)

// ─── Session No-Show Scan Cron (hourly) ──────────────────────────────────────
export const sessionNoShowScanCron = onSchedule(
  {
    schedule: "0 * * * *",
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
      console.error("[sessionNoShowScanCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/session-no-show`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[sessionNoShowScanCron]", res.status, body)
    } catch (err) {
      console.error("[sessionNoShowScanCron] failed:", err)
    }
  },
)

// ─── Social Outcome Tracker Cron (daily 04:45 UTC) ───────────────────────────
export const socialOutcomeTrackerCron = onSchedule(
  {
    schedule: "45 4 * * *",
    timeZone: "UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) return
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/social-outcome-tracker`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      console.log("[socialOutcomeTrackerCron]", res.status, await res.json().catch(() => ({})))
    } catch (err) {
      console.error("[socialOutcomeTrackerCron] failed:", err)
    }
  },
)

// ─── Audit Log Retention (daily 03:00 UTC) ───────────────────────────────────
// Task 5.1 of the Audit Logs plan. Prunes audit_logs older than
// system_settings.audit_log_retention_days (default 365). Gated by
// system_settings.cron_audit_log_retention_enabled (default false). Talks to
// Supabase directly via the service-role client — no Next.js round-trip.
//
// 03:00 UTC overlaps with syncPlatformAnalytics; the two operate on disjoint
// tables and both are short, so collision is fine.

export const auditLogRetentionCron = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "UTC",
    timeoutSeconds: 300,
    memory: "256MiB",
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey],
  },
  async () => {
    const { getSupabase } = await import("./lib/supabase.js")
    const { logCronStart, logCronEnd } = await import("./lib/cron-runs.js")
    const { pruneAuditLogs } = await import("./lib/audit-logs.js")

    const supabase = getSupabase()

    const { data: enabledRow } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "cron_audit_log_retention_enabled")
      .single()
    if (enabledRow?.value !== true) {
      console.log("[auditLogRetentionCron] disabled via flag, skipping")
      return
    }

    const { data: daysRow } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "audit_log_retention_days")
      .single()
    const days = typeof daysRow?.value === "number" ? daysRow.value : 365

    const runId = await logCronStart(supabase, "auditLogRetentionCron")
    try {
      const deleted = await pruneAuditLogs(supabase, days)
      await logCronEnd(supabase, runId, "success", { deleted, days })
      console.log(`[auditLogRetentionCron] deleted ${deleted} rows older than ${days}d`)
    } catch (err) {
      await logCronEnd(supabase, runId, "failed", { message: (err as Error).message })
      throw err
    }
  },
)

// ─── Contact Timeline Retention (daily 03:30 UTC) ───────────────────────────
// Lead Engine Stage 1b, Task 11. contact_timeline_events.metadata carries raw
// funnel payload PII (names, emails, whatever the form collected) with no
// retention. Scrubs metadata to {} and stamps scrubbed_at on rows older than
// system_settings.contact_timeline_retention_days (default 365) — the row
// itself (kind, source, occurred_at) survives; this scrubs, it does not
// delete. Gated by system_settings.cron_contact_timeline_retention_enabled,
// default TRUE — unlike most crons in this stage, on purpose: same reasoning
// as cron_audit_log_retention_enabled, unbounded PII accumulation is the risk
// being managed. Talks to Supabase directly via the service-role client — no
// Next.js round-trip. (A Next.js route also exists at
// /api/admin/internal/contact-timeline-retention purely for the admin
// "Run now" button — see lib/cron-catalog.ts / VERCEL_ROUTE_JOBS.)
//
// 03:30 UTC runs after auditLogRetentionCron (03:00) and gscSyncCron (03:15);
// all three operate on disjoint tables, so collision is fine.

export const contactTimelineRetentionCron = onSchedule(
  {
    schedule: "30 3 * * *",
    timeZone: "UTC",
    timeoutSeconds: 300,
    memory: "256MiB",
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey],
  },
  async () => {
    const { getSupabase } = await import("./lib/supabase.js")
    const { logCronStart, logCronEnd } = await import("./lib/cron-runs.js")
    const { scrubContactTimeline } = await import("./lib/contact-timeline-retention.js")

    const supabase = getSupabase()

    // Global kill switch. The manual "Run now" path (the Next.js internal
    // route) gates through isCronSkipped(), which checks BOTH this global
    // pause AND the per-cron flag below — so the schedule must check both
    // too, or "pause all automation" silently misses the nightly run while
    // still stopping a manual click. Do not remove this in the name of
    // "simplifying to match auditLogRetentionCron" — that cron has no
    // manual counterpart, so its equivalent gap can never surface as a
    // visible disagreement between two entry points the way this one would.
    const { data: pausedRow } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "automation_paused")
      .single()
    if (pausedRow?.value === true) {
      console.log("[contactTimelineRetentionCron] automation paused, skipping")
      return
    }

    const { data: enabledRow } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "cron_contact_timeline_retention_enabled")
      .single()
    // Default TRUE: unlike auditLogRetentionCron's `!== true` check (which
    // relies on a seeded system_settings row to behave as "on"), this flag
    // must default to enabled with no row present at all, so only an
    // explicit `false` skips it.
    if (enabledRow?.value === false) {
      console.log("[contactTimelineRetentionCron] disabled via flag, skipping")
      return
    }

    const { data: daysRow } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "contact_timeline_retention_days")
      .single()
    const days = typeof daysRow?.value === "number" ? daysRow.value : 365

    const runId = await logCronStart(supabase, "contactTimelineRetentionCron")
    try {
      const scrubbed = await scrubContactTimeline(supabase, days)
      await logCronEnd(supabase, runId, "success", { scrubbed, days })
      console.log(`[contactTimelineRetentionCron] scrubbed ${scrubbed} rows older than ${days}d`)
    } catch (err) {
      await logCronEnd(supabase, runId, "failed", { message: (err as Error).message })
      throw err
    }
  },
)

// ─── Bookkeeping Retention (daily 04:00 UTC) ────────────────────────────────
// AI Bookkeeper Phase 3, Task 15. Prunes bookkeeping_documents (statements +
// receipts) whose retain_until has passed — deletes the private-bucket object
// first, then the row. bookkeeping_ledger_entries.document_id is ON DELETE SET
// NULL (migration 00186), so a linked ledger entry survives with document_id
// nulled. Gated by system_settings.cron_bookkeeping_retention_enabled (default
// false — destructive). 04:00 UTC is clear of auditLogRetentionCron (03:00)
// and syncPlatformAnalytics (03:00); both operate on disjoint tables anyway.

export const bookkeepingRetentionCron = onSchedule(
  {
    schedule: "0 4 * * *",
    timeZone: "UTC",
    timeoutSeconds: 300,
    memory: "256MiB",
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey],
  },
  async () => {
    const { getSupabase } = await import("./lib/supabase.js")
    const { logCronStart, logCronEnd } = await import("./lib/cron-runs.js")
    const { pruneExpiredDocuments } = await import("./lib/bookkeeping-retention.js")
    const { getStorage } = await import("firebase-admin/storage")

    const supabase = getSupabase()

    const { data: enabledRow } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "cron_bookkeeping_retention_enabled")
      .single()
    if (enabledRow?.value !== true) {
      console.log("[bookkeepingRetentionCron] disabled via flag, skipping")
      return
    }

    // See receipt-scan.ts — the deployed value arrives as
    // PRIVATE_STORAGE_BUCKET from functions/.env.<projectId>.
    const bucketName = process.env.FIREBASE_PRIVATE_BUCKET || process.env.PRIVATE_STORAGE_BUCKET
    if (!bucketName) {
      console.warn("[bookkeepingRetentionCron] PRIVATE_STORAGE_BUCKET not set, skipping")
      return
    }
    const bucket = getStorage().bucket(bucketName)
    const today = new Date().toISOString().slice(0, 10)

    const runId = await logCronStart(supabase, "bookkeepingRetentionCron")
    try {
      const { deleted, ids } = await pruneExpiredDocuments(supabase, bucket, today)
      await logCronEnd(supabase, runId, "success", { deleted, ids: ids.slice(0, 50) })
      console.log(`[bookkeepingRetentionCron] pruned ${deleted} document(s) past retain_until`)
    } catch (err) {
      await logCronEnd(supabase, runId, "failed", { message: (err as Error).message })
      throw err
    }
  },
)

// ─── Bookkeeping Quarterly Accountant Pack (Jan/Apr/Jul/Oct 1, 09:00 UTC) ────
// AI Bookkeeper Phase 4b. POSTs to /api/admin/internal/bookkeeping-quarterly-pack,
// which builds and emails the prior calendar quarter's accountant pack to the
// stored recipient. Gated by system_settings.cron_bookkeeping_quarterly_pack_enabled
// (default false). The route already owns logCronStart/logCronEnd under
// "bookkeepingQuarterlyPackCron" — this function must NOT log cron_runs itself,
// or every run would produce two rows. (Checked sibling POST-delegating crons:
// revenueDigestCron does not log cron_runs on either side; runAgentStrategist
// logs functions-side only, but its target route (/ads/agent-strategist) does
// not log at all either — no sibling double-logs, so single-owner logging —
// here, route-side, since the route already does it — is the pattern.)

export const bookkeepingQuarterlyPackCron = onSchedule(
  {
    schedule: "0 9 1 1,4,7,10 *",
    timeZone: "Etc/UTC",
    timeoutSeconds: 180,
    memory: "256MiB",
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey, internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[bookkeepingQuarterlyPackCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/bookkeeping-quarterly-pack`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error("[bookkeepingQuarterlyPackCron]", res.status, body)
        return
      }
      console.log("[bookkeepingQuarterlyPackCron]", res.status, body)
    } catch (err) {
      console.error("[bookkeepingQuarterlyPackCron] failed:", err)
    }
  },
)

// ─── Bookkeeping Close Nudge (monthly, 3rd at 13:00 UTC ≈ 9am ET) ────────────
// POSTs to /api/admin/internal/bookkeeping-close-nudge, which lists finished
// months that still have no close row and emails the coach. The 3rd is the
// monthly-close anchor: late enough that statements have landed, early enough
// that the month is still fresh. Gated by
// system_settings.cron_bookkeeping_close_nudge_enabled (default false, seeded by
// migration 00198). The route owns logCronStart/logCronEnd under
// "bookkeepingCloseNudgeCron" — this function must NOT log cron_runs itself
// (single-owner rule; the receipt-watchdog precedent). Pure fetch-delegator: only
// internalCronToken + appUrl are used, so only those secrets are declared.
export const bookkeepingCloseNudgeCron = onSchedule(
  {
    schedule: "0 13 3 * *",
    timeZone: "Etc/UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[bookkeepingCloseNudgeCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/bookkeeping-close-nudge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error("[bookkeepingCloseNudgeCron]", res.status, body)
        return
      }
      console.log("[bookkeepingCloseNudgeCron]", res.status, body)
    } catch (err) {
      console.error("[bookkeepingCloseNudgeCron] failed:", err)
    }
  },
)

// ─── Bookkeeping Receipt Watchdog (weekly Tue 07:00 UTC) ─────────────────────
// AI Bookkeeper Phase 6b. POSTs to /api/admin/internal/bookkeeping-receipt-watchdog,
// which scans the trailing 365 days for aged expense entries missing receipts /
// business purposes and emails the coach the chore list. Gated by
// system_settings.cron_bookkeeping_receipt_watchdog_enabled (default false, seeded
// by migration 00188). The route owns logCronStart/logCronEnd under
// "bookkeepingReceiptWatchdogCron" — this function must NOT log cron_runs itself
// (single-owner rule; the quarterly-pack precedent). Pure fetch-delegator: only
// internalCronToken + appUrl are used, so only those secrets are declared.
export const bookkeepingReceiptWatchdogCron = onSchedule(
  {
    schedule: "0 7 * * 2",
    timeZone: "Etc/UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[bookkeepingReceiptWatchdogCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/bookkeeping-receipt-watchdog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error("[bookkeepingReceiptWatchdogCron]", res.status, body)
        return
      }
      console.log("[bookkeepingReceiptWatchdogCron]", res.status, body)
    } catch (err) {
      console.error("[bookkeepingReceiptWatchdogCron] failed:", err)
    }
  },
)

// Bookkeeping income sync. POSTs to /api/admin/internal/bookkeeping-income-sync,
// which sweeps the money-of-record tables through the manual import's exact
// pipeline and posts new income to the primary business book (idempotent —
// UNIQUE(book_id,source,source_ref) + alt_ref dedupe). Gated by
// system_settings.cron_bookkeeping_income_sync_enabled (default false, seeded
// by migration 00190). The route owns logCronStart/logCronEnd under
// "bookkeepingIncomeSyncCron" — this function must NOT log cron_runs itself
// (single-owner rule). Pure fetch-delegator: only internalCronToken + appUrl.
export const bookkeepingIncomeSyncCron = onSchedule(
  {
    schedule: "30 4 * * *",
    timeZone: "Etc/UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[bookkeepingIncomeSyncCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/bookkeeping-income-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error("[bookkeepingIncomeSyncCron]", res.status, body)
        return
      }
      console.log("[bookkeepingIncomeSyncCron]", res.status, body)
    } catch (err) {
      console.error("[bookkeepingIncomeSyncCron] failed:", err)
    }
  },
)

// ─── Bookkeeping Gmail Receipt Poller (hourly :20) ───────────────────────────
// Thin delegator (gscSyncCron shape): the route owns the cron_runs row + the
// cron_bookkeeping_gmail_receipts_enabled gate (default OFF) and degrades to
// a successful no-op while Gmail is unconnected. Zero new Firebase secrets —
// the Gmail refresh token lives in platform_connections, read Vercel-side.
export const bookkeepingGmailReceiptsCron = onSchedule(
  {
    schedule: "20 * * * *",
    timeZone: "Etc/UTC",
    timeoutSeconds: 330,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[bookkeepingGmailReceiptsCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/bookkeeping-gmail-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error("[bookkeepingGmailReceiptsCron]", res.status, body)
        return
      }
      console.log("[bookkeepingGmailReceiptsCron]", res.status, body)
    } catch (err) {
      console.error("[bookkeepingGmailReceiptsCron] failed:", err)
    }
  },
)

// ─── Stale AI Job Reaper (every 15 min) ──────────────────────────────────────
// A hard-killed function (platform timeout, OOM, crash) never runs its catch
// block, so its ai_jobs doc keeps its in-flight status forever — and the
// onDocumentCreated guard (`status !== "pending"` → return) makes it
// unrecoverable, so no trigger retry can ever finish it. Observed in prod as a
// week_generation job stuck in "processing" for 13 hours with the UI spinning.
//
// Handlers with their own wall-clock budget (lib/deadline.ts) now fail cleanly
// on their own; this is the safety net for every other handler and for failure
// modes no in-process guard can catch (OOM). Grace periods live in
// lib/stale-ai-jobs.ts — long ones for job types completed by an external
// worker or webhook, which legitimately sit idle in "processing".
//
// Deliberately NOT feature-flagged: it only ever moves already-dead jobs to
// "failed", so there is no money or mass-email risk to gate (per the
// no-default-feature-flags convention). It works Firestore directly rather than
// delegating to a route, so it owns its own cron_runs row (single-owner rule).
export const reapStaleAiJobsCron = onSchedule(
  {
    schedule: "*/15 * * * *",
    timeZone: "Etc/UTC",
    timeoutSeconds: 300,
    memory: "256MiB",
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey],
  },
  async () => {
    const { getSupabase } = await import("./lib/supabase.js")
    const { logCronStart, logCronEnd } = await import("./lib/cron-runs.js")
    const { reapStaleAiJobs } = await import("./reap-stale-ai-jobs.js")

    const supabase = getSupabase()
    const runId = await logCronStart(supabase, "reapStaleAiJobsCron")
    try {
      const result = await reapStaleAiJobs()
      await logCronEnd(supabase, runId, "success", result as unknown as Record<string, unknown>)
      console.log("[reapStaleAiJobsCron]", result)
    } catch (err) {
      await logCronEnd(supabase, runId, "failed", { message: (err as Error).message })
      throw err
    }
  },
)

// Bookkeeping payout sync. POSTs to /api/admin/internal/bookkeeping-payout-sync,
// which READS Stripe payouts + balance transactions into the
// bookkeeping_payouts mirror (idempotent merge upserts on plain UNIQUE
// stripe_payout_id / stripe_balance_txn_id) — never the webhook, never the
// ledger. Gated by system_settings.cron_bookkeeping_payout_sync_enabled
// (default false, seeded by migration 00191). 05:15 UTC — after income-sync
// (04:30) so payout-net dedupe sees the night's freshly posted income. The
// route owns logCronStart/logCronEnd under "bookkeepingPayoutSyncCron" —
// this function must NOT log cron_runs itself (single-owner rule). Pure
// fetch-delegator: only internalCronToken + appUrl (Stripe key stays Vercel-side).
export const bookkeepingPayoutSyncCron = onSchedule(
  {
    schedule: "15 5 * * *",
    timeZone: "Etc/UTC",
    // Must be >= the route's maxDuration (300). A cold start has no
    // arrival_date lower bound (Decision A-4) and can walk up to
    // MAX_PAYOUTS_PER_RUN = 200 payouts, each with its own auto-paged
    // balanceTransactions.list — the route is budgeted 300s for that backlog,
    // so a 120s delegator would be killed mid-flight and strand the
    // route-owned cron_runs row without its logCronEnd.
    timeoutSeconds: 300,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[bookkeepingPayoutSyncCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/bookkeeping-payout-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error("[bookkeepingPayoutSyncCron]", res.status, body)
        return
      }
      console.log("[bookkeepingPayoutSyncCron]", res.status, body)
    } catch (err) {
      console.error("[bookkeepingPayoutSyncCron] failed:", err)
    }
  },
)


// ─── Client messaging: delayed unread-message email (every 5 minutes) ────────
// POSTs to /api/admin/internal/messaging-notify, which emails a recipient only
// when a message is STILL unread after the delay -- so a live back-and-forth in
// the widget produces no email at all. Gated by
// system_settings.cron_messaging_email_enabled (default false, seeded by
// migration 00199). The route owns logCronStart/logCronEnd under
// "messagingNotifyCron" -- this function must NOT log cron_runs itself
// (single-owner rule). Pure fetch-delegator: only internalCronToken + appUrl
// are used, so only those secrets are declared.
export const messagingNotifyCron = onSchedule(
  {
    schedule: "*/5 * * * *",
    timeZone: "Etc/UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[messagingNotifyCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/messaging-notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error("[messagingNotifyCron]", res.status, body)
        return
      }
      console.log("[messagingNotifyCron]", res.status, body)
    } catch (err) {
      console.error("[messagingNotifyCron] failed:", err)
    }
  },
)

// ─── Chat Retention (daily 03:45 UTC) ───────────────────────────────────────
// Lead Engine Stage 3. Deletes chat_conversations older than
// system_settings.chat_retention_days (default 90); chat_messages go with them
// by ON DELETE CASCADE (migration 00227). A chat transcript is free text a
// stranger typed into a public box — a child's name, an injury, what they can
// afford — beside an ip_hash and a user agent, and nothing reads it after a
// few weeks.
//
// Gated by system_settings.cron_chat_retention_enabled, DEFAULT FALSE.
// Deliberately the opposite of contactTimelineRetentionCron next door: that
// job scrubs rows it leaves in place, this one deletes records. A destructive
// job that switches itself on the moment the code lands is how a business
// loses records it had not finished reading.
//
// A DELEGATOR, NOT A TWIN. contactTimelineRetentionCron does its work here and
// keeps a second copy of the operation under functions/src/lib/ because
// functions/ cannot import from lib/. This one POSTs the internal route
// instead, so pruneChatConversations exists exactly once and there is no pair
// of files to drift apart. The route owns logCronStart/logCronEnd under
// "chatRetentionCron", so this function must NOT log cron_runs itself
// (single-owner rule) — and timeoutSeconds must stay >= that route's
// maxDuration (120), which __tests__/lib/cron-delegator-timeout-contract.test.ts
// pins.
//
// 03:45 UTC is clear of auditLogRetentionCron (03:00), gscSyncCron (03:15) and
// contactTimelineRetentionCron (03:30); all four touch disjoint tables anyway.
//
// NOT IN THE AUTOMATION-HEALTH EXPECTED LIST, on purpose and until it is
// actually deployed. That scanner alerts on a cron with no recent successful
// cron_runs row, so listing an undeployed function would raise a critical
// every single day for a job nobody broke — and an operator who learns to
// ignore that subsystem's alerts is worse off than one who has no alert.
// Deploying this function, flipping the flag, and adding it to the expected
// list are three steps of one handover item.
export const chatRetentionCron = onSchedule(
  {
    schedule: "45 3 * * *",
    timeZone: "Etc/UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[chatRetentionCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/chat-retention`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error("[chatRetentionCron]", res.status, body)
        return
      }
      console.log("[chatRetentionCron]", res.status, body)
    } catch (err) {
      console.error("[chatRetentionCron] failed:", err)
    }
  },
)
