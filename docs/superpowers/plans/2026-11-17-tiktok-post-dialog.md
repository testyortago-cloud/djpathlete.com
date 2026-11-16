# TikTok "Post to TikTok" Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every TikTok post goes out through one "Post to TikTok" dialog that follows TikTok's Direct Post UX rules, and the plugin sends exactly what the coach chose there.

**Architecture:** A new `social_posts.tiktok_settings` jsonb holds the coach's choices. A new route `GET|PUT /api/admin/social/posts/[id]/tiktok` serves fresh creator info + a preview URL and saves the choices. A shared `TikTokPostDialog` opens from the Publish now / Schedule buttons of TikTok posts and then calls the EXISTING caption PATCH, `publish-now` and `SchedulePickerDialog`. The TikTok plugin refuses to publish without saved settings — the one guard every path routes through.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgREST), Zod 4, React 19 + Testing Library, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-tiktok-post-dialog-design.md` (approved 2026-11-17). Read it before Task 1.

## Global Constraints

- Work in a worktree: `EnterWorktree` with name `tiktok-post-dialog` (lands in `.claude/worktrees/`). Copy `.env.local` in and run `npm ci` (worktrees have neither). The spec and this plan are untracked on `main`; copy both in and commit them as the branch's first commit.
- **No preset values anywhere**: no default privacy, no pre-ticked interaction box, disclosure off by default. A test in Task 4 pins each.
- Privacy labels, verbatim: `PUBLIC_TO_EVERYONE` "Everyone", `MUTUAL_FOLLOW_FRIENDS` "Friends", `FOLLOWER_OF_CREATOR` "Followers", `SELF_ONLY` "Only me".
- Declaration copy, verbatim: "By posting, you agree to TikTok's Music Usage Confirmation." — with Branded content ticked: "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation." Links: Music Usage Confirmation → `https://www.tiktok.com/legal/page/global/music-usage-confirmation/en`, Branded Content Policy → `https://www.tiktok.com/legal/page/global/bc-policy/en`.
- Disclosure labels, verbatim: Your brand only → `Your photo/video will be labeled as "Promotional content"`; Branded content ticked (alone or with Your brand) → `Your photo/video will be labeled as "Paid partnership"`.
- Disclosure incomplete hint, verbatim: "You need to indicate if your content promotes yourself, a third party, or both."
- Post-success toast, verbatim: "Sent to TikTok. It can take a few minutes to appear on your profile."
- Caption max 2200 characters (TikTok's title limit).
- `social_posts` has no `business_id` (platform seam, migration 00283). Do not add one here; do not add a `SINGLETON_BUSINESS_ID` reference.
- Commit messages: plain, no `Co-Authored-By` trailer, no tool credit (owner's global rule overrides the default).
- Tests: run only the files named in each task (`npx vitest run <files>`). No full-suite runs.
- Dialog: `components/ui/dialog.tsx` caps no height — give `DialogContent` `max-h-[90vh] overflow-y-auto`.
- Admin UI is light-only; no dark styles needed.

## Review Focus

1. **Saved settings the account no longer allows** (privacy level dropped from `privacy_level_options`, or Comment now disabled by the creator): prefill must drop them, never send them. Test in Task 1 (`prefillDraft`).
2. **A post with no resolvable video** (`resolveMediaUrl` → null): the dialog must say so, not show a postable form. Test in Task 3.
3. **A dead TikTok token** (401, refresh fails): the coach must see "reconnect", not a raw error. Test in Task 2 (`creatorInfo`) and Task 1 (`creatorInfoRefusal`).
4. **Caption over 2200 characters**: the textarea stops at 2200 and shows a counter; nothing is silently cut at publish. Test in Task 4.
5. **Double-click on the primary button**: one save, one queue. Button disabled while busy. Test in Task 4.

---

### Task 1: Settings schema and the dialog's rules (pure code)

**Files:**
- Create: `lib/validators/tiktok-post-settings.ts`
- Create: `lib/social/tiktok-post-rules.ts`
- Test: `__tests__/lib/validators/tiktok-post-settings.test.ts`
- Test: `__tests__/lib/social/tiktok-post-rules.test.ts`

**Interfaces:**
- Produces (`lib/validators/tiktok-post-settings.ts`):
  - `TIKTOK_PRIVACY_LEVELS = ["PUBLIC_TO_EVERYONE","MUTUAL_FOLLOW_FRIENDS","FOLLOWER_OF_CREATOR","SELF_ONLY"] as const`
  - `type TikTokPrivacyLevel = (typeof TIKTOK_PRIVACY_LEVELS)[number]`
  - `tiktokPostSettingsSchema` (Zod object, strict) and `type TikTokPostSettings = { privacy_level: TikTokPrivacyLevel; allow_comment: boolean; allow_duet: boolean; allow_stitch: boolean; disclose: boolean; your_brand: boolean; branded_content: boolean }`
- Produces (`lib/social/tiktok-post-rules.ts`, client-safe, no server imports):
  - `interface TikTokCreatorInfo { avatarUrl: string | null; username: string; nickname: string; privacyLevelOptions: TikTokPrivacyLevel[]; commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean; maxVideoPostDurationSec: number }`
  - `type CreatorInfoResult = { ok: true; creator: TikTokCreatorInfo } | { ok: false; code: string; message: string }`
  - `PRIVACY_LABELS: Record<TikTokPrivacyLevel, string>`
  - `type TikTokDraft = Omit<TikTokPostSettings, "privacy_level"> & { privacy_level: TikTokPrivacyLevel | null }`
  - `emptyDraft(): TikTokDraft`
  - `prefillDraft(saved: TikTokPostSettings | null, creator: TikTokCreatorInfo): TikTokDraft`
  - `submitBlocker(draft: TikTokDraft, creator: TikTokCreatorInfo, durationSec: number | null): string | null`
  - `disclosureLabel(draft: TikTokDraft): string | null`
  - `toSettings(draft: TikTokDraft): TikTokPostSettings` (throws if `privacy_level` is null)
  - `creatorInfoRefusal(code: string, message: string): string`

- [ ] **Step 1: Write the failing validator tests**

```ts
const ok = { privacy_level: "SELF_ONLY", allow_comment: false, allow_duet: false, allow_stitch: false,
             disclose: false, your_brand: false, branded_content: false }
it("accepts a complete, consistent settings object", () => expect(tiktokPostSettingsSchema.safeParse(ok).success).toBe(true))
it("rejects a missing privacy level", () => expect(tiktokPostSettingsSchema.safeParse({ ...ok, privacy_level: undefined }).success).toBe(false))
it("rejects an unknown privacy level", () => expect(tiktokPostSettingsSchema.safeParse({ ...ok, privacy_level: "PUBLIC" }).success).toBe(false))
it("rejects disclose with neither brand box", () => expect(tiktokPostSettingsSchema.safeParse({ ...ok, privacy_level: "PUBLIC_TO_EVERYONE", disclose: true }).success).toBe(false))
it("rejects branded content that is private", () => expect(tiktokPostSettingsSchema.safeParse({ ...ok, disclose: true, branded_content: true }).success).toBe(false))
it("rejects a brand box without disclose", () => expect(tiktokPostSettingsSchema.safeParse({ ...ok, your_brand: true }).success).toBe(false))
it("accepts branded content that is public", () => expect(tiktokPostSettingsSchema.safeParse({ ...ok, privacy_level: "PUBLIC_TO_EVERYONE", disclose: true, branded_content: true }).success).toBe(true))
it("rejects unknown keys", () => expect(tiktokPostSettingsSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false))
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run __tests__/lib/validators/tiktok-post-settings.test.ts` → "Cannot find module".

- [ ] **Step 3: Implement the schema.** `z.object({...}).strict().superRefine(...)`. Zod 4 runs `superRefine` even after a field failed (repo memory), so each refinement must read fields defensively (`v?.disclose === true`) and not throw on a partial object.

- [ ] **Step 4: Write the failing rules tests**

```ts
const creator: TikTokCreatorInfo = { avatarUrl: null, username: "coach", nickname: "Coach", maxVideoPostDurationSec: 600,
  privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], commentDisabled: false, duetDisabled: true, stitchDisabled: false }

emptyDraft → privacy_level null, all six booleans false
prefillDraft(null, creator) → equals emptyDraft()
prefillDraft(saved with privacy "FOLLOWER_OF_CREATOR", creator) → privacy_level null   // not in options
prefillDraft(saved with allow_duet true, creator) → allow_duet false                   // duetDisabled
prefillDraft(saved PUBLIC + allow_comment true, creator) → keeps both

submitBlocker(emptyDraft(), creator, null) → "Loading the video…"
submitBlocker(emptyDraft(), creator, 601) → "This video is 601 seconds long. TikTok allows up to 600 seconds for this account."
submitBlocker(emptyDraft(), creator, 30) → "Choose who can view this video."
submitBlocker({...privacy PUBLIC, disclose true}, creator, 30) → "You need to indicate if your content promotes yourself, a third party, or both."
submitBlocker({...privacy SELF_ONLY, disclose true, branded_content true}, creator, 30) → "Branded content can't be private. Choose another audience."
submitBlocker({...privacy PUBLIC}, creator, 30) → null

disclosureLabel(disclose false) → null; (disclose, neither) → null
disclosureLabel(your_brand only) → 'Your photo/video will be labeled as "Promotional content"'
disclosureLabel(branded only) and (both) → 'Your photo/video will be labeled as "Paid partnership"'

toSettings(draft with privacy null) → throws; with privacy → same fields, privacy narrowed

creatorInfoRefusal("spam_risk_too_many_posts", "x") → "This TikTok account has reached today's posting limit. Try again tomorrow."
creatorInfoRefusal("spam_risk_user_banned_from_posting", "x") → "TikTok has stopped this account from posting right now."
creatorInfoRefusal("reached_active_user_cap", "x") → "TikTok's daily limit for this app has been reached. Try again tomorrow."
creatorInfoRefusal("token_invalid", "x") → "The TikTok connection has expired. Reconnect TikTok on the Connections page."
creatorInfoRefusal("other_code", "Some message") → "TikTok said: Some message"
creatorInfoRefusal("other_code", "") → "TikTok said: other_code"
```

Blocker order is fixed as listed: duration unknown, too long, no privacy, disclosure incomplete, branded+private.

- [ ] **Step 5: Run, expect FAIL**, then **implement** `lib/social/tiktok-post-rules.ts` to the interfaces above, then **run both test files, expect PASS**.

- [ ] **Step 6: Commit** — `git add lib/validators/tiktok-post-settings.ts lib/social/tiktok-post-rules.ts __tests__/lib/validators/tiktok-post-settings.test.ts __tests__/lib/social/tiktok-post-rules.test.ts && git commit -m "feat(tiktok): settings schema and post-screen rules"`

---

### Task 2: The column, and the plugin sends the coach's settings

**Files:**
- Create: `supabase/migrations/00301_social_posts_tiktok_settings.sql` (confirm 00301 is free first: `ls supabase/migrations | tail -2`; take the next free number if not, here and in the type comment)
- Modify: `types/database.ts` (`SocialPost`, after `platform_publish_state`)
- Modify: `lib/social/plugins/types.ts` (`PublishInput`)
- Modify: `lib/social/publish-runner.ts` (`buildPluginInput`, return block ~line 164)
- Modify: `lib/social/plugins/tiktok.ts`
- Modify: `app/api/admin/platform-connections/tiktok/connect/route.ts:10` (carry over the uncommitted `main` change: `SCOPES = ["user.info.basic", "video.publish"]`)
- Modify: `deliverables/tiktok-app-review/app-review-explanation.txt` (carry over the same uncommitted change: "Content Posting API (video.publish)")
- Test: `__tests__/lib/social/tiktok.test.ts` (extend)
- Test: `__tests__/lib/social/build-plugin-input-tiktok.test.ts` (new; copy the mock setup of `build-plugin-input-link.test.ts`)

**Interfaces:**
- Consumes: `TikTokPostSettings`, `CreatorInfoResult`, `TikTokCreatorInfo` (Task 1).
- Produces:
  - `SocialPost.tiktok_settings?: TikTokPostSettings | null` (optional: DB-defaulted null; repo memory "a DB-defaulted column must be optional")
  - `PublishInput.tiktokSettings?: TikTokPostSettings | null`
  - `interface TikTokPlugin extends PublishPlugin { creatorInfo(): Promise<CreatorInfoResult> }`, and `createTikTokPlugin(credentials): TikTokPlugin`
  - Missing-settings error string, verbatim: `"Open this post and choose its TikTok settings before posting."`

- [ ] **Step 1: Write the migration.** `ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS tiktok_settings jsonb;` plus a `COMMENT ON COLUMN` naming writer (`PUT /api/admin/social/posts/[id]/tiktok`) and reader (`buildPluginInput` → TikTok plugin), and that NULL means the coach has not been through the dialog.

- [ ] **Step 2: Apply it to the dev clone** with the supabase MCP `apply_migration` (repo memory: apply to dev automatically; prod applies itself on push). Then `npm run test:integration:drift` → PASS.

- [ ] **Step 3: Write the failing plugin tests** (in `tiktok.test.ts`, reuse `mockFetchSequence`)

```ts
const SETTINGS = { privacy_level: "MUTUAL_FOLLOW_FRIENDS", allow_comment: true, allow_duet: false, allow_stitch: true,
                   disclose: true, your_brand: true, branded_content: false }

it("refuses to publish without tiktok settings and makes no request", ...)
  // publish({ content: "c", mediaUrl: MEDIA_URL, scheduledAt: null })
  // → { success: false, error: "Open this post and choose its TikTok settings before posting." }; fetch not called
it("sends the coach's settings in post_info", ...)
  // init body post_info: privacy_level "MUTUAL_FOLLOW_FRIENDS", disable_comment false, disable_duet true,
  // disable_stitch false, brand_organic_toggle true, brand_content_toggle false
it("ignores TIKTOK_PRIVACY_LEVEL", ...)
  // vi.stubEnv("TIKTOK_PRIVACY_LEVEL", "PUBLIC_TO_EVERYONE"); settings SELF_ONLY → post_info.privacy_level "SELF_ONLY"
it("creatorInfo maps TikTok's fields", ...)
  // POST https://open.tiktokapis.com/v2/post/publish/creator_info/query/ → data { creator_avatar_url, creator_username,
  // creator_nickname, privacy_level_options, comment_disabled, duet_disabled, stitch_disabled,
  // max_video_post_duration_sec }, error { code: "ok" } → { ok: true, creator: {camelCase fields} }
it("creatorInfo returns TikTok's error code", ...)
  // 200 with error { code: "spam_risk_too_many_posts", message: "m" } → { ok: false, code: "spam_risk_too_many_posts", message: "m" }
it("creatorInfo reports a dead token as token_invalid", ...)
  // 401, then refresh POST answers 400 → { ok: false, code: "token_invalid", message: "" }
```

Update every existing `publish` test in the file to pass `tiktokSettings` so they keep testing what they tested.

- [ ] **Step 4: Run, expect FAIL** — `npx vitest run __tests__/lib/social/tiktok.test.ts`.

- [ ] **Step 5: Implement.** In `tiktok.ts`: add `CREATOR_INFO_URL`; add `creatorInfo()` using `authedFetch` (POST, empty JSON body); guard at the top of `publish()` before any fetch; map settings into `post_info` (keep `title` and `video_cover_timestamp_ms`); delete `PrivacyLevel` and `defaultPrivacy()`; rewrite the header comment's "Privacy" paragraph and `getSetupInstructions()` step 5 to say privacy is chosen per post in the Post to TikTok dialog. Add the `PublishInput` field and the `SocialPost` field.

- [ ] **Step 6: Run, expect PASS** — `npx vitest run __tests__/lib/social/tiktok.test.ts`.

- [ ] **Step 7: Write the failing runner test** (`build-plugin-input-tiktok.test.ts`)

```ts
it("passes tiktok_settings through for a TikTok post", ...)   // input.tiktokSettings toEqual the row's settings
it("passes null when the TikTok post has none", ...)          // input.tiktokSettings === null
it("omits tiktokSettings for other platforms", ...)           // "tiktokSettings" in input === false for instagram
```

- [ ] **Step 8: Implement** in `buildPluginInput`'s final return: `...(post.platform === "tiktok" ? { tiktokSettings: post.tiktok_settings ?? null } : {})`. Confirm the cron's reader (`listSocialPosts` in `lib/db/social-posts.ts`) and `getSocialPostById` select `*`; if either lists columns, add `tiktok_settings`.

- [ ] **Step 9: Run** `npx vitest run __tests__/lib/social/build-plugin-input-tiktok.test.ts __tests__/lib/social/publish-runner.test.ts __tests__/lib/social/tiktok.test.ts` → PASS. Then `npm run test:integration:selects` → PASS.

- [ ] **Step 10: Mutation check.** Delete the missing-settings guard → "refuses to publish without tiktok settings" goes red. Restore.

- [ ] **Step 11: Commit** — migration, the four source files, connect route, `app-review-explanation.txt`, both tests. Message: `feat(tiktok): send the coach's per-post settings; refuse posts without them`.

---

### Task 3: `GET|PUT /api/admin/social/posts/[id]/tiktok`

**Files:**
- Create: `app/api/admin/social/posts/[id]/tiktok/route.ts`
- Test: `__tests__/api/admin/social/tiktok-settings.test.ts` (mock setup copied from `publish-now.test.ts`; also mock `@/lib/social/resolve-media-url`, `@/lib/social/bootstrap`, `@/lib/social/registry`)

**Interfaces:**
- Consumes: `tiktokPostSettingsSchema`, `TikTokPostSettings` (Task 1); `TikTokPlugin`, `SocialPost.tiktok_settings` (Task 2); `resolveMediaUrl`, `bootstrapPlugins`, `pluginRegistry`, `listPlatformConnections`, `getSocialPostById`, `updateSocialPost`, `canAccessAdminPath`, `auth`; `creatorInfoRefusal` (Task 1).
- Produces:
  - `GET` → 200 `{ creator: TikTokCreatorInfo; previewUrl: string; saved: TikTokPostSettings | null }`, or `{ error: string }` with 401 / 404 / 409.
  - `PUT` body `{ settings: TikTokPostSettings }` → 200 `{ tiktok_settings: TikTokPostSettings }`, or `{ error: string }` with 400 / 401 / 404 / 409.

- [ ] **Step 1: Write the failing tests**

```ts
// GET
401 when not admin
404 when the post is missing; 404 when post.platform is "instagram"
409 { error: "Connect TikTok on the Connections page first." } when pluginRegistry.get("tiktok") is undefined
409 { error: "This post has no video to send." } when resolveMediaUrl → null     // Review Focus 2
409 { error: creatorInfoRefusal(code, message) } when creatorInfo → { ok: false, ... }
200 { creator, previewUrl, saved: post.tiktok_settings ?? null } on success
// PUT
401; 404 missing; 404 non-TikTok
409 when approval_status is "published" (and "rejected")
400 when settings fail the schema (e.g. disclose with no brand box); updateSocialPost not called
200 and updateSocialPost(id, { tiktok_settings: settings }) — exactly that object, nothing else written
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run __tests__/api/admin/social/tiktok-settings.test.ts`.

- [ ] **Step 3: Implement the route.** Auth exactly as `publish-now/route.ts`. Publishable statuses: copy `PUBLISHABLE_STATUSES` from `publish-now/route.ts` (same six). GET: `bootstrapPlugins(await listPlatformConnections())`, then `pluginRegistry.get("tiktok") as TikTokPlugin | undefined`; resolve the preview with `resolveMediaUrl({ source_video_id, media_url })` before calling creator info. PUT: parse body with the schema, return the first issue's message on 400. PUT writes only `tiktok_settings` — the caption goes through the existing PATCH route. No audit row (the sibling post routes record none).

- [ ] **Step 4: Run, expect PASS.** Then `npm run test:integration:selects` (a new route file is collected only if it has a `.select(`; expect no change).

- [ ] **Step 5: Commit** — `feat(tiktok): creator-info and settings route for the Post to TikTok screen`.

---

### Task 4: `TikTokPostDialog`

**Files:**
- Create: `components/admin/social/TikTokPostDialog.tsx`
- Test: `__tests__/components/admin/social/TikTokPostDialog.test.tsx`

**Interfaces:**
- Consumes: Task 1 rules/types; Task 3 route; existing `PATCH /api/admin/social/posts/[id]` (`{ caption_text }`), `POST .../publish-now`.
- Produces:

```ts
interface TikTokPostDialogProps {
  post: SocialPost
  intent: "now" | "schedule"
  open: boolean
  onOpenChange: (open: boolean) => void
  /** "now": called with the publish-now result merged into the post. */
  onQueued: (updated: SocialPost) => void
  /** "schedule": settings saved; caller opens SchedulePickerDialog. */
  onReadyToSchedule: (updated: SocialPost) => void
}
export function TikTokPostDialog(props: TikTokPostDialogProps): JSX.Element
```

Layout and copy are fixed by the spec's "Dialog" section and Global Constraints. Controls: native `<select>` with an empty, disabled placeholder option "Select who can view" and options from `creator.privacyLevelOptions` labelled by `PRIVACY_LABELS` (`SELF_ONLY` option disabled while Branded content is ticked); native checkboxes "Comment", "Duet", "Stitch" (disabled when the creator disables them); `components/ui/switch.tsx` for "Disclose video content"; checkboxes "Your brand" and "Branded content" (Branded content disabled while privacy is `SELF_ONLY`, hint "Branded content can't be private."); `<textarea maxLength={2200}>` with an `N/2200` counter; `<video controls>` on `previewUrl`, whose `loadedmetadata` sets the duration (an `error` event sets the message "Couldn't load this video." and keeps the button blocked). The primary button ("Post to TikTok" for `now`, "Continue to schedule" for `schedule`) is disabled while `submitBlocker(...)` returns a string or a request is in flight; the blocker string shows under the button.

The form's initial state is `prefillDraft(saved, creator)` from the GET response, and the caption starts as `post.content`.

On confirm: if the caption changed, PATCH it; PUT settings; then `now` → POST `publish-now`, toast the success copy, `onQueued`; `schedule` → `onReadyToSchedule`. Any failed request: toast its `error`, stay open.

States: loading (spinner), refused (GET 409: the message and a Close button only), error (network: message + Retry).

- [ ] **Step 1: Write the failing tests** (mock `fetch`; fire `loadedmetadata` on the video with `Object.defineProperty(video, "duration", { value: 30 })`)

```ts
it("shows the creator's nickname and username")                 // "Coach" and "@coach"
it("starts with no privacy chosen")                              // select value "" ; Post disabled; "Choose who can view this video." shown
it("starts with Comment, Duet and Stitch unchecked")
it("disables an interaction the creator turned off")             // duetDisabled → Duet checkbox disabled
it("starts with disclosure off")                                  // switch aria-checked "false"; brand boxes not rendered
it("blocks Post until a brand box is ticked when disclosing")    // hint copy verbatim
it("makes Branded content and Only me exclusive")                // tick Branded → SELF_ONLY option disabled; choose SELF_ONLY → Branded disabled
it("switches the declaration when Branded content is ticked")    // both declaration strings verbatim
it("shows the refusal and no form when the route answers 409")
it("blocks a video longer than the account allows")             // duration 601, max 600 → message verbatim
it("caps the caption at 2200 characters")                        // textarea maxLength 2200; counter "2200/2200"
it("saves once and queues once on a double click")               // two clicks → one PUT, one publish-now (Review Focus 5)
it("PATCHes the caption only when it changed")
it("for schedule, saves settings and calls onReadyToSchedule without publish-now")
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run __tests__/components/admin/social/TikTokPostDialog.test.tsx`.
- [ ] **Step 3: Implement** the component.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(tiktok): Post to TikTok dialog`.

---

### Task 5: Open the dialog from both post screens

**Files:**
- Modify: `components/admin/content-studio/drawer/PostsTabRow.tsx` (`publishNow` button ~line 245, Schedule button ~line 235, `SchedulePickerDialog` ~line 275)
- Modify: `components/admin/social/SocialPostCard.tsx` (Schedule ~line 193, Publish now ~line 201, `SchedulePickerDialog` ~line 243)
- Test: `__tests__/components/admin/content-studio/drawer/PostsTabRow.test.tsx` (extend)
- Test: `__tests__/components/admin/social/SocialPostCard.test.tsx` (new, minimal)

**Interfaces:**
- Consumes: `TikTokPostDialog` (Task 4), existing `SchedulePickerDialog`.

Rule: when `post.platform === "tiktok"`, Publish now / Retry now opens the dialog with `intent="now"`, Schedule / Reschedule opens it with `intent="schedule"`, and `onReadyToSchedule` closes it and opens `SchedulePickerDialog`. Every other platform keeps today's behaviour, byte for byte.

- [ ] **Step 1: Write the failing tests** (each file)

```ts
it("TikTok: Publish now opens the Post to TikTok dialog and does not call publish-now")
it("TikTok: Schedule opens the Post to TikTok dialog, not the schedule picker")
it("Instagram: Publish now still calls publish-now directly")      // presence control for the branch
```

Mock `TikTokPostDialog` as a stub that renders `intent` so the test asserts which intent opened.

- [ ] **Step 2: Run, expect FAIL**, **implement** in both files, **run, expect PASS** — `npx vitest run __tests__/components/admin/content-studio/drawer/PostsTabRow.test.tsx __tests__/components/admin/social/SocialPostCard.test.tsx`.
- [ ] **Step 3: Commit** — `feat(tiktok): TikTok posts go through the Post to TikTok dialog`.

---

### Task 6: Batch actions and the calendar stop queuing TikTok posts

**Files:**
- Modify: `components/admin/content-studio/drawer/BatchPostActions.tsx` (`eligibleForBatch`, the bar's label)
- Modify: `app/api/admin/content-studio/posts/route.ts` (`initialStatus`, ~line 212)
- Modify: `components/admin/content-studio/calendar/ManualPostDialog.tsx` (success toast, ~line 146)
- Test: `__tests__/components/admin/content-studio/drawer/BatchPostActions.test.tsx` (extend)
- Test: `__tests__/api/admin/content-studio/posts-tiktok.test.ts` (new; mock setup from `posts-text.test.ts`)
- Test: `__tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx` (extend)

**Interfaces:**
- Produces: `eligibleForBatch(posts)` now also excludes `platform === "tiktok"`. Create route returns `approval_status: "approved"` and `scheduled_at: null` for a TikTok post even when `scheduled_at` was sent.

My call vs the spec: the spec said "skip and say so in the toast". Excluding TikTok from `eligibleForBatch` is less code and keeps the bar's count honest; the bar shows the note instead: "TikTok posts are sent one at a time from their own row." whenever the drawer holds a TikTok post that is neither published nor rejected.

- [ ] **Step 1: Write the failing tests**

```ts
// BatchPostActions
eligibleForBatch excludes a draft TikTok post and keeps a draft Instagram post
the bar shows the TikTok note when a TikTok draft is present; not when there is none
publish-all with [instagram draft, tiktok draft] calls publish-now once (instagram only)
// create route
TikTok + scheduled_at in the future → createSocialPost called with approval_status "approved", scheduled_at null
Instagram + scheduled_at → still "scheduled"                             // presence control
// ManualPostDialog
creating TikTok + Instagram → toast includes "TikTok: open the post to send it"; Instagram still "scheduled"
```

ManualPostDialog decides from the create response's `approval_status` (already returned), not from the platform name.

- [ ] **Step 2: Run, expect FAIL**, **implement**, **run, expect PASS** — the three test files above plus `__tests__/api/admin/content-studio/posts-text.test.ts` (direct dependent).
- [ ] **Step 3: Commit** — `feat(tiktok): batch send and calendar no longer queue TikTok posts`.

---

### Task 7: Verify, look at it, write it down

- [ ] **Step 1: Build gates.** `npx tsc --noEmit 2>&1 | grep -c "error TS"` on the branch and on `main` (control); the branch count must not exceed main's, and `grep` the output for every file this plan touched → none. `npm run build` → exit 0.
- [ ] **Step 2: Targeted tests, once more, together** — every test file named in Tasks 1–6. Then `npm run test:integration:selects` and `npm run test:integration:drift` → PASS.
- [ ] **Step 3: Real-app screenshots** (owner's screenshot rule: the real page on the real route, annotated, burned into the PNG; light only). On `localhost:3050` against the dev clone, which has no TikTok connection: capture the drawer's TikTok row → the dialog's refused state ("Connect TikTok on the Connections page first."). The full form needs a connected TikTok account: once the owner's sandbox exists, connect it locally (if TikTok accepts a `localhost` redirect URI) or capture it on production during the recording session. Do not fake creator info and do not write to production data to reach it; if neither is possible, say so in the report. Save to `screenshots/tiktok-post-dialog/`.
- [ ] **Step 4: Whole-branch review** with a fresh reviewer, handed the diff as a file (repo memory: reviewers inherit the worktree pin).
- [ ] **Step 5: Journal.** Add a dated `[Feature build-out]` entry to `JOURNAL.md` (local, never committed): what shipped, the rejection it answers, mistakes + lessons. Update `deliverables/tiktok-app-review/README.md`: scopes now `user.info.basic` + `video.publish`; the old Playwright/Remotion demo is unusable (TikTok forbids automated recordings); point to the recording runbook in the spec.
- [ ] **Step 6: Stop before main.** Branch committed and green; merging and the prod deploy wait for the owner's go-ahead. After merge, revert the now-duplicated uncommitted `SCOPES` edit in the main checkout (`git checkout -- app/api/admin/platform-connections/tiktok/connect/route.ts deliverables/tiktok-app-review/app-review-explanation.txt` only after confirming the branch holds the same change), and remove the worktree + branch per the owner's cleanup rule.
