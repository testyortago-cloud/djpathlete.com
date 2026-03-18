-- Add payment_status to program_assignments so paid programs aren't given away free on assign
alter table public.program_assignments
  add column if not exists payment_status text not null default 'not_required'
  check (payment_status in ('not_required', 'pending', 'paid'));

-- Backfill: existing assignments stay 'not_required' (they were already granted access)
