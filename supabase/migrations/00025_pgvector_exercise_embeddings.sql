-- Enable pgvector extension for embedding search
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column (1536 dims = OpenAI text-embedding-3-small)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW index for fast approximate nearest-neighbor search
CREATE INDEX idx_exercises_embedding
  ON exercises USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
