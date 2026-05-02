# Google Ads — Leads-First Optimization & AI Ads Agent — Design Spec

**Date:** 2026-05-03
**Status:** Draft, ready for plan-drafting
**Phase:** 1.5 — layered on top of Phase 1 (`docs/superpowers/specs/2026-05-02-google-ads-integration-design.md`)
**Headline deliverable:** AI Ads Agent (Phase 1.5g) — an autonomous senior-performance-marketer agent that reads the funnel, drafts weekly strategy, queues recommendations, and (per-campaign) auto-applies them.
**Prereqs:** Phase 1 OAuth + sync schema must be live (`google_ads_*` tables populated); Darren's Developer Token + Customer ID in production env.

---

## Problem statement

Phase 1 makes Google Ads visible and lets Claude propose per-campaign tactical recommendations (negative keywords, bids, ad copy). What it does **not** do:

1. **Tell Google what a real coaching client is worth.** Conversions today are whatever Google's pixel sees on the website — no Stripe revenue, no GHL pipeline closure, no booking-to-customer correlation. Bidding learns toward clicks and form-fills, not paying clients.
2. **Use Darren's existing customer list.** Two years of paying athletes, newsletter subscribers, event signups, and bookings are sitting in Supabase. Google Ads has zero visibility into them. No Customer Match audiences, no lookalike seeds, no exclusion of existing customers from prospecting.
3. **Reason at the strategy level.** The Phase 1 recommendation engine looks at one campaign at a time. It cannot say "your $500/mo Search budget is wasting 60% on non-coaching searches; reallocate to PMax" or "you're 38% to your Q3 client target — these are the three highest-leverage moves."
4. **Capture click attribution end-to-end.** No `gclid` is stored on bookings or payments, so even when a paid Stripe charge happens, we can't tell Google which click drove it.

Phase 1.5 closes those four gaps. The deliverable is a **lead-feedback loop** plus an **AI Ads Agent** that operates as a senior performance marketer with full read access to the funnel, write access through the existing recommendations queue, and a North Star defined by Darren's business goals.

---

## Goals

1. **Capture click attribution at the door** — gclid, gbraid, wbraid, fbclid, utm_* persisted per session and joined to bookings/newsletter/payments.
2. **Sync Customer Match audiences daily** — three lists (Customers, Bookers, Subscribers) hashed and uploaded to Google Ads with consent gating.
3. **Upload bookings as the primary conversion** — real-time on `bookings.status='confirmed'`, with gclid + admin-configurable initial value.
4. **Update conversion value when Stripe closes** — offline conversion adjustment using the same booking ID, so Google's bidding model learns true revenue per source.
5. **Import GA4 remarketing audiences** into Google Ads.
6. **Visualize the full funnel** in admin: impressions → clicks → newsletter → booking → payment, per campaign, with cost and revenue attributed at each stage.
7. **Deploy the AI Ads Agent** — three operating modes (weekly strategist, interactive co-pilot chat, per-campaign auto-apply via Phase 1's `automation_mode`), with `business_goals` table as North Star and a self-improving loop that writes learnings back into `prompt_templates.few_shot_examples`.

## Non-goals (deferred)

- **Server-side gtag / GTM Server containers.** Using Google's Offline Conversion API only — more reliable for lead-gen with multi-day sales cycle and avoids cookie-loss issues.
- **Meta/Facebook ads parallel pipeline.** Schema and consent surfaces are designed extensible, but the actual Meta integration is a separate spec.
- **Predictive LTV ML modeling.** Initial conversion values are admin-configurable static defaults; ML refinement deferred to Phase 2.
- **Cross-device deterministic identity stitching beyond gclid + email match.** Customer Match handles email-side; gclid handles click-side; that's the floor.
- **Campaign creation via the agent.** Phase 1.5g's agent can *propose* a new campaign in a strategy memo, but only humans create campaigns through Google's UI in Phase 1.5. Auto-create deferred to Phase 2.
- **Bid strategy switching by the agent.** Agent recommends; human switches in Google Ads UI.

---

## Existing patterns to follow

| Pattern | File / location | What we reuse |
|---|---|---|
| Phase 1 sync, recommendations, apply, automation_mode | `lib/ads/*.ts`, `functions/src/sync-google-ads.ts` | Phase 1.5 layers on top — audiences and conversions are new tables, but recommendations queue is the same |
| Stripe webhook | `app/api/stripe/webhook/route.ts` | Add a hook to enqueue `ads_conversion_value_update` on succeeded payments |
| Booking write path | `lib/db/bookings.ts` + `app/api/bookings/route.ts` | Add a hook to enqueue `ads_conversion_upload` on confirmed bookings |
| Marketing consent surface | `lib/db/consents.ts` (existing — legal documents acceptance) | Extend with `marketing_consent_at` on `users` + dedicated audit table |
| Tool-use chat | `streamWithTools` in `functions/src/ai/anthropic.ts:344` | Reuse for the agent's co-pilot chat mode |
| Scheduled jobs | `functions/src/voice-drift-monitor.ts`, `performance-learning-loop.ts` | Pattern for weekly strategist mode + quarterly retrospective |
| Self-improving loop | `performance-learning-loop.ts` writes to `prompt_templates.few_shot_examples` | Same pattern for the agent's quarterly retro |
| `ai_jobs` doc-trigger pattern | `functions/src/index.ts` | New types: `ads_conversion_upload`, `ads_conversion_value_update`, `ads_audience_sync`, `ads_agent_session`, `ads_agent_strategist` |
| Admin chat surface | `app/(admin)/admin/ai/admin-chat/` (existing) | Pattern for `/admin/ads/agent` |
| Service-role Supabase client | `lib/supabase.ts` | Functions side reads/writes via service role |
| Migration numbering | After Phase 1 spec lands `00095–00100`, next free is `00101` | This spec uses `00101–00108` |

---

## Decisions

### D1. Three Customer Match lists (not one, not five)

Customers, Bookers, Subscribers. Reason: each has distinct optimization use:
- **Customers** is the lookalike seed for Performance Max and the *exclusion* list for prospecting Search.
- **Bookers** is mid-funnel; bid up in Search.
- **Subscribers** is top-of-funnel reach for awareness campaigns.

Below ~1,000 matched users, Customer Match audiences won't activate in Google Ads. Admin UI shows a "below activation threshold" badge per list and surfaces match-rate (Google's reported `matched_user_count / submitted_count`).

### D2. Conversion taxonomy: 3 actions, value-based bidding

| Conversion action | Trigger | Initial value | Final value path |
|---|---|---|---|
| **Lead — Booking** | `bookings.status='confirmed'` | admin-configurable per booking type, default $200 | overwritten by linked payment via offline value-adjustment upload |
| **Sale — Direct Purchase** | `payments.status='succeeded'` AND no linked booking | actual `payment.amount` | static |
| **Lead — Subscriber** | `newsletter_subscribers` insert with `consent_marketing=true` | admin-configurable, default $5 | static (micro-conversion) |

