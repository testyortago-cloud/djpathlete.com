-- Allow status='lead' on users (contact-form submissions land here),
-- and make password_hash nullable so leads (no auth account yet) can exist.

alter table public.users
  drop constraint if exists users_status_check;

alter table public.users
  add constraint users_status_check
  check (status in ('active', 'inactive', 'suspended', 'lead'));

alter table public.users
  alter column password_hash drop not null;
