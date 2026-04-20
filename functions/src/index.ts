import { initializeApp } from "firebase-admin/app"
import { onDocumentCreated } from "firebase-functions/v2/firestore"
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

// ─── Tavily Research ──────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "tavily_research"

export const tavilyResearch = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    secrets: [tavilyApiKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "tavily_research") return

    const { handleTavilyResearch } = await import("./tavily-research.js")
    await handleTavilyResearch(event.params.jobId)
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