Bidding strategy: **Maximize Conversion Value (tROAS)**. The Phase 1 spec's bid recommendations layer continues to operate within this strategy.

### D3. Booking is the primary conversion, value-adjusted post-pay

The full lifecycle of a single conversion:

1. Visitor lands with gclid → stored in `marketing_attribution` row (cookie + DB).
2. Visitor books → `bookings` row created with `gclid` column populated. Firebase Function uploads to Google Ads Offline Conversion API: `conversion_action=lead_booking, gclid=<x>, conversion_value=<initial_value>, conversion_date=<now>`.
3. Visitor pays → `payments` row created with FK to `booking_id`. Stripe webhook handler enqueues a value-adjustment upload: `ConversionAdjustment(adjustment_type=RESTATEMENT, conversion_action=lead_booking, gclid=<x>, conversion_value=<actual amount>, adjustment_date=<now>)`.
4. Visitor's subscription renews → optional second adjustment uploaded N days later (configurable; default off in Phase 1.5, enable later).

This is the modern Google Ads "smart bidding for lead-gen" pattern: feed the model click → lead → revenue → renewal so it can learn which sources produce real long-term clients.

### D4. Customer Match consent is non-negotiable

Google Ads Customer Match TOS requires the advertiser warrant explicit user consent for the upload of hashed PII for ad personalization. We implement:

- New `users.marketing_consent_at` (timestamptz nullable) and `marketing_consent_source` (text, e.g., `'newsletter_signup'`, `'registration_v2'`, `'account_settings'`)
- New `marketing_consent_log` table (audit trail of every set/unset)
- Customer Match daily sync **excludes** users with NULL `marketing_consent_at`
- Withdrawal → next-day sync removes the user from the Google list (REMOVE operation in `OfflineUserDataJobOperation`)
- Newsletter signup form, registration form, and `/account/preferences` get a checkbox: *"I consent to receiving marketing communications, including the use of my email for personalized advertising on Google."*

### D5. gclid attribution stored at the session layer, joined to identity at action time

A new `marketing_attribution` table captures every landing-with-tracking-params hit:

- Session-level: anonymous user, gclid/gbraid/wbraid/fbclid, utm_*, landing_url, referrer, first_seen_at, last_seen_at
- Identity-level: when the visitor signs up / books / subscribes, their user_id is back-filled (FK from the action row to the most recent un-claimed attribution row in their session cookie)
- All bookings and payments get a `gclid TEXT NULL` column — the value at the moment of action (preserved even if attribution row is later GC'd)

The cookie is `djp_attr` (1-year max-age, `SameSite=Lax`), set on first landing. Server-side stamping in middleware so it works without JS.

### D6. Conversion uploads are async, idempotent, and audited

Every offline conversion upload (initial + adjustment) is enqueued as an `ai_jobs` doc; a Firebase Function consumes it. Reasons:

- **Decouple from user flow.** A booking insert must not block on Google's API. The Function does the upload in the background.
- **Idempotency.** Each `google_ads_conversion_uploads` row has UNIQUE `(conversion_action_id, gclid, conversion_date_time)`. Re-runs on the same row are no-ops.
- **Audit + retry.** Every upload writes a row with the request payload, response, status, and retry_count. Failed uploads can be re-driven from the admin UI.

### D7. Audience sync is daily diff-based, not full-overwrite

Each Customer Match list has a Supabase-side snapshot in `google_ads_audience_members`. The daily Function:

1. Re-computes "should be in list X" from the source query (paying customers, bookers, subscribers).
2. Diffs against the local snapshot.
3. Sends only ADD / REMOVE operations to Google's Offline User Data Job API.
4. Updates the snapshot.

Reason: Google has rate limits on full uploads and doesn't deduplicate well. Diff-based avoids quota and avoids resetting Google's match-rate counter every night.

### D8. The AI Ads Agent operates in three modes, all gated by `automation_mode`

Reuse Phase 1's per-campaign `automation_mode` enum (`auto_pilot | co_pilot | advisory`). The agent's mode-aware behavior:

| Mode (per campaign) | What the agent does |
|---|---|
| Auto-pilot | High-confidence (≥0.8) recommendations of type `add_negative_keyword`, `pause_keyword`, `adjust_bid` (within ±25%) auto-applied through Phase 1's `lib/ads/apply.ts` |
| Co-pilot | All recommendations queued in `google_ads_recommendations` for human approval |
| Advisory | Recommendations written but flagged `advisory_only=true` — surfaced in the strategy memo and dashboard but not in the apply queue |

In addition to per-campaign modes, the agent has portfolio-level proposals (budget shifts, new campaign suggestions) that always require human approval — these go to a separate `ads_strategy_notes` queue, never auto-applied.

### D9. Strategy memos are markdown blobs in `ads_strategy_notes`

Weekly strategist mode produces a memo: `headline`, `summary_md` (full memo), `actions_proposed` (jsonb of recommendation IDs created), `actions_taken` (jsonb of which were approved/applied), `period_start`, `period_end`. Memo is also emailed to `COACH_EMAIL`. Format proven by the existing weekly content report and daily pulse jobs.

### D10. Goals as the agent's North Star

New `business_goals` table — single-row by design (use a `singleton_lock` pattern):

```sql
CREATE TABLE business_goals (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton_lock           boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton_lock),
  target_monthly_clients   integer,
  target_monthly_revenue   numeric(14,2),
  target_cpa               numeric(10,2),
  target_roas              numeric(8,2),
  target_quarter           text,                 -- e.g. 'Q3-2026'
  timezone                 text NOT NULL DEFAULT 'America/Chicago',
  notes                    text,
  updated_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
```

The agent's system prompt anchors on these. Every weekly memo opens with "We are [N]% to [target_quarter]'s [target_monthly_clients] clients/mo target."

### D11. Self-improving loop — quarterly retrospective writes few-shot examples

Once per quarter (last Sunday of Q at 04:00 PT), a separate Function runs an extended agent session:
- Pulls last 90 days of recommendations + their applied / not-applied / outcome
- Identifies recommendations that produced measurable lift vs. those that didn't
- Writes the top 3 wins as `few_shot_examples` rows in `prompt_templates` under category `google_ads_strategist`
- The next strategist session loads them automatically (existing `performance-learning-loop.ts` pattern)

This is how the agent gets better at *Darren's* business specifically over time, not generically.

### D12. Privacy posture is "consent-aware default-off"

- Existing `users` rows have NULL `marketing_consent_at` until they explicitly opt in. They are NOT included in Customer Match.
- Account-settings page surfaces consent state with a one-click toggle.
- The `consents` table (existing) gets a new entry type `'marketing_v1'`; the `marketing_consent_log` is a denormalized convenience table for audit (not the source of truth — `consents` stays canonical).
- Removal-from-Customer-Match propagates within 24 hours (next nightly sync).

### D13. Stripe value updates handled via existing webhook + new job type

The existing `app/api/stripe/webhook/route.ts` handles `payment_intent.succeeded`, `customer.subscription.*`, etc. We add one branch:

- On `payment_intent.succeeded` where `metadata.booking_id` is present → enqueue `ads_conversion_value_update` job with `{booking_id, payment_id, new_value, gclid}`.
- On `payment_intent.succeeded` without booking → enqueue `ads_conversion_upload` of type `purchase`.
- On `customer.subscription.updated` (renewal) → optional second adjustment if config flag enabled.

### D14. GA4 audiences imported via the existing GA4 ↔ Google Ads link

No code work in Phase 1.5e beyond the GA4-side audience definitions. Darren creates the audiences in GA4 (site visitors, blog readers, program-page viewers, abandoned checkout); the existing GA4-Google Ads link imports them automatically. We document this in the Phase 1.5e plan but write zero code.

---

## Schema (migrations starting at `00101_*`)

> Numbered after Phase 1's `00095–00100`. If Phase 1 spec ships first the numbering holds; otherwise renumber in plan-drafting.

### 00101_marketing_attribution.sql

```sql
CREATE TABLE marketing_attribution (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      text NOT NULL,                 -- djp_attr cookie value (server-set)
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  gclid           text,
  gbraid          text,
  wbraid          text,
  fbclid          text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_term        text,
  utm_content     text,
  landing_url     text,
  referrer        text,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  claimed_at      timestamptz,                   -- set when user_id is back-filled
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id)
);
CREATE INDEX idx_marketing_attr_user ON marketing_attribution(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_marketing_attr_gclid ON marketing_attribution(gclid) WHERE gclid IS NOT NULL;
```

Plus: add `gclid TEXT NULL` columns to `bookings`, `newsletter_subscribers`, `payments`, and `event_signups`. Each is populated at action time from the active session's attribution row.

### 00102_marketing_consent.sql

```sql
ALTER TABLE users
  ADD COLUMN marketing_consent_at      timestamptz,
  ADD COLUMN marketing_consent_source  text;

CREATE TABLE marketing_consent_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted     boolean NOT NULL,
  source      text NOT NULL,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_consent_log_user ON marketing_consent_log(user_id);
```

### 00103_google_ads_conversion_actions.sql

```sql
-- Local mirror of Google's conversion-action resources we created
CREATE TABLE google_ads_conversion_actions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  resource_name       text NOT NULL,         -- e.g., 'customers/123/conversionActions/456'
  conversion_id       text NOT NULL,
  lead_type           text NOT NULL CHECK (lead_type IN
                        ('lead_booking', 'sale_purchase', 'lead_subscriber')),
  display_name        text NOT NULL,
  default_value       numeric(10,2) NOT NULL,
  category            text NOT NULL,         -- 'LEAD' or 'PURCHASE'
  count_type          text NOT NULL DEFAULT 'ONE_PER_CLICK'
                      CHECK (count_type IN ('ONE_PER_CLICK', 'MANY_PER_CLICK')),
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, lead_type)
);
CREATE TRIGGER trg_google_ads_conversion_actions_updated_at
  BEFORE UPDATE ON google_ads_conversion_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

### 00104_google_ads_conversion_uploads.sql

```sql
CREATE TABLE google_ads_conversion_uploads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  conversion_action_id  uuid NOT NULL REFERENCES google_ads_conversion_actions(id) ON DELETE CASCADE,
  upload_type           text NOT NULL CHECK (upload_type IN ('upload', 'value_update', 'restatement')),
  source_table          text NOT NULL CHECK (source_table IN ('bookings', 'payments', 'newsletter_subscribers', 'event_signups')),
  source_id             uuid NOT NULL,
  gclid                 text,
  gbraid                text,
  wbraid                text,
  hashed_email          text,                  -- when gclid missing — Enhanced Conversions for Leads
  hashed_phone          text,
  conversion_date_time  timestamptz NOT NULL,
  conversion_value      numeric(12,2) NOT NULL,
  currency_code         text NOT NULL DEFAULT 'USD',
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'success', 'failed', 'rejected', 'skipped')),
  api_request           jsonb,
  api_response          jsonb,
  error_message         text,
  retry_count           smallint NOT NULL DEFAULT 0,
  attempted_at          timestamptz,
  succeeded_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversion_uploads_status ON google_ads_conversion_uploads(status);
