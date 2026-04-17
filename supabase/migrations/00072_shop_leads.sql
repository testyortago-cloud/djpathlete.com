-- supabase/migrations/00072_shop_leads.sql
CREATE TABLE shop_leads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL REFERENCES shop_products(id),
  email               text NOT NULL,
  resend_contact_id   text,
  resend_sync_status  text NOT NULL DEFAULT 'pending',
  resend_sync_error   text,
  ip_address          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, email)
);

CREATE INDEX idx_shop_leads_product ON shop_leads(product_id);
CREATE INDEX idx_shop_leads_created ON shop_leads(created_at DESC);

ALTER TABLE shop_leads ENABLE ROW LEVEL SECURITY;
