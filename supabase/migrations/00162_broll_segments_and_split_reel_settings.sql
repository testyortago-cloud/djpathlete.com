-- ── Split Reel: b-roll segments + settings ───────────────────────────────────
-- One row per selected b-roll moment for a video. The broll_generation job writes
-- these; the fal webhook fills media_asset_id + flips status to 'ready'; the
-- split_reel_render worker reads the 'ready' rows to compose the reel.

create table if not exists broll_segments (
  id                 uuid primary key default gen_random_uuid(),
  video_upload_id    uuid not null references video_uploads(id) on delete cascade,
  generation_job_id  text not null,                 -- the broll_generation ai_jobs doc id
  segment_index      int  not null,
  start_ms           int  not null,
  end_ms             int  not null,
  concept            text not null default '',
  prompt             text not null,
  media_asset_id     uuid references media_assets(id) on delete set null,
  fal_request_id     text,
  cache_key          text not null,
  status             text not null default 'pending'
                     check (status in ('pending','generating','ready','failed','dropped')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists broll_segments_video_idx
  on broll_segments (video_upload_id, segment_index);
create index if not exists broll_segments_cache_key_idx on broll_segments (cache_key);
create index if not exists broll_segments_job_idx on broll_segments (generation_job_id);

alter table broll_segments enable row level security;
create policy "Admins manage broll_segments" on broll_segments
  for all to authenticated
  using (exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin'))
  with check (exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin'));

comment on table broll_segments is 'Selected b-roll moments per video for Split Reel; one fal text-to-video clip each.';

-- ── Settings (jsonb values, idempotent) ──────────────────────────────────────
insert into system_settings (key, value, description) values
  ('feature_split_reel_enabled', 'false'::jsonb, 'Master flag for the Split Reel (dynamic b-roll) feature'),
  ('split_reel_broll_model', '"fal-ai/ltx-video"'::jsonb, 'fal.ai text-to-video endpoint id for b-roll clips'),
  ('split_reel_broll_window_seconds', '5'::jsonb, 'Length (s) of each b-roll window'),
  ('split_reel_max_broll_windows', '6'::jsonb, 'Hard cap on b-roll windows per reel'),
  ('split_reel_min_gap_seconds', '4'::jsonb, 'Minimum gap (s) between b-roll windows')
on conflict (key) do nothing;