CREATE INDEX idx_conversion_uploads_source ON google_ads_conversion_uploads(source_table, source_id);
CREATE UNIQUE INDEX uq_conversion_uploads_dedup ON google_ads_conversion_uploads(conversion_action_id, gclid, conversion_date_time)
  WHERE gclid IS NOT NULL AND upload_type = 'upload';
CREATE TRIGGER trg_conversion_uploads_updated_at
  BEFORE UPDATE ON google_ads_conversion_uploads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

### 00105_google_ads_audiences.sql

```sql
CREATE TABLE google_ads_audiences (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  list_key              text NOT NULL CHECK (list_key IN
                          ('icp_customers', 'engaged_bookers', 'tof_subscribers')),
  resource_name         text,                  -- 'customers/123/userLists/456' once created
  user_list_id          text,
  display_name          text NOT NULL,
  description           text,
  membership_life_span  smallint NOT NULL DEFAULT 540,    -- days; 540 is Google max
  is_active             boolean NOT NULL DEFAULT true,
  member_count          integer,                          -- last-known matched count from Google
  submitted_count       integer,                          -- our last batch size
  match_rate            numeric(5,2),                     -- member_count / submitted_count
  last_sync_at          timestamptz,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, list_key)
);

CREATE TABLE google_ads_audience_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_id     uuid NOT NULL REFERENCES google_ads_audiences(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hashed_email    text NOT NULL,         -- SHA-256, lowercase, trimmed
  hashed_phone    text,
  added_at        timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz,
  UNIQUE(audience_id, user_id)
);
CREATE INDEX idx_audience_members_active ON google_ads_audience_members(audience_id) WHERE removed_at IS NULL;
CREATE TRIGGER trg_google_ads_audiences_updated_at
  BEFORE UPDATE ON google_ads_audiences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

### 00106_business_goals.sql

```sql
CREATE TABLE business_goals (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton_lock           boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton_lock),
  target_monthly_clients   integer,
  target_monthly_revenue   numeric(14,2),
  target_cpa               numeric(10,2),
  target_roas              numeric(8,2),
  target_quarter           text,
  quarter_starts_on        date,
  quarter_ends_on          date,
  timezone                 text NOT NULL DEFAULT 'America/Chicago',
  notes                    text,
  updated_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_business_goals_updated_at
  BEFORE UPDATE ON business_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

### 00107_ads_strategy_notes.sql

