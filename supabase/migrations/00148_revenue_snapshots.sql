-- 00148_revenue_snapshots.sql
-- Phase 2 of broader-automations plan. One row per ISO week (Monday-anchored).
-- Written by the weekly revenue-digest cron; read by /admin/insights/revenue
-- and the Monday morning email.

CREATE TABLE IF NOT EXISTS revenue_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of DATE NOT NULL UNIQUE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  mrr_cents BIGINT NOT NULL DEFAULT 0,
  mrr_delta_cents BIGINT NOT NULL DEFAULT 0,        -- vs prior week
  new_customers INTEGER NOT NULL DEFAULT 0,
  churned_customers INTEGER NOT NULL DEFAULT 0,
  failed_payments_7d INTEGER NOT NULL DEFAULT 0,
  failed_payment_value_cents BIGINT NOT NULL DEFAULT 0,
  upcoming_renewals_14d INTEGER NOT NULL DEFAULT 0,
  upcoming_renewals_value_cents BIGINT NOT NULL DEFAULT 0,

  top_at_risk_subscriptions JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- [{subscription_id, customer_email, mrr_cents, renewal_at, reason}]
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rs_generated ON revenue_snapshots (generated_at DESC);

INSERT INTO system_settings (key, value, description) VALUES
  (
    'cron_revenue_digest_enabled',
    'false'::jsonb,
    'When true, the weekly revenueDigestCron (Mon 13:00 UTC) builds revenue_snapshots row + emails to COACH_EMAIL. Defaults to false — flip on from /admin/automation once verified.'
  )
ON CONFLICT (key) DO NOTHING;

ALTER TABLE revenue_snapshots ENABLE ROW LEVEL SECURITY;
