# Share to LinkedIn — blog posts and newsletters

**Date:** 2026-09-29 · **Status:** approved in chat (sections 1–2 by the owner; 3–4 decided autonomously overnight, see §8)

## 1. Goal

The owner wants to promote blog posts and newsletter issues on LinkedIn as text posts with a link, not only
videos. LinkedIn (Company Page "DJP Athlete") has been connected in production since 2026-09-29 15:02 UTC.

Done means: from a published blog post or a sent/scheduled newsletter issue, one click produces a LinkedIn
draft in Darren's voice, in the existing approval queue (`/admin/social`), which publishes as a post with a
**link card** (image, title, description) pointing back to darrenjpaul.com. The Content Studio's manual post
box can also create a plain Text post.

### What exists (measured, not assumed)

- `functions/src/social-agent.ts` already drafts a LinkedIn text post from a chosen blog post
  (`{ platform, blogPostId }`) through a writer → reviewer pipeline with the voice profile and few-shots,
  and inserts it as `social_posts` `approval_status='draft'`, `post_type='text'`. Its job `result` lists
  `social_post_id`s. It never includes the article's URL.
- `POST /api/admin/social/agent/run` enqueues that job (`createAiJob`, type `social_agent_run`). No UI calls it.
- `hooks/use-ai-job.ts` tracks a job's status/result client-side (used by `NewsletterGenerateDialog`).
- Every publish path (`publish-runner.ts` cron, `posts/[id]/publish-now` → cron, `posts/[id]/schedule`) builds
  plugin input in ONE place: `buildPluginInput` in `lib/social/publish-runner.ts`.
- `PublishInput` carries only text + media. The LinkedIn plugin sends `commentary` raw.
- LinkedIn's Posts API **does not scrape URLs** for API-created posts: a URL in `commentary` is a bare link,
  no card. A card requires `content.article { source, title, description, thumbnail }` with the thumbnail
  uploaded through the Images API first. (learn.microsoft.com … /shares/posts-api, "Article Post Creation")
- LinkedIn's `commentary` is "little" text: `| { } @ [ ] ( ) < > # \ * _ ~` are reserved. The plugin does not
  escape them today, so every LinkedIn post containing e.g. "(ACL)" is at risk of being mangled or truncated.
- Newsletters have **no public web page**. Prod: 2 sent, 2 scheduled, 10 drafts; none of the sent/scheduled
  came from a blog. The homepage newsletter section has no anchor id.
- `CS_MULTIMEDIA_ENABLED` is **unset in production**, so `ManualPostDialog` shows no post-type picker at all
  (video only), and the create route refuses any non-video type. This is why the owner saw "just videos".
- `social_posts` has no `business_id` and no link/source columns. RLS is enabled (00076).

## 2. What the owner sees (approved)

- **Blog:** a **Share to LinkedIn** button on each *published* post — in the blog list row and in the edit page
  header. Not on drafts.
- **Newsletter:** the same button on each *sent* or *scheduled* issue (list row + edit page).
- **Click →** "Writing LinkedIn post…" (the agent, ~1 min) → **"Draft ready → review in Social"** linking to
  `/admin/social`. Review, edit, approve, post now or schedule there as with any draft.
- **On LinkedIn:** Darren's words, then a link card.
  - Blog: cover image, title, excerpt → `https://www.darrenjpaul.com/blog/<slug>`.
  - Newsletter: a teaser of the issue's main idea ending in an invitation to subscribe; card uses the site's
    default share image → `https://www.darrenjpaul.com/#newsletter`.
- **Twice:** if an un-posted LinkedIn draft from the same source exists, clicking the button turns it into
  **"Draft already in Social"** linking there, instead of writing another. (Checked on click, not on page load, so
  the blog list does not run a query per row.) Once posted, sharing again is allowed.
- **Failures:** LinkedIn not connected / agent failed → a plain-words message, nothing created.
- **Manual:** the New manual post box gets **Text**, available WITHOUT the multimedia flag.

## 3. Data (approved)

Migration `00283_social_posts_share_links.sql` on `social_posts`:

