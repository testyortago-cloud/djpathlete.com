# Google Ads AI Integration — Design Spec

**Date:** 2026-05-02
**Status:** Draft, ready for plan-drafting
**Roadmap reference:** `docs/superpowers/plans/2026-05-02-enterprise-upgrade-roadmap.md` — Phase 1 (weeks 1–4)
**Plan-doc reference:** `docs/DJP-AI-Automation-Plan.md` lines 1384–1413 (Professional tier — Google Ads features)
**Prereqs (Darren):** `docs/superpowers/specs/2026-05-02-google-ads-prerequisites-darren.md`

---

## Problem statement

The Professional/Enterprise tiers promise AI-managed Google Ads — keyword and bid recommendations, ad copy A/B variants, negative keyword detection, three automation modes, weekly performance reports, and 5 campaign types supported. None of this exists in djpathlete today. There is no `app/(admin)/admin/ads/` route, no Google Ads schema, no API client, and no scheduled sync.

This spec designs the integration end-to-end so a fresh engineer can pick up sub-phase plans without ambiguity.

---

## Goals

1. Sync nightly campaign performance data from Google Ads into Supabase (read-only mirror)
2. Generate AI recommendations for keywords, bids, negative keywords, and ad copy
3. Apply approved recommendations back to Google Ads via the API (write path)
4. Provide three automation modes per campaign: Auto-pilot, Co-pilot, Advisory
5. Email a weekly Google Ads report to `COACH_EMAIL` (`darren@darrenjpaul.com`)
6. Match djpathlete conventions — no hardcoded hex, semantic Tailwind tokens, NextAuth v5 admin gate, Firebase Functions for cron, `lib/db/` DAL, Zod validators, brand fonts via `@layer base`

## Non-goals (deferred)

- Multi-tenant MCC support (D1 — single account first, schema allows future)
- Campaign creation/deletion via UI (Phase 1 is read + recommend + apply, not create)
- Google Search Console integration (Phase 4)
- Bid strategy creation (use whatever bid strategy is already configured)

---

## Existing patterns to follow

These already exist in djpathlete and dictate architecture:

| Pattern | File / location | What we reuse |
|---|---|---|
| Platform OAuth tokens | `platform_connections` table (migration 00078, 00082, 00089 — encrypted) | Add `'google_ads'` to plugin_name CHECK; reuse encryption + helpers |
| Scheduled jobs | `functions/src/sync-platform-analytics.ts`, `send-weekly-content-report.ts` | New file `functions/src/sync-google-ads.ts` |
| Admin sidebar | `components/admin/AdminSidebar.tsx` | Add "Ads" group |
| AI calls | `lib/ai/` (uses `@ai-sdk/anthropic`) | Keep direct provider; do not introduce Vercel AI Gateway here |
| DAL convention | `lib/db/*.ts` (one file per table, ~28 files) | Add `lib/db/ads-*.ts` files |
| Zod validators | `lib/validators/*.ts` | Add `lib/validators/ads.ts` |
| Email templates | `components/emails/WeeklyContentReport.tsx` (React Email + Resend) | Add `WeeklyAdsReport.tsx` |
| Migration numbering | `supabase/migrations/00094_*.sql` is current latest | Start at `00095_*` |
| Middleware admin gate | `middleware.ts` | `/admin/ads/*` matches the existing `/admin/*` rule |
| Service-role Supabase client | `lib/supabase.ts` | Server-only writes use this |

---

## Decisions

### D1. Single account now, schema allows multi-account later

Darren's setup is one Google Ads account. We design `google_ads_accounts` as a multi-row table (PK = customer_id) seeded with one row. If MCC support is added later, additional rows + a manager_customer_id column are non-breaking changes.

### D2. OAuth tokens stored in `platform_connections`, plugin_name = `'google_ads'`

- Add `'google_ads'` to the plugin_name CHECK constraint
- Insert one seed row with status `'not_connected'`
- Refresh token stored in `credentials` JSONB, encrypted via the existing pattern (migration 00089)
- Reuse `account_handle` for the Customer ID (10-digit, no dashes)

