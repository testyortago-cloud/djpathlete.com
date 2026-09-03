-- Phase 1: membership becomes UNIVERSAL, so its ABSENCE can mean "no access".
--
-- WHY THIS EXISTS. resolveAdminTenant's compatibility branch keys on "zero
-- business_members rows" and falls back to the singleton. That branch cannot
-- tell "predates multi-tenancy" from "membership just revoked", so OFFBOARDING
-- a coach -- deleting their row -- would PROMOTE them to the singleton, the
-- operator's own tenant with every contact, pipeline card and booking in it.
-- Giving every existing teammate a real row lets the branch be deleted, after
-- which absence means exactly one thing: no access.
--
-- IT ALSO REVIVES A DEAD NOTIFICATION. lib/bookings/ingest.ts:501-514 fans the
-- "New Call Booked" email out to this business's members. Nothing has ever
-- written business_members, so that read returns [] and the notification has
-- reached NOBODY since phase 0 merged -- including for the GHL calendar, which
-- is the one actually taking bookings today. These rows are its first writer.
--
-- SAFE AGAINST THE OLD BUILD. This only INSERTS rows into a table whose only
-- deployed readers are that fan-out (which currently finds nothing and will now
-- find the right people) and the new resolver. It adds no column and no
-- constraint, so the previous build cannot violate anything.
--
-- 'owner' for admins, 'staff' for everyone else: business_members.role is
-- (owner|coach|staff) per 00240, and it is NOT users.role -- an `editor` is a
-- platform teammate whose business membership is 'staff'.

insert into public.business_members (business_id, user_id, role)
select '00000000-0000-0000-0000-000000000001',
       u.id,
       case when u.role = 'admin' then 'owner' else 'staff' end
  from public.users u
 where u.role in ('admin', 'staff', 'editor')
on conflict (business_id, user_id) do nothing;
