-- Form review message attachments: audio (and future media) attached to thread messages
-- ====================================================================================

-- Allow a message row to have null text when it carries only attachments
ALTER TABLE form_review_messages
  ALTER COLUMN message DROP NOT NULL;

CREATE TABLE IF NOT EXISTS form_review_message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES form_review_messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('audio')),
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  duration_seconds INT,
  byte_size INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_form_review_attachments_message
  ON form_review_message_attachments(message_id);

-- =====================================================================
-- RLS
-- =====================================================================

ALTER TABLE form_review_message_attachments ENABLE ROW LEVEL SECURITY;

-- Clients can SELECT attachments on messages on their own reviews
CREATE POLICY "Clients can view attachments on own review messages"
  ON form_review_message_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM form_review_messages m
      JOIN form_reviews r ON r.id = m.form_review_id
      WHERE m.id = form_review_message_attachments.message_id
        AND r.client_user_id = auth.uid()
    )
  );

-- Clients can INSERT attachments only on their own message rows on their own reviews
CREATE POLICY "Clients can create attachments on own messages"
  ON form_review_message_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM form_review_messages m
      JOIN form_reviews r ON r.id = m.form_review_id
      WHERE m.id = form_review_message_attachments.message_id
        AND m.user_id = auth.uid()
        AND r.client_user_id = auth.uid()
    )
  );

-- Admins can SELECT and INSERT on all
CREATE POLICY "Admins can view all attachments"
  ON form_review_message_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can create attachments"
  ON form_review_message_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- =====================================================================
-- RPC: atomic insert of message + attachment
-- =====================================================================

CREATE OR REPLACE FUNCTION create_form_review_message_with_attachment(
  p_review_id UUID,
  p_user_id UUID,
  p_kind TEXT,
  p_storage_path TEXT,
  p_mime_type TEXT,
  p_duration_seconds INT,
  p_byte_size INT
) RETURNS TABLE (
  message_id UUID,
  attachment_id UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_id UUID;
  v_attachment_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
  INSERT INTO form_review_messages (form_review_id, user_id, message)
  VALUES (p_review_id, p_user_id, NULL)
  RETURNING id, created_at INTO v_message_id, v_created_at;

  INSERT INTO form_review_message_attachments
    (message_id, kind, storage_path, mime_type, duration_seconds, byte_size)
  VALUES
    (v_message_id, p_kind, p_storage_path, p_mime_type, p_duration_seconds, p_byte_size)
  RETURNING id INTO v_attachment_id;

  RETURN QUERY SELECT v_message_id, v_attachment_id, v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION create_form_review_message_with_attachment FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_form_review_message_with_attachment TO service_role;
