# Enterprise Upgrade Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: This is a **roadmap**, not a per-task implementation plan. It sequences the work and names the per-phase specs/plans that need to be drafted JIT. Use superpowers:writing-plans to draft each phase plan when that phase begins. Steps in those plans use checkbox (`- [ ]`) syntax.

**Goal:** Sequence the Enterprise package build (Professional + Enterprise tiers, $7,000) into shippable phases over ~14 weeks, with order chosen to deliver visible value early and to leverage two existing working apps (`video-editing-platform`, `athlete-performance`) that already use the same stack.

**Architecture:** Five subsystems. Two are **net-new builds** (Google Ads, SEO + Reporting). Two are **consolidations** of existing apps already running on Next.js 16 + Supabase + Tailwind v4 — not rebuilds. One is a small Stripe wrap-up. Each phase produces working software on its own.

**Tech Stack:** Existing — Next.js 16 App Router (root-level, no `src/`), Supabase, NextAuth v5, Tailwind v4, shadcn/ui, Anthropic Claude (`@ai-sdk/anthropic`), Resend, Recharts, AssemblyAI, Stripe. **Net-new** — Google Ads API, Google Search Console API, `@react-pdf/renderer` (or Puppeteer fallback) for PDF reports, `fluent-ffmpeg` (already in video repo) for clip rendering.

**Source-of-truth docs:**
- Feature spec — `docs/DJP-AI-Automation-Plan.md` lines 1384–1457 (Professional + Enterprise feature lists)
- Existing video app — https://github.com/testyortago-cloud/video-editing-platform
- Existing athlete app — https://github.com/testyortago-cloud/athlete-performance

---

## Why a roadmap, not one big plan

The Enterprise build covers five subsystems with very different shapes (greenfield API integrations vs. code consolidations). Per `superpowers:writing-plans` scope-check: "If the spec covers multiple independent subsystems, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own."

Each per-phase plan is drafted **just-in-time** when its phase begins, so the file paths and code snippets reflect the codebase state at that moment, not a guess from week 1. The consolidation phases (3, 4) need a code audit of the source repos before their plans can be written usefully.

---

## Two existing apps to consolidate (key finding)

User flagged that the video and athlete features are already built in standalone repos. Stack inspection confirms they're highly compatible:

| Aspect | `video-editing-platform` | `athlete-performance` | djpathlete (this repo) |
|---|---|---|---|
| Next.js | 16.1.4 | 16.1.6 | 16.x |
| React | 19.2.3 | 19.2.3 | 19.2.3 |
| Tailwind | v4 | v4 | v4 |
| Supabase | `@supabase/ssr` + `js` | `@supabase/supabase-js` | both |
| **NextAuth** | **v4 (mismatch)** | v5 beta | v5 beta |
| Charts | — | recharts | recharts |
| Test runner | — | vitest | vitest |
| Code layout | `src/` | `src/` | **root-level (no `src/`)** |
| Airtable migration | `scripts/seed-supabase-from-airtable.ts` ✅ | `airtable-csv/` + scripts ✅ | — |
| Special deps | `fluent-ffmpeg`, `firebase`, `googleapis` | `airtable`, `zustand` | none of the above |

**Implication:** These are ports, not rebuilds. Main consolidation work is:
1. Move source from `src/` → root-level (djpathlete convention)
2. Unify auth on NextAuth v5 (video repo currently v4 — needs adapter swap)
3. Merge supabase migrations into `supabase/migrations/`, dedupe overlap with existing `clients/programs/assessments` tables
4. Apply djpathlete brand tokens (Green Azure, Gray Orange, Lexend fonts) — no inline `fontFamily`, no hardcoded hex
5. Decide whether to adopt `zustand` repo-wide or refactor athlete state to existing patterns
6. Run their **existing** Airtable migration scripts (do not rewrite)

---

## Already in the repo (do not rebuild)

These satisfy parts of Professional/Enterprise and are reusable:

| Capability | Where | What it covers |
|---|---|---|
| Client/program/assessment DAL | `lib/db/` (28 files) | Athlete DB foundation — extend, don't replace |
| AI program generation pipeline | `lib/ai/` | 4-agent orchestration, tokens, retries |
| Stripe events checkout | `app/api/stripe/`, `scripts/backfill-events-stripe-live.ts` | Foundation for revenue tracking |
| Content analytics base | `lib/analytics/content.ts`, `lib/analytics/compute.ts`, `types/analytics.ts` | Reporting data layer |
| Weekly content report email | `__tests__/components/emails/WeeklyContentReport.test.tsx` | One of the 5 report templates already exists |
| Trending/SEO seed | `functions/src/seo-enhance.ts`, `functions/src/tavily-trending-scan.ts` | Partial SEO surface (no GSC yet) |
| Content Studio multimedia | `docs/superpowers/specs/2026-04-24-content-studio-multimedia-*` | **Audit before Phase 4** — may overlap with video library scope |
| Starter analytics phases 5a–5f | `docs/superpowers/plans/2026-04-21-starter-ai-automation-phase5*` | Daily Pulse, voice drift, learning loop |

