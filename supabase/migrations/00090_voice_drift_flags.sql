-- supabase/migrations/00090_voice_drift_flags.sql
-- Phase 5e — Voice Drift Monitor.
--
-- Weekly scan (Monday 04:00 Central) compares recent AI-generated content
-- against prompt_templates voice_profile and writes one row per flagged item.

CREATE TABLE voice_drift_flags (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type      text NOT NULL CHECK (entity_type IN ('social_post', 'blog_post', 'newsletter')),
  entity_id        uuid NOT NULL,
  drift_score      smallint NOT NULL CHECK (drift_score BETWEEN 0 AND 100),
  severity         text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  issues           jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_preview  text NOT NULL,
  scanned_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_voice_drift_scanned_desc
  ON voice_drift_flags (scanned_at DESC);

CREATE INDEX idx_voice_drift_entity
  ON voice_drift_flags (entity_type, entity_id);

COMMENT ON TABLE voice_drift_flags IS
  'One row per piece of AI-generated content flagged by the weekly voice-drift scanner. Written by the voiceDriftMonitor Firebase Function. Read-only from the admin UI.';

ALTER TABLE voice_drift_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all voice_drift_flags"
  ON public.voice_drift_flags FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
