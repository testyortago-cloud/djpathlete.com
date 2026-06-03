-- ── Split Reel Phase 3: gate the auto-render ─────────────────────────────────
-- Phase 2 auto-chained broll_generation → split_reel_render. Phase 3 inserts an
-- operator review/approve step, so the chain is gated by this flag (default OFF).
-- Flip true to restore Phase 2's straight-through behavior for testing.
insert into system_settings (key, value, description) values
  ('split_reel_auto_render', 'false'::jsonb,
   'When true, broll_generation auto-chains to split_reel_render (Phase 2 behavior). Phase 3 leaves this OFF so the operator approves the render.')
on conflict (key) do nothing;
