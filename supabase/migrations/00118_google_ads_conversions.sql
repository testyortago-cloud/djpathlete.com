-- Phase 1.5c + 1.5d — Offline conversion uploads + value adjustments
--
-- Two tables:
--   google_ads_conversion_actions — admin-configured map from local trigger
--     ('booking_created' / 'payment_succeeded') to a Google Ads
--     ConversionAction resource ID, with the default value to fire.
--   google_ads_conversion_uploads — durable queue of click-conversion
--     uploads and value adjustments. Survives across the Developer Token
--     cutover: rows enqueued today sit in 'pending' until the worker can
--     drain them once GOOGLE_ADS_DEVELOPER_TOKEN is set.

CREATE TABLE google_ads_conversion_actions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  conversion_action_id  text NOT NULL,            -- Google Ads numeric ID (resource: customers/X/conversionActions/Y)
  name                  text NOT NULL,            -- Display name (e.g. "Booking Created")
  trigger_type          text NOT NULL CHECK (trigger_type IN (
                          'booking_created', 'payment_succeeded'
                        )),
  default_value_micros  bigint NOT NULL DEFAULT 0,  -- e.g. 50_000_000 = $50 placeholder for a discovery call lead
  default_currency      text NOT NULL DEFAULT 'USD',
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, trigger_type)
);

CREATE TRIGGER trg_google_ads_conversion_actions_updated_at
  BEFORE UPDATE ON google_ads_conversion_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE google_ads_conversion_uploads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  conversion_action_id  text NOT NULL,            -- Denormalized from conversion_actions for the upload payload

  upload_type           text NOT NULL CHECK (upload_type IN ('click', 'adjustment')),
  source_table          text NOT NULL CHECK (source_table IN ('bookings', 'payments', 'event_signups')),
  source_id             uuid NOT NULL,            -- bookings.id / payments.id / event_signups.id

  -- Click-conversion identifiers (one of gclid / gbraid / wbraid is required for upload_type='click')
  gclid                 text,
  gbraid                text,
  wbraid                text,

  conversion_time       timestamptz NOT NULL,     -- When the conversion happened (booking_date or charge timestamp)
  value_micros          bigint NOT NULL DEFAULT 0,
  currency              text NOT NULL DEFAULT 'USD',

  -- For upload_type='adjustment'
  adjustment_type       text CHECK (adjustment_type IS NULL OR adjustment_type IN ('RESTATE', 'RETRACT')),
  related_upload_id     uuid REFERENCES google_ads_conversion_uploads(id) ON DELETE SET NULL,

  -- State machine
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending', 'uploaded', 'failed', 'skipped'
                        )),
  attempts              int NOT NULL DEFAULT 0,
  last_attempt_at       timestamptz,
  uploaded_at           timestamptz,

  -- Audit
  api_request           jsonb,
  api_response          jsonb,
  error_message         text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Idempotency key — prevents double-enqueuing the same conversion intent.
-- Postgres rejects COALESCE in inline UNIQUE constraints, so this lives as a
-- separate UNIQUE INDEX that collapses NULL adjustment_type to 'NONE'.
CREATE UNIQUE INDEX idx_google_ads_conv_uploads_unique
  ON google_ads_conversion_uploads(
    source_table, source_id, upload_type, COALESCE(adjustment_type, 'NONE')
  );

CREATE INDEX idx_google_ads_conv_uploads_status   ON google_ads_conversion_uploads(status, customer_id);
CREATE INDEX idx_google_ads_conv_uploads_pending  ON google_ads_conversion_uploads(created_at) WHERE status = 'pending';
CREATE INDEX idx_google_ads_conv_uploads_source   ON google_ads_conversion_uploads(source_table, source_id);

CREATE TRIGGER trg_google_ads_conv_uploads_updated_at
  BEFORE UPDATE ON google_ads_conversion_uploads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE google_ads_conversion_actions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_conversion_uploads  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on google_ads_conversion_actions"
  ON google_ads_conversion_actions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admins read all google_ads_conversion_actions"
  ON google_ads_conversion_actions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role full access on google_ads_conversion_uploads"
  ON google_ads_conversion_uploads FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admins read all google_ads_conversion_uploads"
  ON google_ads_conversion_uploads FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
