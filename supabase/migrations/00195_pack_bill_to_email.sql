-- A session pack's Stripe link is addressed to the trainee by default. When a
-- parent/spouse with no account in the system pays, the coach can pin a
-- different address: Stripe locks a supplied customer_email, so without this
-- the payer cannot correct it and the receipt lands in the wrong inbox.
--
-- Both columns are nullable and unused until a coach types an address, so this
-- migration is inert on arrival.
alter table client_packages
  add column if not exists bill_to_email text,
  add column if not exists bill_to_emailed_at timestamptz;

comment on column client_packages.bill_to_email is
  'Overrides the Stripe checkout addressee for this pack. NULL = household payer, else the trainee.';
comment on column client_packages.bill_to_emailed_at is
  'When the payment link was last emailed to bill_to_email.';
