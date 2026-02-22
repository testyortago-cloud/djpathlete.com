-- Enable pgvector extension for embedding search
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column (384 dims = all-MiniLM-L6-v2 via @huggingface/transformers)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS embedding vector(384);

-- HNSW index for fast approximate nearest-neighbor search
CREATE INDEX idx_exercises_embedding
  ON exercises USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- Similarity search function for exercise retrieval
CREATE OR REPLACE FUNCTION match_exercises(
  query_embedding vector(384),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    exercises.id,
    1 - (exercises.embedding <=> query_embedding) AS similarity
  FROM exercises
  WHERE exercises.embedding IS NOT NULL
    AND exercises.is_active = true
    AND 1 - (exercises.embedding <=> query_embedding) > match_threshold
  ORDER BY exercises.embedding <=> query_embedding
  LIMIT match_count;
$$;
