-- supabase/migrations/00077_content_calendar.sql
CREATE TABLE content_calendar (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type        text NOT NULL CHECK (entry_type IN (
                      'social_post', 'blog_post', 'newsletter', 'topic_suggestion'
                    )),
  reference_id      uuid,
  title             text NOT NULL,
  scheduled_for     date NOT NULL,
  scheduled_time    time,
  status            text NOT NULL DEFAULT 'planned' CHECK (status IN (
                      'planned', 'in_progress', 'published', 'cancelled'
                    )),
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_calendar_date ON content_calendar(scheduled_for);
CREATE INDEX idx_content_calendar_status ON content_calendar(status);
CREATE INDEX idx_content_calendar_entry_type ON content_calendar(entry_type);
CREATE INDEX idx_content_calendar_reference ON content_calendar(reference_id) WHERE reference_id IS NOT NULL;

CREATE TRIGGER trg_content_calendar_updated_at
  BEFORE UPDATE ON content_calendar
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE content_calendar ENABLE ROW LEVEL SECURITY;

create policy "Admins manage all content_calendar"
  on public.content_calendar for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