```sql
CREATE TABLE ads_strategy_notes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('weekly', 'quarterly_retro', 'ad_hoc')),
  period_start        date,
  period_end          date,
  headline            text NOT NULL,
  summary_md          text NOT NULL,
  actions_proposed    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- recommendation IDs
  actions_taken       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- updated as approvals happen
  goals_snapshot      jsonb,                                -- business_goals row at write time
  metrics_snapshot    jsonb,                                -- key metrics summary
  created_by_agent    boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ads_strategy_notes_customer ON ads_strategy_notes(customer_id, period_start DESC);
CREATE TRIGGER trg_ads_strategy_notes_updated_at
  BEFORE UPDATE ON ads_strategy_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

### 00108_google_ads_recommendations_extension.sql

```sql
-- Extend Phase 1's google_ads_recommendations to support agent-generated portfolio actions
ALTER TABLE google_ads_recommendations
  DROP CONSTRAINT google_ads_recommendations_recommendation_type_check;
ALTER TABLE google_ads_recommendations
  ADD CONSTRAINT google_ads_recommendations_recommendation_type_check
  CHECK (recommendation_type IN (
    'add_negative_keyword', 'adjust_bid', 'pause_keyword',
    'add_keyword', 'add_ad_variant', 'pause_ad',
    -- new in Phase 1.5g:
    'budget_shift', 'pause_campaign', 'duplicate_campaign',
    'launch_new_campaign_proposal', 'audience_signal_change'
  ));

ALTER TABLE google_ads_recommendations
  ADD COLUMN advisory_only boolean NOT NULL DEFAULT false,
  ADD COLUMN strategy_note_id uuid REFERENCES ads_strategy_notes(id) ON DELETE SET NULL,
  ADD COLUMN failure_mode text;       -- agent's explicit "if this doesn't work, here's why"
```

---

## File structure (net-new)

```
app/
  (admin)/admin/ads/
    audiences/page.tsx                    # 1.5b — three-list health dashboard
    conversions/page.tsx                  # 1.5c–d — action setup, value rules, upload log
    attribution/page.tsx                  # 1.5f — funnel visualization
    consent/page.tsx                      # 1.5a — consent log viewer + opt-out actions
    agent/page.tsx                        # 1.5g — co-pilot chat surface
    goals/page.tsx                        # 1.5g — business_goals editor
    strategy-notes/[id]/page.tsx          # 1.5g — view a strategy memo
  api/
    admin/ads/
      audiences/sync/route.ts             # manual sync trigger
      audiences/[listKey]/route.ts        # GET status, POST refresh
      conversions/[id]/retry/route.ts     # admin retry of a failed upload
      goals/route.ts                      # GET / PUT business_goals
      agent/session/route.ts              # POST kicks off ads_agent_session ai_jobs doc
      strategy-notes/route.ts             # GET list
      strategy-notes/[id]/approve/route.ts
      consent/[userId]/route.ts           # admin opt-out on user behalf
    public/attribution/track/route.ts     # GET stamps cookie + writes attribution row

middleware.ts                             # extend to set djp_attr cookie + capture gclid

lib/
  ads/
    attribution.ts                        # gclid capture helpers, cookie management
    audiences.ts                          # SHA-256 hashing, list snapshot diffs
    conversions.ts                        # offline conversion API payload builders
    agent/
      tools.ts                            # tool definitions + handlers
      prompts.ts                          # system prompts for strategist + co-pilot
      goals.ts                            # business_goals helpers
  db/
    marketing-attribution.ts
    marketing-consent.ts
    google-ads-conversion-actions.ts
    google-ads-conversion-uploads.ts
    google-ads-audiences.ts
    google-ads-audience-members.ts
    business-goals.ts
    ads-strategy-notes.ts
  validators/
    ads-leads.ts                          # Zod schemas for new tables + agent tool I/O

functions/src/
  upload-google-ads-conversion.ts         # 1.5c — handler for ads_conversion_upload
  update-google-ads-conversion-value.ts   # 1.5d — handler for ads_conversion_value_update
  sync-google-ads-audiences.ts            # 1.5b — daily 04:00 UTC scheduled
  ads-agent-strategist.ts                 # 1.5g — Monday 06:00 PT scheduled (weekly)
  ads-agent-session.ts                    # 1.5g — handler for ads_agent_session (interactive)
  ads-agent-quarterly-retro.ts            # 1.5g — last Sunday of Q at 04:00 PT
  send-weekly-leads-pipeline-report.ts    # 1.5f — Monday 13:00 UTC (extends Phase 1 weekly Ads report)
  ads/
    agent-tools.ts                        # tool implementations Function-side (subset of lib/ads/agent/tools.ts)
    agent-prompts.ts

components/
  admin/ads/
    AudienceHealthCard.tsx
    ConversionActionsTable.tsx
    ConversionUploadLogTable.tsx
    AttributionFunnel.tsx
    ConsentLogTable.tsx
    AgentChat.tsx                         # 1.5g — streaming chat
    GoalsEditor.tsx                       # 1.5g
    StrategyMemoView.tsx                  # 1.5g
    StrategyNotesList.tsx
  emails/
    WeeklyLeadsPipelineReport.tsx         # extends Phase 1 weekly Ads report
    WeeklyAdsStrategyMemo.tsx             # 1.5g
```

---

## Architecture by pipeline

### Pipeline 1 — Attribution capture (1.5a)

**Purpose:** every visitor's tracking parameters end up on a Supabase row, available for join when they convert.

```
Visitor lands on darrenjpaul.com/<any-page>
       │
       ▼
Next.js middleware (edge)
  • Reads or generates djp_attr cookie (1-year, SameSite=Lax)
  • If query params include any of (gclid, gbraid, wbraid, fbclid, utm_*):
      → POSTs to /api/public/attribution/track with cookie + params
  • Sets cookie if new
       │
       ▼
/api/public/attribution/track
  • UPSERTs into marketing_attribution by session_id
  • Updates last_seen_at on existing rows
  • Returns 204 (no PII, no auth)
       │
       │ later, when visitor signs up / books / pays:
       ▼
Backend mutation handler (e.g., POST /api/bookings)
  • Reads djp_attr cookie
  • Looks up marketing_attribution by session_id
  • Back-fills user_id + sets claimed_at
  • Copies gclid (and gbraid/wbraid/fbclid) onto the new bookings/payments/etc row
```

Edge middleware approach (not client-side gtag) because it works without JavaScript and survives ad-blockers.

### Pipeline 2 — Customer Match audience sync (1.5b)

**Daily 04:00 UTC scheduled Function** `sync-google-ads-audiences.ts`:

```
For each list_key in ('icp_customers', 'engaged_bookers', 'tof_subscribers'):
  1. Resolve "should be in list" set from source query:
     • icp_customers: users ⋈ payments(status='succeeded') ∪ active subscriptions
     • engaged_bookers: users ⋈ bookings(confirmed/completed) MINUS icp_customers
     • tof_subscribers: newsletter_subscribers(consent_marketing=true) MINUS the above
  2. Filter to users with marketing_consent_at IS NOT NULL (D4 gate)
  3. Hash emails (SHA-256, lowercase, trimmed) and phones (E.164 lowercase)
  4. Diff vs google_ads_audience_members snapshot:
     • adds = currently_should_be - currently_in_snapshot
     • removes = currently_in_snapshot - currently_should_be
  5. If list doesn't yet exist on Google Ads side (resource_name NULL):
     → CreateUserList API call, store resource_name + user_list_id
  6. OfflineUserDataJob:
     → CREATE job with operations: ADD adds[], REMOVE removes[]
     → RUN job
     → poll until DONE / FAILED
  7. Update google_ads_audience_members snapshot
  8. Update google_ads_audiences row: last_sync_at, member_count, submitted_count, match_rate
