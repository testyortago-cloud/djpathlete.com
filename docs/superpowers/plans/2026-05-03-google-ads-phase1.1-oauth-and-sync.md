# Phase 1.1 — Google Ads OAuth + Nightly Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect a Google Ads account via OAuth, mirror its campaigns / ad groups / keywords / ads / daily metrics / search terms into Supabase via a nightly Firebase Function, and surface a basic campaigns dashboard at `/admin/ads/campaigns`. This is Phase 1.1 of the Google Ads integration spec — read-only sync only; no AI recommendations, no write-back, no automation modes (those are Plans 1.2 / 1.3).

**Architecture:** OAuth refresh token stored encrypted in `platform_connections.credentials` (re-using the existing pattern from migration 00089). A new `lib/ads/google-ads-client.ts` wraps the `google-ads-api` npm package and reads tokens from `platform_connections` on every call (auto-refreshing access tokens). A new Firebase scheduled Function `sync-google-ads.ts` runs nightly at 06:00 UTC, walks each row in `google_ads_accounts`, and UPSERTs synced data through dedicated DAL files. The 7-day rewrite window catches Google Ads' attribution lag without re-fetching the entire account every night.

**Tech Stack:** Next.js 16 App Router, Firebase Functions Gen 2 (Node 22 onSchedule + onRequest), `google-ads-api@^17`, `@anthropic-ai/sdk` (already present, used later in Plan 1.2), Supabase service-role client, NextAuth v5 admin gate, Zod validators, Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-05-02-google-ads-integration-design.md` — D1, D2, D3, D4 (sync), schema migrations, Plan 1.1 section.

**Prereqs (Darren-side, blocking deploy but not implementation):**
1. **Google Ads Developer Token** — apply via Google Ads API Center (1–2 week approval).
2. **OAuth Client ID + Secret** — Google Cloud Console (15 min).
3. **10-digit Customer ID** — already in Darren's Google Ads UI.

While these are pending, all engineering work below builds against a **Google Ads test account** (no Developer Token required). The flip from test to live is one env-var swap.

**Migration renumber from spec:** the spec uses 00095–00100, but those collide with the migrations already on production (00095 = blog inline images, 00101 = marketing_attribution, 00102 = marketing_consent). This plan uses **00103–00107**. The spec text remains valid; only the number sequence changes.

**Non-goals (deferred to later plans):**
- AI recommendations engine (Plan 1.2)
- Apply-back path / write to Google Ads (Plan 1.3)
- Auto-pilot / Co-pilot / Advisory automation modes (Plan 1.3)
- AI ad copy generation (Plan 1.4)
- Weekly performance email (Plan 1.4)
- Customer Match audience sync (Plan 1.5b — separate spec)

---

## File Structure

### New files
- `supabase/migrations/00103_google_ads_accounts.sql`
- `supabase/migrations/00104_google_ads_campaigns.sql`
- `supabase/migrations/00105_google_ads_ad_groups_and_keywords.sql`
- `supabase/migrations/00106_google_ads_metrics.sql`
- `supabase/migrations/00107_extend_platform_connections.sql`
- `lib/validators/ads.ts`
- `lib/db/google-ads-accounts.ts`
- `lib/db/google-ads-campaigns.ts`
- `lib/db/google-ads-ad-groups.ts`
- `lib/db/google-ads-keywords.ts`
- `lib/db/google-ads-ads.ts`
- `lib/db/google-ads-metrics.ts`
- `lib/db/google-ads-search-terms.ts`
- `lib/ads/google-ads-client.ts`
- `lib/ads/oauth.ts`
- `lib/ads/sync-helpers.ts`
- `app/api/integrations/google-ads/connect/route.ts`
- `app/api/integrations/google-ads/callback/route.ts`
- `app/api/integrations/google-ads/disconnect/route.ts`
- `app/api/admin/ads/sync/route.ts`
- `app/(admin)/admin/ads/settings/page.tsx`
- `app/(admin)/admin/ads/settings/ConnectGoogleAdsButton.tsx`
- `app/(admin)/admin/ads/campaigns/page.tsx`
- `app/(admin)/admin/ads/campaigns/CampaignsTable.tsx`
- `functions/src/sync-google-ads.ts`
- `functions/src/ads/sync-helpers.ts` (Functions-side mirror of the Next.js `lib/ads/sync-helpers.ts` core logic — duplicated because the Functions tsconfig can't import from Next.js)
- `__tests__/lib/ads/oauth.test.ts`
- `__tests__/api/integrations/google-ads-callback.test.ts`
- `functions/src/__tests__/sync-google-ads.test.ts`

### Changed files
- `types/database.ts` — add `GoogleAdsAccount`, `GoogleAdsCampaign`, `GoogleAdsAdGroup`, `GoogleAdsKeyword`, `GoogleAdsAd`, `GoogleAdsDailyMetric`, `GoogleAdsSearchTerm` interfaces; extend `PlatformPluginName` enum to include `'google_ads'`
- `app/(admin)/admin/ads/page.tsx` — replace the landing placeholder with real "Connection status + recent metrics summary" card; keep links to consent log, settings, campaigns
- `components/admin/AdminSidebar.tsx` — extend the Ads group with sub-items: Campaigns, Settings, Consent
- `functions/src/index.ts` — register `syncGoogleAds` scheduled function + secrets
- `functions/package.json` — add `google-ads-api` dependency
- `package.json` (Next.js) — add `google-ads-api` dependency (used by OAuth callback for token exchange)
- `.env.example` — add the 5 GOOGLE_ADS_* env vars

---

## Task 1: Migration 00103 — `google_ads_accounts`

**Files:**
- Create: `supabase/migrations/00103_google_ads_accounts.sql`

- [ ] **Step 1: Create the migration**

```sql
-- Phase 1.1 — Google Ads account registry
-- One row per connected Customer ID. Schema allows MCC (manager) accounts
-- via manager_customer_id, but Phase 1.1 ships single-account only.

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

ALTER TABLE google_ads_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on google_ads_accounts"
  ON google_ads_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admins read all google_ads_accounts"
  ON google_ads_accounts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
```

- [ ] **Step 2: Skip db push** (Darren applies via Supabase MCP after merge, same pattern as Phase 1.5a)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00103_google_ads_accounts.sql
git commit -m "feat(db): add google_ads_accounts table"
```

---

## Task 2: Migration 00104 — `google_ads_campaigns`

**Files:**
- Create: `supabase/migrations/00104_google_ads_campaigns.sql`

- [ ] **Step 1: Create**

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
CREATE INDEX idx_google_ads_campaigns_status   ON google_ads_campaigns(status);
CREATE TRIGGER trg_google_ads_campaigns_updated_at
  BEFORE UPDATE ON google_ads_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE google_ads_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on google_ads_campaigns"
  ON google_ads_campaigns FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admins read all google_ads_campaigns"
  ON google_ads_campaigns FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/00104_google_ads_campaigns.sql
git commit -m "feat(db): add google_ads_campaigns table"
```

---

## Task 3: Migration 00105 — ad_groups, keywords, negative_keywords, ads

**Files:**
- Create: `supabase/migrations/00105_google_ads_ad_groups_and_keywords.sql`

- [ ] **Step 1: Create**

```sql
CREATE TABLE google_ads_ad_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES google_ads_campaigns(id) ON DELETE CASCADE,
  ad_group_id     text NOT NULL,
  name            text NOT NULL,
  status          text NOT NULL CHECK (status IN ('ENABLED', 'PAUSED', 'REMOVED')),
  type            text,
  cpc_bid_micros  bigint,
  raw_data        jsonb,
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, ad_group_id)
);
CREATE INDEX idx_google_ads_ad_groups_campaign ON google_ads_ad_groups(campaign_id);
CREATE TRIGGER trg_google_ads_ad_groups_updated_at
  BEFORE UPDATE ON google_ads_ad_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE google_ads_keywords (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_group_id     uuid NOT NULL REFERENCES google_ads_ad_groups(id) ON DELETE CASCADE,
  criterion_id    text NOT NULL,
  text            text NOT NULL,
  match_type      text NOT NULL CHECK (match_type IN ('EXACT', 'PHRASE', 'BROAD')),
  status          text NOT NULL CHECK (status IN ('ENABLED', 'PAUSED', 'REMOVED')),
  cpc_bid_micros  bigint,
  raw_data        jsonb,
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ad_group_id, criterion_id)
);
CREATE INDEX idx_google_ads_keywords_ad_group ON google_ads_keywords(ad_group_id);
CREATE INDEX idx_google_ads_keywords_status   ON google_ads_keywords(status);

CREATE TABLE google_ads_negative_keywords (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  scope_type      text NOT NULL CHECK (scope_type IN ('campaign', 'ad_group')),
  scope_id        uuid NOT NULL,
  criterion_id    text NOT NULL,
  text            text NOT NULL,
  match_type      text NOT NULL CHECK (match_type IN ('EXACT', 'PHRASE', 'BROAD')),
  raw_data        jsonb,
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, scope_type, scope_id, criterion_id)
);
CREATE INDEX idx_google_ads_negative_kw_scope ON google_ads_negative_keywords(scope_type, scope_id);

CREATE TABLE google_ads_ads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_group_id     uuid NOT NULL REFERENCES google_ads_ad_groups(id) ON DELETE CASCADE,
  ad_id           text NOT NULL,
  type            text NOT NULL,
  status          text NOT NULL CHECK (status IN ('ENABLED', 'PAUSED', 'REMOVED')),
  headlines       jsonb NOT NULL DEFAULT '[]'::jsonb,
  descriptions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  final_urls      jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_data        jsonb,
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ad_group_id, ad_id)
);
CREATE INDEX idx_google_ads_ads_ad_group ON google_ads_ads(ad_group_id);

ALTER TABLE google_ads_ad_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_keywords         ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_negative_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_ads              ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on google_ads_ad_groups"        ON google_ads_ad_groups        FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on google_ads_keywords"         ON google_ads_keywords         FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on google_ads_negative_keywords" ON google_ads_negative_keywords FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on google_ads_ads"              ON google_ads_ads              FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins read all google_ads_ad_groups"        ON google_ads_ad_groups        FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins read all google_ads_keywords"         ON google_ads_keywords         FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins read all google_ads_negative_keywords" ON google_ads_negative_keywords FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins read all google_ads_ads"              ON google_ads_ads              FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/00105_google_ads_ad_groups_and_keywords.sql
git commit -m "feat(db): add google_ads_ad_groups, keywords, negative_keywords, ads"
```

---

## Task 4: Migration 00106 — daily metrics + search terms

**Files:**
- Create: `supabase/migrations/00106_google_ads_metrics.sql`

- [ ] **Step 1: Create**

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
CREATE INDEX idx_google_ads_daily_metrics_date     ON google_ads_daily_metrics(date);
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

ALTER TABLE google_ads_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_search_terms  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on google_ads_daily_metrics" ON google_ads_daily_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on google_ads_search_terms"  ON google_ads_search_terms  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admins read all google_ads_daily_metrics" ON google_ads_daily_metrics FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins read all google_ads_search_terms"  ON google_ads_search_terms  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/00106_google_ads_metrics.sql
git commit -m "feat(db): add google_ads_daily_metrics + search_terms tables"
```

---

## Task 5: Migration 00107 — extend platform_connections