---

## Phasing decision (revised)

Order chosen to:
1. Front-load **Google Ads** (greenfield, biggest weekly time-savings, blocks no other work).
2. Move **Athlete DB consolidation** up to Phase 2 — it's a cheap port, gets Darren off Airtable's per-user fees by week ~6 instead of week ~13. Reporting suite later reads from these tables.
3. Slot **Video platform consolidation** as Phase 3 — same rationale, reusable infrastructure (uploads, storage) before reporting needs it.
4. **SEO + Reporting suite** moves to Phase 4 — by then Ads, Athlete, and Video data sources all exist, so report templates can pull from every system in one pass instead of being retrofit later.
5. **Stripe revenue + handoff** stays last (Phase 5).

```
Week  1 ─┬─ Phase 1: Google Ads core integration                    [GREENFIELD]
      2 │
      3 │
      4 │
Week  5 ─┼─ Phase 2: Athlete DB consolidation + Airtable migration  [PORT]
      6 │
Week  7 ─┼─ Phase 3: Video platform consolidation                   [PORT]
      8 │
Week  9 ─┼─ Phase 4: SEO (GSC) + Reporting suite + Smart alerts     [GREENFIELD]
     10 │
     11 │
     12 │
Week 13 ─┼─ Phase 5: Stripe revenue reporting + retainer handoff
     14 │
```

---

## Phase 0 — Pre-flight (week 1, day 1, ≤1 day)

Things that must start day 1 because they have lead times or block decisions:

- [ ] **Apply for Google Ads developer token** (1–2 weeks approval). Owner: Darren.
- [ ] **Verify Darren's GSC site property** is accessible from his Google account. Owner: Darren.
- [ ] **Lock video host decision.** Recommend **Mux** for speed-to-launch unless cost is a blocker, then Supabase Storage + HLS. The video repo already uses `fluent-ffmpeg` server-side, so a server-rendered approach is viable too.
- [ ] **Clone both source repos read-only** to a local audit folder for Phase 2/3 inventory work:
  ```bash
  git clone https://github.com/testyortago-cloud/athlete-performance.git ../_audit/athlete-performance
  git clone https://github.com/testyortago-cloud/video-editing-platform.git ../_audit/video-editing-platform
  ```
- [ ] **Read** `_audit/athlete-performance/PLAN.md` (27 KB) and `UI_UX_PLAN.md` (14 KB) to know exactly what's already built. Same for video repo's `README.md` (25 KB).
- [ ] **PDF rendering decision** — `@react-pdf/renderer` first; fall back to Puppeteer only if charts look bad in Phase 4. No work needed yet, just a parking-lot note.

---

## Phase 1 — Google Ads AI integration (~4 weeks, weeks 1–4)

**Why first:** Largest net-new chunk; biggest weekly time-savings for Darren; no upstream dependencies; developer token approval can run in background.

**Spec to draft:** `docs/superpowers/specs/2026-05-02-google-ads-integration-design.md`

**Plans to draft (one per sub-phase):**
- `2026-05-XX-google-ads-phase1-oauth-and-sync.md` — OAuth, nightly campaign data sync into Supabase, schema for campaigns/ad-groups/keywords/metrics
- `2026-05-XX-google-ads-phase2-ai-recommendations.md` — Keyword analysis, bid recommendations, negative keyword detection (Claude-powered)
- `2026-05-XX-google-ads-phase3-automation-modes.md` — Auto-pilot / Co-pilot / Advisory mode switch + approval queue UI in `(admin)/admin/ads/`
- `2026-05-XX-google-ads-phase4-ad-copy-and-report.md` — AI ad copy A/B variants + weekly Google Ads report email

**Required env vars:** `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`

**Routes / files to create (high level):**
- `app/(admin)/admin/ads/page.tsx`, `app/(admin)/admin/ads/[campaignId]/page.tsx`
- `app/api/ads/sync/route.ts`, `app/api/ads/recommendations/route.ts`, `app/api/ads/approve/route.ts`
- `lib/ads/google-ads-client.ts`, `lib/ads/sync.ts`, `lib/ads/recommendations.ts`
- `lib/db/ads-campaigns.ts`, `lib/db/ads-recommendations.ts`
- `lib/validators/ads.ts`
- `supabase/migrations/<ts>_ads_tables.sql`
- `components/admin/ads/*`, `components/emails/WeeklyAdsReport.tsx`