### D3. OAuth flow is admin-only, system-level

Only admin users (NextAuth v5 role check) can complete the OAuth flow. Successful connect persists the refresh token for the whole platform — Darren is the sole advertiser.

OAuth flow:
- Connect button on `/admin/ads/settings/page.tsx` → redirects to `/api/integrations/google-ads/connect`
- That route generates an OAuth URL with scope `https://www.googleapis.com/auth/adwords` and a signed `state` (to prevent CSRF)
- Callback at `/api/integrations/google-ads/callback` exchanges the code for tokens and writes to `platform_connections`
- Disconnect clears the credentials row but leaves the data intact

### D4. Sync runs nightly via Firebase Cloud Function

- New file `functions/src/sync-google-ads.ts`
- Triggered by Firebase Scheduler (cron: `0 6 * * *` UTC = 06:00 UTC nightly = 22:00 PT previous day, after Google Ads' standard 06:00 UTC report finalization)
- Idempotent — UPSERTs by composite keys
- Incremental — fetches last 7 days of metrics on every run to catch attribution lag, but only persists deltas
- Run duration target: <5 minutes for a single account

### D5. Recommendations are AI-generated, not rule-based

The AI recommendation engine (`lib/ads/recommendations.ts`) calls Claude with a structured prompt that includes recent metrics, campaign settings, and current keywords. Output is structured JSON (Zod-validated) of recommended actions:
- Add negative keywords (with reason)
- Adjust keyword bids (delta + reason)
- Pause low-CTR keywords (with reason)
- Add new keyword variants (Search campaigns only)

Each recommendation row is stored with status `pending`, `approved`, `applied`, `rejected`, `auto_applied`, `failed`.

### D6. Three automation modes are per-campaign

The mode is a column on `google_ads_campaigns` (synced from a local override, not from Google Ads):
- `automation_mode` enum: `'auto_pilot' | 'co_pilot' | 'advisory'`
- Default for newly-synced campaigns: `'co_pilot'` (Performance Max overridden to `'advisory'` per D7)

**Mode behavior:**
| Mode | Negative keyword adds | Bid changes | Ad copy variants | Pause keywords |
|---|---|---|---|---|
| Auto-pilot | Auto-applied if confidence ≥ 0.8 | Approval queue | Approval queue | Approval queue |
| Co-pilot | Approval queue | Approval queue | Approval queue | Approval queue |
| Advisory | Reported only | Reported only | Reported only | Reported only |

Auto-pilot's threshold is conservative on purpose: only clearly-bad negative keywords (irrelevant search terms with zero conversions over 14+ days) ever auto-apply. This matches Darren's risk tolerance and the plan-doc framing.

### D7. Performance Max campaigns default to Advisory mode

Performance Max optimization is opaque (Google manages it). External recommendations frequently conflict with Google's signals. Default mode is `'advisory'`. Darren can override to Co-pilot in settings if he wants.

### D8. Ad copy generation uses brand voice from `prompt_templates`

Migration 00075 added `prompt_templates` for AI prompts. Ad copy generation reads a category like `'google_ads_copy'` from this table. Initial seed is part of Plan 1.4. This keeps the brand voice consistent with social/blog/newsletter generation.

### D9. Apply path is gated and audited

Every "apply" action (auto or manual) writes a row to `google_ads_automation_log` capturing:
- Recommendation ID
- Mode at time of apply
- Actor (user_id for manual, `'system'` for auto)
- API request payload (what we sent to Google)
- API response (what Google returned)
- Resulting status

This is the audit trail. Important for debugging and for post-hoc "did the AI break my campaigns?" questions.

### D10. Weekly report uses existing email pipeline

Reuses `Resend` (already in djpathlete) + React Email pattern from `WeeklyContentReport.tsx`. Triggered by a separate Firebase Scheduler at `0 13 * * 1` UTC (Mondays 06:00 PT / 13:00 UTC). Recipient: `COACH_EMAIL` from environment (`darren@darrenjpaul.com` per memory).

---

## Schema (migrations starting at `00095_*`)

### 00095_google_ads_accounts.sql
```sql
CREATE TABLE google_ads_accounts (
  customer_id          text PRIMARY KEY,
  manager_customer_id  text,
  descriptive_name     text,
  currency_code        text,
  time_zone            text,
  is_active            boolean NOT NULL DEFAULT true,
  connected_at         timestamptz,
  last_synced_at       timestamptz,
  last_error           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_google_ads_accounts_updated_at
  BEFORE UPDATE ON google_ads_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

### 00096_google_ads_campaigns.sql
```sql
CREATE TABLE google_ads_campaigns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  campaign_id         text NOT NULL,
  name                text NOT NULL,
  type                text NOT NULL CHECK (type IN (
                        'SEARCH', 'VIDEO', 'PERFORMANCE_MAX', 'DISPLAY', 'SHOPPING',
                        'DEMAND_GEN', 'LOCAL_SERVICES', 'APP', 'HOTEL', 'SMART', 'UNKNOWN'
                      )),
  status              text NOT NULL CHECK (status IN ('ENABLED', 'PAUSED', 'REMOVED')),
  bidding_strategy    text,
  budget_micros       bigint,
  start_date          date,
  end_date            date,
  automation_mode     text NOT NULL DEFAULT 'co_pilot'
                      CHECK (automation_mode IN ('auto_pilot', 'co_pilot', 'advisory')),
  raw_data            jsonb,
  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, campaign_id)
);
CREATE INDEX idx_google_ads_campaigns_customer ON google_ads_campaigns(customer_id);
CREATE INDEX idx_google_ads_campaigns_status ON google_ads_campaigns(status);
CREATE TRIGGER trg_google_ads_campaigns_updated_at
  BEFORE UPDATE ON google_ads_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