**Files:**
- Create: `supabase/migrations/00107_extend_platform_connections.sql`

- [ ] **Step 1: Create**

The current plugin_name CHECK constraint is on the `platform_connections` table from migration 00078 (extended in 00082). The exact existing constraint name may differ — the migration drops and re-adds explicitly.

```sql
-- Phase 1.1 — extend platform_connections with 'google_ads' plugin
ALTER TABLE platform_connections
  DROP CONSTRAINT IF EXISTS platform_connections_plugin_name_check;

ALTER TABLE platform_connections
  ADD CONSTRAINT platform_connections_plugin_name_check
  CHECK (plugin_name IN (
    'facebook', 'instagram', 'tiktok', 'youtube', 'youtube_shorts', 'linkedin',
    'google_ads'
  ));

INSERT INTO platform_connections (plugin_name, status)
VALUES ('google_ads', 'not_connected')
ON CONFLICT (plugin_name) DO NOTHING;
```

- [ ] **Step 2: Verify the existing CHECK constraint name**

Run from a Supabase SQL editor or `mcp__supabase__execute_sql`:
```sql
SELECT conname FROM pg_constraint WHERE conrelid = 'platform_connections'::regclass AND contype = 'c';
```
If the current constraint isn't named `platform_connections_plugin_name_check`, edit migration 00107 to use the actual name. The DROP CONSTRAINT IF EXISTS makes it safe to keep both attempts.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00107_extend_platform_connections.sql
git commit -m "feat(db): extend platform_connections plugin_name with google_ads"
```

---

## Task 6: TypeScript types + Zod validators

**Files:**
- Modify: `types/database.ts`
- Create: `lib/validators/ads.ts`

- [ ] **Step 1: Add types**

In `types/database.ts`, append after the marketing types:

```ts
// Google Ads — Phase 1.1 (read-only mirror)

export type GoogleAdsAutomationMode = "auto_pilot" | "co_pilot" | "advisory"
export type GoogleAdsResourceStatus = "ENABLED" | "PAUSED" | "REMOVED"
export type GoogleAdsCampaignType =
  | "SEARCH" | "VIDEO" | "PERFORMANCE_MAX" | "DISPLAY" | "SHOPPING"
  | "DEMAND_GEN" | "LOCAL_SERVICES" | "APP" | "HOTEL" | "SMART" | "UNKNOWN"
export type GoogleAdsKeywordMatchType = "EXACT" | "PHRASE" | "BROAD"

export interface GoogleAdsAccount {
  customer_id: string
  manager_customer_id: string | null
  descriptive_name: string | null
  currency_code: string | null
  time_zone: string | null
  is_active: boolean
  connected_at: string | null
  last_synced_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface GoogleAdsCampaign {
  id: string
  customer_id: string
  campaign_id: string
  name: string
  type: GoogleAdsCampaignType
  status: GoogleAdsResourceStatus
  bidding_strategy: string | null
  budget_micros: number | null
  start_date: string | null
  end_date: string | null
  automation_mode: GoogleAdsAutomationMode
  raw_data: Record<string, unknown> | null
  last_synced_at: string
  created_at: string
  updated_at: string
}

export interface GoogleAdsAdGroup {
  id: string
  campaign_id: string
  ad_group_id: string
  name: string
  status: GoogleAdsResourceStatus
  type: string | null
  cpc_bid_micros: number | null
  raw_data: Record<string, unknown> | null
  last_synced_at: string
  created_at: string
  updated_at: string
}

export interface GoogleAdsKeyword {
  id: string
  ad_group_id: string
  criterion_id: string
  text: string
  match_type: GoogleAdsKeywordMatchType
  status: GoogleAdsResourceStatus
  cpc_bid_micros: number | null
  raw_data: Record<string, unknown> | null
  last_synced_at: string
  created_at: string
}

export interface GoogleAdsAd {
  id: string
  ad_group_id: string
  ad_id: string
  type: string
  status: GoogleAdsResourceStatus
  headlines: Array<{ text: string }>
  descriptions: Array<{ text: string }>
  final_urls: string[]
  raw_data: Record<string, unknown> | null
  last_synced_at: string
  created_at: string
}

export interface GoogleAdsDailyMetric {
  id: string
  customer_id: string
  campaign_id: string
  ad_group_id: string | null
  keyword_criterion_id: string | null
  date: string
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  conversion_value: number
  ctr: number
  avg_cpc_micros: number
  raw_data: Record<string, unknown> | null
  last_synced_at: string
}

export interface GoogleAdsSearchTerm {
  id: string
  customer_id: string
  campaign_id: string
  ad_group_id: string
  search_term: string
  date: string
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  matched_keyword_id: string | null
  last_synced_at: string
}
```

- [ ] **Step 2: Create `lib/validators/ads.ts`**

```ts
import { z } from "zod"

export const googleAdsCampaignTypeSchema = z.enum([
  "SEARCH", "VIDEO", "PERFORMANCE_MAX", "DISPLAY", "SHOPPING",
  "DEMAND_GEN", "LOCAL_SERVICES", "APP", "HOTEL", "SMART", "UNKNOWN",
])

export const googleAdsResourceStatusSchema = z.enum(["ENABLED", "PAUSED", "REMOVED"])
export const googleAdsKeywordMatchTypeSchema = z.enum(["EXACT", "PHRASE", "BROAD"])
export const googleAdsAutomationModeSchema = z.enum(["auto_pilot", "co_pilot", "advisory"])

export const automationModeUpdateSchema = z.object({
  campaign_id: z.string().uuid(),
  automation_mode: googleAdsAutomationModeSchema,
})

// OAuth callback parses these from the redirected query
export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  error: z.string().optional(),
  error_description: z.string().optional(),
})
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`. Expect no NEW errors in source files.

- [ ] **Step 4: Commit**

```bash
git add types/database.ts lib/validators/ads.ts
git commit -m "feat(types): Google Ads types + validators (Phase 1.1)"
```

---

## Task 7: DAL — google_ads_accounts

**Files:**
- Create: `lib/db/google-ads-accounts.ts`

- [ ] **Step 1: Create**

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { GoogleAdsAccount } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listGoogleAdsAccounts(): Promise<GoogleAdsAccount[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_accounts")
    .select("*")
    .order("descriptive_name", { ascending: true })
  if (error) throw error
  return (data ?? []) as GoogleAdsAccount[]
}

export async function getActiveGoogleAdsAccounts(): Promise<GoogleAdsAccount[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_accounts")
    .select("*")
    .eq("is_active", true)
  if (error) throw error
  return (data ?? []) as GoogleAdsAccount[]
}

export async function upsertGoogleAdsAccount(account: {
  customer_id: string
  manager_customer_id?: string | null
  descriptive_name?: string | null
  currency_code?: string | null
  time_zone?: string | null
  connected_at?: string | null
}): Promise<GoogleAdsAccount> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_accounts")
    .upsert(
      {
        customer_id: account.customer_id,
        manager_customer_id: account.manager_customer_id ?? null,
        descriptive_name: account.descriptive_name ?? null,
        currency_code: account.currency_code ?? null,
        time_zone: account.time_zone ?? null,
        connected_at: account.connected_at ?? new Date().toISOString(),
        is_active: true,
      },
      { onConflict: "customer_id" },
    )
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsAccount
}

export async function setGoogleAdsAccountSyncResult(
  customer_id: string,
  result: { last_error?: string | null },
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("google_ads_accounts")
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: result.last_error ?? null,
    })
    .eq("customer_id", customer_id)
  if (error) throw error
}

export async function deactivateGoogleAdsAccount(customer_id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("google_ads_accounts")
    .update({ is_active: false })
    .eq("customer_id", customer_id)
  if (error) throw error
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/google-ads-accounts.ts
git commit -m "feat(db): DAL for google_ads_accounts"
```

---

## Task 8: DAL — campaigns, ad_groups, keywords, ads

**Files:**
- Create: `lib/db/google-ads-campaigns.ts`
- Create: `lib/db/google-ads-ad-groups.ts`
- Create: `lib/db/google-ads-keywords.ts`
- Create: `lib/db/google-ads-ads.ts`

- [ ] **Step 1: Create `lib/db/google-ads-campaigns.ts`**

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { GoogleAdsCampaign, GoogleAdsAutomationMode } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface UpsertCampaignInput {
  customer_id: string
  campaign_id: string
  name: string
  type: string
  status: string
  bidding_strategy?: string | null
  budget_micros?: number | null
  start_date?: string | null
  end_date?: string | null
  raw_data?: Record<string, unknown> | null
}

export async function listCampaignsForCustomer(customerId: string): Promise<GoogleAdsCampaign[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_campaigns")
    .select("*")
    .eq("customer_id", customerId)
    .order("name")
  if (error) throw error
  return (data ?? []) as GoogleAdsCampaign[]
}

export async function getCampaignById(id: string): Promise<GoogleAdsCampaign | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as GoogleAdsCampaign | null) ?? null
}

/**
 * UPSERT preserves the local automation_mode override — it's not in the
 * upsert payload, so an existing row keeps its previously-set mode.
 */
export async function upsertCampaign(input: UpsertCampaignInput): Promise<GoogleAdsCampaign> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_campaigns")
    .upsert(
      {
        customer_id: input.customer_id,
        campaign_id: input.campaign_id,
        name: input.name,
        type: input.type,
        status: input.status,
        bidding_strategy: input.bidding_strategy ?? null,
        budget_micros: input.budget_micros ?? null,
        start_date: input.start_date ?? null,
        end_date: input.end_date ?? null,
        raw_data: input.raw_data ?? null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "customer_id,campaign_id", ignoreDuplicates: false },
    )
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsCampaign
}

export async function setAutomationMode(
  id: string,
  mode: GoogleAdsAutomationMode,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("google_ads_campaigns")
    .update({ automation_mode: mode })
    .eq("id", id)
  if (error) throw error
}
```

- [ ] **Step 2: Create `lib/db/google-ads-ad-groups.ts`**

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { GoogleAdsAdGroup } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface UpsertAdGroupInput {
  campaign_id: string  // local UUID FK to google_ads_campaigns.id
  ad_group_id: string
  name: string
  status: string
  type?: string | null
  cpc_bid_micros?: number | null
  raw_data?: Record<string, unknown> | null
}

export async function upsertAdGroup(input: UpsertAdGroupInput): Promise<GoogleAdsAdGroup> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_ad_groups")
    .upsert(
      {
        campaign_id: input.campaign_id,
        ad_group_id: input.ad_group_id,
        name: input.name,
        status: input.status,
        type: input.type ?? null,
        cpc_bid_micros: input.cpc_bid_micros ?? null,
        raw_data: input.raw_data ?? null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "campaign_id,ad_group_id" },
    )
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsAdGroup
}
```

- [ ] **Step 3: Create `lib/db/google-ads-keywords.ts`**

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { GoogleAdsKeyword, GoogleAdsKeywordMatchType, GoogleAdsResourceStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface UpsertKeywordInput {
  ad_group_id: string  // local UUID FK
  criterion_id: string
  text: string
  match_type: GoogleAdsKeywordMatchType
  status: GoogleAdsResourceStatus
  cpc_bid_micros?: number | null
  raw_data?: Record<string, unknown> | null
}

export async function upsertKeyword(input: UpsertKeywordInput): Promise<GoogleAdsKeyword> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_keywords")
    .upsert(
      {
        ad_group_id: input.ad_group_id,
        criterion_id: input.criterion_id,
        text: input.text,
        match_type: input.match_type,
        status: input.status,
        cpc_bid_micros: input.cpc_bid_micros ?? null,
        raw_data: input.raw_data ?? null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "ad_group_id,criterion_id" },
    )
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsKeyword
}

