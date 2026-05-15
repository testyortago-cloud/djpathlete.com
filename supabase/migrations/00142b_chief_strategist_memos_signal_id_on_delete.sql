-- 00142b_chief_strategist_memos_signal_id_on_delete.sql
-- Follow-up to 00142: align signal_id FK with sibling pattern
-- (strategy_briefs.signal_id) and audit-trail-outlives-upstream design intent.
-- No data in chief_strategist_memos yet, so this is a safe ALTER.

ALTER TABLE chief_strategist_memos
  DROP CONSTRAINT chief_strategist_memos_signal_id_fkey,
  ADD CONSTRAINT chief_strategist_memos_signal_id_fkey
    FOREIGN KEY (signal_id)
    REFERENCES cross_channel_signals(id)
    ON DELETE SET NULL;
