-- Calendly per coach, phase 1: an invite can name a business.
--
-- WHY team_invites AND NOT A NEW business_invites TABLE. team_invites already
-- has 24-byte base64url tokens, a 7-day TTL, revoke (expire in place, keeping
-- the row for audit), token rotation on resend, used_at, a status helper and an
-- accept route. A parallel table would duplicate every one of those and give
-- the operator two invite lists to reconcile.
--
-- BOTH COLUMNS NULLABLE, and that is not laziness: every existing row has
-- neither, and an invite with no business is still a perfectly valid
-- platform-staff invite. The accept path inserts a business_members row only
-- when business_id is present, so null means exactly what it looks like.
--
-- The CHECK mirrors business_members.role (00240). It is a separate constraint
-- rather than a foreign key onto some roles table because there is no such
-- table -- the same shape 00240 chose.

alter table public.team_invites
  add column if not exists business_id   uuid references public.businesses(id) on delete cascade,
  add column if not exists business_role text check (business_role in ('owner','coach','staff'));

create index if not exists team_invites_business_id on public.team_invites (business_id);