export async function listKeywordsForAdGroup(adGroupId: string): Promise<GoogleAdsKeyword[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_keywords")
    .select("*")
    .eq("ad_group_id", adGroupId)
    .order("text")
  if (error) throw error
  return (data ?? []) as GoogleAdsKeyword[]
}
```

- [ ] **Step 4: Create `lib/db/google-ads-ads.ts`**

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { GoogleAdsAd, GoogleAdsResourceStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface UpsertAdInput {
  ad_group_id: string  // local UUID FK
  ad_id: string
  type: string
  status: GoogleAdsResourceStatus
  headlines: Array<{ text: string }>
  descriptions: Array<{ text: string }>
  final_urls: string[]
  raw_data?: Record<string, unknown> | null
}

export async function upsertAd(input: UpsertAdInput): Promise<GoogleAdsAd> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_ads")
    .upsert(
      {
        ad_group_id: input.ad_group_id,
        ad_id: input.ad_id,
        type: input.type,
        status: input.status,
        headlines: input.headlines,
        descriptions: input.descriptions,
        final_urls: input.final_urls,
        raw_data: input.raw_data ?? null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "ad_group_id,ad_id" },
    )
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsAd
}
```

- [ ] **Step 5: Type-check + commit**

```bash
git add lib/db/google-ads-campaigns.ts lib/db/google-ads-ad-groups.ts lib/db/google-ads-keywords.ts lib/db/google-ads-ads.ts
git commit -m "feat(db): DAL for campaigns, ad_groups, keywords, ads"
```

---

## Task 9: DAL — metrics + search_terms

**Files:**
- Create: `lib/db/google-ads-metrics.ts`
- Create: `lib/db/google-ads-search-terms.ts`

- [ ] **Step 1: Create `lib/db/google-ads-metrics.ts`**

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { GoogleAdsDailyMetric } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface UpsertDailyMetricInput {
  customer_id: string
  campaign_id: string
  ad_group_id?: string | null
  keyword_criterion_id?: string | null
  date: string  // YYYY-MM-DD
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  conversion_value: number
  raw_data?: Record<string, unknown> | null
}

export async function upsertDailyMetrics(rows: UpsertDailyMetricInput[]): Promise<number> {
  if (rows.length === 0) return 0
  const supabase = getClient()
  const payload = rows.map((r) => ({
    customer_id: r.customer_id,
    campaign_id: r.campaign_id,
    ad_group_id: r.ad_group_id ?? null,
    keyword_criterion_id: r.keyword_criterion_id ?? null,
    date: r.date,
    impressions: r.impressions,
    clicks: r.clicks,
    cost_micros: r.cost_micros,
    conversions: r.conversions,
    conversion_value: r.conversion_value,
    raw_data: r.raw_data ?? null,
    last_synced_at: new Date().toISOString(),
  }))
  // Batches of 500 to stay under Supabase row-limit comfortably
  let written = 0
  for (let i = 0; i < payload.length; i += 500) {
    const batch = payload.slice(i, i + 500)
    const { error, count } = await supabase
      .from("google_ads_daily_metrics")
      .upsert(batch, {
        onConflict:
          "customer_id,campaign_id,ad_group_id,keyword_criterion_id,date",
        count: "exact",
      })
    if (error) throw error
    written += count ?? batch.length
  }
  return written
}

export async function getDailyMetricsForCampaign(
  campaignId: string,
  fromDate: string,
  toDate: string,
): Promise<GoogleAdsDailyMetric[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_daily_metrics")
    .select("*")
    .eq("campaign_id", campaignId)
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("date")
  if (error) throw error
  return (data ?? []) as GoogleAdsDailyMetric[]
}
```

- [ ] **Step 2: Create `lib/db/google-ads-search-terms.ts`**

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { GoogleAdsSearchTerm } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface UpsertSearchTermInput {
  customer_id: string
  campaign_id: string
  ad_group_id: string
  search_term: string
  date: string
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  matched_keyword_id?: string | null
}

export async function upsertSearchTerms(rows: UpsertSearchTermInput[]): Promise<number> {
  if (rows.length === 0) return 0
  const supabase = getClient()
  const payload = rows.map((r) => ({
    customer_id: r.customer_id,
    campaign_id: r.campaign_id,
    ad_group_id: r.ad_group_id,
    search_term: r.search_term,
    date: r.date,
    impressions: r.impressions,
    clicks: r.clicks,
    cost_micros: r.cost_micros,
    conversions: r.conversions,
    matched_keyword_id: r.matched_keyword_id ?? null,
    last_synced_at: new Date().toISOString(),
  }))
  let written = 0
  for (let i = 0; i < payload.length; i += 500) {
    const batch = payload.slice(i, i + 500)
    const { error, count } = await supabase
      .from("google_ads_search_terms")
      .upsert(batch, {
        onConflict: "customer_id,campaign_id,ad_group_id,search_term,date",
        count: "exact",
      })
    if (error) throw error
    written += count ?? batch.length
  }
  return written
}

export async function listRecentUnmatchedSearchTerms(
  customerId: string,
  withinDays: number = 14,
): Promise<GoogleAdsSearchTerm[]> {
  const supabase = getClient()
  const since = new Date(Date.now() - withinDays * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from("google_ads_search_terms")
    .select("*")
    .eq("customer_id", customerId)
    .gte("date", since)
    .is("matched_keyword_id", null)
    .order("impressions", { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []) as GoogleAdsSearchTerm[]
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/db/google-ads-metrics.ts lib/db/google-ads-search-terms.ts
git commit -m "feat(db): DAL for daily metrics + search terms"
```

---

## Task 10: Add `google-ads-api` dependency

**Files:**
- Modify: `package.json` (Next.js)
- Modify: `functions/package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install in Next.js root**

```bash
npm install google-ads-api@^17
```

- [ ] **Step 2: Install in Functions**

```bash
cd functions && npm install google-ads-api@^17 && cd ..
```

- [ ] **Step 3: Add env vars to `.env.example`**

Append to `.env.example`:

```
# Google Ads — Phase 1.1
# Apply for Developer Token: Google Ads → Tools & Settings → API Center
GOOGLE_ADS_DEVELOPER_TOKEN=
# OAuth credentials from Google Cloud Console
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
# 10-digit Customer ID, no dashes (manager ID if MCC)
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
# Must match the redirect URI configured in Google Cloud Console exactly.
# In dev: http://localhost:3050/api/integrations/google-ads/callback
GOOGLE_ADS_REDIRECT_URI=https://www.darrenjpaul.com/api/integrations/google-ads/callback
```

- [ ] **Step 4: Build to verify**

```bash
cd functions && npm run build && cd ..
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json functions/package.json functions/package-lock.json .env.example
git commit -m "build: add google-ads-api dep + env var scaffolding"
```

---

## Task 11: OAuth helpers — `lib/ads/oauth.ts`

**Files:**
- Create: `lib/ads/oauth.ts`
- Test: `__tests__/lib/ads/oauth.test.ts`

OAuth flow uses Google's standard offline-access pattern. The state parameter is signed with `NEXTAUTH_SECRET` to prevent CSRF.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/ads/oauth.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { buildAuthorizationUrl, signState, verifyState } from "@/lib/ads/oauth"

const TEST_SECRET = "test-secret-do-not-use-in-prod"

describe("signState / verifyState", () => {
  it("signs and verifies a payload round-trip", () => {
    const state = signState({ user_id: "u1", nonce: "abc" }, TEST_SECRET)
    expect(typeof state).toBe("string")
    const verified = verifyState<{ user_id: string; nonce: string }>(state, TEST_SECRET)
    expect(verified).toEqual({ user_id: "u1", nonce: "abc" })
  })

  it("rejects tampered state", () => {
    const state = signState({ user_id: "u1" }, TEST_SECRET)
    const tampered = state.slice(0, -2) + "xx"
    expect(verifyState(tampered, TEST_SECRET)).toBeNull()
  })

  it("rejects state signed with a different secret", () => {
    const state = signState({ user_id: "u1" }, TEST_SECRET)
    expect(verifyState(state, "different-secret")).toBeNull()
  })
})

describe("buildAuthorizationUrl", () => {
  it("includes required OAuth params with the adwords scope", () => {
    const url = buildAuthorizationUrl({
      client_id: "test-client-id",
      redirect_uri: "https://example.com/callback",
      state: "state-token",
    })
    const parsed = new URL(url)
    expect(parsed.host).toBe("accounts.google.com")
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id")
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://example.com/callback")
    expect(parsed.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/adwords")
    expect(parsed.searchParams.get("access_type")).toBe("offline")
    expect(parsed.searchParams.get("prompt")).toBe("consent")
    expect(parsed.searchParams.get("state")).toBe("state-token")
    expect(parsed.searchParams.get("response_type")).toBe("code")
  })
})
```

- [ ] **Step 2: Run test — FAIL**

`npx vitest run __tests__/lib/ads/oauth.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Implement**

Create `lib/ads/oauth.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto"

const ADWORDS_SCOPE = "https://www.googleapis.com/auth/adwords"

export interface AuthorizationUrlInput {
  client_id: string
  redirect_uri: string
  state: string
}

export function buildAuthorizationUrl(input: AuthorizationUrlInput): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("client_id", input.client_id)
  url.searchParams.set("redirect_uri", input.redirect_uri)
  url.searchParams.set("scope", ADWORDS_SCOPE)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("state", input.state)
  return url.toString()
}

/**
 * Sign an arbitrary JSON payload as `<base64(payload)>.<base64(hmac)>`. Used
 * for the OAuth state parameter so the callback can verify it wasn't forged.
 */
export function signState<T>(payload: T, secret: string): string {
  const json = JSON.stringify(payload)
  const body = Buffer.from(json, "utf8").toString("base64url")
  const hmac = createHmac("sha256", secret).update(body).digest("base64url")
  return `${body}.${hmac}`
}

