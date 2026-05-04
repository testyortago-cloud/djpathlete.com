-- Phase 1.5b — Customer Match audience sync
--
-- google_ads_user_lists: admin-configured map from a local audience definition
-- ('bookers', 'subscribers', 'icp') to a Google Ads UserList resource ID.
-- google_ads_user_list_members: a local mirror of which email hashes we
-- believe are currently in each UserList. Lets the sync engine compute
-- precise add/remove deltas instead of re-uploading the full list every
-- night.

CREATE TABLE google_ads_user_lists (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  user_list_id    text NOT NULL,                  -- Google Ads UserList resource numeric ID
  name            text NOT NULL,
  audience_type   text NOT NULL CHECK (audience_type IN ('bookers', 'subscribers', 'icp')),
  is_active       boolean NOT NULL DEFAULT true,
  last_synced_at  timestamptz,
  last_error      text,
  member_count    integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, audience_type)
);

CREATE TRIGGER trg_google_ads_user_lists_updated_at
  BEFORE UPDATE ON google_ads_user_lists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE google_ads_user_list_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_list_id      uuid NOT NULL REFERENCES google_ads_user_lists(id) ON DELETE CASCADE,
  email_hash        text NOT NULL,                -- SHA-256 hex of normalized email (the value uploaded to Google Ads)
  email_normalized  text NOT NULL,                -- Normalized form (lowercase+trim) for local diffing — never uploaded
  added_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_list_id, email_hash)
);

CREATE INDEX idx_google_ads_user_list_members_list ON google_ads_user_list_members(user_list_id);

ALTER TABLE google_ads_user_lists         ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_user_list_members  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on google_ads_user_lists"
  ON google_ads_user_lists FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admins read all google_ads_user_lists"
  ON google_ads_user_lists FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role full access on google_ads_user_list_members"
  ON google_ads_user_list_members FOR ALL TO service_role USING (true) WITH CHECK (true);
-- No admin SELECT policy on members — the email hashes are operational data.
-- RLS is enabled so authenticated users can't read it; service role still works.