### 00097_google_ads_ad_groups_and_keywords.sql
- `google_ads_ad_groups` (id, campaign_id FK, ad_group_id, name, status, type, cpc_bid_micros, raw_data, last_synced_at)
- `google_ads_keywords` (id, ad_group_id FK, criterion_id, text, match_type CHECK in EXACT/PHRASE/BROAD, status, cpc_bid_micros, last_synced_at, UNIQUE(ad_group_id, criterion_id))
- `google_ads_negative_keywords` (id, scope_type CHECK in 'campaign'/'ad_group', scope_id, criterion_id, text, match_type, last_synced_at)
- `google_ads_ads` (id, ad_group_id FK, ad_id, type, status, headlines jsonb, descriptions jsonb, final_urls jsonb, raw_data, last_synced_at)

### 00098_google_ads_metrics.sql
```sql
CREATE TABLE google_ads_daily_metrics (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  campaign_id         text NOT NULL,
  ad_group_id         text,
  keyword_criterion_id text,
  date                date NOT NULL,
  impressions         bigint NOT NULL DEFAULT 0,
  clicks              bigint NOT NULL DEFAULT 0,
  cost_micros         bigint NOT NULL DEFAULT 0,
  conversions         numeric(12,3) NOT NULL DEFAULT 0,
  conversion_value    numeric(14,2) NOT NULL DEFAULT 0,
  ctr                 numeric(8,5) GENERATED ALWAYS AS
                      (CASE WHEN impressions > 0 THEN clicks::numeric / impressions ELSE 0 END) STORED,
  avg_cpc_micros      bigint GENERATED ALWAYS AS
                      (CASE WHEN clicks > 0 THEN cost_micros / clicks ELSE 0 END) STORED,
  raw_data            jsonb,
  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, campaign_id, COALESCE(ad_group_id, ''), COALESCE(keyword_criterion_id, ''), date)
);
CREATE INDEX idx_google_ads_daily_metrics_date ON google_ads_daily_metrics(date);
CREATE INDEX idx_google_ads_daily_metrics_campaign ON google_ads_daily_metrics(campaign_id, date);

CREATE TABLE google_ads_search_terms (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  campaign_id         text NOT NULL,
  ad_group_id         text NOT NULL,
  search_term         text NOT NULL,
  date                date NOT NULL,
  impressions         bigint NOT NULL DEFAULT 0,
  clicks              bigint NOT NULL DEFAULT 0,
  cost_micros         bigint NOT NULL DEFAULT 0,
  conversions         numeric(12,3) NOT NULL DEFAULT 0,
  matched_keyword_id  text,
  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, campaign_id, ad_group_id, search_term, date)
);
CREATE INDEX idx_search_terms_term ON google_ads_search_terms(search_term);
```