export function verifyState<T>(state: string, secret: string): T | null {
  const [body, sig] = state.split(".")
  if (!body || !sig) return null
  const expected = createHmac("sha256", secret).update(body).digest("base64url")
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null
  try {
    const json = Buffer.from(body, "base64url").toString("utf8")
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

export interface ExchangeCodeInput {
  code: string
  client_id: string
  client_secret: string
  redirect_uri: string
}

export interface OAuthTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: "Bearer"
  scope: string
}

/**
 * Exchange an OAuth authorization code for an access + refresh token via
 * Google's token endpoint. Throws on non-200 responses.
 */
export async function exchangeCodeForTokens(input: ExchangeCodeInput): Promise<OAuthTokenResponse> {
  const params = new URLSearchParams({
    code: input.code,
    client_id: input.client_id,
    client_secret: input.client_secret,
    redirect_uri: input.redirect_uri,
    grant_type: "authorization_code",
  })
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`OAuth token exchange failed: HTTP ${res.status} ${text}`)
  }
  return (await res.json()) as OAuthTokenResponse
}
```

- [ ] **Step 4: Verify tests pass**

`npx vitest run __tests__/lib/ads/oauth.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/oauth.ts __tests__/lib/ads/oauth.test.ts
git commit -m "feat(ads): OAuth helpers (state signing + auth URL + code exchange)"
```

---

## Task 12: OAuth connect route

**Files:**
- Create: `app/api/integrations/google-ads/connect/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { buildAuthorizationUrl, signState } from "@/lib/ads/oauth"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI
  const secret = process.env.NEXTAUTH_SECRET
  if (!clientId || !redirectUri || !secret) {
    return NextResponse.json({ error: "Google Ads OAuth not configured" }, { status: 500 })
  }

  const state = signState(
    { user_id: session.user.id, nonce: crypto.randomUUID(), iat: Date.now() },
    secret,
  )
  const url = buildAuthorizationUrl({ client_id: clientId, redirect_uri: redirectUri, state })

  return NextResponse.redirect(url)
}
```

- [ ] **Step 2: Type-check + commit**

```bash
git add app/api/integrations/google-ads/connect/route.ts
git commit -m "feat(api): Google Ads OAuth connect route"
```

---

## Task 13: OAuth callback route + token storage

**Files:**
- Create: `app/api/integrations/google-ads/callback/route.ts`
- Test: `__tests__/api/integrations/google-ads-callback.test.ts`

The callback exchanges the authorization code for tokens, persists the encrypted refresh token in `platform_connections`, and writes a row to `google_ads_accounts` keyed by the discovered Customer ID.

This task uses the existing `platform_connections` encryption pattern from migration 00089. Look up how other platforms do it (Meta, LinkedIn) and mirror the pattern.

- [ ] **Step 1: Read existing platform_connections write path**

```bash
grep -rn "platform_connections" lib/db/ app/api/integrations/ | head
```
Find the existing pattern for writing encrypted credentials. Most likely there's a helper like `setPlatformConnection({ plugin_name, credentials })` in `lib/db/platform-connections.ts` that handles encryption transparently. Reuse it.

- [ ] **Step 2: Write the failing test**

Create `__tests__/api/integrations/google-ads-callback.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  exchangeCodeForTokens: vi.fn(),
  verifyState: vi.fn(),
  setPlatformCredentials: vi.fn(),
  upsertGoogleAdsAccount: vi.fn(),
  listAccessibleCustomers: vi.fn(),
}))

vi.mock("@/lib/ads/oauth", () => ({
  exchangeCodeForTokens: mocks.exchangeCodeForTokens,
  verifyState: mocks.verifyState,
  signState: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
}))
vi.mock("@/lib/db/platform-connections", () => ({
  setPlatformCredentials: mocks.setPlatformCredentials,
}))
vi.mock("@/lib/db/google-ads-accounts", () => ({
  upsertGoogleAdsAccount: mocks.upsertGoogleAdsAccount,
}))
vi.mock("@/lib/ads/google-ads-client", () => ({
  listAccessibleCustomers: mocks.listAccessibleCustomers,
}))

import { GET } from "@/app/api/integrations/google-ads/callback/route"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GOOGLE_ADS_CLIENT_ID = "cid"
  process.env.GOOGLE_ADS_CLIENT_SECRET = "csec"
  process.env.GOOGLE_ADS_REDIRECT_URI = "http://localhost/cb"
  process.env.NEXTAUTH_SECRET = "secret"
})

function reqWith(query: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/integrations/google-ads/callback")
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

describe("GET /api/integrations/google-ads/callback", () => {
  it("400 when state is missing", async () => {
    const res = await GET(reqWith({ code: "abc" }))
    expect(res.status).toBe(400)
  })

  it("400 when state fails verification", async () => {
    mocks.verifyState.mockReturnValueOnce(null)
    const res = await GET(reqWith({ code: "abc", state: "bad" }))
    expect(res.status).toBe(400)
  })

  it("redirects to settings on success", async () => {
    mocks.verifyState.mockReturnValueOnce({ user_id: "u1" })
    mocks.exchangeCodeForTokens.mockResolvedValueOnce({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "adwords",
    })
    mocks.listAccessibleCustomers.mockResolvedValueOnce([
      { customer_id: "1234567890", descriptive_name: "Darren Paul Athlete" },
    ])
    mocks.upsertGoogleAdsAccount.mockResolvedValueOnce({})
    mocks.setPlatformCredentials.mockResolvedValueOnce({})

    const res = await GET(reqWith({ code: "auth-code", state: "good" }))
    expect(res.status).toBe(307)  // NextResponse.redirect default status
    expect(mocks.setPlatformCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        plugin_name: "google_ads",
        credentials: expect.objectContaining({ refresh_token: "rt" }),
      }),
    )
    expect(mocks.upsertGoogleAdsAccount).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: "1234567890" }),
    )
  })
})
```

- [ ] **Step 3: Implement the route**

Create `app/api/integrations/google-ads/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { exchangeCodeForTokens, verifyState } from "@/lib/ads/oauth"
import { setPlatformCredentials } from "@/lib/db/platform-connections"
import { upsertGoogleAdsAccount } from "@/lib/db/google-ads-accounts"
import { listAccessibleCustomers } from "@/lib/ads/google-ads-client"
import { oauthCallbackQuerySchema } from "@/lib/validators/ads"

export async function GET(request: NextRequest) {
  const params: Record<string, string> = {}
  request.nextUrl.searchParams.forEach((v, k) => (params[k] = v))
  const parsed = oauthCallbackQuerySchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid callback params" }, { status: 400 })
  }
  const { code, state, error: googleError, error_description } = parsed.data
  if (googleError) {
    return NextResponse.redirect(
      new URL(`/admin/ads/settings?error=${encodeURIComponent(error_description ?? googleError)}`, request.url),
    )
  }

  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })

  const claim = verifyState<{ user_id: string }>(state, secret)
  if (!claim) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 })
  }

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "Google Ads OAuth not configured" }, { status: 500 })
  }

  let tokens
  try {
    tokens = await exchangeCodeForTokens({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    })
  } catch (err) {
    return NextResponse.redirect(
      new URL(
        `/admin/ads/settings?error=${encodeURIComponent("Token exchange failed: " + (err as Error).message)}`,
        request.url,
      ),
    )
  }

  // Persist refresh token (encrypted at rest in platform_connections)
  await setPlatformCredentials({
    plugin_name: "google_ads",
    credentials: {
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      authorized_user_id: claim.user_id,
      authorized_at: new Date().toISOString(),
    },
  })

  // Discover the Customer ID(s) the user just authorized us for, write a row per account.
  try {
    const accounts = await listAccessibleCustomers(tokens.refresh_token)
    for (const acct of accounts) {
      await upsertGoogleAdsAccount({
        customer_id: acct.customer_id,
        descriptive_name: acct.descriptive_name,
        currency_code: acct.currency_code,
        time_zone: acct.time_zone,
      })
    }
  } catch (err) {
    return NextResponse.redirect(
      new URL(
        `/admin/ads/settings?error=${encodeURIComponent("Customer discovery failed: " + (err as Error).message)}`,
        request.url,
      ),
    )
  }

  return NextResponse.redirect(new URL("/admin/ads/settings?connected=1", request.url))
}
```

> **Note on `setPlatformCredentials`:** Read `lib/db/platform-connections.ts` to confirm the exact signature. If the existing function takes `(pluginName, credentials)` rather than an object, adapt the call.

- [ ] **Step 4: Verify tests pass**

`npx vitest run __tests__/api/integrations/google-ads-callback.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/integrations/google-ads/callback/route.ts __tests__/api/integrations/google-ads-callback.test.ts
git commit -m "feat(api): Google Ads OAuth callback route + account discovery"
```

---

## Task 14: OAuth disconnect route

**Files:**
- Create: `app/api/integrations/google-ads/disconnect/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { setPlatformCredentials } from "@/lib/db/platform-connections"
import { listGoogleAdsAccounts, deactivateGoogleAdsAccount } from "@/lib/db/google-ads-accounts"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Clear stored credentials (sets status to 'not_connected')
  await setPlatformCredentials({
    plugin_name: "google_ads",
    credentials: {},  // empty payload — DAL will treat this as a disconnect
  })

  // Mark all linked accounts inactive (data preserved for historical analysis)
  const accounts = await listGoogleAdsAccounts()
  for (const acct of accounts) {
    await deactivateGoogleAdsAccount(acct.customer_id)
  }

  return NextResponse.json({ success: true })
}
```

> **Note:** if `setPlatformCredentials` doesn't support empty-payload-as-disconnect, look for a dedicated helper like `disconnectPlatform(pluginName)` in `lib/db/platform-connections.ts`. Use whichever exists.

- [ ] **Step 2: Commit**

```bash
git add app/api/integrations/google-ads/disconnect/route.ts
git commit -m "feat(api): Google Ads OAuth disconnect route"
```

---

## Task 15: Google Ads API client wrapper

**Files:**
- Create: `lib/ads/google-ads-client.ts`

- [ ] **Step 1: Implement**

```ts
import { GoogleAdsApi, type Customer } from "google-ads-api"
import { getPlatformCredentials } from "@/lib/db/platform-connections"

interface GoogleAdsConfig {
  developer_token: string
  client_id: string
  client_secret: string
}

function getConfig(): GoogleAdsConfig {
  const developer_token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  const client_id = process.env.GOOGLE_ADS_CLIENT_ID
  const client_secret = process.env.GOOGLE_ADS_CLIENT_SECRET
  if (!developer_token || !client_id || !client_secret) {
    throw new Error("Google Ads env vars missing (GOOGLE_ADS_DEVELOPER_TOKEN/CLIENT_ID/CLIENT_SECRET)")
  }
  return { developer_token, client_id, client_secret }
}

let _client: GoogleAdsApi | null = null

function getClient(): GoogleAdsApi {
  if (!_client) {
    const cfg = getConfig()
    _client = new GoogleAdsApi(cfg)
  }
  return _client
}

/**
 * Build a customer-scoped client using the stored refresh_token. Each call
 * costs nothing (no network); the refresh happens lazily on the first query.
 */
export async function getCustomerClient(customerId: string): Promise<Customer> {
  const creds = await getPlatformCredentials("google_ads")
  if (!creds?.refresh_token) {
    throw new Error("Google Ads not connected")
  }
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  return getClient().Customer({
    customer_id: customerId,
    refresh_token: creds.refresh_token,
    ...(loginCustomerId ? { login_customer_id: loginCustomerId } : {}),
  })
}

/**
 * One-shot: take a refresh_token and list every Customer ID the OAuth user
 * has access to. Used during the OAuth callback before we've persisted the
 * refresh token. Returns descriptive_name, currency, time_zone for each.
 */
export interface AccessibleCustomerSummary {
  customer_id: string
  descriptive_name: string | null
  currency_code: string | null
  time_zone: string | null
}

