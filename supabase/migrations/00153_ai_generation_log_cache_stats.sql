-- 00153_ai_generation_log_cache_stats.sql
-- Track Anthropic prompt-cache usage per generation run.
-- cache_creation_tokens: tokens written to cache (1.25× normal input cost)
-- cache_read_tokens:     tokens read from cache (0.1× normal input cost)
-- Both are NULL for runs before this column existed.

ALTER TABLE ai_generation_log
  ADD COLUMN IF NOT EXISTS cache_creation_tokens integer,
  ADD COLUMN IF NOT EXISTS cache_read_tokens     integer;

COMMENT ON COLUMN ai_generation_log.cache_creation_tokens IS
  'Anthropic prompt-cache write tokens accumulated across all agents in this generation. NULL for legacy rows.';
COMMENT ON COLUMN ai_generation_log.cache_read_tokens IS
  'Anthropic prompt-cache read tokens accumulated across all agents in this generation. NULL for legacy rows.';
