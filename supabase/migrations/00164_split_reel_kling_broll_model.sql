-- 00164_split_reel_kling_broll_model.sql
-- Upgrade the default Split Reel b-roll model from LTX to Kling 2.5 Turbo Pro:
-- top-tier motion fluidity, cinematic look, no audio (b-roll is muted). The
-- submit path (functions/src/lib/fal-broll.ts + lib/split-reel/fal-submit.ts)
-- now sends `duration` as a string enum ("5"/"10"), which Kling requires.
update system_settings
set value = '"fal-ai/kling-video/v2.5-turbo/pro/text-to-video"'::jsonb
where key = 'split_reel_broll_model';
