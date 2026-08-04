-- Client Messaging: 1:1 coach <-> client conversations
-- ============================================================================
-- One conversation per client (client_user_id is UNIQUE). The admin side is a
-- SHARED inbox: any admin sees every conversation and read state is per-SIDE,
-- not per-admin. Solo operator today; a second coach would share the inbox the
-- way a support inbox is shared.
--
-- RLS grants SELECT ONLY. Every write goes through a Next.js route on the
-- service-role client, which bypasses RLS -- so a browser holding a valid
-- realtime token can read its own rows and write nothing.

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  last_message_sender_role TEXT CHECK (last_message_sender_role IN ('admin','client')),
  client_last_read_at TIMESTAMPTZ,
  admin_last_read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message
  ON conversations(last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('admin','client')),
  body TEXT,
  attachment_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_notified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
-- Drives the notifier cron's only query.
CREATE INDEX IF NOT EXISTS idx_messages_pending_email
  ON messages(created_at) WHERE email_notified_at IS NULL;

CREATE TABLE IF NOT EXISTS message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INT NOT NULL,
  width INT,
  height INT,
  duration_seconds NUMERIC,
  original_filename TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);

CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- PLAIN unique constraint: PostgREST onConflict only accepts plain uniques,
  -- not partial or NULLS-NOT-DISTINCT ones.
  CONSTRAINT message_reactions_unique UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);

-- ============================================================================
-- Helper: is the current JWT an admin?
-- ============================================================================
-- form_reviews inlines this EXISTS clause into every policy. There are eight
-- policies here; one definition that cannot be edited inconsistently is worth
-- the function.
CREATE OR REPLACE FUNCTION public.is_messaging_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin');
$$;

-- ============================================================================
-- RPC: message + attachments + denormalized conversation fields, atomically
-- ============================================================================
-- conversations.last_message_* exists because ordering and previewing the
-- conversation list otherwise needs a lateral join PostgREST cannot express.
-- Writing it in the SAME transaction as the message is what keeps the list from
-- disagreeing with the thread.
CREATE OR REPLACE FUNCTION public.create_message(
  p_conversation_id UUID,
  p_sender_user_id UUID,
  p_sender_role TEXT,
  p_body TEXT,
  p_preview TEXT,
  p_attachments JSONB
) RETURNS TABLE (message_id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_id UUID;
  v_created_at TIMESTAMPTZ;
  v_count INT;
BEGIN
  v_count := COALESCE(jsonb_array_length(p_attachments), 0);

  INSERT INTO messages (conversation_id, sender_user_id, sender_role, body, attachment_count)
  VALUES (p_conversation_id, p_sender_user_id, p_sender_role, p_body, v_count)
  RETURNING messages.id, messages.created_at INTO v_message_id, v_created_at;

  IF v_count > 0 THEN
    INSERT INTO message_attachments
      (message_id, kind, storage_path, mime_type, byte_size, width, height, duration_seconds, original_filename)
    SELECT
      v_message_id,
      a->>'kind',
      a->>'storage_path',
      a->>'mime_type',
      (a->>'byte_size')::INT,
      NULLIF(a->>'width','')::INT,
      NULLIF(a->>'height','')::INT,
      NULLIF(a->>'duration_seconds','')::NUMERIC,
      a->>'original_filename'
    FROM jsonb_array_elements(p_attachments) AS a;
  END IF;

  UPDATE conversations
     SET last_message_at = v_created_at,
         last_message_preview = p_preview,
         last_message_sender_role = p_sender_role
   WHERE id = p_conversation_id;

  RETURN QUERY SELECT v_message_id, v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_message FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_message TO service_role;

-- ============================================================================
-- RLS -- SELECT ONLY
-- ============================================================================
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own or admin conversations" ON conversations;
CREATE POLICY "own or admin conversations" ON conversations FOR SELECT TO authenticated
  USING (client_user_id = auth.uid() OR public.is_messaging_admin());

DROP POLICY IF EXISTS "own or admin messages" ON messages;
CREATE POLICY "own or admin messages" ON messages FOR SELECT TO authenticated
  USING (
    public.is_messaging_admin() OR EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id AND c.client_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "own or admin attachments" ON message_attachments;
CREATE POLICY "own or admin attachments" ON message_attachments FOR SELECT TO authenticated
  USING (
    public.is_messaging_admin() OR EXISTS (
      SELECT 1 FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = message_attachments.message_id AND c.client_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "own or admin reactions" ON message_reactions;
CREATE POLICY "own or admin reactions" ON message_reactions FOR SELECT TO authenticated
  USING (
    public.is_messaging_admin() OR EXISTS (
      SELECT 1 FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = message_reactions.message_id AND c.client_user_id = auth.uid()
    )
  );

-- ============================================================================
-- Realtime
-- ============================================================================
-- message_reactions deliberately keeps its DEFAULT replica identity (PK only).
-- postgres_changes does NOT apply RLS to DELETE events, so REPLICA IDENTITY FULL
-- would broadcast the user_id + emoji of every un-react to every subscriber.
-- With the default, a delete carries only the row id -- all the client needs to
-- remove it from the DOM, and meaningless to anyone else.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Private channel `conversation:<uuid>` carries typing + presence, which are
-- ephemeral and never touch a table.
--
-- The regex guard runs BEFORE the ::uuid cast so a malformed topic is rejected
-- rather than raising a cast error inside the policy.
--
-- NOTE (ops, not code): private channels are only ENFORCED once "Allow public
-- access" is turned off in the project's Realtime settings.
DROP POLICY IF EXISTS "participants read conversation channel" ON realtime.messages;
CREATE POLICY "participants read conversation channel"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.topic() ~ '^conversation:[0-9a-fA-F-]{36}$'
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = split_part(realtime.topic(), ':', 2)::uuid
        AND (c.client_user_id = auth.uid() OR public.is_messaging_admin())
    )
  );

DROP POLICY IF EXISTS "participants write conversation channel" ON realtime.messages;
CREATE POLICY "participants write conversation channel"
  ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (
    realtime.topic() ~ '^conversation:[0-9a-fA-F-]{36}$'
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = split_part(realtime.topic(), ':', 2)::uuid
        AND (c.client_user_id = auth.uid() OR public.is_messaging_admin())
    )
  );

-- ============================================================================
-- Feature flag for the notifier cron (default OFF -- it emails clients)
-- ============================================================================
INSERT INTO system_settings (key, value)
VALUES ('cron_messaging_email_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