### 00099_google_ads_recommendations.sql
```sql
CREATE TABLE google_ads_recommendations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  scope_type          text NOT NULL CHECK (scope_type IN ('campaign', 'ad_group', 'keyword', 'ad')),
  scope_id            text NOT NULL,
  recommendation_type text NOT NULL CHECK (recommendation_type IN (
                        'add_negative_keyword', 'adjust_bid', 'pause_keyword',
                        'add_keyword', 'add_ad_variant', 'pause_ad'
                      )),
  payload             jsonb NOT NULL,
  reasoning           text NOT NULL,
  confidence          numeric(3,2) CHECK (confidence BETWEEN 0 AND 1),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'applied', 'rejected', 'auto_applied', 'failed', 'expired')),
  created_by_ai       boolean NOT NULL DEFAULT true,
  approved_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  applied_at          timestamptz,
  expires_at          timestamptz NOT NULL DEFAULT now() + INTERVAL '14 days',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_google_ads_recs_status ON google_ads_recommendations(status, customer_id);
CREATE INDEX idx_google_ads_recs_scope ON google_ads_recommendations(scope_type, scope_id);
CREATE TRIGGER trg_google_ads_recs_updated_at
  BEFORE UPDATE ON google_ads_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE google_ads_automation_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid REFERENCES google_ads_recommendations(id) ON DELETE SET NULL,
  customer_id       text NOT NULL,
  mode              text NOT NULL,
  actor             text NOT NULL,                  -- 'system' or user_id
  api_request       jsonb NOT NULL,
  api_response      jsonb,
  result_status     text NOT NULL CHECK (result_status IN ('success', 'failure', 'partial')),
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_google_ads_log_rec ON google_ads_automation_log(recommendation_id);
CREATE INDEX idx_google_ads_log_created ON google_ads_automation_log(created_at);
```

### 00100_extend_platform_connections.sql
```sql
ALTER TABLE platform_connections DROP CONSTRAINT platform_connections_plugin_name_check;
ALTER TABLE platform_connections ADD CONSTRAINT platform_connections_plugin_name_check
  CHECK (plugin_name IN (
    'facebook', 'instagram', 'tiktok', 'youtube', 'youtube_shorts', 'linkedin',
    'google_ads'
  ));
INSERT INTO platform_connections (plugin_name, status) VALUES ('google_ads', 'not_connected')
  ON CONFLICT (plugin_name) DO NOTHING;
```

---

## File structure (net-new)

```
app/
  (admin)/admin/ads/
    page.tsx                          # campaigns list dashboard
    [campaignId]/page.tsx             # campaign detail + AI recs
    settings/page.tsx                 # OAuth connect/disconnect, automation defaults
    recommendations/page.tsx          # cross-campaign approval queue
  api/
    integrations/google-ads/
      connect/route.ts                # OAuth init
      callback/route.ts               # OAuth callback
      disconnect/route.ts
    ads/
      recommendations/route.ts        # GET list, POST approve/reject
      recommendations/[id]/apply/route.ts
      sync/route.ts                   # manual sync trigger (admin)

lib/
  ads/
    google-ads-client.ts              # thin wrapper around google-ads-api npm
    auth.ts                           # OAuth helpers
    sync.ts                           # nightly sync orchestrator
    recommendations.ts                # AI rec generation (calls lib/ai/)
    apply.ts                          # apply approved recs back to Google Ads
    metrics.ts                        # aggregation helpers for the dashboard
  db/
    google-ads-accounts.ts
    google-ads-campaigns.ts
    google-ads-ad-groups.ts
    google-ads-keywords.ts
    google-ads-ads.ts
    google-ads-metrics.ts
    google-ads-search-terms.ts
    google-ads-recommendations.ts
    google-ads-automation-log.ts
  validators/
    ads.ts                            # all Zod schemas

functions/src/
  sync-google-ads.ts                  # Firebase scheduled function (nightly)
  send-weekly-ads-report.ts           # Firebase scheduled function (Mondays)

components/
  admin/ads/
    CampaignsTable.tsx
    CampaignDetail.tsx
    AutomationModeSelector.tsx
    RecommendationCard.tsx
    RecommendationsQueue.tsx
    ConnectGoogleAdsButton.tsx
  emails/
    WeeklyAdsReport.tsx               # React Email template
```

