-- 00174_exercise_favorites.sql
-- Per-client exercise favorites. Clients toggle a heart on exercises; the AI
-- program generator applies a soft scoring boost to favorited exercises.

CREATE TABLE IF NOT EXISTS exercise_favorites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id     UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  source          TEXT NOT NULL DEFAULT 'client' CHECK (source IN ('client','admin')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_user_id, exercise_id)
);

CREATE INDEX IF NOT EXISTS idx_exercise_favorites_client ON exercise_favorites(client_user_id);

ALTER TABLE exercise_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients view own favorites"   ON exercise_favorites FOR SELECT USING (client_user_id = auth.uid());
CREATE POLICY "Clients insert own favorites" ON exercise_favorites FOR INSERT WITH CHECK (client_user_id = auth.uid());
CREATE POLICY "Clients delete own favorites" ON exercise_favorites FOR DELETE USING (client_user_id = auth.uid());
CREATE POLICY "Admins manage all favorites"  ON exercise_favorites FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
);

-- AI scoring-boost kill switch (DB-backed flag, default ON). Flip to 'false' in
-- system_settings to disable favorites' influence on AI generation.
INSERT INTO system_settings (key, value, description)
VALUES ('exercise_favorites_ai_enabled', 'true'::jsonb, 'When true, a client''s favorited exercises apply a soft scoring boost in AI program generation. Kill switch — flip to false to disable.')
ON CONFLICT (key) DO NOTHING;
