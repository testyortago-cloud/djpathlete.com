-- Athlete test report cover photo.
--
-- The public test report at /athlete/<token> leads with a full-bleed image. The
-- client's `users.avatar_url` is a small headshot used across the whole app, so
-- reusing it would mean changing their avatar everywhere to change the report
-- cover. This column holds a dedicated, coach-uploaded action shot.
--
-- Nullable and additive: the report falls back to the avatar, then to a branded
-- gradient, so nothing breaks before any photo is uploaded.

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS report_photo_url TEXT;

COMMENT ON COLUMN client_profiles.report_photo_url IS
  'Coach-uploaded cover photo for the public athlete test report. Falls back to users.avatar_url when null.';