---

## Sync architecture (nightly)

`functions/src/sync-google-ads.ts` runs as a scheduled Cloud Function. Pseudocode:

```
1. Read platform_connections row for 'google_ads', refresh OAuth token if expired.
2. For each row in google_ads_accounts WHERE is_active=true:
   a. Fetch campaigns (Google Ads Query Language: SELECT campaign.* WHERE campaign.status != 'REMOVED')
      → UPSERT into google_ads_campaigns by (customer_id, campaign_id), preserving local automation_mode override.
   b. Fetch ad_groups for active campaigns → UPSERT.
   c. Fetch ad_group_criterion (keywords + negatives) → UPSERT.
   d. Fetch ad_group_ad → UPSERT.
   e. Fetch metrics for last 7 days at the campaign+ad_group+keyword grain → UPSERT into google_ads_daily_metrics.
   f. Fetch search_term_view for last 7 days → UPSERT.
3. Update google_ads_accounts.last_synced_at; clear last_error on success or set on failure.
4. Write a row to sync_log (existing djpathlete pattern from athlete-performance audit — check if djpathlete has equivalent; if not, no-op).
```

**Why 7-day rewrite window?** Google Ads conversion attribution can lag up to 7 days. Re-fetching avoids stale numbers in the dashboard.

**Why per-campaign cascade?** Lets us short-circuit if a campaign is REMOVED — no need to fetch its ad groups.

**Bun vs Node:** Firebase Functions = Node. No change.

---

## AI recommendation engine

`lib/ads/recommendations.ts` runs as part of the nightly sync OR on-demand from the admin UI. For each campaign:

1. Pull last 28 days of metrics from Supabase
2. Pull last 14 days of search_terms with non-zero impressions
3. Build a prompt that includes:
   - Campaign settings (budget, bid strategy, type, automation_mode)
   - Aggregate metrics (impressions, clicks, cost, conversions, ctr, cpa)
   - Keyword performance (top 50 by impressions, with their metrics)
   - Search terms with no matching keyword (negative-keyword candidates)
   - Brand voice from `prompt_templates` category `'google_ads_copy'`
4. Call Claude with structured output (JSON schema validated by `lib/validators/ads.ts`)
5. Persist each recommendation row with `status='pending'` and a 14-day expiry
6. If campaign mode = `auto_pilot` and rec is `add_negative_keyword` with `confidence >= 0.8`, immediately apply

The Claude prompt includes constraints:
- "Only suggest negative keywords that have ≥0 conversions and ≥10 impressions over 14 days"
- "Only suggest bid changes between -50% and +50% of current bid"
- "Cite the metric basis for every recommendation"

Output schema (Zod):
```ts
const recommendationSchema = z.object({
  type: z.enum(['add_negative_keyword', 'adjust_bid', 'pause_keyword', 'add_keyword', 'add_ad_variant', 'pause_ad']),
  scope_type: z.enum(['campaign', 'ad_group', 'keyword', 'ad']),
  scope_id: z.string(),
  payload: z.record(z.unknown()),
  reasoning: z.string().min(20).max(500),
  confidence: z.number().min(0).max(1),
});
```

---

## Apply path (write back to Google Ads)

