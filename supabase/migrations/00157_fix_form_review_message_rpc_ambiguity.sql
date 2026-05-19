-- Fix column-ambiguity bug in create_form_review_message_with_attachment.
-- The RETURNS TABLE includes `created_at`, so the bare `RETURNING id, created_at`
-- inside the function body was ambiguous between the OUT column and the
-- form_review_messages.created_at column. Postgres raises 42702 and the
-- voice-message send fails with a generic 500 in the API. Qualify the
-- column references to disambiguate.

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
  RETURNING form_review_messages.id, form_review_messages.created_at
  INTO v_message_id, v_created_at;

  INSERT INTO form_review_message_attachments
    (message_id, kind, storage_path, mime_type, duration_seconds, byte_size)
  VALUES
    (v_message_id, p_kind, p_storage_path, p_mime_type, p_duration_seconds, p_byte_size)
  RETURNING form_review_message_attachments.id INTO v_attachment_id;

  RETURN QUERY SELECT v_message_id, v_attachment_id, v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION create_form_review_message_with_attachment FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_form_review_message_with_attachment TO service_role;
