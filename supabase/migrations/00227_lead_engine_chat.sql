-- supabase/migrations/00227_lead_engine_chat.sql
-- Lead Engine Stage 3: the public chat assistant.
-- Spec: docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md §3

CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES public.businesses(id) ON DELETE CASCADE,
  -- Set only once a visitor completes the consent card. ON DELETE SET NULL so
  -- erasing a contact does not erase the operational record that a
  -- conversation happened.
  contact_id    uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  -- sha256(ip + CHAT_IP_SALT). The raw origin is never stored: this column
  -- exists only to count requests per origin, and a hash counts just as well.
  ip_hash       text NOT NULL,
  user_agent    text,
  landing_path  text,
  attribution_session_id text,
  message_count int NOT NULL DEFAULT 0,
  tokens_used   int NOT NULL DEFAULT 0,
  escalated_at  timestamptz,
  captured_at   timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                    REFERENCES public.businesses(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user','assistant')),
  content         text NOT NULL,
  -- The typed facts the validator checked this reply against. Kept per message
  -- deliberately: "the model said $120 and nothing in the fact set contained
  -- 120" is only checkable afterwards if the fact set was kept.
  fact_set        jsonb NOT NULL DEFAULT '{}'::jsonb,
  cards           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 'short_circuit' means the model was never called - an injury or medical
  -- question answered by a fixed refusal before any generation happened.
  verdict         text CHECK (verdict IN ('ok','blocked','short_circuit')),
  violations      jsonb NOT NULL DEFAULT '[]'::jsonb,
  tokens_input    int,
  tokens_output   int,
  model           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON public.chat_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_ip
  ON public.chat_conversations (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_activity
  ON public.chat_conversations (last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_escalated
  ON public.chat_conversations (escalated_at DESC) WHERE escalated_at IS NOT NULL;

-- ── Row level security ──────────────────────────────────────────────────────
--
-- WITHOUT THIS, BOTH TABLES ARE WORLD-READABLE AND WORLD-WRITABLE. Supabase
-- grants `anon` full DML on a public-schema table whose RLS is off, and
-- NEXT_PUBLIC_SUPABASE_ANON_KEY ships inside the browser bundle. Measured on
-- the dev clone before this block existed: the anon key returned every row of
-- both tables, while `contacts`, `contact_consents` and `faqs` — which do
-- enable RLS — returned nothing.
--
-- These two tables hold the most personal text this subsystem touches: whatever
-- a stranger typed into a public box, including the injury and medical
-- questions the risk classifier persists verbatim before it declines to answer
-- them. They also hold the counters the rate limits read (`message_count`,
-- `tokens_used`) and the `escalated_at` / `captured_at` flags that cap
-- escalation emails and lead capture — so an open UPDATE is not only a
-- disclosure, it resets every cap the design relies on.
--
-- It would also have reopened the history-laundering hole §7.1a closes: an
-- anon INSERT of a row with role='assistant' and verdict='ok' is replayed to
-- the model as something it said, because only 'blocked' rows are rewritten.
--
-- Service role only, matching 00212 / 00213 / 00214 / 00215. Nothing in the
-- app reads these tables with the anon key — every access goes through
-- lib/db/chat.ts, which uses createServiceRoleClient() — so this costs nothing.
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on chat_conversations"
  ON public.chat_conversations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on chat_messages"
  ON public.chat_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
