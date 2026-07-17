-- 00184: fix the ledger dedupe constraint. APPLIED live 2026-07-17 via mcp
-- (verified: two manual NULL-source_ref rows now coexist).
-- 00183 used UNIQUE NULLS NOT DISTINCT, which makes every NULL source_ref
-- collide — so only ONE manual entry (source_ref = NULL) could exist per
-- (book, 'manual'), breaking manual entry entirely. Standard UNIQUE treats
-- NULLs as distinct: unlimited manual entries allowed, while non-null platform
-- refs still dedupe (a re-run of the platform import never double-posts).
ALTER TABLE bookkeeping_ledger_entries
  DROP CONSTRAINT IF EXISTS bookkeeping_ledger_entries_book_id_source_source_ref_key;

ALTER TABLE bookkeeping_ledger_entries
  ADD CONSTRAINT bookkeeping_ledger_entries_book_id_source_source_ref_key
  UNIQUE (book_id, source, source_ref);
