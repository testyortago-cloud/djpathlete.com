# Instagram video publishing and video carousel slides — design

Date: 2026-09-30. Owner approved the design in chat ("Approved, go"; two-step publish chosen over an in-run wait).

## Why

1. **Instagram video never waits for processing.** Meta processes a video container asynchronously and
   refuses `media_publish` until the container's `status_code` is `FINISHED`; it recommends checking about
   once a minute for up to five minutes
   ([content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/),
   [IG Container](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-container/)).
   Today the Reel path (`lib/social/plugins/instagram.ts`, single-media branch) publishes straight after
   creating the container, and the Story and carousel paths poll for about 7.5s in total. Photos finish in
   that window; videos do not. No Instagram video is known to have published from this app. The manual
   Video post fixed earlier today (main@896f4b5c) makes Instagram video posts easy to create, so this bites now.
2. **Owner asked for videos inside carousels.** Only Instagram's API accepts video carousel items. Facebook
   builds multi-photo posts from `attached_media` photo ids and LinkedIn's `multiImage` holds images only;
   TikTok carousels are not supported by the app.

## What changes

### A. Two-step Instagram publishing (Reels, video Stories, carousels)

- **Column** `social_posts.platform_publish_state jsonb NULL` (migration `00284`). Reader: the publish runner
  (`lib/social/publish-runner.ts`). Writer: the same runner, from the plugin's answer. Null for every post
  that is not mid-publish. No `business_id` question: it is a column on an existing tenant-scoped row.
- **Plugin contract.** `PublishResult` gains a third outcome: `{ success: true, pending: PendingPublish }`
  where `PendingPublish` is plugin-owned JSON (for Instagram: the container ids still processing, what to do
  once they finish, and when the wait started). `PublishInput` gains `resumeState?: PendingPublish` so the
  runner can hand the saved state back on the next tick. Other plugins never return `pending` and ignore
  `resumeState`.
- **Instagram plugin.** Creates containers as today, then checks their status for at most the existing short
  window. All `FINISHED` → proceeds exactly as today (photos are unchanged). Any `IN_PROGRESS` → returns
  `pending`. Called again with `resumeState`, it checks the saved containers once: all finished → next step
  (carousel: create the parent container, which may itself be pending; Reel/Story/carousel: `media_publish`);
  `ERROR` or `EXPIRED` → failure carrying Instagram's status; still processing → `pending` again, same start
  time.
- **Publish runner.** Due selection unchanged (a mid-publish post keeps `approval_status = 'scheduled'`, its
  past `scheduled_at` and no `platform_post_id`, so every tick picks it up). On `pending` it saves
  `platform_publish_state` and counts the post as neither published nor failed. On resume it passes the saved
  state. When the saved wait started more than **30 minutes** ago and the plugin still answers `pending`, the
  post is marked `failed` with "Instagram is still processing the video after 30 minutes." On publish or fail
  the state is cleared.
- **Nothing waits.** No run blocks on a video, so the Firebase cron's 120s timeout cannot be hit by video
  processing. "Publish now" sets a past `scheduled_at` and lets this runner publish, so it inherits the
  behaviour. Native scheduling (`/schedule`, Facebook's `scheduled_publish_time`) is untouched.

### B. Video carousel slides

- **Upload.** `POST /api/admin/media-assets/upload-url` accepts `video/mp4` and `video/quicktime`
  (`.mp4`, `.mov`) and records `kind = 'video'` (already allowed by the `media_assets.kind` check since 00093).
  Storage path keeps the extension. The vision alt-text job runs for images only.
- **Composer.** Each carousel slot accepts a photo or a video. A video slot shows the uploaded clip in a small
  player (same local-file approach as the manual-post player shipped in 4f3de768). The composer reports, with
  the ids, whether any slide is a video.
- **Dialog.** When the carousel holds a video, every platform but Instagram is treated like an unsupported
  platform: marked, and listed as "doesn't support videos in a carousel and will be skipped".
- **Route.** `POST /api/admin/content-studio/posts` accepts a `kind = 'video'` carousel asset only when the
  platform is Instagram, with mime `video/mp4` or `video/quicktime`; otherwise 400 with a plain reason.
- **Publish input.** `PublishInput` gains `mediaKinds?: ("image" | "video")[]`, parallel to `mediaUrls`, filled
  from the asset rows by `buildPluginInput`. The Instagram carousel sends video children as
  `media_type = VIDEO` with `video_url`, image children unchanged. Kind comes from the row, not the file name.

## Out of scope

Video carousels on Facebook, LinkedIn or TikTok; a separate "Processing on Instagram" status or badge (the post
shows Scheduled while it waits); trimming or checking Instagram's video limits before upload (Instagram's
refusal surfaces as the post's failure reason); changes to the Videos page uploader.

## Testing

TDD per rule: state saved on `pending`; resumed with the saved state; published once finished; failed on
`ERROR`/`EXPIRED`; failed after 30 minutes; state cleared on publish and on failure; photo-only paths unchanged;
mixed carousel sends VIDEO children; video slide refused for Facebook and LinkedIn; upload route accepts
mp4/mov and still refuses other types. Then the targeted suites for every changed module, root `tsc`,
`test:integration:selects`, and `test:integration:drift` after applying `00284` to the dev clone.

**Not provable here:** a real Instagram publish (the dev clone has no Instagram connection; the only one is
production). Owner approved one test post to the live account after deploy, which needs their go-ahead to push.