export async function listAccessibleCustomers(
  refresh_token: string,
): Promise<AccessibleCustomerSummary[]> {
  const cfg = getConfig()
  const api = new GoogleAdsApi(cfg)
  const customers = await api.listAccessibleCustomers(refresh_token)
  // listAccessibleCustomers returns just IDs. We need to query each one for
  // its descriptive_name etc. — but that requires a customer-scoped client
  // with the right login_customer_id. For Phase 1.1 single-account, we just
  // return the IDs and let the caller fill in metadata after the user picks
  // one (or we auto-pick the first / only one).
  return customers.resource_names.map((rn) => ({
    customer_id: rn.replace("customers/", ""),
    descriptive_name: null,
    currency_code: null,
    time_zone: null,
  }))
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ads/google-ads-client.ts
git commit -m "feat(ads): google-ads-api client wrapper + accessible-customers discovery"
```

---

## Task 16: Sync helpers — pure functions for parsing GAQL responses

**Files:**
- Create: `lib/ads/sync-helpers.ts`

These are pure transforms from `google-ads-api` query result shapes to our DAL input shapes. No I/O. Easily unit-testable. The Functions side will duplicate this file in `functions/src/ads/sync-helpers.ts` (Task 19) — keep them in sync manually.

- [ ] **Step 1: Implement**

```ts
import type { UpsertCampaignInput } from "@/lib/db/google-ads-campaigns"
import type { UpsertAdGroupInput } from "@/lib/db/google-ads-ad-groups"
import type { UpsertKeywordInput } from "@/lib/db/google-ads-keywords"
import type { UpsertAdInput } from "@/lib/db/google-ads-ads"
import type { UpsertDailyMetricInput } from "@/lib/db/google-ads-metrics"
import type { UpsertSearchTermInput } from "@/lib/db/google-ads-search-terms"
import type {
  GoogleAdsCampaignType,
  GoogleAdsKeywordMatchType,
  GoogleAdsResourceStatus,
} from "@/types/database"

const CAMPAIGN_TYPE_VALUES: GoogleAdsCampaignType[] = [
  "SEARCH", "VIDEO", "PERFORMANCE_MAX", "DISPLAY", "SHOPPING",
  "DEMAND_GEN", "LOCAL_SERVICES", "APP", "HOTEL", "SMART", "UNKNOWN",
]
const STATUS_VALUES: GoogleAdsResourceStatus[] = ["ENABLED", "PAUSED", "REMOVED"]
const MATCH_TYPE_VALUES: GoogleAdsKeywordMatchType[] = ["EXACT", "PHRASE", "BROAD"]

function coerceCampaignType(raw: unknown): GoogleAdsCampaignType {
  return CAMPAIGN_TYPE_VALUES.includes(raw as GoogleAdsCampaignType)
    ? (raw as GoogleAdsCampaignType)
    : "UNKNOWN"
}
function coerceStatus(raw: unknown): GoogleAdsResourceStatus {
  return STATUS_VALUES.includes(raw as GoogleAdsResourceStatus)
    ? (raw as GoogleAdsResourceStatus)
    : "REMOVED"
}
function coerceMatchType(raw: unknown): GoogleAdsKeywordMatchType {
  return MATCH_TYPE_VALUES.includes(raw as GoogleAdsKeywordMatchType)
    ? (raw as GoogleAdsKeywordMatchType)
    : "BROAD"
}

interface CampaignRow {
  campaign?: {
    id?: string | number
    name?: string
    advertising_channel_type?: string
    status?: string
    bidding_strategy_type?: string
    start_date?: string | null
    end_date?: string | null
  }
  campaign_budget?: { amount_micros?: string | number | null }
}

export function transformCampaignRow(row: CampaignRow, customer_id: string): UpsertCampaignInput {
  const c = row.campaign ?? {}
  return {
    customer_id,
    campaign_id: String(c.id ?? ""),
    name: c.name ?? "",
    type: coerceCampaignType(c.advertising_channel_type),
    status: coerceStatus(c.status),
    bidding_strategy: c.bidding_strategy_type ?? null,
    budget_micros: row.campaign_budget?.amount_micros != null ? Number(row.campaign_budget.amount_micros) : null,
    start_date: c.start_date ?? null,
    end_date: c.end_date ?? null,
    raw_data: row as unknown as Record<string, unknown>,
  }
}

interface AdGroupRow {
  ad_group?: {
    id?: string | number
    name?: string
    status?: string
    type?: string
    cpc_bid_micros?: string | number | null
  }
}

export function transformAdGroupRow(row: AdGroupRow, localCampaignId: string): UpsertAdGroupInput {
  const ag = row.ad_group ?? {}
  return {
    campaign_id: localCampaignId,
    ad_group_id: String(ag.id ?? ""),
    name: ag.name ?? "",
    status: coerceStatus(ag.status),
    type: ag.type ?? null,
    cpc_bid_micros: ag.cpc_bid_micros != null ? Number(ag.cpc_bid_micros) : null,
    raw_data: row as unknown as Record<string, unknown>,
  }
}

interface KeywordRow {
  ad_group_criterion?: {
    criterion_id?: string | number
    keyword?: { text?: string; match_type?: string }
    status?: string
    cpc_bid_micros?: string | number | null
  }
}

export function transformKeywordRow(row: KeywordRow, localAdGroupId: string): UpsertKeywordInput {
  const k = row.ad_group_criterion ?? {}
  return {
    ad_group_id: localAdGroupId,
    criterion_id: String(k.criterion_id ?? ""),
    text: k.keyword?.text ?? "",
    match_type: coerceMatchType(k.keyword?.match_type),
    status: coerceStatus(k.status),
    cpc_bid_micros: k.cpc_bid_micros != null ? Number(k.cpc_bid_micros) : null,
    raw_data: row as unknown as Record<string, unknown>,
  }
}

interface AdRow {
  ad_group_ad?: {
    ad?: {
      id?: string | number
      type?: string
      responsive_search_ad?: {
        headlines?: Array<{ text?: string }>
        descriptions?: Array<{ text?: string }>
      }
      final_urls?: string[]
    }
    status?: string
  }
}

export function transformAdRow(row: AdRow, localAdGroupId: string): UpsertAdInput {
  const ad = row.ad_group_ad?.ad ?? {}
  return {
    ad_group_id: localAdGroupId,
    ad_id: String(ad.id ?? ""),
    type: ad.type ?? "RESPONSIVE_SEARCH_AD",
    status: coerceStatus(row.ad_group_ad?.status),
    headlines: (ad.responsive_search_ad?.headlines ?? [])
      .filter((h) => typeof h.text === "string")
      .map((h) => ({ text: h.text as string })),
    descriptions: (ad.responsive_search_ad?.descriptions ?? [])
      .filter((d) => typeof d.text === "string")
      .map((d) => ({ text: d.text as string })),
    final_urls: ad.final_urls ?? [],
    raw_data: row as unknown as Record<string, unknown>,
  }
}

interface MetricsRow {
  segments?: { date?: string }
  metrics?: {
    impressions?: string | number
    clicks?: string | number
    cost_micros?: string | number
    conversions?: string | number
    conversions_value?: string | number
  }
  campaign?: { id?: string | number }
  ad_group?: { id?: string | number }
  ad_group_criterion?: { criterion_id?: string | number }
}

export function transformMetricsRow(row: MetricsRow, customer_id: string): UpsertDailyMetricInput {
  const m = row.metrics ?? {}
  return {
    customer_id,
    campaign_id: String(row.campaign?.id ?? ""),
    ad_group_id: row.ad_group?.id != null ? String(row.ad_group.id) : null,
    keyword_criterion_id:
      row.ad_group_criterion?.criterion_id != null
        ? String(row.ad_group_criterion.criterion_id)
        : null,
    date: row.segments?.date ?? new Date().toISOString().slice(0, 10),
    impressions: Number(m.impressions ?? 0),
    clicks: Number(m.clicks ?? 0),
    cost_micros: Number(m.cost_micros ?? 0),
    conversions: Number(m.conversions ?? 0),
    conversion_value: Number(m.conversions_value ?? 0),
    raw_data: row as unknown as Record<string, unknown>,
  }
}

interface SearchTermRow {
  search_term_view?: { search_term?: string }
  segments?: { date?: string; keyword?: { ad_group_criterion?: string } }
  metrics?: {
    impressions?: string | number
    clicks?: string | number
    cost_micros?: string | number
    conversions?: string | number
  }
  campaign?: { id?: string | number }
  ad_group?: { id?: string | number }
}

export function transformSearchTermRow(row: SearchTermRow, customer_id: string): UpsertSearchTermInput {
  const m = row.metrics ?? {}
  return {
    customer_id,
    campaign_id: String(row.campaign?.id ?? ""),
    ad_group_id: String(row.ad_group?.id ?? ""),
    search_term: row.search_term_view?.search_term ?? "",
    date: row.segments?.date ?? new Date().toISOString().slice(0, 10),
    impressions: Number(m.impressions ?? 0),
    clicks: Number(m.clicks ?? 0),
    cost_micros: Number(m.cost_micros ?? 0),
    conversions: Number(m.conversions ?? 0),
    matched_keyword_id: row.segments?.keyword?.ad_group_criterion ?? null,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ads/sync-helpers.ts
git commit -m "feat(ads): sync helpers (GAQL response → DAL input transforms)"
```

---

## Task 17: Manual sync trigger route (admin)

**Files:**
- Create: `app/api/admin/ads/sync/route.ts`

This route lets admin click a "Sync now" button to enqueue an ai_jobs doc that the Firebase Function picks up. Saves Darren from waiting for the nightly run.

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const db = getAdminFirestore()
  const jobRef = db.collection("ai_jobs").doc()
  await jobRef.set({
    type: "google_ads_sync",
    status: "pending",
    input: { triggered_by: session.user.id, manual: true },
    result: null,
    error: null,
    userId: session.user.id,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return NextResponse.json({ jobId: jobRef.id, status: "pending" }, { status: 202 })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/ads/sync/route.ts
git commit -m "feat(api): admin manual sync trigger for Google Ads"
```

---

## Task 18: Functions-side mirrors of DAL + sync helpers

**Files:**
- Create: `functions/src/ads/sync-helpers.ts` — copy of `lib/ads/sync-helpers.ts` (Functions tsconfig can't import from Next.js lib/)
- Create: `functions/src/lib/google-ads-accounts.ts` — Functions DAL (mirrors `lib/db/google-ads-accounts.ts` but uses `functions/src/lib/supabase.ts`)
- Create: `functions/src/lib/google-ads-campaigns.ts`
- Create: `functions/src/lib/google-ads-ad-groups.ts`
- Create: `functions/src/lib/google-ads-keywords.ts`
- Create: `functions/src/lib/google-ads-ads.ts`
- Create: `functions/src/lib/google-ads-metrics.ts`
- Create: `functions/src/lib/google-ads-search-terms.ts`

For each Functions DAL file, copy the body from the Next.js side, replacing:
```ts
import { createServiceRoleClient } from "@/lib/supabase"
```
with:
```ts
import { getSupabase } from "./supabase.js"
```
and rename `createServiceRoleClient()` → `getSupabase()`.

The `functions/src/lib/supabase.ts` already exists with `getSupabase()` exported.

- [ ] **Step 1: Mirror each DAL file**

For each of the 7 Next.js DAL files (accounts, campaigns, ad_groups, keywords, ads, metrics, search_terms), copy → adapt → place in `functions/src/lib/`. Imports in the Functions side use `.js` extensions (per existing convention).

- [ ] **Step 2: Mirror sync-helpers**

Copy `lib/ads/sync-helpers.ts` → `functions/src/ads/sync-helpers.ts`. Adjust the type imports — instead of `import type { UpsertCampaignInput } from "@/lib/db/google-ads-campaigns"`, import from the Functions-side mirror: `import type { UpsertCampaignInput } from "../lib/google-ads-campaigns.js"`. Same for the others.

- [ ] **Step 3: Build**

```bash
cd functions && npm run build && cd ..
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add functions/src/lib/google-ads-*.ts functions/src/ads/sync-helpers.ts
git commit -m "feat(functions): mirror google-ads DAL + sync helpers Functions-side"
```

---

## Task 19: Sync orchestrator — `functions/src/sync-google-ads.ts`

**Files:**
- Create: `functions/src/sync-google-ads.ts`
- Test: `functions/src/__tests__/sync-google-ads.test.ts`

The orchestrator handles `ai_jobs` doc-create with `type: "google_ads_sync"`. For each active row in `google_ads_accounts`, it builds a Customer-scoped Google Ads client and walks the resource hierarchy: campaigns → ad_groups → keywords (and negatives) → ads → metrics → search_terms.

> **Design note on the 7-day rewrite window:** Google Ads conversion attribution can lag up to 7 days. We re-fetch the last 7 days of metrics every run to catch late-arriving conversions. UPSERTs on the unique-key composite handle dedup.

- [ ] **Step 1: Write the test**

Create `functions/src/__tests__/sync-google-ads.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  getActiveGoogleAdsAccounts: vi.fn(),
  getCustomerClient: vi.fn(),
  upsertCampaign: vi.fn(),
  upsertAdGroup: vi.fn(),
  upsertKeyword: vi.fn(),
  upsertAd: vi.fn(),
  upsertDailyMetrics: vi.fn(),
  upsertSearchTerms: vi.fn(),
  setGoogleAdsAccountSyncResult: vi.fn(),
  getFirestore: vi.fn(),
}))

vi.mock("./lib/google-ads-accounts.js", () => ({
  getActiveGoogleAdsAccounts: mocks.getActiveGoogleAdsAccounts,
  setGoogleAdsAccountSyncResult: mocks.setGoogleAdsAccountSyncResult,
}))
vi.mock("./lib/google-ads-campaigns.js", () => ({ upsertCampaign: mocks.upsertCampaign }))
vi.mock("./lib/google-ads-ad-groups.js", () => ({ upsertAdGroup: mocks.upsertAdGroup }))
vi.mock("./lib/google-ads-keywords.js", () => ({ upsertKeyword: mocks.upsertKeyword }))
vi.mock("./lib/google-ads-ads.js", () => ({ upsertAd: mocks.upsertAd }))
vi.mock("./lib/google-ads-metrics.js", () => ({ upsertDailyMetrics: mocks.upsertDailyMetrics }))
vi.mock("./lib/google-ads-search-terms.js", () => ({ upsertSearchTerms: mocks.upsertSearchTerms }))
vi.mock("./lib/google-ads-client.js", () => ({ getCustomerClient: mocks.getCustomerClient }))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: mocks.getFirestore,
  FieldValue: { serverTimestamp: () => "TS" },
}))

import { handleGoogleAdsSync } from "../sync-google-ads.js"

beforeEach(() => {
  vi.clearAllMocks()

  const jobUpdate = vi.fn().mockResolvedValue(undefined)
  mocks.getFirestore.mockReturnValue({
    collection: () => ({
      doc: () => ({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ status: "pending", input: { manual: true } }),
        }),
        update: jobUpdate,
      }),
    }),
  })

  // Two accounts, but the 2nd is paused (is_active=false would be filtered upstream;
  // we still want the orchestrator to handle 1 active gracefully).
  mocks.getActiveGoogleAdsAccounts.mockResolvedValue([
    { customer_id: "1234567890", is_active: true },
  ])
  mocks.upsertCampaign.mockResolvedValue({ id: "local-campaign-1", customer_id: "1234567890", campaign_id: "111" })
  mocks.upsertAdGroup.mockResolvedValue({ id: "local-ag-1", campaign_id: "local-campaign-1", ad_group_id: "222" })
  mocks.upsertKeyword.mockResolvedValue({})
  mocks.upsertAd.mockResolvedValue({})
  mocks.upsertDailyMetrics.mockResolvedValue(0)
  mocks.upsertSearchTerms.mockResolvedValue(0)

  // Customer-scoped client returns canned GAQL rows
  const customer = {
    query: vi.fn().mockImplementation(async (gaql: string) => {
      if (gaql.includes("FROM campaign")) {
        return [{
          campaign: { id: 111, name: "Brand Search", advertising_channel_type: "SEARCH", status: "ENABLED", bidding_strategy_type: "MAXIMIZE_CONVERSIONS", start_date: "2026-01-01", end_date: null },
          campaign_budget: { amount_micros: 50_000_000 },
        }]
      }
      if (gaql.includes("FROM ad_group ")) {
        return [{ ad_group: { id: 222, name: "Branded keywords", status: "ENABLED", type: "SEARCH_STANDARD", cpc_bid_micros: 1_500_000 } }]
      }
      if (gaql.includes("ad_group_criterion") && gaql.includes("type = 'KEYWORD'")) {
        return [{ ad_group_criterion: { criterion_id: 333, keyword: { text: "darren paul coaching", match_type: "PHRASE" }, status: "ENABLED", cpc_bid_micros: 1_500_000 } }]
      }
      if (gaql.includes("FROM ad_group_ad")) {
        return [{ ad_group_ad: { ad: { id: 444, type: "RESPONSIVE_SEARCH_AD", responsive_search_ad: { headlines: [{ text: "Coach Darren Paul" }], descriptions: [{ text: "Sport-science coaching" }] }, final_urls: ["https://www.darrenjpaul.com"] }, status: "ENABLED" } }]
      }
      if (gaql.includes("FROM keyword_view") || gaql.includes("metrics.impressions")) {
        return [{ campaign: { id: 111 }, ad_group: { id: 222 }, ad_group_criterion: { criterion_id: 333 }, segments: { date: "2026-05-02" }, metrics: { impressions: 100, clicks: 5, cost_micros: 5_000_000, conversions: 0.5, conversions_value: 99 } }]
      }
      if (gaql.includes("search_term_view")) {
        return [{ search_term_view: { search_term: "darren paul coaching" }, segments: { date: "2026-05-02", keyword: { ad_group_criterion: "333" } }, campaign: { id: 111 }, ad_group: { id: 222 }, metrics: { impressions: 100, clicks: 5, cost_micros: 5_000_000, conversions: 0.5 } }]
      }
      return []
    }),
  }
  mocks.getCustomerClient.mockResolvedValue(customer)
})

describe("handleGoogleAdsSync", () => {
  it("walks the resource hierarchy and upserts at each level", async () => {
    await handleGoogleAdsSync("job-1")
    expect(mocks.upsertCampaign).toHaveBeenCalledTimes(1)
    expect(mocks.upsertAdGroup).toHaveBeenCalledTimes(1)
    expect(mocks.upsertKeyword).toHaveBeenCalledTimes(1)
    expect(mocks.upsertAd).toHaveBeenCalledTimes(1)
    expect(mocks.upsertDailyMetrics).toHaveBeenCalled()
    expect(mocks.upsertSearchTerms).toHaveBeenCalled()
    expect(mocks.setGoogleAdsAccountSyncResult).toHaveBeenCalledWith(
      "1234567890",
      expect.objectContaining({ last_error: null }),
    )
  })

  it("records last_error and continues when a single account fails", async () => {
    mocks.getActiveGoogleAdsAccounts.mockResolvedValueOnce([
      { customer_id: "9999999999", is_active: true },
      { customer_id: "1234567890", is_active: true },
    ])
    mocks.getCustomerClient
      .mockRejectedValueOnce(new Error("permission_denied"))
      .mockResolvedValueOnce({
        query: vi.fn().mockResolvedValue([]),
      })

    await handleGoogleAdsSync("job-2")
    expect(mocks.setGoogleAdsAccountSyncResult).toHaveBeenCalledWith(
      "9999999999",
      expect.objectContaining({ last_error: expect.stringContaining("permission_denied") }),
    )
    expect(mocks.setGoogleAdsAccountSyncResult).toHaveBeenCalledWith(
      "1234567890",
      expect.objectContaining({ last_error: null }),
    )
  })
})
```

- [ ] **Step 2: Implement**

Create `functions/src/sync-google-ads.ts`:

```ts
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { getActiveGoogleAdsAccounts, setGoogleAdsAccountSyncResult } from "./lib/google-ads-accounts.js"
import { upsertCampaign } from "./lib/google-ads-campaigns.js"
import { upsertAdGroup } from "./lib/google-ads-ad-groups.js"
import { upsertKeyword } from "./lib/google-ads-keywords.js"
import { upsertAd } from "./lib/google-ads-ads.js"
import { upsertDailyMetrics } from "./lib/google-ads-metrics.js"
import { upsertSearchTerms } from "./lib/google-ads-search-terms.js"
import { getCustomerClient } from "./lib/google-ads-client.js"
import {
  transformCampaignRow,
  transformAdGroupRow,
  transformKeywordRow,
  transformAdRow,
  transformMetricsRow,
  transformSearchTermRow,
} from "./ads/sync-helpers.js"

const RECENT_DAYS = 7

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function handleGoogleAdsSync(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

  const accounts = await getActiveGoogleAdsAccounts()
  const summary: Array<{ customer_id: string; ok: boolean; error?: string }> = []

  for (const account of accounts) {
    try {
      await syncOneAccount(account.customer_id)
      await setGoogleAdsAccountSyncResult(account.customer_id, { last_error: null })
      summary.push({ customer_id: account.customer_id, ok: true })
    } catch (err) {
      const msg = (err as Error).message ?? "Unknown sync error"
      console.error(`[sync-google-ads] account ${account.customer_id} failed:`, msg)
      await setGoogleAdsAccountSyncResult(account.customer_id, { last_error: msg })
      summary.push({ customer_id: account.customer_id, ok: false, error: msg })
    }
  }

  await jobRef.update({
    status: "completed",
    result: { accounts_synced: summary },
    updatedAt: FieldValue.serverTimestamp(),
  })
}

async function syncOneAccount(customer_id: string): Promise<void> {
  const customer = await getCustomerClient(customer_id)

  const today = new Date()
  const since = new Date(today.getTime() - RECENT_DAYS * 86_400_000)
  const since_ymd = ymd(since)
  const today_ymd = ymd(today)

  // 1) Campaigns
  const campaignRows = await customer.query(`
    SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.status,
           campaign.bidding_strategy_type, campaign.start_date, campaign.end_date,
           campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status != 'REMOVED'
  `)
  const campaignByGoogleId = new Map<string, { id: string }>()
  for (const row of campaignRows) {
    const upserted = await upsertCampaign(transformCampaignRow(row, customer_id))
    campaignByGoogleId.set(upserted.campaign_id, { id: upserted.id })
  }

  // 2) Ad groups (only for synced campaigns)
  const adGroupRows = await customer.query(`
    SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.cpc_bid_micros,
           ad_group.campaign
    FROM ad_group
    WHERE ad_group.status != 'REMOVED'
  `)
  const adGroupByGoogleId = new Map<string, { id: string }>()
  for (const row of adGroupRows) {
    const campaignResource = (row.ad_group as { campaign?: string } | undefined)?.campaign ?? ""
    const googleCampaignId = campaignResource.split("/").pop() ?? ""
    const localCampaign = campaignByGoogleId.get(googleCampaignId)
    if (!localCampaign) continue
    const upserted = await upsertAdGroup(transformAdGroupRow(row, localCampaign.id))
    adGroupByGoogleId.set(upserted.ad_group_id, { id: upserted.id })
  }

  // 3) Keywords
  const keywordRows = await customer.query(`
    SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
           ad_group_criterion.keyword.match_type, ad_group_criterion.status,
           ad_group_criterion.cpc_bid_micros, ad_group_criterion.ad_group
    FROM ad_group_criterion
    WHERE ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.negative = FALSE
      AND ad_group_criterion.status != 'REMOVED'
  `)
  for (const row of keywordRows) {
    const adGroupResource = (row.ad_group_criterion as { ad_group?: string } | undefined)?.ad_group ?? ""
    const googleAdGroupId = adGroupResource.split("/").pop() ?? ""
    const localAdGroup = adGroupByGoogleId.get(googleAdGroupId)
    if (!localAdGroup) continue
    await upsertKeyword(transformKeywordRow(row, localAdGroup.id))
  }

  // 4) Ads
  const adRows = await customer.query(`
    SELECT ad_group_ad.ad.id, ad_group_ad.ad.type,
           ad_group_ad.ad.responsive_search_ad.headlines,
           ad_group_ad.ad.responsive_search_ad.descriptions,
           ad_group_ad.ad.final_urls, ad_group_ad.status, ad_group_ad.ad_group
    FROM ad_group_ad
    WHERE ad_group_ad.status != 'REMOVED'
  `)
  for (const row of adRows) {
    const adGroupResource = (row.ad_group_ad as { ad_group?: string } | undefined)?.ad_group ?? ""
    const googleAdGroupId = adGroupResource.split("/").pop() ?? ""
    const localAdGroup = adGroupByGoogleId.get(googleAdGroupId)
    if (!localAdGroup) continue
    await upsertAd(transformAdRow(row, localAdGroup.id))
  }

  // 5) Daily metrics — last 7 days, aggregated at keyword grain (rolls up to ad_group + campaign)
  const metricsRows = await customer.query(`
    SELECT campaign.id, ad_group.id, ad_group_criterion.criterion_id,
           segments.date,
           metrics.impressions, metrics.clicks, metrics.cost_micros,
           metrics.conversions, metrics.conversions_value
    FROM keyword_view
    WHERE segments.date BETWEEN '${since_ymd}' AND '${today_ymd}'
  `)
  await upsertDailyMetrics(metricsRows.map((r: unknown) => transformMetricsRow(r as Record<string, unknown>, customer_id)))

  // 6) Search terms — last 7 days
  const searchTermRows = await customer.query(`
    SELECT campaign.id, ad_group.id, search_term_view.search_term,
           segments.date, segments.keyword.ad_group_criterion,
           metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM search_term_view
    WHERE segments.date BETWEEN '${since_ymd}' AND '${today_ymd}'
  `)
  await upsertSearchTerms(searchTermRows.map((r: unknown) => transformSearchTermRow(r as Record<string, unknown>, customer_id)))
}
```

> **Note:** the `google-ads-api` package's `customer.query()` returns rows in the shape produced by Google Ads' GAQL. The exact field nesting depends on the package version — Phase 1.1 uses `^17`. If field names differ at integration time, adjust the transforms in `sync-helpers.ts` (where the parsing lives) rather than the orchestrator.

- [ ] **Step 3: Run tests**

```bash
cd functions && npx vitest run src/__tests__/sync-google-ads.test.ts
```
Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add functions/src/sync-google-ads.ts functions/src/__tests__/sync-google-ads.test.ts
git commit -m "feat(functions): Google Ads sync orchestrator (campaigns→metrics→search terms)"
```

---

## Task 20: Functions-side OAuth helpers + register sync function in index.ts

**Files:**
- Create: `functions/src/lib/google-ads-client.ts` — Functions-side mirror of `lib/ads/google-ads-client.ts`
- Modify: `functions/src/index.ts` — register `syncGoogleAds` with secrets and an `onDocumentCreated` trigger; add an `onSchedule` trigger for nightly runs

- [ ] **Step 1: Create `functions/src/lib/google-ads-client.ts`**

Copy `lib/ads/google-ads-client.ts`, replace the import of `getPlatformCredentials` from `@/lib/db/platform-connections` with the Functions-side equivalent (likely a helper in `functions/src/lib/` already, or extract from existing platform-connection helpers). Adjust to read `process.env` for the dev token.

- [ ] **Step 2: Modify `functions/src/index.ts`**

Add the new secret (after the existing ones around line 17–19):

```ts
const googleAdsDeveloperToken = defineSecret("GOOGLE_ADS_DEVELOPER_TOKEN")
const googleAdsClientId = defineSecret("GOOGLE_ADS_CLIENT_ID")
const googleAdsClientSecret = defineSecret("GOOGLE_ADS_CLIENT_SECRET")
const googleAdsLoginCustomerId = defineSecret("GOOGLE_ADS_LOGIN_CUSTOMER_ID")
```

Add the secrets array near the existing `allSecrets`:

```ts
const googleAdsSecrets = [
  supabaseUrl, supabaseServiceRoleKey,
  googleAdsDeveloperToken, googleAdsClientId, googleAdsClientSecret, googleAdsLoginCustomerId,
]
```

Append at the bottom:

```ts
// ─── Google Ads — manual sync trigger via ai_jobs doc ──────────────────────
// Triggered when an ai_jobs doc is created with type "google_ads_sync".

export const googleAdsSyncOnDemand = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: googleAdsSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "google_ads_sync") return
    const { handleGoogleAdsSync } = await import("./sync-google-ads.js")
    await handleGoogleAdsSync(event.params.jobId)
  },
)

// ─── Google Ads — nightly scheduled sync ───────────────────────────────────
// 06:00 UTC = 22:00 PT prior day, after Google's daily report finalization.

export const googleAdsSyncScheduled = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "UTC",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: googleAdsSecrets,
  },
  async () => {
    // Enqueue a job doc the on-demand handler will pick up.
    // We deliberately route through ai_jobs so all syncs share one code path
    // and one audit trail.
    const { getFirestore, FieldValue } = await import("firebase-admin/firestore")
    const db = getFirestore()
    const ref = db.collection("ai_jobs").doc()
    await ref.set({
      type: "google_ads_sync",
      status: "pending",
      input: { manual: false, scheduled: true },
      result: null,
      error: null,
      userId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    console.log(`[googleAdsSyncScheduled] enqueued ${ref.id}`)
  },
)
```

- [ ] **Step 3: Build**

```bash
cd functions && npm run build && cd ..
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add functions/src/lib/google-ads-client.ts functions/src/index.ts
git commit -m "feat(functions): register googleAdsSync (manual + nightly scheduled)"
```

- [ ] **Step 5: Set Firebase secrets (Darren)**

```bash
firebase functions:secrets:set GOOGLE_ADS_DEVELOPER_TOKEN
firebase functions:secrets:set GOOGLE_ADS_CLIENT_ID
firebase functions:secrets:set GOOGLE_ADS_CLIENT_SECRET
firebase functions:secrets:set GOOGLE_ADS_LOGIN_CUSTOMER_ID
```

(Don't run from this task — note in deploy step.)

---

## Task 21: Admin settings page — connect/disconnect

**Files:**
- Create: `app/(admin)/admin/ads/settings/page.tsx`
- Create: `app/(admin)/admin/ads/settings/ConnectGoogleAdsButton.tsx`

- [ ] **Step 1: Implement the toggle component**

Create `app/(admin)/admin/ads/settings/ConnectGoogleAdsButton.tsx`:

```tsx
"use client"

import { useState } from "react"
import { toast } from "sonner"

interface Props {
  isConnected: boolean
}

export function ConnectGoogleAdsButton({ isConnected }: Props) {
  const [pending, setPending] = useState(false)

  async function disconnect() {
    if (pending) return
    if (!confirm("Disconnect Google Ads? Synced data is preserved but no further updates will run.")) return
    setPending(true)
    try {
      const res = await fetch("/api/integrations/google-ads/disconnect", { method: "POST" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success("Disconnected.")
      window.location.reload()
    } catch (err) {
      toast.error(`Disconnect failed: ${(err as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  if (isConnected) {
    return (
      <button
        type="button"
        onClick={disconnect}
        disabled={pending}
        className="inline-flex items-center px-4 py-2 rounded-md border border-error/40 text-error bg-error/5 text-sm font-medium hover:bg-error/10 transition-colors disabled:opacity-50"
      >
        {pending ? "Disconnecting..." : "Disconnect Google Ads"}
      </button>
    )
  }

  return (
    <a
      href="/api/integrations/google-ads/connect"
      className="inline-flex items-center px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
    >
      Connect Google Ads
    </a>
  )
}
```

- [ ] **Step 2: Implement the page**

Create `app/(admin)/admin/ads/settings/page.tsx`:

```tsx
import { createServiceRoleClient } from "@/lib/supabase"
import { listGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"
import { ConnectGoogleAdsButton } from "./ConnectGoogleAdsButton"
import type { GoogleAdsAccount } from "@/types/database"

export const metadata = { title: "Google Ads — Settings" }

interface PageProps {
  searchParams: Promise<{ connected?: string; error?: string }>
}

export default async function GoogleAdsSettingsPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const supabase = createServiceRoleClient()

  const { data: connection } = await supabase
    .from("platform_connections")
    .select("status, account_handle, updated_at")
    .eq("plugin_name", "google_ads")
    .maybeSingle()

  const isConnected = (connection?.status ?? "not_connected") === "connected"
  const accounts: GoogleAdsAccount[] = isConnected ? await listGoogleAdsAccounts() : []

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-heading text-primary">Google Ads — Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your Google Ads account to enable nightly campaign sync, AI recommendations
          (Plan 1.2), and the AI Ads Agent (Plan 1.5g).
        </p>
      </div>

      {sp.error ? (
        <div className="border border-error/40 bg-error/5 text-error rounded-lg p-4 text-sm">
          {sp.error}
        </div>
      ) : null}
      {sp.connected === "1" ? (
        <div className="border border-success/40 bg-success/5 text-success rounded-lg p-4 text-sm">
          Connected. Nightly sync runs at 06:00 UTC; you can also trigger one manually below.
        </div>
      ) : null}

      <div className="border border-border rounded-xl p-6 space-y-4 bg-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-primary">Connection</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isConnected ? "Authorized — refresh token stored." : "Not connected."}
            </p>
          </div>
          <ConnectGoogleAdsButton isConnected={isConnected} />
        </div>
      </div>

      {accounts.length > 0 ? (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <div className="p-4 border-b border-border/60">
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Connected accounts
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">Customer ID</th>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Last synced</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.customer_id} className="border-t border-border/60">
                  <td className="p-3 font-mono text-xs">{a.customer_id}</td>
                  <td className="p-3">{a.descriptive_name ?? "—"}</td>
                  <td className="p-3 font-mono text-xs">
                    {a.last_synced_at ? new Date(a.last_synced_at).toLocaleString() : "Never"}
                  </td>
                  <td className="p-3 text-xs">
                    {a.last_error ? (
                      <span className="text-error">Error: {a.last_error.slice(0, 80)}</span>
                    ) : (
                      <span className="text-success">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/ads/settings/"
git commit -m "feat(admin): Google Ads connect/disconnect settings page"
```

---

## Task 22: Admin campaigns dashboard

**Files:**
- Create: `app/(admin)/admin/ads/campaigns/page.tsx`
- Create: `app/(admin)/admin/ads/campaigns/CampaignsTable.tsx`

This is the headline UI of Phase 1.1: list of campaigns with last-7-day metrics summary, automation_mode selector (Plan 1.2 will activate the selector for real, here it's a read-only badge for now).

- [ ] **Step 1: Implement the table**

Create `app/(admin)/admin/ads/campaigns/CampaignsTable.tsx`:

```tsx
import type { GoogleAdsCampaign } from "@/types/database"

interface CampaignWithMetrics extends GoogleAdsCampaign {
  cost_micros_7d: number
  clicks_7d: number
  conversions_7d: number
  conversion_value_7d: number
}

const CURRENCY_DIVISOR = 1_000_000

function formatMicros(micros: number): string {
  return `$${(micros / CURRENCY_DIVISOR).toFixed(2)}`
}

const AUTOMATION_LABEL: Record<string, { label: string; classes: string }> = {
  auto_pilot: { label: "Auto-pilot", classes: "bg-accent/15 text-accent" },
  co_pilot: { label: "Co-pilot", classes: "bg-primary/10 text-primary" },
  advisory: { label: "Advisory", classes: "bg-muted/40 text-muted-foreground" },
}

const STATUS_LABEL: Record<string, { label: string; classes: string }> = {
  ENABLED: { label: "Enabled", classes: "bg-success/10 text-success" },
  PAUSED: { label: "Paused", classes: "bg-warning/15 text-warning" },
  REMOVED: { label: "Removed", classes: "bg-error/10 text-error" },
}

export function CampaignsTable({ campaigns }: { campaigns: CampaignWithMetrics[] }) {
  if (campaigns.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-lg p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No campaigns synced yet. Connect Google Ads in Settings, then trigger a manual sync.
        </p>
      </div>
    )
  }
  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left p-3">Campaign</th>
            <th className="text-left p-3 w-24">Type</th>
            <th className="text-left p-3 w-24">Status</th>
            <th className="text-right p-3 w-24">Spend (7d)</th>
            <th className="text-right p-3 w-20">Clicks (7d)</th>
            <th className="text-right p-3 w-24">Conv. (7d)</th>
            <th className="text-right p-3 w-28">Conv. value (7d)</th>
            <th className="text-left p-3 w-28">Mode</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => {
            const status = STATUS_LABEL[c.status] ?? STATUS_LABEL.REMOVED
            const mode = AUTOMATION_LABEL[c.automation_mode] ?? AUTOMATION_LABEL.advisory
            return (
              <tr key={c.id} className="border-t border-border/60 align-top">
                <td className="p-3">
                  <p className="font-medium text-primary text-sm">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{c.campaign_id}</p>
                </td>
                <td className="p-3 font-mono text-xs">{c.type}</td>
                <td className="p-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs ${status.classes}`}>{status.label}</span>
                </td>
                <td className="p-3 text-right font-mono text-xs">{formatMicros(c.cost_micros_7d)}</td>
                <td className="p-3 text-right font-mono text-xs">{c.clicks_7d.toLocaleString()}</td>
                <td className="p-3 text-right font-mono text-xs">{c.conversions_7d.toFixed(2)}</td>
                <td className="p-3 text-right font-mono text-xs">${c.conversion_value_7d.toFixed(2)}</td>
                <td className="p-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs ${mode.classes}`}>{mode.label}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Implement the page**

Create `app/(admin)/admin/ads/campaigns/page.tsx`:

```tsx
import Link from "next/link"
import { listGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"
import { listCampaignsForCustomer } from "@/lib/db/google-ads-campaigns"
import { createServiceRoleClient } from "@/lib/supabase"
import { CampaignsTable } from "./CampaignsTable"

export const metadata = { title: "Google Ads — Campaigns" }

export default async function GoogleAdsCampaignsPage() {
  const accounts = await listGoogleAdsAccounts()
  const supabase = createServiceRoleClient()

  // Aggregate last-7-day metrics per campaign
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  const allCampaigns = []
  for (const account of accounts) {
    const campaigns = await listCampaignsForCustomer(account.customer_id)
    for (const c of campaigns) {
      const { data: metricRows } = await supabase
        .from("google_ads_daily_metrics")
        .select("cost_micros, clicks, conversions, conversion_value")
        .eq("campaign_id", c.campaign_id)
        .gte("date", since)
        .is("ad_group_id", null)  // campaign-level summary rows would have ad_group_id null
      const agg = (metricRows ?? []).reduce(
        (acc: { cost: number; clicks: number; conv: number; convVal: number }, r) => ({
          cost: acc.cost + Number(r.cost_micros ?? 0),
          clicks: acc.clicks + Number(r.clicks ?? 0),
          conv: acc.conv + Number(r.conversions ?? 0),
          convVal: acc.convVal + Number(r.conversion_value ?? 0),
        }),
        { cost: 0, clicks: 0, conv: 0, convVal: 0 },
      )
      allCampaigns.push({
        ...c,
        cost_micros_7d: agg.cost,
        clicks_7d: agg.clicks,
        conversions_7d: agg.conv,
        conversion_value_7d: agg.convVal,
      })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading text-primary">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Last 7 days of synced data. Drill into a campaign for keywords, search terms, and ads.
          </p>
        </div>
        <Link
          href="/admin/ads/settings"
          className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors"
        >
          Settings →
        </Link>
      </div>
      <CampaignsTable campaigns={allCampaigns} />
    </div>
  )
}
```

- [ ] **Step 3: Update sidebar to expose Campaigns + Settings**

In `components/admin/AdminSidebar.tsx`, replace the single Ads entry with a multi-item group:

```tsx
    {
      title: "Ads",
      items: [
        { label: "Google Ads", href: "/admin/ads", icon: Target },
        { label: "Campaigns", href: "/admin/ads/campaigns", icon: BarChart3 },
        { label: "Settings", href: "/admin/ads/settings", icon: Settings },
      ],
    },
```

(`BarChart3` is already imported. `Settings` is imported via lucide-react in the existing file.)

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/ads/campaigns/" components/admin/AdminSidebar.tsx
git commit -m "feat(admin): Google Ads campaigns dashboard with last-7-day metrics"
```

---

## Task 23: End-to-end verification

**Files:** none (manual verification)

- [ ] **Step 1: Run all new tests**

```bash
npx vitest run __tests__/lib/ads/ __tests__/api/integrations/
cd functions && npx vitest run src/__tests__/sync-google-ads.test.ts && cd ..
```
Expected: all pass.

- [ ] **Step 2: Smoke test against a Google Ads test account**

(Requires Darren's test-account credentials in Google Cloud Console; engineering can't run this without them. Steps for Darren when ready:)

1. Set env vars in `.env.local`:
   ```
   GOOGLE_ADS_DEVELOPER_TOKEN=<test-account-developer-token-or-blank>
   GOOGLE_ADS_CLIENT_ID=<from-google-cloud-console>
   GOOGLE_ADS_CLIENT_SECRET=<from-google-cloud-console>
   GOOGLE_ADS_LOGIN_CUSTOMER_ID=<test-customer-id>
   GOOGLE_ADS_REDIRECT_URI=http://localhost:3050/api/integrations/google-ads/callback
   ```
2. Apply migrations 00103–00107 to local Supabase.
3. `npm run dev`, log in as admin, visit `/admin/ads/settings`, click "Connect Google Ads".
4. Complete the OAuth flow.
5. Verify a row appears in `google_ads_accounts` with the test Customer ID.
6. From the admin UI (or curl `POST /api/admin/ads/sync`), trigger a manual sync.
7. Watch Firebase Functions logs (`firebase functions:log --only googleAdsSyncOnDemand`).
8. Verify rows appear in `google_ads_campaigns`, `google_ads_ad_groups`, `google_ads_keywords`, `google_ads_ads`, `google_ads_daily_metrics`, `google_ads_search_terms`.
9. Visit `/admin/ads/campaigns` — see the synced campaigns with their 7-day metrics.

- [ ] **Step 3: Production deploy checklist**

(For Darren after Developer Token approval lands:)

1. `firebase functions:secrets:set GOOGLE_ADS_DEVELOPER_TOKEN` (real production token)
2. `firebase functions:secrets:set GOOGLE_ADS_CLIENT_ID` / `_SECRET` / `LOGIN_CUSTOMER_ID`
3. Apply migrations 00103–00107 to production Supabase via Supabase MCP (`mcp__supabase__apply_migration` × 5)
4. Deploy: `firebase deploy --only "functions:default:googleAdsSyncOnDemand,functions:default:googleAdsSyncScheduled"`
5. Vercel deploy the Next.js side
6. From `/admin/ads/settings`, click "Connect Google Ads" with the production account
7. Trigger a manual sync; watch logs

---

## Self-review checklist

- [x] **Spec coverage:** every section of the Phase 1 spec relevant to Plan 1.1 has a task:
  - D1 single-account-now schema → Task 1
  - D2 OAuth tokens in platform_connections → Tasks 5, 13
  - D3 admin-only OAuth → Tasks 12, 13, 14
  - D4 nightly sync → Tasks 19, 20
  - Migrations → Tasks 1–5
  - File structure → Tasks 7–22
  - Sub-phase Plan 1.1 deliverables → all 23 tasks

- [x] **Placeholder scan:** every step has full code; no "TBD" / "implement later" / "add appropriate validation". Two open spots are explicitly flagged for the implementer:
  - Task 13 step 3 — confirm `setPlatformCredentials` signature against the existing helper (read first; adapt if needed).
  - Task 7 step 2 — `listAccessibleCustomers` returns just IDs; descriptive_name etc. is auto-discovered separately. Documented inline.

- [x] **Type consistency:** signatures match across tasks. `UpsertCampaignInput` defined in Task 8 is consumed by `transformCampaignRow` in Task 16. `getCustomerClient(customerId)` defined in Task 15 is called from Task 19's orchestrator. `setGoogleAdsAccountSyncResult` matches between DAL and orchestrator.

- [x] **No undefined symbols:** every import in later tasks is created in an earlier task.

---

## What ships at the end of Plan 1.1

**Working software:**
- Admins can connect Google Ads via OAuth at `/admin/ads/settings`
- Refresh token stored encrypted in `platform_connections.credentials`
- Nightly Firebase Function syncs campaigns, ad groups, keywords, ads, daily metrics, and search terms
- Manual "Sync now" trigger from the admin UI
- Campaigns dashboard at `/admin/ads/campaigns` with last-7-day metrics
- All 5 plan-doc campaign types supported in schema (Search, Video, Performance Max, Display, Demand Gen)

**What's queued behind this plan:**
- **Plan 1.2** — AI recommendations engine (negative keywords, bid adjusts) on top of the now-synced data
- **Plan 1.3** — Apply path (write back to Google Ads) + automation modes (Auto-pilot / Co-pilot / Advisory)
- **Plan 1.4** — AI ad copy generation + weekly performance email report
- **Plans 1.5b–g** — leads-first overlays + AI Ads Agent (separate spec at `2026-05-03-google-ads-leads-first-optimization-design.md`)
