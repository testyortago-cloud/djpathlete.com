-- 00194_bookkeeping_payout_reconciliation.sql
-- Track A follow-up: per-payout fee-reconciliation state.
--
-- WHY: the sync route derives gross/fee from
-- `balanceTransactions.list({ payout: <id> })`, and the Stripe API documents that
-- filter as working "for AUTOMATIC Stripe payouts only". A MANUAL payout (the
-- dashboard's "Pay out now", automatic:false) returns ZERO constituent
-- transactions, so the mirror stores gross_cents = 0 / fee_cents = 0 for a payout
-- that really did carry processing fees. Before this migration that mismatch
-- reached only cron_runs.detail.warnings, while the report layer inferred
-- "no payouts ingested" from "fee sum === 0" — which prints a FALSE
-- "$0.00 — no payouts ingested for this period" into the accountant workbook.
--
-- fees_reconciled pins the identity gross − fee = payout net per row, so the
-- report layer can distinguish "no payout data" from "payout data we could not
-- fully explain". reconcile_delta_cents keeps the signed miss for triage.
-- Additive, idempotent, inert without code.
alter table bookkeeping_payouts
  add column if not exists fees_reconciled boolean not null default false,
  add column if not exists reconcile_delta_cents integer not null default 0;

comment on column bookkeeping_payouts.fees_reconciled is
  'True when the ingested lines fully explain the payout: gross_cents - fee_cents = amount_cents. False for manual payouts (Stripe returns no constituent balance transactions for them) and for any other unexplained miss.';
comment on column bookkeeping_payouts.reconcile_delta_cents is
  'Signed (gross_cents - fee_cents) - amount_cents. 0 when reconciled; negative when ingested lines under-explain the payout.';

-- Backfill from what is already stored (deterministic; safe to re-run).
update bookkeeping_payouts
   set fees_reconciled = (gross_cents - fee_cents = amount_cents),
       reconcile_delta_cents = (gross_cents - fee_cents) - amount_cents;

-- The report layer now joins lines -> payouts (book scoping + reconciliation
-- state); without this the join scans the growing lines table by payout_id.
create index if not exists idx_bk_payout_lines_payout_id on bookkeeping_payout_lines (payout_id);
