-- Replace the unused composite index with predicates that match the real query patterns:
-- 1. Listing in admin UI: ORDER BY created_at DESC over all rows.
-- 2. Preventing duplicate pending invites to the same email at the DB layer.

DROP INDEX IF EXISTS public.idx_team_invites_status_created;

-- Plain DESC index for the admin listing (matches DAL listInvites() ORDER BY).
CREATE INDEX idx_team_invites_created_at_desc
  ON public.team_invites (created_at DESC);

-- Partial unique index: at most one pending (unused) invite per normalized email.
-- The DAL already lower()s + trim()s before insert; this is the belt-and-suspenders guard.
CREATE UNIQUE INDEX idx_team_invites_unique_pending_email
  ON public.team_invites (lower(email))
  WHERE used_at IS NULL;
