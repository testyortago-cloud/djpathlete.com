# TikTok "Post to TikTok" dialog — design

2026-11-17. Status: draft, awaiting owner approval.

## Intent

TikTok rejected the app review (Login Kit + Content Posting API). The owner will re-record the demo video by
hand, posting to a TikTok **sandbox** account. The reviewer will watch our post screen in that video, and the
later Direct Post audit (needed before posts can be public) checks the same screen against TikTok's
[content sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines). Today the screen
breaks almost every rule: privacy comes from an env var, Comment/Duet/Stitch are silently ON, no creator info
is fetched, the account is never shown.

Goal: one "Post to TikTok" screen that follows those rules, so the owner records once and the same screen
passes the audit later.

## Goals

- A TikTok post cannot be published or scheduled until the coach has made every choice TikTok requires, on a
  screen that showed fresh creator info.
- The choices the coach made are exactly what the plugin sends to TikTok.
- Works from both places a single TikTok post can be sent: the Content Studio drawer row and `/admin/social`.
  The two batch-style paths stop queuing TikTok posts (see "Other paths").

## Non-goals

- Making "Publish now" instant. It still queues for `publishDuePostsCron` (≤ 5 min). The demo can be two clips
  (the form allows up to 5 videos).
- Sandbox support in code. The connection row stores its own `client_key` (callback route), so recording
  against the sandbox is an env swap plus reconnect, done by the owner. See "Recording runbook" below.
- Photo posts, drafts to inbox (`video.upload` was dropped from `SCOPES` on 2026-11-17), AIGC labelling.
- Re-checking creator info at cron time. TikTok's init call rejects a privacy level the account no longer
  allows; that surfaces as a normal failed post.

## Anti-goals

- Any preset value: no default privacy, no pre-ticked interaction box, no "remember my last choice". TikTok
  forbids it, and it would fail the audit even if it works.
- A second code path that can reach TikTok without the saved settings (the old env-var path must go).

## TikTok's rules this must meet (from the guidelines)

1. Fetch creator info (`POST /v2/post/publish/creator_info/query/`) when the screen renders.
2. Show the creator's nickname (and avatar) so the coach knows which account receives the post.
3. If creator info says the account can't post now (posting cap or a ban error), stop and tell the coach to
   try later. Do not show a postable form.
4. Video longer than `max_video_post_duration_sec` → block with a message.
5. Editable caption (title), prefilled with our caption.
6. "Who can view this video": dropdown of `privacy_level_options` only, **no default value**.
7. "Allow users to" Comment / Duet / Stitch: all **unchecked** by default; a box is disabled and greyed when
   creator info says that interaction is off for the account (`comment_disabled` etc.).
8. "Disclose video content" toggle, **off** by default. When on: "Your brand" and "Branded content"
   checkboxes, a label preview ("Promotional content" for Your brand only, "Paid partnership" otherwise), and
   Post disabled until at least one is ticked. Branded content cannot be private: if privacy is `SELF_ONLY`,
   "Branded content" is disabled (and vice versa, `SELF_ONLY` is disabled while Branded content is ticked),
   each with a short reason.
9. Declaration above the Post button: "By posting, you agree to TikTok's Music Usage Confirmation." — or, with
   Branded content ticked, "By posting, you agree to TikTok's Branded Content Policy and Music Usage
   Confirmation." Both names link to TikTok's pages.
10. Preview of the video being posted.
11. After posting: tell the coach it may take a few minutes to appear on their profile.

## Approaches considered

- **A. A "Post to TikTok" dialog (chosen by owner).** For a TikTok post, Publish now / Schedule open one
  dialog with everything above; on confirm it saves the choices on the post, then queues or opens the existing
  schedule picker. Matches TikTok's own framing ("Post to TikTok page", fresh creator info at render), reads
  as one clear screen on video, leaves other platforms untouched.