| Column | Type | Writer | Reader |
|---|---|---|---|
| `source_blog_post_id` | uuid null → `blog_posts(id)` ON DELETE SET NULL | social agent | share route (dedupe) |
| `source_newsletter_id` | uuid null → `newsletters(id)` ON DELETE SET NULL | social agent | share route (dedupe) |
| `link_url` | text null, CHECK `link_url IS NULL OR link_url LIKE 'https://%'` | social agent | `buildPluginInput` |
| `link_title` | text null | social agent | `buildPluginInput` |
| `link_description` | text null | social agent | `buildPluginInput` |
| `link_image_url` | text null, CHECK https like link_url | social agent | `buildPluginInput` |

Plus a CHECK that at most one source is set, and partial indexes on each source column (`WHERE … IS NOT NULL`).
SET NULL, not CASCADE: deleting a blog must not delete the record of what was posted.

**Tenancy:** `social_posts` has no `business_id`; this feature lives inside the existing platform seam
(`agent/run` already stamps `platformBusinessId()` and is listed in `lib/tenancy/platform.ts`). The new share
route is a new caller of that seam and must be added to the inventory in `platform.ts` (the inventory test fails
otherwise). No new `SINGLETON_BUSINESS_ID` reference. Flagged, not fixed: `social_posts` itself needs a tenant.

`SocialPost` type and the `lib/db/social-posts.ts` DAL gain the six fields (optional on insert — DB-defaulted
null; see memory "a DB-defaulted column must be optional").

## 4. Share route (approved)

`POST /api/admin/social/share` — body `{ blogPostId }` XOR `{ newsletterId }`.

1. Auth: session + `canAccessAdminPath` (same gate as `agent/run`).
2. Validate exactly one id. Load the source:
   - blog: 404 if missing; 409 `"Only published posts can be shared"` unless `status='published'`.
   - newsletter: 404 if missing; 409 `"Only sent or scheduled issues can be shared"` unless `sent`/`scheduled`.
3. LinkedIn must be `connected` in `platform_connections`, else 409 `"Connect LinkedIn first (Platform connections)"`.
4. Dedupe: newest `social_posts` row with the same source column, `platform='linkedin'`, and
   `approval_status` NOT IN (`published`, `rejected`). If found → 200 `{ existingPostId }`, no job.
5. Else `createAiJob({ type: "social_agent_run", userId, input: { platform: "linkedin", blogPostId | newsletterId,
   siteUrl: SITE_URL, businessId: platformBusinessId() } })` → 202 `{ jobId }`.

Dedupe is check-then-enqueue, not atomic: two fast clicks can create two drafts. Acceptable (the owner deletes
one); the button disables itself while a request is in flight. Do not describe it as airtight.

## 5. Agent changes (approved)

`functions/src/social-agent.ts`:

- Input gains `newsletterId?: string` and `siteUrl?: string`. `blogPostId` and `newsletterId` are mutually
  exclusive; both set → fail the job with a clear message.
- Newsletter topic: load `newsletters` (subject, preview_text, content), strip HTML to text, and map into the
  same `BlogTopic` shape the copywriter consumes plus a `kind: "blog" | "newsletter"` discriminator. The brief
  scoring / `dont_do` guard applies to blog auto-picks only (unchanged); an explicit newsletter share skips it
  exactly as an explicit `blogPostId` override does today.
- Copywriter message: tells the writer a link card will be attached beneath the post, so it must NOT paste the
  URL or say "link below"; for newsletters, end with a short invitation to subscribe.
- Persist: the insert also writes the source column and the link fields, built by a pure, unit-tested helper
  `buildShareLink(topic, siteUrl)`:
  - blog → `link_url = ${siteUrl}/blog/${slug}`, `link_title = title`, `link_description = excerpt` (≤ 200
    chars, ellipsis), `link_image_url = cover_image_url` if https, else `${siteUrl}/images/gym-training-01.jpg`.
  - newsletter → `link_url = ${siteUrl}/#newsletter`, `link_title = subject`,
    `link_description = "Free newsletter from Darren Paul. Sign up to get the next issue."`,
    `link_image_url = ${siteUrl}/images/gym-training-01.jpg`.
  - no `siteUrl` (a job enqueued by older code) → all link fields null; source column still written.