**Done when:**
- All 5 campaign types (Search, YouTube Video, Retargeting, Performance Max, Lead Gen) sync nightly without errors
- AI recommendations queue + Co-pilot approval flow works end-to-end
- Auto-pilot can apply low-risk negative keywords without human approval
- Weekly Ads report emails to `COACH_EMAIL` (`darren@darrenjpaul.com` per memory) on schedule

---

## Phase 2 — Athlete DB consolidation + Airtable migration (~2 weeks, weeks 5–6)

**Why second:** Source repo is on the same stack and same auth as djpathlete (NextAuth v5 + Supabase + Tailwind v4 + Recharts). Migration script and Airtable CSV exports already exist in the source repo. Getting Darren off Airtable early kills the per-user subscription cost.

**Pre-work (must complete before plans are drafted):**

- [ ] **Audit the source repo.** Inventory:
  - All routes under `_audit/athlete-performance/src/app/`
  - All DAL files (likely under `src/lib/db/` or `src/lib/supabase/`)
  - All Supabase migrations under `_audit/athlete-performance/supabase/`
  - The Airtable migration script(s) — confirm they're parameterized and testable
  - All UI components — note brand-token mismatches (this repo uses different colors/fonts)
  - State management — `zustand` is in `package.json`; decide adopt vs refactor
  - Read `PLAN.md`, `UI_UX_PLAN.md`, `TESTING.md`, `PROFILE_ROADMAP.md` and capture deltas vs djpathlete's existing client/assessment surface
- [ ] **Schema diff.** Compare athlete-performance migrations against djpathlete's existing `clients` / `assessments` / `programs` tables. Identify:
  - Tables to add wholesale (e.g. custom field definitions)
  - Tables to merge (e.g. their `clients` vs ours)
  - Columns that conflict
- [ ] **Migration strategy decision.** Options:
  - (A) Add their tables alongside ours, write adapter views — fastest, leaves dual sources of truth
  - (B) Merge schemas, migrate our existing data into their structure (or vice versa) — cleanest, riskier
  - **Recommend (B)** because Phase 4 reporting reads from one canonical client store

**Spec to draft (after audit):** `docs/superpowers/specs/2026-05-XX-athlete-db-consolidation-design.md`