- B. A settings panel inside the expanded row. Cheaper UI, but creator info on every expand, duplicated in two
  cards, and a crowded row the reviewer has to hunt through.
- Dropped: account-level defaults — TikTok forbids preset values.

## Design

### Data

New migration `00301_social_posts_tiktok_settings.sql`: `ALTER TABLE social_posts ADD COLUMN tiktok_settings
jsonb` (nullable). Writer: the new settings route. Reader: `buildPluginInput` → TikTok plugin. NULL means "the
coach has not been through the dialog". `social_posts` has no `business_id` (existing platform seam, migration
00283); this adds a column to an existing table, not a table.

Shape (validated by a Zod schema in `lib/validators/`):

```
{ privacy_level: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY",
  allow_comment: boolean, allow_duet: boolean, allow_stitch: boolean,
  disclose: boolean, your_brand: boolean, branded_content: boolean }
```

Schema refinements: `disclose` → at least one of `your_brand` / `branded_content`; `branded_content` →
`privacy_level !== "SELF_ONLY"`; `disclose: false` → both brand flags false.

### Routes

- `GET /api/admin/social/posts/[id]/tiktok` → `{ creator, previewUrl }` or a refusal. Admin-gated like the
  sibling routes (`canAccessAdminPath`). 404 unless the post exists and `platform === "tiktok"`. Bootstraps
  plugins from `listPlatformConnections()`, calls a new `creatorInfo()` on the TikTok plugin. `previewUrl`
  comes from `resolveMediaUrl` — the same function the publisher uses, so the preview is the exact file posted.
  A creator-info error (cap reached, banned, token dead) returns 409 with TikTok's message mapped to plain
  words, so the dialog shows "try again later" instead of a form.
- `PUT /api/admin/social/posts/[id]/tiktok` with `{ caption, settings }` → validates, refuses unless the post
  is TikTok and in a publishable status, saves `content` + `tiktok_settings`. The dialog then calls the
  EXISTING `publish-now` route, or opens the EXISTING `SchedulePickerDialog`. Those two routes do not change.

### Plugin (`lib/social/plugins/tiktok.ts`)

- New `creatorInfo()` method (TikTok-only, not on the shared `PublishPlugin` interface; the route narrows the
  plugin by name).
- `publish()` reads `input.tiktokSettings` (new optional field on `PublishInput`, filled by `buildPluginInput`
  for TikTok posts only). **Missing settings → `success: false` with "Open this post and choose its TikTok
  settings before posting."** This is the single guard every path routes through: publish-now, schedule, the
  calendar's manual-post create, and anything added later.
- `post_info` maps the settings: `privacy_level`, `disable_comment: !allow_comment` (same for duet, stitch),
  `brand_organic_toggle: your_brand`, `brand_content_toggle: branded_content`.
- Delete `defaultPrivacy()` and the `TIKTOK_PRIVACY_LEVEL` env read, and update the setup-instructions text.

### Dialog (`components/admin/social/TikTokPostDialog.tsx`)

Shared by `PostsTabRow` and `SocialPostCard`. For `platform === "tiktok"` (non-story), their Publish now and
Schedule buttons open this dialog instead of acting directly; other platforms unchanged. Props: the post, the
intent (`"now" | "schedule"`), callbacks.