`lib/ads/apply.ts` exposes one function per recommendation type. Each:
1. Reads the recommendation row, asserts status `approved` or `auto_applied`-pending
2. Constructs the Google Ads API mutation payload from `payload` JSONB
3. Calls the API
4. Writes a `google_ads_automation_log` row with the request, response, and result status
5. Updates the recommendation status to `applied` or `failed`

Concurrency: per-recommendation idempotency via `status='applying'` lock column (or use Postgres advisory lock). To be detailed in Plan 1.3.

---

## Three automation modes (per-campaign)

Already specified in D6/D7. Mode is a column on `google_ads_campaigns`. Selector UI in `CampaignDetail.tsx`. Auto-pilot's auto-apply path runs at the end of each nightly sync, scoped to that campaign's `add_negative_keyword` recs with `confidence >= 0.8`.

---

## Weekly report email

`functions/src/send-weekly-ads-report.ts` (cron `0 13 * * 1`):

1. Aggregate last 7 days of metrics (vs prior 7 days) — total spend, conversions, CTR, CPA delta
2. Top 5 best-performing campaigns (by conversion value)
3. Top 5 worst-performing keywords (high spend, zero conversions)
4. Pending recommendations count + top 3 by impact estimate
5. Render `components/emails/WeeklyAdsReport.tsx` (React Email)
6. Send via Resend to `COACH_EMAIL`

Plain-English insights generated by Claude (one short paragraph at top of email) — same pattern as `send-weekly-content-report.ts`.

---

## Sub-phase breakdown (for plan-drafting)

### Plan 1.1 — OAuth + sync schema (week 1)
**Output:** `docs/superpowers/plans/2026-05-XX-google-ads-phase1-oauth-and-sync.md`
- All migrations 00095–00100
- DAL files for accounts, campaigns, ad_groups, keywords, ads, metrics, search_terms
- `lib/ads/google-ads-client.ts` (using `google-ads-api` npm package)
- OAuth connect/callback/disconnect routes + admin settings page
- Manual sync trigger route
- Firebase function `sync-google-ads.ts` (read-only sync, no recommendations yet)
- Smoke tests against a Google Ads test account (no Developer Token needed)

### Plan 1.2 — AI recommendations (week 2)
**Output:** `docs/superpowers/plans/2026-05-XX-google-ads-phase2-ai-recommendations.md`
- Migration 00099 (recommendations + automation log)
- DAL files for recommendations + automation_log
- `lib/ads/recommendations.ts` — Claude prompt + structured-output parsing
- Hook into nightly sync after data refresh
- Approval queue UI at `/admin/ads/recommendations`
- Per-campaign automation_mode selector

### Plan 1.3 — Apply path + automation modes (week 3)
**Output:** `docs/superpowers/plans/2026-05-XX-google-ads-phase3-apply-and-modes.md`
- `lib/ads/apply.ts` — write-back functions per recommendation type
- POST `/api/ads/recommendations/[id]/apply`
- Auto-pilot branch in nightly sync (for negative keywords with confidence ≥ 0.8)
- Automation log views in admin UI
- Performance Max default-to-advisory enforcement

### Plan 1.4 — Ad copy + weekly report (week 4)
**Output:** `docs/superpowers/plans/2026-05-XX-google-ads-phase4-ad-copy-and-report.md`
- Seed `prompt_templates` row for `'google_ads_copy'` category
- Ad copy variant generator (creates `add_ad_variant` recommendations with headlines + descriptions)
- `WeeklyAdsReport.tsx` React Email template
- `functions/src/send-weekly-ads-report.ts`
- Resend integration (existing pattern)
- End-to-end smoke test: full sync → recs → email lands in `COACH_EMAIL` inbox

---

## Environment variables (new)

Added to `.env.example` and Vercel env per existing pattern:

