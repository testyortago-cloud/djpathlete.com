# DJP Athlete AI Automation — Starter Plan

## Social Media + Content Automation — $4,000 USD

_A detailed build proposal for the Starter tier of the DJP Athlete AI Automation Ecosystem._

---

## Table of Contents

1. [Overview](#overview)
2. [What You Get](#what-you-get)
3. [Platforms Covered](#platforms-covered)
4. [Module 1: Social Media Automation](#module-1-social-media-automation)
5. [Module 2: Video-to-Caption Workflow](#module-2-video-to-caption-workflow)
6. [Module 3: Blog & Newsletter Content Engine](#module-3-blog--newsletter-content-engine)
7. [Module 4: Approval Workflow](#module-4-approval-workflow)
8. [Module 5: Automated Email Reports](#module-5-automated-email-reports)
9. [Module 6: Admin Dashboard Additions](#module-6-admin-dashboard-additions)
10. [Module 7: Live Web Research via Tavily](#module-7-live-web-research-via-tavily)
11. [APIs & Services Connected](#apis--services-connected)
12. [What's NOT Included](#whats-not-included)
13. [6-Week Implementation Timeline](#6-week-implementation-timeline)
14. [What We Need From You](#what-we-need-from-you)
15. [Investment & ROI](#investment--roi)
16. [Day-to-Day Experience](#day-to-day-experience)
17. [Ongoing Running Costs](#ongoing-running-costs)
18. [Risks & Safeguards](#risks--safeguards)
19. [Upgrade Path](#upgrade-path)
20. [Getting Started](#getting-started)

---

## Overview

The Starter package is designed for one goal: **get AI-powered social media and content automation live in your business in 6 weeks, at a flat one-time build fee of $4,000 USD**.

After this build, your marketing content — captions, blog articles, newsletters — is generated, scheduled, and reported on automatically. You review and approve. Nothing publishes without you.

**Who this is for:**

- Coaches who are losing 10–20 hours a week to content creation
- Coaches currently paying a VA or freelancer $500–$1,500/month for social media
- Coaches with a backlog of video content they can't repurpose fast enough
- Coaches who want a real content engine but don't yet need paid ads automation or a full athlete database

**What makes it different:**

- **One-time fee.** You own the system. No monthly SaaS, no per-seat pricing, no vendor lock-in.
- **Built into your existing DJP Athlete platform.** Not a third-party dashboard — new tabs inside the admin panel you already use.
- **Your data lives in your own Supabase database.** You can export everything any time.
- **AI trained on your voice, your products, your exercise library.** Not generic fitness content.
- **Plug-and-play platform architecture.** Every social platform is a self-contained plugin. You don't need Facebook, Instagram, TikTok, YouTube, or LinkedIn accounts created before or during the build — activate each one self-service, whenever you're ready, via a guided setup UI.

---

## What You Get

| Feature                        | What It Does                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Social Media Automation**    | AI-generated captions and hashtags for Facebook, Instagram, TikTok, YouTube, YouTube Shorts, and LinkedIn              |
| **Content Calendar**           | Weekly and monthly calendars with AI-suggested posts in your brand voice                                               |
| **Video-to-Caption Workflow**  | Upload a video → AssemblyAI transcribes → AI writes captions for every platform                                        |
| **Blog Content Engine**        | SEO-optimized articles generated from your video transcripts and training IP                                           |
| **Live Web Research (Tavily)** | Real-time web search feeds trending topics, competitor gaps, and fresh angles into every blog, caption, and newsletter |
| **Newsletter Automation**      | Blog content automatically reformatted into email newsletters via Resend                                               |
| **Approval Workflow**          | Review, edit, and approve everything before it goes live                                                               |
| **Weekly Content Report**      | Performance email every Friday — what worked, what didn't, what's next                                                 |
| **Daily Quick Pulse**          | Short morning digest in your inbox                                                                                     |
| **Admin Dashboard**            | New Social + Content sections inside your existing admin panel                                                         |

---

## Platforms Covered

| Platform           | Automation Level | Post Types                           | How It Works                                                          |
| ------------------ | ---------------- | ------------------------------------ | --------------------------------------------------------------------- |
| **Facebook**       | Full             | Text, image, video, link, stories    | Auto-publishes via Meta Graph API                                     |
| **Instagram**      | Full             | Photo, carousel, reels, stories      | Auto-publishes via Instagram Graph API (Business/Creator)             |
| **TikTok**         | Hybrid           | Video with captions                  | AI writes the caption → you paste and post natively (~30 s)           |
| **YouTube**        | Full             | Long-form video, title, description  | Auto-publishes via YouTube Data API v3                                |
| **YouTube Shorts** | Full             | Short video (≤60 s), title, captions | Auto-publishes via YouTube Data API (same pipeline, #Shorts flag)     |
| **LinkedIn**       | Full             | Text, image, video, article posts    | Auto-publishes via LinkedIn Marketing API (Company Page)              |
| **Blog (DJP)**     | Full             | Long-form SEO articles               | Publishes directly to your Next.js site (internal `blog_posts` table) |
| **Newsletter**     | Full             | Email campaigns                      | Sends via Resend (already in your stack)                              |

**Why TikTok is hybrid:** TikTok's algorithm favors native posts. We save you the writing (the hardest part) while you keep the algorithm boost by posting natively. Total time per TikTok: ~30 seconds. As TikTok's API matures, we can flip this to fully automated without rebuilding anything.

**A note on YouTube Shorts:** Shorts publish through the same YouTube Data API as long-form videos — a short is just a vertical video ≤60 seconds with the `#Shorts` tag, which our pipeline handles automatically. No hybrid step required.

**A note on LinkedIn:** Full automation uses a LinkedIn **Company Page** via the Marketing Developer Platform (free, requires app approval during Week 1). Posting to a personal profile is also supported but has stricter rate limits — a Company Page is recommended.

---

## Module 1: Social Media Automation

**What it does:**

- Generates a full weekly or monthly content calendar based on your training programs, client success patterns (anonymized), fitness themes, and seasonal trends.
- Writes **platform-specific captions** — Instagram, Facebook, TikTok, YouTube, YouTube Shorts, and LinkedIn each get their own tone, length, and hashtag style. The AI understands the differences.
- Suggests **relevant hashtags** based on your niche (rotational athletes, comeback athletes, online coaching) and target audience.
- **Schedules approved posts** to publish at optimal times based on your historical engagement.
- **Tracks performance** — engagement rate, reach, follower growth — and learns what works.

**Where the content comes from:**

The AI pulls from assets you already have but don't repurpose:

- Your exercise library (300+ exercises with descriptions, cues, categories)
- Your training programs (Comeback Code, Rotational Reboot) and methodologies
- Your coaching philosophy and brand voice guide
- Seasonal themes (pre-season, New Year, summer prep)
- Any video you upload (see Module 2)

**Your workflow:**

1. Open the dashboard → Social tab
2. Review the week's queued posts (usually 5–10 across platforms)
3. Tap Edit on any you want to change
4. Hit Approve Batch
5. Facebook, Instagram, YouTube, YouTube Shorts, and LinkedIn auto-publish at their scheduled times; TikTok captions get copied to clipboard when it's time

**Time saved:** 10–15 hours per week — research, writing, hashtag hunting, scheduling across 7 platforms.

---

## Module 2: Video-to-Caption Workflow

This is the highest-leverage feature in the Starter package. **Upload one video → get content for every platform.**

### The Flow

```
                          Your Video Upload
                                │
    ┌──────────┬──────────┬─────┼─────┬───────────┬──────────┬──────────────┬────────────┐
    ▼          ▼          ▼     ▼     ▼           ▼          ▼              ▼            ▼
Instagram   TikTok    Facebook  YT   YT Shorts  LinkedIn   Blog         Newsletter   (metadata:
Caption     Caption   Caption   desc  caption   post       Article      (email        hashtags,
+ hashtags                      +     + hook    (pro tone, (full SEO    version       schedule,
                                tags                       article)      + link)       thumbnail)
```

### Step-by-Step

1. **You upload** a phone video (coaching clip, exercise demo, training tip).
2. **AssemblyAI transcribes** the audio — fitness-terminology-aware, seconds to complete.
3. **The AI reads the transcript** and extracts the exercise/topic, key coaching points, target audience, and linked products.
4. **The AI writes platform-specific content** — short and punchy for Instagram, hook-driven for TikTok and YouTube Shorts, detailed for Facebook, SEO-rich title + description + tags for YouTube long-form, professional/authority tone for LinkedIn, 800–1,200 words for the blog, condensed for newsletter.
5. **You review and approve** everything in the dashboard.
6. **The system publishes** (or copies to clipboard for TikTok) at the scheduled times.

### Cost Per Video

AssemblyAI's free tier covers up to ~333 hours of audio. For your content volume, **transcription is effectively free**. Past the free tier, cost is well under $0.01 per video.

### Real Example — Landmine Rotational Press

From one 90-second video where you coach the landmine rotational press:

- **Instagram:** Short hook, 3 bullet benefits, CTA to Rotational Reboot, 20–30 hashtags
- **TikTok:** One-line hook, 5–7 trending hashtags
- **Facebook:** Longer explainer, linked to Rotational Reboot in comments
- **YouTube (long-form):** SEO-optimized title ("The Landmine Rotational Press: A Full Breakdown for Rotational Athletes"), 300–500 word description with timestamps and links, 10–15 tags, chapter markers, end-screen + pinned comment CTA
- **YouTube Shorts:** Vertical cut + 1-line hook caption, `#Shorts` tag, 3–5 niche hashtags
- **LinkedIn:** Professional-tone post framing the exercise as a coaching insight — "Here's a drill I use with every rotational athlete I work with..." — CTA to your coaching services, 3–5 industry hashtags
- **Blog:** Full 800+ word SEO article with embedded video, meta description, internal links to program page
- **Newsletter:** 2-paragraph teaser with link to the full blog article

All generated, queued for your review, and ready to schedule in under a minute.

---

## Module 3: Blog & Newsletter Content Engine

**What it does:**

- Generates **SEO-optimized blog articles** for your DJP Athlete website.
- Handles technical SEO automatically: meta titles, meta descriptions, header structure, internal links, schema markup, sitemap updates.
- Creates **matching newsletter versions** for your email list.
- Builds a **consistent publishing schedule** (default: 2 blog posts/week, 1 newsletter/week — configurable).

**Content types the AI can produce:**

| Type                 | Example                                              | SEO Value                      |
| -------------------- | ---------------------------------------------------- | ------------------------------ |
| How-to guides        | "5 Rotational Exercises Every Golfer Needs"          | High — specific search queries |
| Program explainers   | "Why Periodization Matters for Comeback Athletes"    | Medium — authority building    |
| Myth-busting         | "No, You Don't Need to Stretch Before Every Workout" | High — attention-grabbing      |
| Client spotlights    | "How [Client] Returned to Competition After Injury"  | Medium — social proof          |
| Seasonal content     | "Pre-Season Training Checklist for Fall Sports"      | High — seasonal traffic        |
| Video-based articles | Full article built from a video you recorded         | Very High — original + embed   |

**Sources the AI draws from:**

- Your exercise library and program content
- Your video transcripts (highest-value source — original, expert content)
- SEO research on what your market is searching
- Your products and service pages

**Newsletter flow:**

Each published blog article auto-generates an email-formatted version. It gets queued in the Newsletter tab. You review, approve, and Resend sends it to your list on a set schedule (default: Fridays).

**Time saved:** 6–10 hours per week — research, writing, editing, SEO, email formatting.

---

## Module 4: Approval Workflow

**Nothing publishes without your approval.** This is the safety net.

### Approval States

Every piece of content flows through clear states visible in the dashboard:

1. **Draft** — AI has generated it, waiting for review
2. **Edited** — You made changes
3. **Approved** — Queued for publishing at scheduled time
4. **Published** — Live on platform, tracking engagement
5. **Rejected** — Sent back to AI with feedback so next generations improve

### What You Can Do

- **Edit inline** — change captions, swap hashtags, adjust tone
- **Approve in batches** — approve a full week in one click
- **Schedule override** — move a post to a different time or day
- **Teach the AI** — rejections with feedback train the system to match your voice better over time

### Voice Drift Protection

The AI is bounded by your brand voice profile (built during Phase 1). If a generation starts drifting toward generic fitness content, you mark it, and that pattern is suppressed going forward.

---

## Module 5: Automated Email Reports

You shouldn't need to log in daily to know what's happening. Two reports come to your inbox on the Starter plan:

### Daily Quick Pulse

Short morning email, arrives at 7:00 AM. Scannable in 30 seconds.

- Content scheduled for today
- Any posts that hit a performance milestone yesterday
- Anything pending your approval
- One-line AI summary of yesterday's activity

### Weekly Content Report

Arrives Friday at 5:00 PM. Full recap of the week.

**What's in it:**

| Section                | Data Shown                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Posts published        | Count by platform, with engagement rate                                              |
| Top performing post    | Which post won and why (AI-written explanation)                                      |
| Follower growth        | Net new across Facebook, Instagram, TikTok, YouTube, and LinkedIn                    |
| Reach & impressions    | How many people saw your content                                                     |
| Best posting times     | Which days/times drove the highest engagement this week                              |
| Hashtag performance    | Which hashtags drove discovery                                                       |
| Content type breakdown | Video vs. carousel vs. image vs. text                                                |
| Blog performance       | Articles published, organic traffic, top-performing article                          |
| Newsletter performance | Open rate, click rate, top clicked link                                              |
| AI recommendations     | "Do more of X, less of Y, test Z next week" — plain-English insights, not raw tables |

The full custom report builder and smart alert system (viral content alerts, trend detection, budget alerts, etc.) are **Professional tier** features. The Starter reports are fixed templates — well-designed, but not customizable per-field.

---

## Module 6: Admin Dashboard Additions

The Starter build adds two new sections inside your **existing** DJP Athlete admin dashboard (not a separate tool):

### Social Tab

- Content calendar (week / month views)
- Queued posts (pending approval)
- Published posts (with engagement metrics)
- Video upload + status tracking
- Brand voice settings

### Content Tab

- Blog article queue (drafts, scheduled, published)
- Newsletter queue
- Topic pipeline (what AI suggests writing next)
- SEO keyword tracking (basic — what you rank for, on-page)

Everything matches your existing admin styling: Green Azure sidebar, accent active state, Lexend fonts. Feels like the same product — because it is.

---

## Module 7: Live Web Research via Tavily

The AI doesn't know what's trending this week. Tavily fixes that.

**Tavily** is a web search API purpose-built for LLMs — it returns clean, pre-processed content that Claude can use as context before generating. Adding it gives your Starter system **real-time awareness** without upgrading to the Professional tier's Google Search Console integration.

### Where Tavily Plugs Into the Starter Pipeline

| Pipeline Stage                 | What Tavily Does                                                                                                  | Why It Matters                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Blog topic research**        | Pulls the current top-ranking pages for a target keyword before the AI writes                                     | Articles hit current search intent instead of 6-month-old assumptions                              |
| **Fresh angle discovery**      | Surfaces what competitors are publishing on rotational training, ACL return, golf fitness                         | Finds gaps — topics nobody's covering well                                                         |
| **Trending hashtag research**  | Scans current fitness / sport-specific trends across the web weekly                                               | Hashtags stay current; no more using last year's tags                                              |
| **Caption context enrichment** | Surfaces recent events (pro-athlete comebacks, injury news, tournament results) tied to the topic you just filmed | Captions feel of-the-moment, not evergreen-generic                                                 |
| **Newsletter curation**        | Pulls 2–3 industry stories worth referencing each week                                                            | Newsletter becomes a real curation, not just a blog repost                                         |
| **Claim verification**         | Before the AI writes "studies show X" or "research proves Y," Tavily checks if that's still current               | Brand safety — no outdated or fabricated claims                                                    |
| **SEO keyword expansion**      | Discovers long-tail keywords people actually search, from live SERPs                                              | Partial substitute for the Google Search Console tracking you'd otherwise wait for in Professional |

### A Concrete Example

**Without Tavily:** You record a video on rotational training. The AI generates a blog post titled "5 Exercises for Rotational Power" using its training data — solid but generic.

**With Tavily:** Before writing, the AI runs a Tavily search for `rotational training exercises golf 2026`. It finds:

- Top ranking competitor articles (to beat on quality and angle)
- A recent PGA Tour study on rotational velocity
- A trending debate about anti-rotation vs. rotational training

The AI generates a blog titled **"Anti-Rotation vs. Rotational Power: What the Latest Research Says for Golfers"** — a timely, differentiated article that cites current sources and targets a keyword cluster people are actively searching right now.

Same video. Dramatically better output.

### What We Build

- **Topic research action** in the Content tab — click a button, get a research brief on any topic before drafting
- **Weekly trending scan** — Tavily runs every Monday morning and surfaces 5–10 topic ideas ranked by opportunity
- **Inline research during generation** — the blog + newsletter AI automatically calls Tavily before long-form writing
- **Fact-check pass** — before any blog publishes, the AI verifies its own claims against live sources; flags unverifiable claims in the approval UI

### Cost & Setup

| Item                  | Detail                                                               |
| --------------------- | -------------------------------------------------------------------- |
| Free tier             | 1,000 API calls/month — covers typical Starter content volume        |
| Paid tier (if needed) | ~$30/month for 4,000 calls — only if you scale content significantly |
| Setup work            | ~half a day during Week 2; one new env var (`TAVILY_API_KEY`)        |
| Impact on build fee   | **None.** Included in the $4,000 Starter fee if added at kickoff.    |

### Risks & Limits

- Tavily won't replace **keyword ranking tracking** (that requires Google Search Console — Professional tier). It tells you _what's being searched and published_, not _where you personally rank_.
- Like any web search, results can include noise. The AI is instructed to cite sources and the approval workflow still gives you final review.

---

## APIs & Services Connected

| Service                    | Purpose                                       | Cost                                                                          |
| -------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| **Meta Graph API**         | Facebook + Instagram publishing               | Free                                                                          |
| **TikTok Content API**     | Hybrid caption workflow                       | Free (developer application required)                                         |
| **YouTube Data API v3**    | YouTube + YouTube Shorts publishing           | Free (10,000 quota units/day — well above our usage)                          |
| **LinkedIn Marketing API** | LinkedIn Company Page publishing              | Free (Marketing Developer Platform app approval)                              |
| **Tavily**                 | Live web research for blogs, captions, trends | Free 1,000 calls/mo; ~$30/mo if scaled                                        |
| **Firebase Functions**     | All time-consuming AI + Tavily + cron work    | Free tier: 2M invocations/mo, 400K GB-seconds — likely free at Starter volume |
| **AssemblyAI**             | Video transcription                           | Free up to ~333 hrs audio/month                                               |
| **Anthropic Claude**       | AI content generation                         | Already in your stack                                                         |
| **Resend**                 | Newsletter email delivery                     | Already in your stack                                                         |
| **Supabase**               | Data storage (your database)                  | Already in your stack                                                         |

No new recurring software subscriptions for you to manage. Running costs for a coach at your volume are typically **$15–$140/month in AI token usage + Tavily + Firebase Functions** (see [Ongoing Running Costs](#ongoing-running-costs)).

---

## What's NOT Included

To keep Starter at $4,000 and deliver in 6 weeks, these features are **excluded** and are only available in Professional ($5,000) or Enterprise ($7,000):

| Feature                                             | Tier Required |
| --------------------------------------------------- | ------------- |
| Google Ads AI optimization                          | Professional+ |
| Google Ads reporting                                | Professional+ |
| SEO keyword ranking tracking (GSC)                  | Professional+ |
| Custom report builder                               | Professional+ |
| Smart alert emails (viral, anomalies)               | Professional+ |
| Monthly executive summary PDF                       | Professional+ |
| Client/training app activity reporting              | Enterprise    |
| Video editing platform                              | Enterprise    |
| Athlete performance database (Airtable replacement) | Enterprise    |
| Stripe revenue reporting                            | Enterprise    |

**Why this matters:** you can always upgrade later. The Starter codebase is built modularly — Professional and Enterprise add modules on top of the same foundation. You never rebuild what you already bought.

---

## 6-Week Implementation Timeline

### Weeks 1–2: Foundation

- Database schema for content, captions, calendar, analytics
- Brand voice profile built from your sample content
- API connections: Meta (FB + IG), TikTok, YouTube Data API, LinkedIn Marketing API, AssemblyAI, Claude, Tavily, Resend
- Admin dashboard shell: Social and Content tabs scaffolded
- Your voice guide reviewed and approved

**Milestone:** All platforms connected, AI knows your voice.

### Weeks 3–4: Social Media + Video Workflow

- Content calendar + caption generation
- Video upload + AssemblyAI transcription pipeline
- Platform-specific caption generation (IG, FB, TikTok)
- Automated posting for Facebook, Instagram, YouTube, YouTube Shorts, and LinkedIn
- TikTok hybrid workflow (notification + clipboard copy)
- Approval workflow end-to-end
- First test batch of posts for your review

**Milestone:** First full week of AI-generated social content goes live.

### Weeks 5–6: Content Engine + Reports + Polish

- Blog article generation pipeline
- Video-to-article workflow
- SEO optimization (meta, headers, internal links, schema)
- Publishing integration with your website
- Newsletter generation and Resend sending
- Daily pulse + weekly content report email templates
- Fine-tuning based on your feedback from weeks 3–4
- Handoff documentation

**Milestone:** Full Starter ecosystem live. First weekly report lands in your inbox.

---

## What We Need From You

**Credentials & access (all OPTIONAL at kickoff — see note below):**

1. Facebook Page admin access _(if you have one)_
2. Instagram Business or Creator account credentials _(if you have one)_
3. TikTok account _(if you have one)_
4. YouTube channel admin _(if you have one)_
5. LinkedIn Company Page admin _(if you have one)_
6. Resend API key (already in stack — confirm)
7. DJP Athlete admin access (already yours)

**You do NOT need to have the social accounts created to start or finish the build.** Every platform is built as a self-contained plugin tested against our own sandbox accounts during the 6-week build. You activate each one — with a guided, non-developer setup flow in the admin — whenever you're ready. Details in [DJP-AI-Automation-Starter-Phases.md](./DJP-AI-Automation-Starter-Phases.md).

**Content & voice inputs:**

6. **30 minutes** on a call to walk through your brand voice, tone, and messaging
7. **5–10 examples** of social posts, captions, or articles you love (yours or reference)
8. **3–5 sample videos** to test the transcription and caption workflow
9. **Your product and service list** with descriptions (Comeback Code, Rotational Reboot, etc.)
10. **Any existing style rules** (words you use/don't use, boundaries on client stories, disclaimers)

That's it. We handle everything else.

---

## Investment & ROI

### One-Time Build Fee

**$4,000 USD** — flat, one-time. Paid 50% on kickoff, 50% on Week 6 delivery.

### Annual Impact

| Metric                               | Without Automation  | With Starter                           |
| ------------------------------------ | ------------------- | -------------------------------------- |
| VA / freelancer costs                | $6,000 – $18,000/yr | $0                                     |
| AI system costs (tokens)             | $0                  | $180 – $1,200/yr                       |
| Your time on content operations      | 728 – 1,144 hrs/yr  | 104 – 156 hrs/yr                       |
| **Year 1 savings (after build fee)** | —                   | **$1,800 – $13,800 + 600–1,000 hours** |
| **Year 2+ annual savings**           | —                   | **$5,800 – $17,800 + 600–1,000 hours** |

### Payback Period

At a conservative $700/month VA replacement, the build pays for itself in **~6 months**. After that, every month is pure savings.

### Time Reclaimed

You get back **12–20 hours per week** — roughly half a working day per day — that was previously going to content creation, editing, scheduling, and reporting. That time can go to coaching, product development, or living your life.

---

## Day-to-Day Experience

Here's what a typical week looks like **after the Starter build is live**:

### Monday (5 minutes)

- Daily Pulse email arrives at 7 AM — quick scan
- Included in the Pulse: **Tavily's Weekly Trending Scan** — 5–10 fresh topic ideas ranked by opportunity (competitor gaps, rising searches, timely events in rotational training / comeback / golf fitness)
- Star any topics worth writing about this week — they get pushed to the content queue
- Open dashboard, scan the week's queued posts, hit Approve Batch
- Your week's social media is set up

### Tuesday (5 minutes)

- You film a coaching video on your phone
- Upload to the dashboard
- Tavily runs a quick context lookup for the exercise/topic in your video (recent research, trending discussion, timely events)
- Within a minute: Instagram, TikTok, Facebook, YouTube (title + description + tags), YouTube Shorts, and LinkedIn captions + full blog draft (with cited sources from Tavily) + newsletter version, all queued
- Review, approve

### Wednesday (2 minutes from your inbox)

- Alert-style email: "2 blog articles ready for review"
- Tap the link, read in dashboard, add a personal note if you want
- Approve → scheduled to publish Thursday and Saturday

### Thursday (0 minutes)

- Scheduled content auto-publishes to Facebook, Instagram, YouTube, YouTube Shorts, LinkedIn, and your blog
- TikTok: notification on your phone saying caption is ready — 30 seconds to paste and post

### Friday (5 minutes from your inbox)

- Weekly Content Report arrives at 5 PM
- Scan the wins, see which post landed, read the AI's "do more of X" recommendation for next week
- Newsletter auto-sends to your list

**Total weekly time investment: ~20 minutes.** Most of it from your inbox, on your phone.

---

## Ongoing Running Costs

After the one-time build fee, here's what running the system actually costs you:

| Service                | Monthly Cost          | Notes                                                             |
| ---------------------- | --------------------- | ----------------------------------------------------------------- |
| Anthropic (Claude)     | $15 – $100            | AI generation — scales with content volume                        |
| AssemblyAI             | $0                    | Free tier (~333 hrs/month) covers typical volume                  |
| Meta Graph API         | $0                    | Free for business accounts                                        |
| TikTok API             | $0                    | Free                                                              |
| YouTube Data API       | $0                    | Free (within daily quota — well above our usage)                  |
| LinkedIn Marketing API | $0                    | Free                                                              |
| Tavily                 | $0 – $30              | Free tier = 1,000 calls/mo; paid only if content scales           |
| Firebase Functions     | $0 – $10              | Free tier (2M invocations, 400K GB-seconds) covers Starter volume |
| Resend                 | Already in your stack | No change                                                         |
| Supabase               | Already in your stack | No change                                                         |
| **Total**              | **$15 – $140/month**  | **vs. $500 – $1,500/month for a VA**                              |

No hidden fees. No per-seat pricing. No vendor lock-in — everything runs on services you control.

---

## Risks & Safeguards

### "What if the AI generates something off-brand?"

Nothing publishes without your approval. Every piece goes through review. Rejections with feedback train the AI to match you better. Over time, the approval step gets faster because the drafts get closer to publish-ready.

### "What if a platform changes its API?"

The system is modular. If Instagram changes something, we update that one connector without affecting Facebook, TikTok, your blog, or your newsletter. The TikTok hybrid workflow is specifically designed to be resilient to API changes — because the human posting step bypasses API limits entirely.

### "What if I want to stop using it?"

All your content, analytics, and history live in your own Supabase database. You can export everything. You can pause generation any time — the dashboard keeps working.

### "Will it sound like me?"

The AI is trained on your brand voice guide, your exercise library, your programs, and example content you approve. It doesn't generate generic fitness content — it generates DJP Athlete content. And you review everything.

### "What about client privacy?"

No personal client data is ever used in public content without explicit permission. The AI works with anonymized patterns and general training methodologies, not individual client information.

### "What about video transcription accuracy?"

AssemblyAI is industry-leading on specialized terminology — exercise names, anatomical terms, coaching cues. Accuracy is typically 95%+ on clear audio. Speaker identification is supported for multi-person videos.

---

## Upgrade Path

If you start with Starter and later decide you want ads automation or a full athlete database, the upgrade is **additive, not a rebuild**:

| Upgrade                       | Additional Cost | Additional Timeline                                              |
| ----------------------------- | --------------- | ---------------------------------------------------------------- |
| **Starter → Professional**    | +$1,000         | +4 weeks (Google Ads module, SEO tracking, full reporting suite) |
| **Starter → Enterprise**      | +$3,000         | +8 weeks (Pro features + video platform + athlete database)      |
| **Professional → Enterprise** | +$2,000         | +4 weeks (video platform + athlete database)                     |

You pay the difference, not the full Professional/Enterprise price. The Starter foundation is reused.

---

## Getting Started

### Week 0 (Pre-Kickoff)

1. Sign off on this document
2. 50% deposit ($2,000)
3. Schedule the 30-minute brand voice call

### Week 1 (Kickoff)

1. Credentials shared via secure handoff
2. Brand voice call
3. Development begins

### Week 6 (Delivery)

1. Full Starter system live
2. Walkthrough + handoff documentation
3. Final 50% ($2,000)
4. 2 weeks of post-launch support included

### Questions to Decide Before Kickoff

- **Post volume:** How many posts per week per platform? (Default: 2 IG / 3 FB / 2 TikTok / 1 YouTube long-form / 3 YT Shorts / 2 LinkedIn / 2 blog / 1 newsletter per week — we can tune.)
- **Approval cadence:** Do you want to approve daily, or batch-approve a week at a time?
- **Additional email recipients:** Business partner? Accountant? Who else should get the weekly report?
- **Content boundaries:** Any topics, tones, or client stories that are off-limits?

---

_Ready to lock in the Starter build? Sign off on this doc and we kick off the brand voice session within the week. Your first fully AI-generated post goes live about 4 weeks after we start._