Layout, top to bottom: avatar + nickname + @username; video preview (`<video controls>` on `previewUrl`, which
also yields the duration for rule 4 — `duration_seconds` is NULL on most stored videos); caption textarea;
privacy select (placeholder "Select who can view", no value); three checkboxes; disclosure toggle with its two
checkboxes and label preview; declaration line; Cancel / primary button ("Post to TikTok" or "Continue to
schedule"). The primary button stays disabled until privacy is chosen, disclosure is complete, duration is
known and within the limit; a disabled button says why on hover.

States: loading (spinner while creator info loads); refused (creator-info 409: message, Close only); error
(network: message + Retry). After a successful "now": toast "Sent to TikTok. It can take a few minutes to
appear on your profile."

Uses the house dialog primitive with a capped height (memory: the dialog primitive caps no height).

### Tests

- Plugin: settings → `post_info` mapping (each flag, both brand toggles); missing settings → refused with no
  fetch made; `creatorInfo()` happy path and error mapping. Mutation check: drop the missing-settings guard,
  the test must go red.
- Validator: each refinement rejects its bad case and accepts the good one.
- Settings route: refuses non-TikTok, unknown post, bad body, unpublishable status; saves on the happy path.
- creator-info route: 404 non-TikTok, 409 on TikTok error, 200 with preview URL.
- Dialog (Testing Library): no privacy preselected; all three boxes unchecked; disabled box when creator info
  disables it; Branded content ↔ SELF_ONLY mutual exclusion; declaration text switches; Post disabled until
  valid.
- `npm run test:integration:selects` after the migration is applied to the dev clone, then
  `test:integration:drift`.

## Recording runbook (owner, not code)

1. Developer Portal → create a sandbox, add your own private TikTok account as a target user, enable Login Kit
   + Content Posting API (Direct Post) with `user.info.basic` + `video.publish` only, and register redirect URI
   `https://www.darrenjpaul.com/api/admin/platform-connections/tiktok/callback`.
2. Put the sandbox Client key/secret into Vercel production `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`,
   redeploy. (darrenjpaul_ cannot post today anyway: public account, unaudited app.)
3. Record by hand, in a real browser with the address bar showing `www.darrenjpaul.com`: Connect TikTok →
   TikTok consent screen → handle shown → Content Studio → open a video's TikTok post → Post to TikTok dialog →
   choices → Post → wait → status Published → open TikTok and show the video on the sandbox account.
4. Swap the env back, redeploy, reconnect darrenjpaul_.

A detailed shot list will be written separately once the dialog exists.

## Other paths that queue TikTok posts (my call)

Two more paths queue posts without a row button, and both would now queue TikTok posts that are certain to
fail at cron time:

- `components/admin/content-studio/drawer/BatchPostActions.tsx` (batch Publish now / Schedule): **skip TikTok
  posts** and say so in the result toast ("TikTok posts skipped: open each one to post it"). TikTok requires
  per-post consent on a screen with fresh creator info, so a batch path cannot be made compliant.
- `POST /api/admin/content-studio/posts` (the calendar's `ManualPostDialog`): **a TikTok post is never created
  already scheduled.** It lands as `approved` with `scheduled_at` null; the dialog's success message tells the
  coach to open it to post. The plugin guard stays as the backstop for anything missed.

## Decisions on edge cases (my calls, from the builder check)

- **Row buttons always open the dialog for TikTok**, including retry after failure and reschedule, because
  rule 1 wants fresh creator info every time. Fields prefill only from THIS post's own saved
  `tiktok_settings` (the coach's own earlier choice); a post never through the dialog opens blank.
- **Existing queued TikTok posts with NULL settings**: no data step. They fail at the next cron with the
  plugin's plain message; the coach reopens them. The only live account cannot post today anyway.
- **Duration**: browser check only. TikTok's own refusal is the backstop; no server re-check.
- **Settings survive** caption edits, unschedule and failure; nothing clears them.
- **PUT then publish-now is two calls.** If the second fails, settings stay saved and the error shows; the coach
  retries. The GET already fails when TikTok is not connected, so a disconnected account never reaches the
  form. The PUT does not call `releaseSourceVideoForSend`; `publish-now` and `schedule` still do.
- **Migration number**: confirm `00301` is still free at build time; take the next free number if not.

## Left to the builder

Exact file layout of the dialog's sub-parts, the copy of each "why disabled" hint, and the mapping of TikTok
creator-info error codes to plain words (`spam_risk_too_many_posts`, `spam_risk_user_banned_from_posting`,
`reached_active_user_cap`, anything else → "TikTok said: <message>").
