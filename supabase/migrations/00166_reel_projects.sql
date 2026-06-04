-- ── Reel Editor: per-video editable "reel project" snapshot ───────────────────
-- One row per (video_upload_id, mode). `props` is the MEDIA-AGNOSTIC effective
-- snapshot that BOTH the in-app reel editor (live @remotion/player preview) and
-- the render worker consume: captions (pages), accentHex, face trajectory,
-- b-roll window timing/enable, hook, music, trim. It stores NO signed URLs —
-- each consumer resolves media itself (browser = v4 signed URLs; worker =
-- loopback). `edited_fields` lists the prop keys the operator explicitly locked;
-- the worker re-derives every OTHER field from live truth on each render and
-- writes the resolved snapshot back, so un-edited fields can never go stale when
-- the operator regenerates b-roll or edits the hook through the existing panel.

create table if not exists reel_projects (
  id               uuid primary key default gen_random_uuid(),
  video_upload_id  uuid not null references video_uploads(id) on delete cascade,
  mode             text not null
                   check (mode in ('split_reel','captioned_cut')),
  props            jsonb  not null default '{}'::jsonb,
  edited_fields    text[] not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists reel_projects_video_mode_idx
  on reel_projects (video_upload_id, mode);

alter table reel_projects enable row level security;
create policy "Admins manage reel_projects" on reel_projects
  for all to authenticated
  using (exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin'))
  with check (exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin'));

comment on table reel_projects is 'Per-video editable reel snapshot (pages/accent/trajectory/b-roll/hook/music/trim) for the in-app reel editor; consumed by the render worker, which re-derives any field not listed in edited_fields.';

-- ── Settings (jsonb values, idempotent) ──────────────────────────────────────
insert into system_settings (key, value, description) values
  ('feature_reel_editor_enabled', 'false'::jsonb, 'Master flag for the in-app reel editor (live Player preview + caption/accent/music/hook/b-roll edits). Defaults OFF.')
on conflict (key) do nothing;
