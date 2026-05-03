-- 1. Extend the users.role check constraint to include 'editor'
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'client', 'editor'));

-- 2. Create team_invites table
CREATE TABLE public.team_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('editor')),
  token       text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_invites_token ON public.team_invites(token);
CREATE INDEX idx_team_invites_email ON public.team_invites(email);
CREATE INDEX idx_team_invites_status_created
  ON public.team_invites(used_at, expires_at, created_at DESC);

-- 3. RLS — service-role bypasses; admin policy for completeness
ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all team_invites"
  ON public.team_invites FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.users u
            WHERE u.id = auth.uid() AND u.role = 'admin')
  );