```

Customer Match operations are idempotent on Google's side (matching by hashed email), so partial failures retry safely.

### Pipeline 3 — Conversion upload on booking (1.5c)

**Real-time, async via `ai_jobs`:**

```
POST /api/bookings (existing)
  • INSERT bookings row with gclid copied from marketing_attribution
  • If status='confirmed' (i.e., not 'pending') AND gclid IS NOT NULL:
      → ENQUEUE ai_jobs doc { type: 'ads_conversion_upload', input: {booking_id} }

functions/src/upload-google-ads-conversion.ts
  • Read booking row
  • Read google_ads_conversion_actions where lead_type='lead_booking'
  • INSERT google_ads_conversion_uploads row (status='pending')
  • Build ClickConversion payload (gclid + conversion_value + conversion_date_time)
  • Call UploadClickConversions API
  • UPDATE row with status, api_response
  • If failed and retry_count < 3 → re-enqueue with exponential backoff
```

If gclid is missing but the user has consented marketing email, fall back to **Enhanced Conversions for Leads**: send hashed email + phone instead of gclid, Google attributes via cross-reference.

### Pipeline 4 — Conversion value update on Stripe (1.5d)

```
Stripe webhook → app/api/stripe/webhook/route.ts (existing)
  • On payment_intent.succeeded:
      • If metadata.booking_id is present:
          → ENQUEUE ai_jobs doc { type: 'ads_conversion_value_update',
                                  input: {payment_id, booking_id, new_value} }
      • Else (direct purchase, no booking):
          → ENQUEUE ai_jobs doc { type: 'ads_conversion_upload',
                                  input: {payment_id, lead_type: 'sale_purchase'} }

functions/src/update-google-ads-conversion-value.ts
  • Read booking + payment
  • INSERT google_ads_conversion_uploads row with upload_type='restatement'
  • Build ConversionAdjustment payload:
      adjustment_type = RESTATEMENT
      conversion_action = lead_booking action resource_name
      gclid + conversion_date_time = same as original upload
      restatement_value = actual payment amount
  • Call UploadConversionAdjustments API
  • UPDATE row with status, api_response
```

### Pipeline 5 — GA4 remarketing import (1.5e)

Zero new code. Documentation-only deliverable in the plan: instructs Darren to define audiences in GA4 (e.g., "Site visitors 30d", "Blog readers 30d", "Program page visitors 14d", "Abandoned checkout 14d") and verifies the existing GA4 ↔ Google Ads link imports them.

### Pipeline 6 — Pipeline dashboard + weekly funnel email (1.5f)

`/admin/ads/attribution` renders a Sankey-or-funnel of:

```
Impressions   →   Clicks   →   Newsletter   →   Booking   →   Payment
(GA4)             (GA4)        (Supabase)       (Supabase)    (Supabase)
$cost/imp        $CPC          $CPL             $CPA          $ROAS
```

Per campaign drilldown via `marketing_attribution.utm_campaign` → `bookings.gclid` join.

`send-weekly-leads-pipeline-report.ts` extends Phase 1's weekly Ads report email with a "Funnel" section (top of email) plus campaign-level cost-per-stage and revenue-per-stage tables. Sent Monday 13:00 UTC to `COACH_EMAIL`.

---

## Pipeline 7 — AI Ads Agent (Phase 1.5g — the headline deliverable)

### Three operating modes

#### 7.1 Strategist mode — weekly autonomous

Scheduled Function `ads-agent-strategist.ts`, Monday 06:00 America/Chicago:

```
1. Read business_goals.
2. Read last 28 days of:
   • google_ads_daily_metrics (campaign + ad_group + keyword grain)
   • google_ads_search_terms
   • marketing_attribution
   • bookings + payments (with gclid joined)
   • newsletter_subscribers
   • google_ads_audiences (sizes, match rates)
   • google_ads_recommendations (last 90 days, with apply outcomes)
3. Read prompt_templates few_shot_examples for category 'google_ads_strategist'.
4. Build the agent loop with streamWithTools (existing pattern):
     system: ADS_STRATEGIST_SYSTEM_PROMPT (anchored on the business goals + voice)
     tools: get_campaign_overview, get_keyword_performance, get_search_terms,
            get_ga4_funnel, get_attribution, get_audience_health,
            get_brand_voice, get_competitor_signals, get_recent_history,
            propose_recommendation, propose_budget_shift, propose_new_campaign,
            write_strategy_memo
5. Run the loop with maxToolRounds=20.
6. Persist:
     • write_strategy_memo → ads_strategy_notes row (kind='weekly')
     • propose_* → google_ads_recommendations rows (status='pending', strategy_note_id=<note_id>)
7. Send WeeklyAdsStrategyMemo email via Resend to COACH_EMAIL.
```

The system prompt anchors on:
- Business goals as North Star
- "15-year senior performance marketer specializing in coaching and sport-tech"
- Brand voice from `prompt_templates`
- Hard guardrails (D8): no >25% budget shifts, no pausing >$1k/mo without 14d data, must cite metric basis, must identify failure mode

#### 7.2 Co-pilot mode — interactive chat

Admin opens `/admin/ads/agent`. The page:

```
Loads conversation history from ai_conversations.
On user message:
  POST /api/admin/ads/agent/session
  → enqueues ai_jobs doc { type: 'ads_agent_session', input: {message, conversation_id} }
  → SSE-streams Function output back to the client (existing pattern from admin-chat)

functions/src/ads-agent-session.ts
  • Load conversation history
  • Build agent loop with same tool surface as strategist
  • Stream text + tool_start + tool_result events to ai_jobs.result over time
  • Persist final message to ai_conversations
```

Same plumbing as `admin-chat.ts` — only the system prompt + tool surface are different.

#### 7.3 Auto-apply mode — per-campaign

Phase 1's `lib/ads/apply.ts` and `automation_mode` enum already handle the auto-apply path. Phase 1.5g adds:

- New recommendation types (`budget_shift`, etc. — D14 schema extension)
- Apply implementations for each new type in `lib/ads/apply.ts`
- Strategist mode tags portfolio-level proposals with `advisory_only=true` (always human-approved) and per-campaign tactical proposals with the campaign's mode (auto/co/advisory)

### Tool surface (deep)

```ts
// functions/src/ads/agent-tools.ts