**Plans to draft:**
- `2026-05-XX-athlete-consolidation-phase1-schema-merge.md` — Supabase migrations that merge schemas + backfill existing djpathlete client data
- `2026-05-XX-athlete-consolidation-phase2-port-routes.md` — Move `src/app/...` → `app/(admin)/admin/clients/...` and `app/(client)/client/...`, applying djpathlete brand tokens (no inline `fontFamily`, no hardcoded hex)
- `2026-05-XX-athlete-consolidation-phase3-port-dal-and-state.md` — Port DAL into `lib/db/`, decide on `zustand` adoption (recommend: scope it to client-side only where stores already exist; don't introduce repo-wide)
- `2026-05-XX-athlete-consolidation-phase4-airtable-migration.md` — Run the existing migration script against Darren's live Airtable; verify with spot-check queries; cancel Airtable subscription
- `2026-05-XX-athlete-consolidation-phase5-progress-views.md` — Custom data fields editor, per-client progress charts (Recharts), CSV/PDF export, client-portal progress view

**Done when:**
- All routes/components from `athlete-performance` live under djpathlete's `(admin)/admin/clients/*` and `(client)/client/*`
- Auth uses djpathlete's NextAuth v5 (already matches source — minimal work)
- All Tailwind classes use semantic tokens (`text-primary`, `bg-accent`, etc.); no `#hex` or inline `fontFamily`
- Darren's Airtable data is fully imported; migration script's verification report shows zero data loss
- Darren's Airtable subscription can be canceled

---

## Phase 3 — Video platform consolidation (~2 weeks, weeks 7–8)

**Why third:** Same stack-port rationale as Phase 2. AssemblyAI already in djpathlete from Starter — keep it. Source repo uses `fluent-ffmpeg` server-side, so the host decision (Mux vs. Supabase Storage) actually matters for what features we keep.

**Pre-work (must complete before plans are drafted):**

- [ ] **Audit `_audit/video-editing-platform/`.** Inventory:
  - All routes under `src/app/`
  - Supabase schema under `supabase/`
  - The Airtable seed script (`scripts/seed-supabase-from-airtable.ts`) — what does it import?
  - The `googleapis` usage — likely Google Drive integration; decide keep / drop
  - The `firebase` + `firebase-admin` usage — note overlap with djpathlete's existing Firebase config
  - Read `README.md` (25 KB) and capture feature inventory
- [ ] **Cross-reference with `docs/superpowers/specs/2026-04-24-content-studio-multimedia-*`.** If multimedia work already covers upload + library, shrink Phase 3 to AI tagging + clip suggestions only.
- [ ] **NextAuth v4 → v5 migration.** Source repo uses NextAuth v4. djpathlete uses v5. Replace auth wiring during the port; do not ship a mixed v4/v5 app.

**Spec to draft (after audit):** `docs/superpowers/specs/2026-05-XX-video-consolidation-design.md`

**Plans to draft:**
- `2026-05-XX-video-consolidation-phase1-schema-and-storage.md` — Merge Supabase video tables; pick host (Mux vs. Supabase Storage); migrate any seed data
- `2026-05-XX-video-consolidation-phase2-port-routes-and-auth.md` — Move routes to `app/(admin)/admin/videos/*`, **swap NextAuth v4 wiring for v5**, apply djpathlete brand tokens
- `2026-05-XX-video-consolidation-phase3-ai-tags-and-clips.md` — AssemblyAI transcript → Claude tag/description generator → clip suggester (likely already exists in source repo; verify and port)
- `2026-05-XX-video-consolidation-phase4-content-studio-handoff.md` — Wire suggested clips into Content Studio's social schedule

**Done when:**
- Video upload, library, and search live under `app/(admin)/admin/videos/`
- Auth uses NextAuth v5 (no v4 leftovers)
- AssemblyAI transcripts populate; AI tags/descriptions render
- Clip suggestions can be one-click queued into Content Studio
- All Tailwind classes use semantic tokens

---

## Phase 4 — SEO + Reporting suite + Smart alerts (~4 weeks, weeks 9–12)

**Why fourth:** By now Ads, Athlete, and Video data sources all exist. Reporting suite reads from every system in one pass, instead of being retrofit later.

**Specs to draft:**
- `docs/superpowers/specs/2026-05-XX-gsc-integration-design.md`
- `docs/superpowers/specs/2026-05-XX-reporting-suite-design.md`

**Plans to draft:**
- `2026-05-XX-gsc-phase1-oauth-and-rankings.md` — GSC OAuth, daily ranking sync, keyword movement detector
- `2026-05-XX-reporting-phase1-template-engine.md` — shared `lib/reports/` engine: takes a template + date range + recipient list, renders, emails (powers all 5 templates)
- `2026-05-XX-reporting-phase2-templates.md` — implement remaining templates: Daily Pulse (extend existing 5d work), Weekly Review, **Ads Only** (Phase 1 data), Content Performance (extend), **Monthly Executive Summary** with PDF
- `2026-05-XX-reporting-phase3-custom-builder.md` — admin UI to compose custom reports (data sources, schedule, format, recipients)
- `2026-05-XX-reporting-phase4-smart-alerts.md` — alert engine (ad anomalies, viral content, SEO milestones, budget warnings) hooked into ads + GSC + content tables
- `2026-05-XX-reporting-phase5-training-app-data.md` — wire Athlete DB activity (sign-ups, completions, retention) into reports (data layer ready from Phase 2)

**Required env vars:** `GOOGLE_SEARCH_CONSOLE_CLIENT_ID`, `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET`, `GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN`, `GSC_SITE_URL`

**Routes / files to create:**
- `app/(admin)/admin/seo/page.tsx`, `app/(admin)/admin/reports/page.tsx`, `app/(admin)/admin/reports/builder/page.tsx`
- `app/api/seo/sync/route.ts`, `app/api/reports/run/route.ts`, `app/api/alerts/check/route.ts`
- `lib/seo/gsc-client.ts`, `lib/seo/ranking-tracker.ts`
- `lib/reports/engine.ts`, `lib/reports/templates/*` (one file per template), `lib/reports/pdf.tsx`
- `lib/alerts/engine.ts`, `lib/alerts/rules/*`
- `lib/db/seo-rankings.ts`, `lib/db/reports.ts`, `lib/db/alerts.ts`
- `components/emails/{WeeklyReview,AdsOnly,ContentPerformance,MonthlyExec}Report.tsx`

**Done when:**
- GSC pulls nightly; rankings table populated for ≥50 tracked keywords
- All 5 report templates render and email on their schedules
- Custom report builder can save + run a non-template report
- ≥4 alert rules fire correctly in staging
- Monthly Executive Summary exports as PDF and renders cleanly

---

## Phase 5 — Stripe revenue reporting + handoff (~1 week, weeks 13–14)

**Why last:** Small scope; depends on subscription products existing. Reporting suite from Phase 4 is the surface where revenue numbers land.

**Decision needed early:** Are Stripe **subscriptions** in scope, or only one-off + event purchases? Current commits suggest events-only. If subs aren't planned yet, "Revenue Tracking" is MRR-equivalent from current product mix.

**Spec to draft:** `docs/superpowers/specs/2026-05-XX-stripe-revenue-reporting-design.md`

**Plans to draft:**
- `2026-05-XX-stripe-phase1-revenue-sync.md` — webhook + nightly reconciliation into a `revenue_events` table
- `2026-05-XX-stripe-phase2-revenue-in-reports.md` — surface MRR / new sales / churn in Monthly Executive Summary + a Revenue tab in admin

**Done when:**
- Stripe webhook captures all relevant events (`charge.succeeded`, `invoice.paid`, `customer.subscription.{created,updated,deleted}`, `charge.refunded`)
- Monthly Executive Summary includes revenue (MRR, new sales, churn)
- Reconciliation script flags any mismatch between Stripe dashboard and DB

**Handoff at end of week 14:**
- End-to-end demo with Darren
- Maintenance retainer decision (Basic / Standard / Premium per plan doc lines 1503–1513)
- Run `/schedule` to set up a 30-day check-in agent

---

## Risks & decisions to lock early

| Risk / decision | When | Owner |
|---|---|---|
| Google Ads developer token approval (1–2 weeks lead) | **Day 1** | Darren |
| GSC site verification | Week 9 day 1 | Darren |
| Video host (Mux vs. Bunny vs. Supabase Storage) | Phase 0, day 1 | Engineering |
| PDF renderer (`@react-pdf/renderer` vs. Puppeteer) | Before Phase 4 reports | Engineering |
| Schema-merge strategy (athlete repo) — adapter views vs. true merge | Phase 2 pre-work | Engineering |
| Adopt `zustand` repo-wide vs. scope to client UI? | Phase 2 pre-work | Engineering |
| NextAuth v4 → v5 migration path (video repo) | Phase 3 pre-work | Engineering |
| Drop or keep Google Drive integration (`googleapis` in video repo) | Phase 3 pre-work | Engineering |
| Drop or keep Firebase usage in video repo (vs. djpathlete's existing Firebase) | Phase 3 pre-work | Engineering |
| Airtable export access | Week 5 day 1 | Darren |
| Stripe subscription scope | Before Phase 5 | Darren |
| Audit overlap: `content-studio-multimedia` specs vs. video repo | Phase 3 pre-work | Engineering |

---

## Per-phase plan-drafting trigger

When a phase is about to start:
1. Re-read the phase section here
2. Run the listed pre-work (audit, schema diff, etc.)
3. Draft the spec under `docs/superpowers/specs/`
4. Use `superpowers:writing-plans` to draft each sub-phase plan under `docs/superpowers/plans/` in the standard TDD bite-sized step format
5. Execute each plan with `superpowers:subagent-driven-development` or `superpowers:executing-plans`

---

## Spec coverage check (vs. `docs/DJP-AI-Automation-Plan.md` lines 1384–1457)

| Plan-doc feature | Phase covering it |
|---|---|
| Google Ads AI Optimization | Phase 1 |
| Three Automation Levels | Phase 1 |
| 5 Campaign Type Support | Phase 1 |
| AI Ad Copy Generation | Phase 1 |
| Weekly Google Ads Report | Phase 1 |
| Athlete Performance Database | Phase 2 (port) |
| Client Profiles | Phase 2 (port) |
| Custom Data Fields | Phase 2 |
| Progress Dashboards | Phase 2 |
| Data Export (CSV/PDF) | Phase 2 |
| Client Portal Integration | Phase 2 |
| Replaces Airtable | Phase 2 |
| Video Editing Platform Integration | Phase 3 (port) |
| Video Library | Phase 3 (port) |
| Auto-Clip Suggestions | Phase 3 |
| SEO Keyword Tracking (GSC) | Phase 4 |
| Full Reporting Suite (5 templates) | Phase 4 |
| Custom Report Builder | Phase 4 |
| Smart Alert Emails | Phase 4 |
| Monthly Executive Summary PDF | Phase 4 |
| Training App Reporting | Phase 4 (Phase 2 supplies the data) |
| Revenue Tracking (Stripe) | Phase 5 |

All Professional + Enterprise features mapped.
