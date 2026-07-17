-- 00185_bookkeeping_documents.sql
-- Phase 2: stored bank/Venmo statements (private-bucket path + retention + parse metadata).
create table bookkeeping_documents (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references bookkeeping_books(id) on delete cascade,
  kind text not null default 'statement' check (kind in ('statement','receipt')),
  original_filename text,
  storage_path text not null,
  mime_type text,
  file_size_bytes integer,
  sha256 text,
  retain_until date not null,
  uploaded_by uuid,
  import_batch_id uuid,
  row_count integer,
  posted_count integer,
  period_start date,
  period_end date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookkeeping_documents_book_created_idx on bookkeeping_documents (book_id, created_at desc);
create index bookkeeping_documents_sha_idx on bookkeeping_documents (book_id, sha256);
alter table bookkeeping_documents enable row level security;
create policy bookkeeping_documents_service_all on bookkeeping_documents for all using (true) with check (true);
