-- supabase/migrations/00092_system_settings.sql
-- Phase 6 — Admin Operations.
--
-- Generic key/value table for ops-level flags that need to be toggleable
-- without a redeploy. First user: `automation_paused` — global kill switch for
-- every Phase 5 scheduled function.

CREATE TABLE system_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE system_settings IS
  'Ops-level flags toggleable without redeploy. Written by the admin, read by scheduled Firebase functions + Next.js server code.';

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all system_settings"
  ON public.system_settings FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

INSERT INTO system_settings (key, value, description) VALUES
  (
    'automation_paused',
    'false'::jsonb,
    'When true, all Phase 5 scheduled functions (analytics sync, weekly report, daily pulse, voice drift monitor, performance learning loop) skip their runs. Flip back to false to resume.'
  );