```
# Google Ads (Phase 1)
GOOGLE_ADS_DEVELOPER_TOKEN=          # from Darren's Google Ads API Center (1-2 wk approval)
GOOGLE_ADS_CLIENT_ID=                # OAuth Client ID from Google Cloud Console
GOOGLE_ADS_CLIENT_SECRET=            # OAuth Client Secret
GOOGLE_ADS_LOGIN_CUSTOMER_ID=        # 10-digit customer ID (no dashes); manager ID if MCC
GOOGLE_ADS_REDIRECT_URI=             # https://www.darrenjpaul.com/api/integrations/google-ads/callback
                                     # (and http://localhost:3050/... for dev)
```

Refresh tokens are NOT in env — they live encrypted in `platform_connections.credentials`.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Developer Token approval delayed >2 weeks | Build against Google's test accounts (no token required). Switch to live by env-var swap. |
| Google Ads API rate limits | The `google-ads-api` library has built-in retry. Sync runs nightly, not hourly — well under quota for one account. |
| AI hallucinates a non-existent keyword/campaign | Recommendations reference `scope_id` (real Google Ads IDs from our synced data); Plan 1.2 includes an existence check before persisting. |
| Auto-pilot misfires (mass-adding wrong negatives) | Confidence threshold ≥0.8, scoped to negative keywords only, log every action, daily cap (e.g. ≤10 auto-applies per night). |
| Token leak | `platform_connections.credentials` already encrypted (migration 00089). OAuth callback route validates `state`. |
| Cost regression vs. Darren's current setup | Advisory mode for first 2 weeks per campaign per Darren's prereqs doc. Compare 14-day spend before/after in week-4 review. |
| Performance Max recommendations conflict with Google's optimization | Default to `'advisory'` mode (D7). |
| Dev env can't test write-back without polluting Darren's real account | Use a Google Ads test account for dev/staging. Production connect happens once at launch. |
| `google-ads-api` npm package version drift | Pin major version. Add to `package.json` review checklist in maintenance retainer. |

---

## Open questions for Darren (already in prereqs doc, repeated here)

1. Confirm single-account vs MCC (Q2 of prereqs doc)
2. Approve default automation modes (Co-pilot for existing, Advisory for Performance Max)
3. Consent to `darren@darrenjpaul.com` as the Resend recipient for weekly Ads reports

---

## Acceptance criteria (Phase 1 done when…)

- [ ] OAuth connect flow works end-to-end against a test account
- [ ] Nightly sync populates campaigns, ad_groups, keywords, ads, daily metrics, search terms
- [ ] All 5 plan-doc campaign types supported in schema (Search, Video, Performance Max, Display via Retargeting, Demand Gen as Lead Gen proxy)
- [ ] AI generates ≥3 recommendations per active campaign on a real-data nightly run
- [ ] Co-pilot approval queue: approve → applied to Google Ads, automation_log row written
- [ ] Auto-pilot: at least one negative keyword auto-applied with confidence ≥0.8 in a test scenario
- [ ] Advisory: recs visible in UI, no apply button shown
- [ ] Performance Max defaults to advisory automatically
- [ ] Weekly Ads report email lands in `COACH_EMAIL` inbox on schedule, with plain-English insights
- [ ] No hardcoded hex; semantic Tailwind tokens used; brand fonts via Tailwind utilities
- [ ] All DB writes go through `lib/db/google-ads-*.ts`
- [ ] All Zod validators pass round-trip JSON checks
- [ ] `.env.example` updated; README has a "Google Ads setup" section
- [ ] Darren's actual Developer Token + Customer ID swapped in production env successfully

---

## Spec coverage check (vs `docs/DJP-AI-Automation-Plan.md` lines 1384–1413)

| Plan-doc feature | Where in spec |
|---|---|
| Google Ads AI Optimization (nightly sync, keyword analysis, bid recs) | D4, D5, Plan 1.1, Plan 1.2 |
| Three Automation Levels | D6, D7, Plan 1.3 |
| 5 Campaign Type Support | Schema 00096 type CHECK, all sync paths |
| AI Ad Copy Generation | D8, Plan 1.4 |
| Weekly Google Ads Report | D10, Plan 1.4 |
| Negative keyword detection | D5 (Auto-pilot scope), Plan 1.2 |

All Phase 1 plan-doc features mapped.
