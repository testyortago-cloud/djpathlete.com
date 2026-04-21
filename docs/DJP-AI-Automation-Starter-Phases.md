# DJP Athlete AI Automation — Starter Phases Plan

## Detailed Week-by-Week Build Plan for the $4,000 Starter Package

_Companion document to [DJP-AI-Automation-Starter-Plan.md](./DJP-AI-Automation-Starter-Plan.md). Where the main doc describes **what** you get, this doc describes **how and when** it gets built._

---

## Table of Contents

1. [Codebase Integration Map](#codebase-integration-map)
2. [Core Design Principle: Plug-and-Play Architecture](#core-design-principle-plug-and-play-architecture)
3. [Overview & Timeline Map](#overview--timeline-map)
4. [Phase 0: Pre-Kickoff (Week 0)](#phase-0-pre-kickoff-week-0)
5. [Phase 1: Foundation (Week 1)](#phase-1-foundation-week-1)
6. [Phase 2: Core Platform Integrations (Week 2)](#phase-2-core-platform-integrations-week-2)
7. [Phase 3: Social + Video Pipeline (Week 3)](#phase-3-social--video-pipeline-week-3)
8. [Phase 4: Content Extensions — Blog, Newsletter, Tavily](#phase-4-content-extensions--blog-newsletter-tavily)
9. [Phase 5: Analytics Tabs, Reports & Polish](#phase-5-analytics-tabs-reports--polish)
10. [Phase 6: Final Review, Training & Handoff (Week 6)](#phase-6-final-review-training--handoff-week-6)
11. [Adding Platforms After Handoff (Self-Service)](#adding-platforms-after-handoff-self-service)
12. [Dependency Map](#dependency-map)
13. [Risks & Mitigations Per Phase](#risks--mitigations-per-phase)
14. [Weekly Client Time Commitment](#weekly-client-time-commitment)
15. [Success Criteria](#success-criteria)

---

## Codebase Integration Map

This build is **extend-first, not rebuild-first**. Your DJP Athlete codebase already has substantial blog, newsletter, AI, and analytics infrastructure. The Starter build hooks into what exists rather than creating parallel systems.

### What We're Extending (Existing Systems)

| Existing System                           | File(s)                                                                                                                                                                                | How We Extend It                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Blog DAL**                              | [lib/db/blog-posts.ts](../lib/db/blog-posts.ts), `blog_posts` table                                                                                                                    | Add columns: `source_video_id`, `seo_metadata` (JSONB), `tavily_research` (JSONB), `fact_check_status`                                     |
| **Blog AI generation**                    | [components/admin/blog/BlogGenerateDialog.tsx](../components/admin/blog/BlogGenerateDialog.tsx)                                                                                        | Add "Generate from video" mode — pre-fills prompt from transcript; adds Tavily research pass before generation                             |
| **Blog publish pipeline**                 | `lib/blog-storage.ts` + `blog_posts` Supabase table                                                                                                                                    | Internal publish only. AI pipeline writes directly to `blog_posts` via existing [lib/db/blog-posts.ts](../lib/db/blog-posts.ts) DAL.       |
| **Newsletter DAL**                        | [lib/db/newsletter.ts](../lib/db/newsletter.ts), [lib/db/newsletters.ts](../lib/db/newsletters.ts), `newsletter_subscribers` table                                                     | No schema change. Auto-draft from new blog posts; trigger via blog publish hook.                                                           |
| **Newsletter AI generation**              | [components/admin/newsletter/NewsletterGenerateDialog.tsx](../components/admin/newsletter/NewsletterGenerateDialog.tsx)                                                                | Add "From blog post" mode — pre-fills from recently published article.                                                                     |
| **AI job queue**                          | [app/api/ai-jobs/[id]/route.ts](../app/api/ai-jobs/[id]/route.ts), `useAiJob` hook                                                                                                     | Social caption generation uses the exact same pattern — new job type `social_fanout`                                                       |
| **Claude wrapper**                        | [lib/ai/anthropic.ts](../lib/ai/anthropic.ts), [lib/ai/schemas.ts](../lib/ai/schemas.ts)                                                                                               | New Zod schemas for social caption + fact-check outputs. No wrapper changes.                                                               |
| **Prompt template editor**                | [components/admin/ai-templates/](../components/admin/ai-templates/)                                                                                                                    | New template category: "Social Caption" / "Blog Research" — same editor UI, more templates                                                 |
| **Text-enhance pattern**                  | [components/admin/ai-templates/enhance-textarea-button.tsx](../components/admin/ai-templates/enhance-textarea-button.tsx), [lib/ai/enhance-template.ts](../lib/ai/enhance-template.ts) | Reuse verbatim in Social caption editor for "improve this caption" button.                                                                 |
| **Analytics dashboard**                   | [components/admin/analytics/AnalyticsDashboard.tsx](../components/admin/analytics/AnalyticsDashboard.tsx)                                                                              | Add `SocialTab.tsx` and `ContentTab.tsx` — same pattern as existing `ShopTab`, `EngagementTab`, etc.                                       |
| **Analytics primitives**                  | `StatCard`, `HorizontalBar`, `DateRangePicker`                                                                                                                                         | Reused verbatim in the new tabs.                                                                                                           |
| **Email via Resend**                      | [lib/resend.ts](../lib/resend.ts), [lib/email.ts](../lib/email.ts)                                                                                                                     | Daily Pulse + Weekly Content Report use existing Resend client.                                                                            |
| **YouTube URL utils**                     | [lib/youtube.ts](../lib/youtube.ts)                                                                                                                                                    | Extend with upload-via-API functions (currently only has `extractYouTubeId`, thumbnail helpers).                                           |
| **GoHighLevel (contacts/workflows only)** | [lib/ghl.ts](../lib/ghl.ts)                                                                                                                                                            | Still used for GHL contacts/workflows. **Blog no longer uses GHL** — [lib/ghl-blog.ts](../lib/ghl-blog.ts) is out of scope for this build. |
| **Token tracking / AI usage**             | [lib/ai/token-utils.ts](../lib/ai/token-utils.ts), `AiUsageDashboard.tsx`                                                                                                              | Social generation tokens flow into the existing AI Usage dashboard automatically.                                                          |
| **Admin sidebar, layout, theme**          | [components/admin/AdminSidebar.tsx](../components/admin/AdminSidebar.tsx), [components/admin/AdminLayout.tsx](../components/admin/AdminLayout.tsx)                                     | Add Social + Content sidebar items using existing Green Azure / accent styling.                                                            |
| **Supabase service-role pattern**         | [lib/supabase.ts](../lib/supabase.ts) `createServiceRoleClient()`                                                                                                                      | All new DAL files follow the existing pattern exactly.                                                                                     |
| **Firebase (push notifications)**         | [lib/firebase.ts](../lib/firebase.ts), [lib/firebase-admin.ts](../lib/firebase-admin.ts)                                                                                               | TikTok hybrid workflow notification uses existing Firebase push infra.                                                                     |

### What We're Building New

| New System                | File Path (Planned)                                              | Why It's New                                                        |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| Plugin framework          | `lib/social/plugins/` (new directory) + `lib/social/registry.ts` | No social publishing infra exists today — greenfield                |
| Meta plugin               | `lib/social/plugins/meta.ts`                                     | New                                                                 |
| YouTube plugin            | `lib/social/plugins/youtube.ts`                                  | Extends existing `lib/youtube.ts` URL utils with upload API methods |
| TikTok plugin             | `lib/social/plugins/tiktok.ts`                                   | New (hybrid, uses Firebase push from your existing setup)           |
| LinkedIn plugin           | `lib/social/plugins/linkedin.ts`                                 | New                                                                 |
| Social posts DAL          | `lib/db/social-posts.ts`, `lib/db/social-captions.ts`            | New                                                                 |
| Content calendar DAL      | `lib/db/content-calendar.ts`                                     | New (spans both social + blog)                                      |
| Platform connections DAL  | `lib/db/platform-connections.ts`                                 | New — stores OAuth tokens + connection status per plugin            |
| Video uploads DAL         | `lib/db/video-uploads.ts`, `lib/db/video-transcripts.ts`         | New                                                                 |
| AssemblyAI client         | `lib/assemblyai.ts`                                              | New                                                                 |
| Tavily client             | `lib/tavily.ts`                                                  | New                                                                 |
| Social caption dialog     | `components/admin/social/SocialCaptionGenerateDialog.tsx`        | New — mirrors `BlogGenerateDialog` pattern (ai-jobs + `useAiJob`)   |
| Platform Connections page | `app/(admin)/admin/platform-connections/page.tsx`                | New                                                                 |
| Social admin page         | `app/(admin)/admin/social/page.tsx`                              | New                                                                 |
| Video admin page          | `app/(admin)/admin/videos/page.tsx`                              | New                                                                 |
| Migrations 00076+         | `supabase/migrations/00076_*.sql` ... `00081_*.sql`              | Schema additions for above tables + blog_posts column additions     |

### What Does NOT Change

- Existing blog admin routes ([app/(admin)/admin/blog/](../app/%28admin%29/admin/blog/)) — untouched
- Existing newsletter admin routes — untouched
- Existing blog DAL signatures — additive only
- Existing AI infrastructure ([lib/ai/](../lib/ai/)) — additive only (new schemas, no breaking changes)
- Existing ai-jobs API — additive (new job type, same route/shape)
- Existing analytics tabs — no edits; only new tabs appended
- Auth, middleware, migrations 00001-00075 — untouched

---

### Compute Architecture: Firebase Functions for All Heavy Async Work

**All time-consuming operations run on Firebase Cloud Functions** (2nd gen, Cloud Run-based). Your Next.js admin app stays a thin UI/API layer; the heavy compute moves off Vercel's request path.

**Why Firebase Functions:**

- Already in your stack ([lib/firebase.ts](../lib/firebase.ts), [lib/firebase-admin.ts](../lib/firebase-admin.ts)) — no new vendor
- Long-running budgets (up to 60 minutes vs. Vercel's 10–300s) — critical for multi-step AI pipelines
- Clean separation: Vercel handles UI + request routing; Firebase handles compute
- Built-in Cloud Scheduler for cron jobs — no separate cron service needed
- Horizontal scale + cost-effective pay-per-invocation
- Native retries + dead-letter queues

**The pattern (preserves existing `useAiJob` UX):**

```
[User clicks "Generate"]
      │
      ▼
[Next.js API route: POST /api/ai-jobs]
      │  ├─ inserts row into `ai_jobs` table (status: pending)
      │  └─ invokes Firebase Function via HTTPS callable
      ▼
[Firebase Function]
      │  ├─ updates ai_jobs row to status: processing
      │  ├─ does the real work (Claude + Tavily + AssemblyAI + etc.)
      │  ├─ writes result to ai_jobs.result
      │  └─ sets status: completed
      ▼
[Frontend: useAiJob(jobId) polls GET /api/ai-jobs/:id]
      │  └─ reads ai_jobs row from Supabase — unchanged UX
      ▼
[Dialog shows result, UX identical to today's BlogGenerateDialog]
```

**Function catalog (built across Phases 2–5):**

| #   | Function                     | Type                                     | Runs On                                                            | Typical Duration |
| --- | ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------ | ---------------- |
| 1   | `generateSocialCaption`      | HTTPS callable                           | ai-jobs pipeline                                                   | 3–10 s           |
| 2   | `generateSocialFanout`       | HTTPS callable                           | ai-jobs (one video → 6 captions)                                   | 20–60 s          |
| 3   | `generateBlogFromVideo`      | HTTPS callable                           | ai-jobs (research + generate + fact-check)                         | 30–90 s          |
| 4   | `generateNewsletterFromBlog` | HTTPS callable                           | ai-jobs                                                            | 5–15 s           |
| 5   | `tavilyResearch`             | HTTPS callable                           | ai-jobs + blog inline                                              | 3–10 s           |
| 6   | `tavilyFactCheck`            | HTTPS callable                           | post-blog-generation                                               | 5–15 s           |
| 7   | `enhanceCaption`             | HTTPS callable                           | existing `enhance-textarea-button`                                 | 2–5 s            |
| 8   | `transcribeVideo`            | Storage-triggered                        | On upload to Supabase Storage (via webhook) → AssemblyAI async job | 30 s – 5 min     |
| 9   | `assemblyAIWebhookHandler`   | HTTPS (webhook)                          | AssemblyAI transcript-ready callback                               | 2–5 s            |
| 10  | `publishScheduledPost`       | Scheduled (Cloud Scheduler, every 5 min) | picks approved social_posts                                        | 5–15 s           |
| 11  | `tavilyWeeklyTrendingScan`   | Scheduled (Monday 6 AM)                  | writes to content_calendar                                         | 30–60 s          |
| 12  | `syncPlatformAnalytics`      | Scheduled (nightly)                      | Pulls FB/IG/TikTok/YouTube/LinkedIn + blog/email                   | 2–10 min         |
| 13  | `voiceDriftMonitor`          | Scheduled (weekly)                       | compares recent generations vs. voice profile                      | 30–90 s          |
| 14  | `performanceLearningLoop`    | Scheduled (weekly)                       | updates prompt_templates few-shot examples                         | 30–60 s          |
| 15  | `sendDailyPulse`             | Scheduled (7 AM daily)                   | composes + sends via Resend                                        | 5–15 s           |
| 16  | `sendWeeklyContentReport`    | Scheduled (Friday 5 PM)                  | composes + sends via Resend                                        | 10–30 s          |

**New files at repo root:**

```
functions/
├── src/
│   ├── index.ts                    # exports all functions
│   ├── ai/
│   │   ├── generateSocialCaption.ts
│   │   ├── generateSocialFanout.ts
│   │   ├── generateBlogFromVideo.ts
│   │   ├── generateNewsletterFromBlog.ts
│   │   └── enhanceCaption.ts
│   ├── tavily/
│   │   ├── client.ts
│   │   ├── research.ts
│   │   ├── factCheck.ts
│   │   └── weeklyTrendingScan.ts
│   ├── video/
│   │   ├── transcribeVideo.ts
│   │   └── assemblyAIWebhookHandler.ts
│   ├── publishing/
│   │   └── publishScheduledPost.ts
│   ├── analytics/
│   │   ├── syncPlatformAnalytics.ts
│   │   ├── voiceDriftMonitor.ts
│   │   └── performanceLearningLoop.ts
│   ├── reports/
│   │   ├── sendDailyPulse.ts
│   │   └── sendWeeklyContentReport.ts
│   ├── lib/
│   │   ├── claude.ts               # Claude API wrapper for functions context
│   │   ├── supabase.ts             # Supabase service-role client for functions
│   │   └── resend.ts               # Resend client
│   └── schemas/
│       └── (mirrored Zod schemas from main app's lib/ai/schemas.ts)
├── package.json
├── tsconfig.json
└── firebase.json                   # functions config
```

**What STAYS in Next.js (light, fast):**

- All admin UI
- All existing CRUD API routes
- The `ai-jobs` endpoint — but it becomes a thin wrapper: creates the row, invokes the Firebase Function, returns the job id
- Auth middleware
- Rendering

**What MOVES to Firebase Functions:**

- All Claude API calls
- All Tavily API calls
- All AssemblyAI orchestration
- All cron jobs (replaces planned Vercel Cron)
- All email composition + send (Daily Pulse, Weekly Report)
- All scheduled social publishing

**Shared code approach:**

- Zod schemas in [lib/ai/schemas.ts](../lib/ai/schemas.ts) are mirrored into `functions/src/schemas/` (kept in sync via a small build script)
- Supabase service-role client pattern ([lib/supabase.ts](../lib/supabase.ts)) re-implemented in `functions/src/lib/supabase.ts`
- Resend pattern ([lib/resend.ts](../lib/resend.ts)) re-implemented in `functions/src/lib/resend.ts`

**Deployment:**

- `firebase deploy --only functions` in CI after any change under `functions/`
- Environment variables managed via Firebase secrets (not committed)

### Why This Matters for You

1. **No parallel systems** — your existing blog editor, newsletter generator, and AI job pipeline keep working exactly as they do today; the AI automation features plug in as new modes.
2. **Lower delivery risk** — most of Phase 4 and Phase 5 is extension, not greenfield. The blast radius of any bug is contained to new code.
3. **Faster real value** — by end of Phase 4, your existing BlogGenerateDialog can already accept a video transcript as input. You're not waiting for an entirely new blog system to work.
4. **Your team's existing mental model carries forward** — ai-jobs polling, `useAiJob` hook, `StatCard` + analytics tabs, GHL blog publish — you already know how these work.

---

## Core Design Principle: Plug-and-Play Architecture

**The build is complete when the system is finished — not when every social account is connected.** You don't need Facebook, Instagram, TikTok, YouTube, or LinkedIn accounts set up before or during the build. Every platform is a self-contained plugin that works "disconnected" and can be activated by you, self-service, any time after handoff.

### What This Means in Practice

- **Every connector is a plugin** implementing a shared `PublishPlugin` interface: `connect()`, `publish()`, `fetchAnalytics()`, `disconnect()`.
- **Every plugin has three states:** `Not Connected` (default), `Connected` (active), `Paused` (credentials present, publishing paused).
- **The developer apps are ours, not yours.** The Meta app, TikTok app, YouTube OAuth client, and LinkedIn app are all registered to us (or a DJP-owned developer account you'll own). Your individual Page, channel, or profile just grants OAuth access when you're ready — no new developer paperwork from you.
- **A "Platform Connections" page** in the admin dashboard lists every plugin with its current state, a Connect button, and per-platform setup instructions written for non-developers.
- **AI generation works regardless of connection status.** Captions, blog articles, and newsletters still get generated for every platform. If a platform is disconnected, posts queue as `Awaiting Connection` — you can review, approve, and park them. The moment you connect that platform, they auto-publish (or wait for their scheduled time).

### Why This Works for Your Situation

You mentioned you don't have the social accounts yet. Fine — here's what happens:

1. We build the complete Starter system in 6 weeks regardless.
2. During the build, we test every connector using **our own sandbox/dev accounts** (Meta test apps, a throwaway TikTok account, a DJP test YouTube channel, a test LinkedIn page). You don't need to create a single account.
3. At handoff, you get a working system with one or two platforms connected (the ones you already have — likely Facebook/Instagram if any). Everything else shows `Not Connected` with a "click here to connect" button.
4. Whenever you get around to creating a Facebook Page, TikTok account, YouTube channel, or LinkedIn Company Page, you log into the admin, click Connect, follow the guided OAuth flow (~5 minutes each), and that platform goes live.
5. Any previously queued posts for that platform either publish immediately or wait for their schedule.

### What Changes Because of This

| Area                            | Before (Accounts-Required)                    | After (Plug-and-Play)                                           |
| ------------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| Phase 0 credential collection   | You needed accounts for every platform        | You provide whatever you have; we use sandboxes for the rest    |
| Platform approval critical path | Blocked by you creating accounts              | Not blocked — our developer apps work with any OAuth'd client   |
| Phase 6 handoff                 | All platforms live, tested end-to-end         | Core system fully live; per-platform activation is self-service |
| Timeline                        | 6 weeks, contingent on your account readiness | 6 weeks, **guaranteed** regardless of your account status       |
| Price                           | $4,000                                        | $4,000 (no change)                                              |
| Your ability to activate later  | Required developer help                       | Self-service in the admin — no new invoice                      |

**The core build includes all 6 plugins ready to activate. What you pay the $4,000 for doesn't change — you just don't have to scramble to create accounts on our schedule.**

---

## Overview & Timeline Map

| Week  | Phase                            | Goal                                                                 | End-of-Week Milestone                                                          |
| ----- | -------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **0** | Pre-Kickoff                      | Alignment, voice inputs collected, whatever accounts you have shared | Contract signed, 50% deposit paid, brand voice call scheduled                  |
| **1** | Foundation                       | Database, dashboard shell, plugin framework, brand voice, dev apps   | Dashboard shell live, brand voice profile approved, plugin registry scaffolded |
| **2** | Core Platform Integrations       | All 6 platform plugins built + tested against sandbox/dev accounts   | Every plugin publishes successfully via our own test accounts                  |
| **3** | Social + Video Pipeline          | Video → multi-platform captions → scheduled posts, with approval     | First test video fans out to all platforms; approval flow working              |
| **4** | Blog & Newsletter Engine         | Long-form content + SEO + newsletter + Tavily fact-checking          | First full blog + newsletter pair published from a real video                  |
| **5** | Reports, Analytics & Polish      | Daily Pulse, Weekly Report, analytics aggregation, voice refinement  | First Weekly Content Report lands in your inbox                                |
| **6** | Final Review, Training & Handoff | Full week of live content, training session, documentation           | System fully live, you run it solo, final 50% paid                             |

```
Week 0      Week 1         Week 2              Week 3             Week 4              Week 5              Week 6
  │           │              │                   │                  │                   │                   │
Pre-kickoff  Foundation    Integrations       Social+Video       Blog+Newsletter     Reports+Polish     Handoff
  │           │              │                   │                  │                   │                   │
  │           ├─ DB schema   ├─ Meta API        ├─ Caption AI      ├─ Blog AI         ├─ Daily Pulse      ├─ Live test
Credentials  ├─ Dash shell  ├─ YT API          ├─ Video upload    ├─ SEO engine      ├─ Weekly Report    ├─ Training
Voice call   ├─ Brand voice ├─ TikTok hybrid   ├─ Transcription   ├─ Tavily fact     ├─ Analytics        ├─ Docs
setup        ├─ API apps    ├─ LinkedIn API    ├─ Multi-platform  │   check pass     │   aggregation     ├─ Final pay
             │   (LinkedIn, ├─ AssemblyAI      │   fanout         ├─ Newsletter      ├─ Voice tuning     │
             │   Meta,       ├─ Tavily          ├─ Approval UI    │   Resend flow    ├─ Bug fixes        │
             │   TikTok,     │                   │                   │                   │                   │
             │   YouTube)    │                   │                   │                   │                   │
             │               │                   │                   │                   │                   │
             └─ CHECKPOINT 1 └─ CHECKPOINT 2   └─ CHECKPOINT 3   └─ CHECKPOINT 4   └─ CHECKPOINT 5   └─ LAUNCH
                Voice sign-off   Platform test    First fanout      First blog live   First report        Full live
```

**Checkpoints are 30-minute calls at the end of each week** — you see what's working, flag what isn't, and we adjust before the next phase.

---

## Phase 0: Pre-Kickoff (Week 0)

**Goal:** Start Week 1 with voice inputs in hand. Social accounts are NOT required — we'll use sandboxes for any platform you haven't set up yet.

### Deliverables

- Signed contract
- 50% deposit ($2,000) received
- Brand voice call scheduled for Week 1, Day 1
- Sample content package received (5–10 posts, 3–5 videos, service descriptions)
- Whatever accounts you **already have** connected to the credentials vault (optional — can be deferred entirely)

### Your Tasks (~90 min total)

| Task                                                                                  | Estimated Time | Why                                                        |
| ------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------- |
| Review and sign contract                                                              | 20 min         | Kicks off everything                                       |
| Pay 50% deposit ($2,000)                                                              | 5 min          | Starts development                                         |
| Share credentials for any accounts you already have (optional — can be done any time) | 0–30 min       | Lets us connect real accounts during the build if you want |
| Send 5–10 example posts that capture your voice                                       | 20 min         | Trains the AI voice profile                                |
| Send 3–5 coaching videos for transcription testing                                    | 10 min         | Needed for video pipeline testing in Week 3                |
| Send service descriptions (Comeback Code, Rotational Reboot, etc.) in your own words  | 30 min         | Embedded into brand voice prompts                          |

**You do NOT need to create a Facebook Page, Instagram Business account, TikTok account, YouTube channel, or LinkedIn Company Page to start — or to finish — the build.**

### Our Tasks

- Set up secure credentials vault (empty is fine)
- Prepare brand voice interview questions
- Register OUR developer apps (not yours):
  - Meta developer app (DJP Athlete-owned, can serve any Page that OAuth grants access)
  - TikTok Content Posting API developer app
  - Google Cloud OAuth client for YouTube Data API
  - LinkedIn Marketing Developer Platform app
- Provision our own sandbox / test accounts for every platform (so we can build and demo without your accounts):
  - Test Facebook Page + Instagram Business account
  - Test TikTok account
  - Test YouTube channel
  - Test LinkedIn Company Page
- Create staging branch, CI pipeline setup
- Review current DJP Athlete codebase for reusable infrastructure

### Checkpoint

**30-min kickoff call** at end of Week 0 — confirm voice inputs are in, staging environment is ready, developer apps are submitted. No dependency on you having social accounts.

---

## Phase 1: Foundation (Week 1)

**Goal:** Lay every piece of groundwork before any platform-specific code gets written. By end of week, the empty dashboard is visible, the brand voice is captured, the plugin framework exists, and our developer apps are submitted.

### Deliverables

- ✅ Migrations **00076–00081** applied: `social_posts`, `social_captions`, `content_calendar`, `platform_connections`, `video_uploads`, `video_transcripts` + `ALTER blog_posts ADD source_video_id, seo_metadata, tavily_research, fact_check_status`
- ✅ New sidebar items in [AdminSidebar.tsx](../components/admin/AdminSidebar.tsx): Social, Videos, Platform Connections (styled to match existing Green Azure / accent pattern)
- ✅ Scaffolded pages: `app/(admin)/admin/social/page.tsx`, `app/(admin)/admin/videos/page.tsx`, `app/(admin)/admin/platform-connections/page.tsx`
- ✅ **`PublishPlugin` interface** + plugin registry at `lib/social/plugins/` and `lib/social/registry.ts`
- ✅ Brand voice profile stored in a new `content_voice_profile` record (extends existing prompt-templates infra — reuses the `prompt_templates` table pattern from migration 00075)
- ✅ **Firebase Functions project initialized** at `functions/` with 2nd-gen runtime, TypeScript, shared libs (`functions/src/lib/claude.ts`, `supabase.ts`, `resend.ts`), CI deploy wired up
- ✅ **Firebase secrets** populated via `firebase functions:secrets:set` — never committed to repo
- ✅ **Cloud Scheduler** enabled in Firebase project for cron functions
- ✅ Helper `lib/firebase-functions.ts` in Next.js app — thin wrapper that invokes HTTPS-callable functions from API routes
- ✅ **Our** developer apps submitted (Meta, TikTok, YouTube, LinkedIn, AssemblyAI, Tavily — registered to DJP Athlete)
- ✅ Sandbox/test accounts provisioned for every platform
- ✅ Env vars added to both environments:
  - **Next.js (Vercel):** `FIREBASE_PROJECT_ID`, `FIREBASE_FUNCTIONS_REGION`, platform OAuth client IDs (public-ish), Supabase URL/keys, NextAuth secret
  - **Firebase Functions (Firebase secrets):** `CLAUDE_API_KEY`, `TAVILY_API_KEY`, `ASSEMBLYAI_API_KEY`, `META_APP_SECRET`, `TIKTOK_APP_SECRET`, `YOUTUBE_CLIENT_SECRET`, `LINKEDIN_CLIENT_SECRET`, `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (secrets stay server-side, never in Vercel env)

### Engineering Tasks

| Day | Task                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Brand voice interview (60-min call with you) + draft voice profile, stored as `prompt_templates` rows (category: `voice`)                                                                                                                                          |
| 1–2 | Migrations 00076 (`social_posts`, `social_captions`), 00077 (`content_calendar`), 00078 (`platform_connections`), 00079 (`video_uploads`, `video_transcripts`), 00080 (blog_posts column additions), 00081 (`content_voice_profile` extension to prompt_templates) |
| 2   | `PublishPlugin` interface (`lib/social/plugins/types.ts`) + registry (`lib/social/registry.ts`) with state machine                                                                                                                                                 |
| 2–3 | Sidebar items + page scaffolds (Social, Videos, Platform Connections) — reuses existing `AdminLayout.tsx`, `StatCard.tsx`                                                                                                                                          |
| 3   | Submit Meta App Review (DJP-owned app, Pages + Instagram Graph permissions)                                                                                                                                                                                        |
| 3   | Submit TikTok Developer App (DJP-owned)                                                                                                                                                                                                                            |
| 3   | Configure Google Cloud project + OAuth consent screen for YouTube Data API (DJP-owned)                                                                                                                                                                             |
| 3–4 | LinkedIn Marketing Developer Platform app (DJP-owned)                                                                                                                                                                                                              |
| 4   | **Firebase Functions project init** at `functions/`: 2nd-gen runtime, TypeScript, shared libs (`claude.ts`, `supabase.ts`, `resend.ts`), CI deploy job                                                                                                             |
| 4   | Helper `lib/firebase-functions.ts` in Next.js: thin `invokeFunction(name, payload)` wrapper using Firebase Admin SDK                                                                                                                                               |
| 4   | AssemblyAI + Tavily clients live **in `functions/src/lib/`** — not in Next.js `lib/` — since all calls happen inside Functions                                                                                                                                     |
| 4   | Provision sandbox accounts (test FB Page, test IG, test TikTok, test YouTube channel, test LinkedIn Company Page)                                                                                                                                                  |
| 4–5 | Env var wiring: Vercel for Next.js, Firebase secrets for Functions. Staging deploy of both.                                                                                                                                                                        |
| 5   | Voice profile v2 + voice-adherence test harness — runs 20 sample generations through a dry-run Firebase Function invocation                                                                                                                                        |

### Your Tasks (~90 min total)

| Task                                      | Est. Time | When     |
| ----------------------------------------- | --------- | -------- |
| Brand voice interview call                | 60 min    | Day 1    |
| Review voice profile draft + feedback     | 15 min    | Day 4    |
| OAuth consent flow for YouTube + LinkedIn | 10 min    | Days 3–4 |
| Approve staging dashboard preview         | 5 min     | Day 5    |

### Dependencies / Blockers

- All approvals apply to **our** developer apps and are decoupled from any account you create later. Your personal/business accounts just OAuth into the approved app when you're ready — no waiting.
- **LinkedIn app approval** is the critical path for the build (5–10 business days). Submitted Week 0 Day 1 so it clears by Week 1 end. If delayed, we continue with stub publisher for LinkedIn; no slip to the overall timeline.
- **Meta app review** is usually 24–48 hours for standard Pages/IG permissions.
- **TikTok developer approval** typically 3–5 business days.
- **None of these depend on you having accounts.**

### Checkpoint 1 (End of Week 1)

30-min call. Walk through:

- Empty dashboard in staging — does it match your mental model?
- Brand voice profile — does it sound like you?
- API approval status board
- Any ambiguities in the sample content you sent

---

## Phase 2: Core Platform Integrations (Week 2)

**Goal:** Every platform is a self-contained plugin implementing the `PublishPlugin` interface. Each plugin is built, tested end-to-end with our sandbox accounts, and registered with the plugin registry. No dependency on your accounts existing.

### Deliverables

- ✅ **Meta plugin:** post text, image, video, link to Facebook Page + Instagram Business. Tested against our sandbox FB Page + IG Business.
- ✅ **YouTube plugin:** upload video with title, description, tags, thumbnail — long-form and Shorts. Tested against our sandbox channel.
- ✅ **TikTok plugin:** hybrid workflow (notification + clipboard copy). Tested against our sandbox TikTok.
- ✅ **LinkedIn plugin:** post text, image, video, article to Company Page. Tested against our sandbox LinkedIn Page.
- ✅ Every plugin supports: `connect()`, `publish()`, `fetchAnalytics()`, `disconnect()`, `getConnectionStatus()`, `getSetupInstructions()`
- ✅ AssemblyAI transcription pipeline: upload video → transcript returned
- ✅ Tavily research client: keyword → SERP results + extracted content
- ✅ Integration test harness — one command fires a test post to every plugin using sandbox accounts
- ✅ **Platform Connections UI** shows each plugin's status, setup instructions, and Connect button

### Engineering Tasks

| Day | Task                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `lib/social/plugins/meta.ts`: `PublishPlugin` impl, OAuth via existing auth-helpers pattern, post methods, analytics, rate-limit handling. Tokens stored in `platform_connections`. Tested vs. sandbox FB + IG. |
| 2   | `lib/social/plugins/youtube.ts`: extends existing [lib/youtube.ts](../lib/youtube.ts) with upload API, OAuth token storage, resumable upload, `#Shorts` flag logic. Tested vs. sandbox channel.                 |
| 3   | `lib/social/plugins/tiktok.ts`: hybrid notification flow — **reuses existing [lib/firebase-admin.ts](../lib/firebase-admin.ts) for push**, Resend for email fallback. Clipboard payload via dashboard.          |
| 3–4 | `lib/social/plugins/linkedin.ts`: Company Page auth, UGC Posts API. Tested vs. sandbox Page.                                                                                                                    |
| 4   | Platform Connections UI (`app/(admin)/admin/platform-connections/page.tsx`): list from `platform_connections` DAL, per-plugin setup MDX, Connect/Disconnect/Pause controls                                      |
| 4   | **`transcribeVideo` Firebase Function** (Storage-triggered on video upload) + **`assemblyAIWebhookHandler`** HTTPS function for transcript-ready callback. Next.js ai-jobs row tracks status.                   |
| 5   | **`tavilyResearch` Firebase Function** with Supabase `tavily_cache` table + cost guardrails. Invoked from Next.js ai-jobs wrapper.                                                                              |
| 5   | Integration smoke test: `scripts/smoke-social-plugins.ts` (publishes) + `scripts/smoke-firebase-functions.ts` (Functions invocation)                                                                            |

### Your Tasks (~15 min)

| Task                                                                             | Est. Time |
| -------------------------------------------------------------------------------- | --------- |
| Review integration test results (test posts fired to our sandbox accounts)       | 15 min    |
| **Nothing required on your real accounts** — zero cleanup since we use sandboxes |           |

### Dependencies

- Everything in Phase 1 must be approved by Day 1 of Week 2. If any API approval is still pending, we work around it with mock/stub endpoints and swap the live connector the moment approval lands.
- **Your accounts are NOT a dependency.** The plugin registry is designed to work with zero connected accounts — it just means posts queue as `Awaiting Connection` instead of publishing.

### Checkpoint 2 (End of Week 2)

30-min call. Walk through:

- Demo: live test post to every platform **using our sandbox accounts**
- Walk through the Platform Connections UI — show what your activation flow will look like later
- Rate-limit strategy and failure modes
- Any surprises from platform approvals

---

## Phase 3: Social + Video Pipeline (Week 3)

**Goal:** The core value prop — upload a video, get captions for every platform, review them, approve them, watch them publish.

### Deliverables

- ✅ Caption generation AI: platform-specific prompts for IG, FB, TikTok, YouTube (long-form + Shorts), LinkedIn
- ✅ Video upload UI in admin dashboard — drag-and-drop, progress indicator
- ✅ Transcription → AI understanding → multi-platform fanout pipeline
- ✅ Content calendar view (week / month)
- ✅ Approval workflow state machine (draft → edited → approved → scheduled → published → rejected)
- ✅ Scheduled publishing engine (cron-based, respects optimal posting times)
- ✅ First test video fully fans out in staging

### Engineering Tasks

| Day | Task                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Platform-specific caption prompt library — 6 new entries in `prompt_templates` table (category: `social_caption`, scope per platform). Editable via existing [template-editor-modal](../components/admin/ai-templates/template-editor-modal.tsx).                                                                                      |
| 1–2 | Video upload flow: new Videos page + Supabase Storage bucket `video-uploads`. Webhook on upload → **`transcribeVideo` Firebase Function** → AssemblyAI → `assemblyAIWebhookHandler` writes transcript to Supabase                                                                                                                      |
| 2   | **`generateSocialFanout` Firebase Function** — one video transcript → calls Claude 6× (one per platform) → writes all captions to `social_captions`. Uses shared schemas from `functions/src/schemas/`.                                                                                                                                |
| 2–3 | Next.js API route `app/api/ai-jobs/route.ts` POST handler: inserts `ai_jobs` row, invokes `generateSocialFanout` via Firebase Admin SDK, returns job id. Polling route unchanged.                                                                                                                                                      |
| 3   | `SocialCaptionGenerateDialog.tsx` (mirror of [BlogGenerateDialog.tsx](../components/admin/blog/BlogGenerateDialog.tsx)): same `useAiJob(jobId)` polling UX — the frontend has no idea Firebase is involved                                                                                                                             |
| 3   | Content calendar UI at `app/(admin)/admin/social/calendar/page.tsx` — week/month view with drag-to-reschedule                                                                                                                                                                                                                          |
| 3–4 | Approval workflow: the existing [enhance-textarea-button.tsx](../components/admin/ai-templates/enhance-textarea-button.tsx) now routes its enhance call through the new **`enhanceCaption` Firebase Function**. Batch approve + reject-with-feedback (feedback writes to `social_captions.rejection_notes` for future prompt training) |
| 4   | **`publishScheduledPost` Firebase Function** — Cloud Scheduler triggers every 5 min, picks approved `social_posts` where `scheduled_at <= now()`, invokes plugin's `publish()`, logs to existing `ai_generation_log` table                                                                                                             |
| 4–5 | TikTok hybrid notification: Firebase push (reuses existing [lib/firebase-admin.ts](../lib/firebase-admin.ts)) + Resend email fallback + clipboard payload on dashboard card                                                                                                                                                            |
| 5   | End-to-end test with one of your real sample videos, using sandbox accounts for publishing                                                                                                                                                                                                                                             |

### Your Tasks (~45 min)

| Task                                                                     | Est. Time |
| ------------------------------------------------------------------------ | --------- |
| Upload 1 sample video on Day 5 for the first real fanout test            | 5 min     |
| Review the 6 generated captions + give voice feedback                    | 30 min    |
| Approve 1–2 captions to publish to **our sandbox accounts** for the test | 10 min    |

### Dependencies

- Caption quality depends on Phase 1 brand voice profile. If voice still feels off by Week 3, we iterate — but that means less polish time later.

### Checkpoint 3 (End of Week 3)

30-min call. Walk through:

- Live demo: upload one of your videos, watch the 6 captions generate in under 60 seconds
- Review captions together, edit one, approve, watch it publish to staging
- Voice calibration — what needs adjusting?

---

## Phase 4: Content Extensions — Blog, Newsletter, Tavily

**Goal:** Extend your **existing** blog and newsletter systems with video-transcript input, Tavily research, and a fact-check pass. No parallel systems — hook into what's already there.

### What Already Works (No Change)

- Blog post DAL at [lib/db/blog-posts.ts](../lib/db/blog-posts.ts) — CRUD, status filtering, slug lookup
- Blog AI generation via [BlogGenerateDialog](../components/admin/blog/BlogGenerateDialog.tsx) with `useAiJob` polling
- Internal publish to `blog_posts` table → surfaced on your Next.js site (marketing blog route)
- Newsletter subscriber management at [lib/db/newsletter.ts](../lib/db/newsletter.ts)
- Newsletter AI generation via [NewsletterGenerateDialog](../components/admin/newsletter/NewsletterGenerateDialog.tsx)
- Resend email delivery via [lib/resend.ts](../lib/resend.ts)

### Deliverables (Extensions)

- ✅ **BlogGenerateDialog gains a new input mode**: "Generate from video" — pre-fills prompt from selected `video_transcripts` row
- ✅ **Tavily research pass** runs automatically before any blog generation; brief stored in `blog_posts.tavily_research` JSONB
- ✅ **Fact-check pass** runs after generation; results in `blog_posts.fact_check_status` (passed / flagged / failed) and surfaces flagged claims in the existing `BlogEditor` approval UI
- ✅ **SEO enhancement** on the existing blog output: structured metadata in new `blog_posts.seo_metadata` column (meta_title, meta_description, keywords, schema.org JSON-LD, internal links)
- ✅ **Tavily weekly trending scan** cron — inserts suggestions into `content_calendar` as `topic_suggestion` entries (already visible in your admin since you have a `content_calendar` table from Phase 1)
- ✅ **Blog → Newsletter auto-draft**: new hook in blog publish flow calls NewsletterGenerateDialog's underlying ai-jobs generator, creating a draft newsletter queued for your approval
- ✅ **"Research" button** added to the existing [BlogEditor.tsx](../components/admin/blog/BlogEditor.tsx) toolbar — one-click Tavily brief for the current topic

### Engineering Tasks

| Day | Task                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`tavilyResearch` + `tavilyFactCheck` Firebase Functions** finalized (living in `functions/src/tavily/`). Both invokable from ai-jobs wrapper.                                                                                                                                       |
| 1–2 | Extend existing `BlogGenerateDialog` to accept `{ mode: 'prompt' \| 'video', videoId?: string }` prop; add video picker when mode=`video`. Frontend still uses `useAiJob`.                                                                                                            |
| 2   | **`generateBlogFromVideo` Firebase Function** — orchestrates: read transcript → `tavilyResearch` → Claude generate → `tavilyFactCheck` → write to `blog_posts`. Can run 30–90 s (Vercel couldn't do this).                                                                            |
| 2   | Schema additions to [lib/ai/schemas.ts](../lib/ai/schemas.ts) for `BlogGeneration` output (extend existing) — **mirrored into `functions/src/schemas/`** via build script                                                                                                             |
| 3   | Internal linking engine — scans `blog_posts` on publish, suggests cross-links, surfaced in BlogEditor sidebar                                                                                                                                                                         |
| 4   | Fact-check results (from Firebase Function) highlighted inline in existing [BlogEditor.tsx](../components/admin/blog/BlogEditor.tsx) with "sources" popover                                                                                                                           |
| 4   | **Blog publish webhook** — new `app/api/webhooks/blog-published/route.ts` invokes **`generateNewsletterFromBlog` Firebase Function**                                                                                                                                                  |
| 4–5 | Extend `NewsletterGenerateDialog` with "From blog post" mode (accepts `blogPostId` prop, pre-fills content from that article)                                                                                                                                                         |
| 5   | **`tavilyWeeklyTrendingScan` Firebase Function** (Cloud Scheduler, Monday 6 AM) writes 5–10 ranked topics to `content_calendar` table                                                                                                                                                 |
| 5   | End-to-end test: upload real video → `transcribeVideo` → `generateBlogFromVideo` → blog draft appears in [admin/blog](../app/%28admin%29/admin/blog/) → approve → `generateNewsletterFromBlog` → newsletter draft appears in [admin/newsletter](../app/%28admin%29/admin/newsletter/) |

### Your Tasks (~60 min)

| Task                                                                                             | Est. Time |
| ------------------------------------------------------------------------------------------------ | --------- |
| Review first AI blog draft in existing BlogEditor (now with research brief + fact-check sidebar) | 20 min    |
| Voice / factual feedback on the blog                                                             | 15 min    |
| Review newsletter version in existing NewsletterGenerateDialog                                   | 10 min    |
| Approve the pair to publish (writes directly to `blog_posts` and sends via Resend)               | 15 min    |

### Dependencies

- Blog publishes internally to `blog_posts` table → rendered on your Next.js marketing blog route. No external CMS / GHL dependency.
- Resend is already in stack — no new approval loop.

### Checkpoint 4 (End of Week 4)

30-min call. Walk through:

- Open existing [admin/blog](../app/%28admin%29/admin/blog/) — see the new "Generate from video" option in BlogGenerateDialog
- Run the flow live — video → blog → newsletter draft
- Review Tavily fact-check flags (if any)
- Review the Monday trending scan output in `content_calendar`

---

## Phase 5: Analytics Tabs, Reports & Polish

**Goal:** Surface all the new content performance data inside your **existing** AnalyticsDashboard — no new dashboard built. Email reports hit your inbox. Bugs from Weeks 3–4 squashed.

### What Already Works (No Change)

- [AnalyticsDashboard.tsx](../components/admin/analytics/AnalyticsDashboard.tsx) with `ClientsTab`, `EngagementTab`, `ProgramsTab`, `RevenueTab`, `ShopTab`
- Analytics primitives: [StatCard.tsx](../components/admin/analytics/StatCard.tsx), [HorizontalBar.tsx](../components/admin/analytics/HorizontalBar.tsx), [DateRangePicker.tsx](../components/admin/analytics/DateRangePicker.tsx)
- AI usage tracking via [AiUsageDashboard.tsx](../components/admin/AiUsageDashboard.tsx) and [lib/ai/token-utils.ts](../lib/ai/token-utils.ts)
- Resend email delivery via [lib/resend.ts](../lib/resend.ts) and [lib/email.ts](../lib/email.ts)

### Deliverables (Extensions)

- ✅ **Two new analytics tabs** appended to existing dashboard: `components/admin/analytics/SocialTab.tsx` and `ContentTab.tsx` — use same `StatCard`/`HorizontalBar`/`DateRangePicker` primitives as other tabs
- ✅ **Nightly analytics sync** cron (Vercel Cron) — each plugin's `fetchAnalytics()` writes to new `social_analytics` table
- ✅ **Daily Pulse** email at 7 AM via React Email + existing Resend client — delivered through `lib/email.ts` pattern
- ✅ **Weekly Content Report** email every Friday 5 PM
- ✅ **Voice drift monitor** — weekly comparison job; flagged captions surfaced in existing [AiInsightsDashboard.tsx](../components/admin/AiInsightsDashboard.tsx)
- ✅ **Performance learning loop** — top-performing posts feed back as examples into `prompt_templates` (category: `social_caption`) via the existing template system
- ✅ Social-generated content token usage automatically visible in existing [AiUsageDashboard.tsx](../components/admin/AiUsageDashboard.tsx) (inherited from `lib/ai/token-utils.ts` — no extra work)
- ✅ Comprehensive bug sweep — nothing left with a TODO

### Engineering Tasks

| Day | Task                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`syncPlatformAnalytics` Firebase Function** (Cloud Scheduler, nightly) — calls each plugin's `fetchAnalytics()`, writes to `social_analytics` table. Runs 2–10 min, way past Vercel's limit. |
| 1–2 | `SocialTab.tsx` — follows [ShopTab.tsx](../components/admin/analytics/ShopTab.tsx) pattern exactly; renders `StatCard` + `HorizontalBar` reading from `social_analytics`                       |
| 2   | `ContentTab.tsx` — follows same pattern; renders blog publish cadence, newsletter open rate, Tavily research volume                                                                            |
| 2–3 | Register new tabs in [AnalyticsDashboard.tsx](../components/admin/analytics/AnalyticsDashboard.tsx) tab array                                                                                  |
| 3   | **`sendDailyPulse` Firebase Function** (Cloud Scheduler, 7 AM daily) — React Email template + Resend. Monday edition includes Tavily trending scan results.                                    |
| 3   | **`sendWeeklyContentReport` Firebase Function** (Cloud Scheduler, Friday 5 PM) — all 9 sections from main proposal doc                                                                         |
| 4   | **`voiceDriftMonitor` Firebase Function** (Cloud Scheduler, weekly) — compares recent generations against voice profile; flagged items surfaced in existing AiInsightsDashboard                |
| 4   | **`performanceLearningLoop` Firebase Function** (Cloud Scheduler, weekly) — top-3 performing posts per week appended to `few_shot_examples` JSONB on their `prompt_templates` row              |
| 4–5 | Full bug sweep, voice tuning based on 2 weeks of your feedback                                                                                                                                 |
| 5   | Dry-run of a week's content end-to-end — verify all 16 Firebase Functions fire correctly                                                                                                       |

### Your Tasks (~30 min)

| Task                                                  | Est. Time |
| ----------------------------------------------------- | --------- |
| Review first Daily Pulse draft                        | 5 min     |
| Review first Weekly Content Report draft              | 15 min    |
| Feedback on report format, data points, order, length | 10 min    |

### Checkpoint 5 (End of Week 5)

30-min call. Walk through:

- First real Weekly Content Report in your inbox
- Monday edition of Daily Pulse with Tavily trending scan
- Review any remaining issues or preferences before final handoff week

---

## Phase 6: Final Review, Training & Handoff (Week 6)

**Goal:** You run the system solo by end of week. The core system is fully live; per-platform connections are either already set up (if you had accounts) or waiting for you to activate via the Platform Connections UI. Final payment on delivery.

### Deliverables

- ✅ Full week of live content generation (publishing only to platforms you've connected — any disconnected platforms queue `Awaiting Connection` posts for later activation)
- ✅ **Self-service Platform Connections UI** fully documented: step-by-step setup guide per platform (non-developer friendly)
- ✅ Admin documentation (in-dashboard help panels + PDF handbook)
- ✅ Video training library (5–7 short Loom recordings covering every workflow + **"How to connect a new platform"**)
- ✅ 60-min live training session — includes walkthrough of activating a platform post-handoff
- ✅ Post-launch support plan (2 weeks of Slack/email support included)
- ✅ Emergency rollback procedures documented
- ✅ Final 50% payment ($2,000) on successful handoff

### Engineering Tasks

| Day | Task                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–2 | Live full week of content generation — monitor every step, fix any issues in real-time                                                                                                                                                    |
| 2   | **Per-platform setup guides** — one step-by-step article per plugin (Facebook Page creation, IG Business conversion, TikTok setup, YouTube channel creation, LinkedIn Company Page setup), rendered inline in the Platform Connections UI |
| 2–3 | Write in-dashboard help panels (tooltips + "learn more" links per section)                                                                                                                                                                |
| 3   | Record Loom training videos: Upload a video, Approve a batch, Handle a rejection, Read the weekly report, Adjust brand voice, Pause the system, Export your data, **Activate a new platform**                                             |
| 4   | Written PDF handbook — the full system documented in one place                                                                                                                                                                            |
| 4   | 60-min training session with you                                                                                                                                                                                                          |
| 5   | Final sanity sweep; handoff packet delivered; final invoice sent                                                                                                                                                                          |

### Your Tasks (~2 hours total)

| Task                                                                               | Est. Time |
| ---------------------------------------------------------------------------------- | --------- |
| Approve a real week's worth of content end-to-end                                  | 45 min    |
| Live training session (includes activating one platform together as a walkthrough) | 60 min    |
| Review handoff packet and documentation                                            | 15 min    |
| Final 50% payment                                                                  | 5 min     |

### Post-Launch Support (Included, Weeks 7–8)

- 2 weeks of Slack / email support
- Up to 2 hours of tuning / adjustments
- Bug fixes (no time limit on genuine bugs from the build)
- After Week 8: available for ongoing support on an hourly or retainer basis

### Checkpoint 6 — LAUNCH

**End-of-build call.** The system is yours. Sign off on delivery. Final payment.

---

## Adding Platforms After Handoff (Self-Service)

After Week 6, you can activate any of the 6 plugins whenever you're ready — no developer needed, no extra cost, no new build fee.

### The Activation Flow (Per Platform)

1. **Log into the admin** → Platform Connections tab
2. **Find the platform** you want to activate (status: `Not Connected`)
3. **Read the inline setup guide** — written for non-developers, specific to your situation (e.g., "Don't have a Facebook Page yet? Here's how to create one in 15 minutes.")
4. **Click Connect** — a guided OAuth flow opens in a new tab
5. **Grant permissions** to DJP Athlete's pre-approved developer app
6. **Done.** Status flips to `Connected`. Any queued `Awaiting Connection` posts either publish immediately or wait for their scheduled time.

### Per-Platform Setup Guides (Delivered in Week 6)

Each guide covers both "I don't have an account yet" and "I have an account already":

| Platform              | Account Creation Time | Activation Time (If Account Exists) |
| --------------------- | --------------------- | ----------------------------------- |
| Facebook Page         | 15 min                | 2 min (OAuth)                       |
| Instagram Business    | 5 min (convert)       | 2 min (linked via Meta app)         |
| TikTok                | 10 min                | 3 min (OAuth + API key)             |
| YouTube channel       | 10 min                | 2 min (OAuth)                       |
| LinkedIn Company Page | 20 min + verify       | 2 min (OAuth)                       |
| Meta Business Manager | 15 min                | 2 min (auto-detects linked assets)  |

### What Works Regardless of Connection Status

Even with zero platforms connected, the system still:

- Generates captions for every platform whenever you upload a video
- Generates blog articles and newsletters (these publish to your own site + email list — not dependent on social plugins)
- Sends Daily Pulse and Weekly Content Report emails
- Runs Tavily trending scans
- Tracks analytics **on whatever is connected**

As you connect each platform, that platform's engagement data starts flowing into your Weekly Report automatically. No reconfiguration.

### Pausing / Disconnecting a Platform

Same UI, opposite direction. Pause stops publishing but keeps credentials; Disconnect removes credentials entirely. Queued posts for a paused platform accumulate until you re-enable.

---

## Dependency Map

Not all work can run in parallel. Here's what blocks what:

```
[Phase 0: voice inputs] ─┐
                         ├──→ [Phase 1: brand voice, DB, plugin framework, OUR dev apps submitted]
                         │           │
                         │           ├──→ [LinkedIn approval 5-10 days] ──┐
                         │           ├──→ [Meta approval 1-2 days]       │
                         │           ├──→ [TikTok approval 3-5 days]     │
                         │           └──→ [YouTube OAuth (same-day)]     │
                         │                                                ▼
                         │                           [Phase 2: plugins built + tested vs sandboxes]
                         │                                                │
                         │                                                ▼
                                                              [Phase 3: video pipeline]
                                                                          │
                                                         ┌────────────────┼────────────────┐
                                                         ▼                                 ▼
                                          [Phase 4: blog engine]              [Phase 4: newsletter]
                                                         │                                 │
                                                         └────────────────┬────────────────┘
                                                                          ▼
                                                          [Phase 5: reports + analytics]
                                                                          │
                                                                          ▼
                                                           [Phase 6: handoff + self-service UI]
                                                                          │
                                                                          ▼
                                     [Post-handoff: you activate each platform whenever ready]
```

**Client accounts are NOT on the critical path.** The build completes on schedule regardless of when you create Facebook, Instagram, TikTok, YouTube, or LinkedIn accounts. The only critical dependency is LinkedIn Marketing Developer Platform approval for **our** app (5–10 business days, submitted Phase 0 Day 1).

---

## Risks & Mitigations Per Phase

| Phase | Risk                                                             | Mitigation                                                                                                  |
| ----- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 0     | You don't have social accounts yet                               | **Not a blocker.** Plugin architecture + sandbox accounts mean we build everything without your accounts.   |
| 1     | Brand voice drift — AI sounds generic                            | Voice profile goes through 2 drafts, tested against 20 sample outputs before sign-off                       |
| 1     | LinkedIn developer app approval delayed beyond 10 days           | Submitted Week 0; LinkedIn plugin falls back to queue-only mode until approved — doesn't block build        |
| 2     | Platform API rate limits or unexpected errors in production      | Every plugin built with exponential backoff, dead-letter queue, and alert on repeated failures              |
| 3     | Video transcription inaccurate on specialized fitness terms      | AssemblyAI is industry-leading on this; if needed, we add a custom vocabulary file                          |
| 3     | Generated captions feel off-brand                                | Week 3 checkpoint catches this early; voice profile tuned before blog engine starts                         |
| 4     | Tavily returns noisy or low-quality research                     | Built-in result ranking + source trust scoring; approval UI flags unverifiable claims                       |
| 4     | Blog publishing integration breaks due to your site's CMS quirks | Scoped discovery Day 1 of Phase 4; alternative: generate article markdown for manual paste if needed        |
| 5     | Analytics data from platforms is delayed or incomplete           | Nightly sync with 24-hour grace window; manual refresh button; analytics-per-plugin so disconnected ≠ break |
| 6     | You haven't created accounts by handoff                          | **Expected, not a risk.** Self-service Platform Connections UI + per-platform setup guides handle this.     |
| 6     | Bugs discovered during handoff week                              | 2-week post-launch support buffer absorbs anything non-critical                                             |

---

## Weekly Client Time Commitment

Your total time commitment across 6 weeks: **~7 hours**.

| Week | Your Time | What You're Doing                                                      |
| ---- | --------- | ---------------------------------------------------------------------- |
| 0    | ~90 min   | Sample content, voice input prep, kickoff call (accounts NOT required) |
| 1    | ~90 min   | Brand voice interview + dashboard preview approval                     |
| 2    | ~20 min   | Integration test review                                                |
| 3    | ~45 min   | First video fanout review + caption feedback                           |
| 4    | ~60 min   | First blog + newsletter review and approval                            |
| 5    | ~30 min   | First report format review                                             |
| 6    | ~2 hours  | Live week review + 60-min training + signoff                           |
| 7–8  | Ad hoc    | Post-launch questions (included)                                       |

Compare: ~7 hours of your time, invested once, in exchange for **600–1,000 hours per year back** starting Week 7.

---

## Success Criteria

Each phase has an objective pass/fail bar. The build is not "done" until every one is green.

| Phase | Success Criterion                                                                                                                                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Voice inputs collected; LinkedIn developer app submitted; kickoff call held                                                                                                                                                                    |
| 1     | Migrations 00076–00081 applied; voice profile signed off as `prompt_templates` rows; plugin framework + registry live; sidebar items added to AdminSidebar                                                                                     |
| 2     | All 6 plugins publish successfully to our sandbox accounts via the new `PublishPlugin` interface; existing ai-jobs API handles the `video_transcription` and `social_fanout` job types                                                         |
| 3     | You upload a video → 6 captions appear in approval queue via existing `useAiJob` polling pattern; first sandbox publish successful                                                                                                             |
| 4     | Existing BlogGenerateDialog now generates from video transcripts with Tavily research + fact-check; NewsletterGenerateDialog auto-drafts from published blog posts; articles publish to `blog_posts` and render on your Next.js marketing blog |
| 5     | `SocialTab` and `ContentTab` live in existing AnalyticsDashboard; Weekly Content Report + Daily Pulse arrive via existing Resend pipeline; AI Usage dashboard shows social-generation tokens inheriting from existing token-utils              |
| 6     | You run a full week of content generation solo using your existing admin UI (extended, not replaced); platform activation self-service; final payment issued                                                                                   |

---

_Questions about any phase? Raise them before kickoff — every phase can be adjusted if something doesn't fit your workflow. But the total timeline and build fee hold: 6 weeks, $4,000 flat._
