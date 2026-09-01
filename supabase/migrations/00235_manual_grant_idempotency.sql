-- 00235_manual_grant_idempotency.sql
--
-- A grant made by hand from a won pipeline card has no Stripe session, and
-- 00208 keyed this ledger on one. Without a key of its own, a double-click, a
-- card dragged out of Won and back, or two admins on the same card mints a
-- second account and a second "set your password" email to somebody who has
-- already set one — the exact failure 00208 exists to prevent, reached by the
-- one door it did not cover.
--
-- WHY NOT REUSE stripe_session_id WITH A SYNTHETIC VALUE. It was considered:
-- writing 'opp:<uuid>' would need no migration at all. Rejected — a column
-- named stripe_session_id holding things that are not Stripe session ids is a
-- lie the schema tells every future reader, and the first person to join this
-- table to Stripe's own data finds out the hard way. The key is a different
-- key; it gets a different column.
--
-- THE TWO KEYS ARE MUTUALLY EXCLUSIVE. A row is either a checkout grant or a
-- manual one, never both and never neither, and the CHECK says so rather than
-- leaving it to whichever code path writes next.

alter table public.funnel_checkout_grants
  alter column stripe_session_id drop not null;

alter table public.funnel_checkout_grants
  add column if not exists opportunity_id uuid
    references public.opportunities(id) on delete set null;

-- Same guard as stripe_session_id's UNIQUE, and for the same reason: two
-- concurrent grants on one card both pass the read, and the loser's insert is
-- refused by the database rather than by application timing. Partial, because
-- every checkout row leaves this column null and null is not a duplicate.
create unique index if not exists funnel_checkout_grants_opportunity_id_key
  on public.funnel_checkout_grants (opportunity_id)
  where opportunity_id is not null;

-- num_nonnulls rather than a pair of OR'd null tests: it says "exactly one"
-- once, instead of saying it twice in a form that can drift apart.
alter table public.funnel_checkout_grants
  drop constraint if exists funnel_checkout_grants_one_key;
alter table public.funnel_checkout_grants
  add constraint funnel_checkout_grants_one_key
  check (num_nonnulls(stripe_session_id, opportunity_id) = 1);

comment on column public.funnel_checkout_grants.opportunity_id is
  'Idempotency key for a grant made by hand from a won pipeline card. Mutually exclusive with stripe_session_id.';