export const ADS_AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_business_goals',
    description: 'Returns Darren\'s current monthly client target, revenue target, target CPA, and target ROAS.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_campaign_overview',
    description: 'Returns all active campaigns with last 28 days of metrics (impressions, clicks, cost, conversions, conversion_value).',
    input_schema: {
      type: 'object',
      properties: { date_range_days: { type: 'integer', default: 28 } }
    }
  },
  {
    name: 'get_keyword_performance',
    description: 'Returns keyword-level metrics for a campaign or ad group over a date range.',
    input_schema: {
      type: 'object',
      properties: {
        scope_type: { type: 'string', enum: ['campaign', 'ad_group'] },
        scope_id: { type: 'string' },
        date_range_days: { type: 'integer', default: 28 },
        order_by: { type: 'string', enum: ['cost_desc', 'conv_desc', 'ctr_desc', 'cpa_asc'] }
      },
      required: ['scope_type', 'scope_id']
    }
  },
  {
    name: 'get_search_terms',
    description: 'Returns search-term report (terms users actually searched). Include only terms with no matching keyword for negative-keyword candidates.',
    input_schema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        date_range_days: { type: 'integer', default: 14 },
        unmatched_only: { type: 'boolean', default: false }
      }
    }
  },
  {
    name: 'get_ga4_funnel',
    description: 'Returns the visitor → newsletter → booking → payment funnel from GA4 + Supabase joined data, broken down by source/medium/campaign.',
    input_schema: {
      type: 'object',
      properties: { date_range_days: { type: 'integer', default: 28 } }
    }
  },
  {
    name: 'get_attribution',
    description: 'Returns bookings and payments joined by gclid, attributing actual revenue to ad clicks. Per campaign or in aggregate.',
    input_schema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        date_range_days: { type: 'integer', default: 60 }
      }
    }
  },
  {
    name: 'get_audience_health',
    description: 'Returns Customer Match list size, match rate, last sync, and below-threshold status for one or all lists.',
    input_schema: {
      type: 'object',
      properties: { list_key: { type: 'string', enum: ['icp_customers', 'engaged_bookers', 'tof_subscribers'] } }
    }
  },
  {
    name: 'get_brand_voice',
    description: 'Returns the voice profile and few-shot examples used for ad copy generation.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_competitor_signals',
    description: 'Returns auction insights from Google Ads + topical trends from Tavily for the coaching/sport-tech vertical.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_recent_history',
    description: 'Returns the last N recommendations and their outcomes (applied / not applied / impact post-apply).',
    input_schema: {
      type: 'object',
      properties: { date_range_days: { type: 'integer', default: 30 } }
    }
  },
  {
    name: 'propose_recommendation',
    description: 'Writes a tactical recommendation to the queue (negative keyword, bid adjust, pause, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        recommendation_type: { type: 'string', enum: [
          'add_negative_keyword', 'adjust_bid', 'pause_keyword',
          'add_keyword', 'add_ad_variant', 'pause_ad'
        ]},
        scope_type: { type: 'string', enum: ['campaign', 'ad_group', 'keyword', 'ad'] },
        scope_id: { type: 'string' },
        payload: { type: 'object' },          // type-specific payload (e.g., {bid_micros: 1500000})
        reasoning: { type: 'string', minLength: 20, maxLength: 500 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        failure_mode: { type: 'string' }      // "if this doesn't work in N days, X"
      },
      required: ['recommendation_type', 'scope_type', 'scope_id', 'payload', 'reasoning', 'confidence', 'failure_mode']
    }
  },
  {
    name: 'propose_budget_shift',
    description: 'Proposes a portfolio-level budget reallocation. Always advisory_only (human approval required).',
    input_schema: {
      type: 'object',
      properties: {
        from_campaign_id: { type: 'string' },
        to_campaign_id: { type: 'string' },
        amount_micros: { type: 'integer' },
        reasoning: { type: 'string' },
        failure_mode: { type: 'string' }
      },
      required: ['from_campaign_id', 'to_campaign_id', 'amount_micros', 'reasoning', 'failure_mode']
    }
  },
  {
    name: 'propose_new_campaign',
    description: 'Proposes launching a new campaign. Always advisory_only — written to ads_strategy_notes for human review, never auto-created.',
    input_schema: {
      type: 'object',
      properties: {
        campaign_type: { type: 'string', enum: ['SEARCH', 'PERFORMANCE_MAX', 'VIDEO', 'DEMAND_GEN', 'DISPLAY'] },
        proposed_name: { type: 'string' },
        proposed_daily_budget_usd: { type: 'number' },
        target_audience_list_keys: { type: 'array', items: { type: 'string' } },  // e.g., ['icp_customers']
        landing_page_url: { type: 'string' },
        starter_keywords: { type: 'array', items: { type: 'string' } },           // Search only
        starter_ad_copy: { type: 'object' },                                       // headlines + descriptions
        reasoning: { type: 'string', minLength: 50, maxLength: 1000 },
        expected_monthly_clients: { type: 'integer' },
        failure_mode: { type: 'string' }
      },
      required: ['campaign_type', 'proposed_name', 'proposed_daily_budget_usd', 'reasoning', 'failure_mode']
    }
  },
  {
    name: 'write_strategy_memo',
    description: 'Writes the weekly strategy memo (markdown). Should open with goal-progress, then top 3 actions in priority order.',
    input_schema: {
      type: 'object',
      properties: {
        headline: { type: 'string' },
        summary_md: { type: 'string' },
        period_start: { type: 'string' },
        period_end: { type: 'string' }
      },
      required: ['headline', 'summary_md', 'period_start', 'period_end']
    }
  }
]
```

### System prompt (excerpt)

```
You are a senior performance marketer with 15 years of experience in the
coaching, sport-tech, and direct-to-consumer health verticals. You are working
inside DJP Athlete, a science-based performance-coaching brand run by Darren
Paul (former pro athlete, current strength & conditioning coach with 20+ years
of work with athletes from youth to professional).

Your job is to help Darren scale his coaching client base. Today's
business goals are:
  Target monthly clients: {{target_monthly_clients}}
  Target monthly revenue: {{target_monthly_revenue}}
  Target CPA: {{target_cpa}}
  Target ROAS: {{target_roas}}
  Target quarter: {{target_quarter}}

You read funnel and campaign data through the supplied tools. You write
recommendations to the queue and a weekly strategy memo through the
supplied tools.

Hard rules (non-negotiable):
- Cite the metric basis for every recommendation. No "I think" — every claim
  references a number you pulled from a tool.
- Never propose a budget change >25% in a single step.
- Never propose pausing a campaign with >$1k/month spend without 14 days of data.
- For every recommendation, identify the failure mode: "If this doesn't move
  CPA in 7 days, the cause is likely [X], and the next move is [Y]."
- Use the brand voice for any ad copy you propose. No generic AI tropes.
- Performance Max recommendations default to advisory only (Google's own AI
  is opaque enough that external recommendations frequently conflict).