- `app/api/admin/internal/social-agent-cron/route.ts` also passes `siteUrl`, so the scheduled agent's automatic
  blog posts get the card too (and `source_blog_post_id`).
- The agent's other platforms (when the cron runs without `platform`) also get the link fields written; only the
  LinkedIn plugin reads them in this piece (see §9).

## 6. Publishing (decided overnight)

- `PublishInput` gains `link?: { url; title; description: string | null; imageUrl: string | null }`.
- `buildPluginInput` sets `link` when `post.link_url` is set.
- LinkedIn plugin: when `input.link` is set and the post has no media → **article post**:
  1. If `imageUrl`: download → `initializeUpload` → PUT → wait AVAILABLE (existing image helpers) → thumbnail URN.
     If any step fails, log and post the article **without** a thumbnail rather than failing the post.
  2. `POST /rest/posts` with `content.article { source, title, description?, thumbnail? }`.
  If the post has media (image/video/carousel), media wins and the link is ignored (a post cannot carry both).
- **Little-text escaping** for every LinkedIn `commentary` (text, image, multi-image, video, article): backslash-
  escape `\ | { } @ [ ] ( ) < > * _ ~`, and `#` only when it does NOT start a hashtag (a `#` followed by a letter
  or digit is left alone, so `#strengthtraining` stays a hashtag). Pure helper `escapeLittleText`, unit-tested.

## 7. Manual Text posts (decided overnight)

- `ManualPostDialog`: the post-type picker is always shown. Options: Video and **Text** always; Photo, Carousel,
  Story only when `multimediaEnabled`.
- `POST /api/admin/content-studio/posts`: `text` is exempt from the multimedia flag; `text` requires a non-empty
  caption (400 `"Write the post text first"`). Text posts are supported on facebook + linkedin (existing matrix).

## 8. Decisions taken overnight (for the owner to review)

1. Newsletter card image = the site's default share image (`/images/gym-training-01.jpg`, the one `app/layout.tsx`
   uses) — newsletters have no image of their own.
2. Article thumbnail failure degrades to a card without image, never a failed post.
3. `#` before a word is NOT escaped (hashtags keep working); every other reserved char is.
4. Text posts no longer need `CS_MULTIMEDIA_ENABLED`. Photo/Carousel/Story still do.
5. Dedupe ignores `published` and `rejected` drafts; a `failed` one counts as existing (retry it instead).
6. No per-share platform choice: LinkedIn only (the owner's ask). The route takes no `platform`.

## 9. Out of scope

- Facebook link cards (FB would need its `link` param); the fields are written, FB ignores them.
- A public web page per newsletter issue (the owner chose the sign-up link).
- Giving `social_posts` a `business_id`.
- Automatic sharing on publish (the owner chose the button).

## 10. Testing

- Unit: `escapeLittleText`; `buildShareLink`; LinkedIn plugin article post (with thumbnail, thumbnail failure
  fallback, media-wins); `buildPluginInput` link passthrough; share route (auth, one-of ids, unpublished 409,
  not connected 409, dedupe hit returns existing and enqueues nothing, happy path enqueues with `siteUrl`);
  agent persist writes source + link fields for blog and newsletter and nulls without `siteUrl`;
  manual route text-without-flag + empty-caption refusal; dialog shows Text without the flag.
- Each new refusal test is paired with its positive control (repo convention).
- Migration applied to the dev clone; `npm run test:integration:selects` and `test:integration:drift` green.
- `tsc --noEmit` filtered to touched files; functions `tsc` for `functions/`.
- Annotated screenshots of the real admin (blog list + edit, newsletter, Social draft, manual Text) in
  `screenshots/share-to-linkedin/`. The share click is intercepted in Playwright so no real agent job fires
  from a dev server against the deployed function.

## 11. Rollout (held for the owner)

Order matters: apply `00283` to **production** before the code that writes the columns deploys, or the agent's
insert fails. Push to `main` deploys Vercel AND the functions (CI on `functions/**`). Both steps wait for the
owner's go-ahead.
