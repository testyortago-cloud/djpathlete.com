-- Admin permissions & team invites.
-- Adds the `staff` role, a per-user permission map, permission payloads on
-- invites, and assignment-based client scoping.
--
-- Purely additive: new nullable/defaulted columns, one new table, and two
-- widened CHECK constraints. No existing row changes meaning.

-- ---------------------------------------------------------------------------
-- 1. users: new `staff` role + permission map
-- ---------------------------------------------------------------------------
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'client', 'editor', 'staff'));

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS staff_role  text;

COMMENT ON COLUMN public.users.permissions IS
  'Resolved permission map for role=staff. Keys/values validated against lib/permissions/registry.ts. Ignored for other roles.';
COMMENT ON COLUMN public.users.staff_role IS
  'Preset the member was created from (coach/marketing/bookkeeper/front_desk/custom). Display only — permissions is the source of truth.';

-- ---------------------------------------------------------------------------
-- 2. team_invites: carry the permission payload through the claim
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_invites DROP CONSTRAINT IF EXISTS team_invites_role_check;
ALTER TABLE public.team_invites
  ADD CONSTRAINT team_invites_role_check CHECK (role IN ('editor', 'staff'));

ALTER TABLE public.team_invites
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS staff_role  text;

-- ---------------------------------------------------------------------------
-- 3. team_member_clients: which clients a staff member can see
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_member_clients (
  staff_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assigned_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_user_id, client_id)
);

-- Reverse lookup: "who can see this client?"
CREATE INDEX IF NOT EXISTS idx_team_member_clients_client
  ON public.team_member_clients(client_id);

ALTER TABLE public.team_member_clients ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; this policy exists so a future anon/authenticated
-- path can't read the mapping. Admins manage, staff read their own rows.
CREATE POLICY "Admins manage team_member_clients"
  ON public.team_member_clients FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.users u
            WHERE u.id = auth.uid() AND u.role = 'admin')
  );

CREATE POLICY "Staff read own client assignments"
  ON public.team_member_clients FOR SELECT
  USING (staff_user_id = auth.uid());