Output format for the weekly strategy memo:
  # Headline (one sentence — the most important thing this week)
  ## Where we are
    - Last 7 days vs prior 7 days: spend, conversions, CPA, ROAS
    - Goal progress: "We're at X% of {{target_monthly_clients}}/mo target."
  ## Top 3 moves this week
    1. [Action] — [why, with metrics] — [failure mode]
    2. ...
    3. ...
  ## What's working / what isn't
    - One bullet each.
  ## Notable search terms / audience signals
    - Anything notable from search-term mining or audience health.
```

### Self-improvement loop (1.5g — quarterly retro)

`ads-agent-quarterly-retro.ts` runs last Sunday of each quarter at 04:00 PT:

1. Pulls 90 days of `google_ads_recommendations` joined with their `google_ads_automation_log` outcomes.
2. Calls Claude with a special "retrospective analyst" system prompt.
3. Identifies recommendations that produced measurable post-apply lift (>10% improvement on CPA / CTR / ROAS over the next 14 days).
4. Writes the top 3 wins (with full context: campaign, action, before/after metrics) as `few_shot_examples` rows in `prompt_templates` under category `google_ads_strategist`.
5. The next strategist run loads them via `get_brand_voice` and `get_recent_history` — making the agent specifically better at *Darren's* business over time.

---

## Privacy & consent flow

```
Visitor lands → no consent yet → no Customer Match, no Enhanced Conversions
       │
       ▼
Newsletter signup form
  • Required field: "I consent to..." (D12 wording)
  • If checked: insert users.marketing_consent_at = now(),
                marketing_consent_log row with source='newsletter_signup'
       │
       ▼
Daily Customer Match sync
  • Query: SELECT users WHERE marketing_consent_at IS NOT NULL
  • Hash emails, upload to Google
       │
       ▼
User opt-out (any time)
  • /account/preferences toggle, or Resend unsubscribe link, or admin action
  • UPDATE users SET marketing_consent_at = NULL,
    marketing_consent_log row with granted=false, source='user_opt_out'
       │
       ▼
Next-day sync
  • REMOVE operation in OfflineUserDataJob for this user's hashed email
```

---

## Sub-phase breakdown

### Plan 1.5a — Attribution capture (week 1)
- Migrations 00101, 00102 (marketing_attribution + consent column + log)
- DAL files for both tables
- Middleware extension for cookie + gclid capture
- `/api/public/attribution/track` route
- Booking, newsletter, payment write paths back-fill gclid
- Account-settings consent toggle
- Newsletter signup consent checkbox
- Tests: middleware sets cookie, attribution row inserts, claim-on-action joins gclid

### Plan 1.5b — Customer Match sync (week 2)
- Migration 00105 (audiences + audience_members)
- DAL files
- `lib/ads/audiences.ts` — SHA-256 hashing helpers (lowercase + trim per Google's spec)
- `functions/src/sync-google-ads-audiences.ts` — daily 04:00 UTC
- `/admin/ads/audiences` page with health cards, "below threshold" badge, manual refresh button
- Manual sync API route
- Tests: hash output matches Google's expected format; diff logic produces correct adds/removes

### Plan 1.5c — Booking conversion upload (week 3)
- Migrations 00103, 00104 (conversion_actions + conversion_uploads)
- DAL files
- Conversion action seed migration: create the three actions in Google Ads (lead_booking, sale_purchase, lead_subscriber) and store their resource names
- `lib/ads/conversions.ts` — Offline Conversion API payload builders
- `functions/src/upload-google-ads-conversion.ts` — handler for `ads_conversion_upload`
- `/api/bookings` write path enqueues the job
- `/admin/ads/conversions` page with action setup, upload log, retry button
- Tests: payload builder output matches Google's schema; idempotency dedup works; Enhanced Conversions for Leads fallback when gclid missing

### Plan 1.5d — Stripe value attribution (week 4)
- `functions/src/update-google-ads-conversion-value.ts` — handler for `ads_conversion_value_update`
- Extend Stripe webhook to enqueue value-update jobs on `payment_intent.succeeded` with booking_id metadata
- Direct-purchase path (no booking) enqueues new conversion of type `sale_purchase`
- Subscription renewal optional second adjustment (config flag, default off)
- Admin UI shows linked booking ↔ payment ↔ upload chain in the upload log
- Tests: restatement payload matches Google's adjustment schema; subscription renewal adjustment respects config flag

### Plan 1.5e — GA4 remarketing import (week 4 — half-week, doc-heavy)
- Documentation: how to define each GA4 audience, verify the GA4 ↔ Google Ads link, and verify imports
- Optional admin UI badge: "GA4 audiences detected — N imported"
- No new code required if the GA4 link is already connected; if not, document the link setup (Google Ads admin task, not Darren task)

### Plan 1.5f — Pipeline dashboard + weekly funnel report (week 5)
- `/admin/ads/attribution` page — Sankey/funnel using existing chart library (Recharts)
- DAL aggregation helpers in `lib/ads/`
- `WeeklyLeadsPipelineReport.tsx` React Email template
- `functions/src/send-weekly-leads-pipeline-report.ts` — Monday 13:00 UTC scheduled
- Tests: aggregation queries return correct stage counts and dollars

### Plan 1.5g — AI Ads Agent (weeks 6–7) — **headline deliverable**
- Migrations 00106, 00107, 00108 (business_goals, ads_strategy_notes, recommendations extension)
- DAL files
- `lib/ads/agent/` — tools, prompts, goals helpers
- `functions/src/ads/agent-tools.ts` — Function-side tool implementations
- `functions/src/ads-agent-strategist.ts` — Monday weekly scheduled
- `functions/src/ads-agent-session.ts` — co-pilot interactive
- `functions/src/ads-agent-quarterly-retro.ts` — last Sunday of Q
- `/admin/ads/agent` page — streaming chat surface
- `/admin/ads/goals` page — business_goals editor (admin-only)
- `/admin/ads/strategy-notes/[id]` page — view a memo
- Apply implementations in `lib/ads/apply.ts` for new recommendation types (`budget_shift`, `pause_campaign`, `duplicate_campaign`, etc.)
- `WeeklyAdsStrategyMemo.tsx` React Email template
- Seed `prompt_templates` rows for `google_ads_strategist` voice profile and starter few-shot examples
- Tests: tool I/O Zod-validated round-trip; agent's recommendation outputs schema-conformant; auto-apply respects per-campaign mode + advisory_only flag

---

## Environment variables (new — beyond Phase 1)

```
# Phase 1.5
GOOGLE_ADS_CONVERSION_ACTION_BOOKING=     # 'customers/<cid>/conversionActions/<id>' — set after seed
GOOGLE_ADS_CONVERSION_ACTION_PURCHASE=    # same
GOOGLE_ADS_CONVERSION_ACTION_SUBSCRIBER=  # same
GOOGLE_ADS_USER_LIST_RESOURCE_ICP=        # 'customers/<cid>/userLists/<id>' — set after first sync
GOOGLE_ADS_USER_LIST_RESOURCE_BOOKERS=    # same
GOOGLE_ADS_USER_LIST_RESOURCE_TOF=        # same

