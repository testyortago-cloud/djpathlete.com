-- Allow nullable user_id / program_id on payments and subscriptions
-- to support "external" Stripe checkouts (Payment Links, dashboard
-- subscriptions, anything created outside the app's own checkout flows
-- where metadata.userId / metadata.programId aren't set).
--
-- Existing rows are unaffected. Only future inserts may have NULL.
-- FK ON DELETE CASCADE behavior remains intact for non-null rows.

alter table payments alter column user_id drop not null;
alter table subscriptions alter column user_id drop not null;
alter table subscriptions alter column program_id drop not null;