# Optional knobs (defaults in code)
GOOGLE_ADS_AGENT_MAX_TOOL_ROUNDS=20
GOOGLE_ADS_AGENT_BUDGET_SHIFT_CAP_PCT=25
GOOGLE_ADS_AGENT_PAUSE_GUARDRAIL_USD_PER_MONTH=1000
GOOGLE_ADS_AGENT_PAUSE_GUARDRAIL_DAYS=14
```

These are stored on Firebase Functions side via `defineSecret`. Resource names are populated lazily — first daily sync creates the lists and stores the names; first conversion action seed migration creates the actions and stores them.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Customer Match list never reaches activation threshold (~1,000 matches) | Admin UI warns. Strategist agent cannot recommend list-targeted campaigns until threshold met. Subscriber-tier list is the most likely to hit threshold first; PMax can use audience signals from below-threshold lists as soft inputs. |
| Stripe value-update arrives before initial booking conversion is uploaded (race) | Offline Conversion Adjustments require the original conversion to exist. Solution: the value-update job checks for the original upload and waits/retries up to 1 hour. If the original upload failed, the value-update inserts the conversion with the actual amount as a fresh upload (no adjustment needed). |
| User opts out after their hash was already matched in Google's system | Daily REMOVE operation propagates within 24 hours per Google's stated SLA. The `marketing_consent_log` provides legal audit trail. |
| Agent makes a wrong call that costs Darren real $ | Three layers: (1) per-campaign `automation_mode` (default Co-pilot — human approval), (2) hard guardrails in system prompt, (3) every action tagged with `failure_mode` so the next session can learn. Auto-apply is restricted to negative-keyword adds + bid changes <±25% with confidence ≥0.8. |
| Agent hallucinates campaign IDs / keyword IDs | Tool outputs reference real synced data; `propose_recommendation` validates `scope_id` against synced `google_ads_*` tables before persisting (existing Phase 1 pattern). |
| GA4 funnel data unavailable / GA4 not linked | Funnel dashboard degrades to "Supabase-only" funnel (newsletter → booking → payment without GA4 layer). Admin sees a "Link GA4 to enable upper-funnel" warning. |
| Privacy regulator (e.g., Texas BITPA, California CCPA) audit | `marketing_consent_log` provides per-event audit trail. `consents` table is canonical. Admin UI's `/admin/ads/consent` exposes the log for SAR (Subject Access Request) compliance. |
| Conversion uploads pile up due to API outage | Upload jobs use exponential backoff with `retry_count` cap of 5. Admin dashboard surfaces the failure log; manual retry per row available. |
| Stripe metadata.booking_id missing on a payment | Webhook handler logs a warning and treats as `sale_purchase` direct-purchase (no value-update path). Phase 1.5d's plan includes a one-off backfill script for any missing metadata. |
| Agent's quarterly retro misclassifies a "win" (selection bias on confounded metrics) | Retro uses post-apply windows of 14 days minimum. `few_shot_examples` are tagged with their source week and are prunable via admin UI. Quarterly retro is gated behind `automation_mode='auto_pilot'` portfolio-level; if all campaigns are co-pilot, retro is skipped. |

---

## Open questions for Darren

1. Confirm initial conversion values: is `lead_booking = $200`, `lead_subscriber = $5` reasonable starting point given his current programs? (Plan 1.5c can adjust before launch.)
2. Approve agent's three guardrail thresholds: 25% budget cap, $1k/mo + 14d pause guardrail, ±25% bid step. (Defaults sane; confirm before week-7 launch.)
3. Confirm `marketing_consent_at` is a valid legal basis for Customer Match in his jurisdiction (US-based, no GDPR gates expected — but explicit confirmation removes any ambiguity).
4. Confirm `business_goals` initial values: target_monthly_clients, target_monthly_revenue, target_CPA, target_ROAS. The agent is only as good as its North Star.

---

## Acceptance criteria (Phase 1.5 done when…)

### Foundation (1.5a–f)
- [ ] gclid captured by middleware on landing, persisted in `marketing_attribution`
- [ ] gclid back-filled onto `bookings`, `payments`, `newsletter_subscribers`, `event_signups`
- [ ] `marketing_consent_at` populated on newsletter signup with checkbox
- [ ] Three Customer Match lists created in Google Ads, daily sync running, snapshot diffs working
- [ ] Three conversion actions exist in Google Ads, mapped in `google_ads_conversion_actions`
- [ ] Booking insert produces a `google_ads_conversion_uploads` row with `status='success'` end-to-end (against test account)
- [ ] Stripe `payment_intent.succeeded` with `metadata.booking_id` produces a value-update upload with `status='success'`
- [ ] GA4 audiences imported into Google Ads (verified in Ads UI)
- [ ] `/admin/ads/attribution` shows full funnel with cost and revenue per stage
- [ ] Weekly leads pipeline email lands in `COACH_EMAIL` Mondays

### AI Ads Agent (1.5g)
- [ ] `business_goals` editable in `/admin/ads/goals`
- [ ] Strategist mode runs Monday 06:00 PT, writes to `ads_strategy_notes`, sends email
- [ ] Co-pilot chat at `/admin/ads/agent` streams responses with tool-use events
- [ ] Recommendations from agent persist with correct `scope_id` (validated against synced data) and `failure_mode` populated
- [ ] Auto-pilot campaigns auto-apply high-confidence negative-keyword adds end-to-end
- [ ] Quarterly retro runs once on schedule and writes ≥1 `few_shot_examples` row
- [ ] Strategy memo email includes goal-progress, top 3 actions, what's working / what isn't, notable signals — in the prescribed format

### Cross-cutting
- [ ] No hardcoded hex; semantic Tailwind tokens
- [ ] All DB writes via `lib/db/*.ts`
- [ ] All Zod validators round-trip clean
- [ ] `.env.example` updated with all new vars
- [ ] All tests pass (existing + new); no regressions in Phase 1 tests
- [ ] Privacy: opt-out propagates to Google Ads within 24 hours

---

## Spec coverage check

| Goal | Where in spec |
|---|---|
| Capture click attribution end-to-end | D5, Pipeline 1, Plan 1.5a |
| Customer Match audiences (3 tiers) | D1, Pipeline 2, Plan 1.5b |
| Booking as primary conversion | D2, D3, Pipeline 3, Plan 1.5c |
| Value adjustment on Stripe | D3, D13, Pipeline 4, Plan 1.5d |
| GA4 remarketing | D14, Pipeline 5, Plan 1.5e |
| Funnel visualization | Pipeline 6, Plan 1.5f |
| AI Ads Agent — strategist | D8, D9, D10, Pipeline 7.1, Plan 1.5g |
| AI Ads Agent — co-pilot chat | Pipeline 7.2, Plan 1.5g |
| AI Ads Agent — auto-apply | D8, Pipeline 7.3, Plan 1.5g |
| Self-improvement loop | D11, Pipeline 7 (retro), Plan 1.5g |
| Privacy & consent | D4, D12, Privacy section |

All design points mapped to a specific decision, pipeline, and plan.
