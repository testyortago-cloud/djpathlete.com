# Content Studio Detail Views as Full Pages — Design Spec

**Date:** 2026-05-31
**Status:** Approved (user lgtm)

## Problem

Clicking a video (or post) in Content Studio opens a **700px right-side drawer**
([DetailDrawer.tsx](../../../components/admin/content-studio/DetailDrawer.tsx)) that
crams the video player, the "Make post"/"Mark as ready" actions, the Captioned Cut
panel, and a tabbed **Transcript / Posts / Meta** view into a narrow overlay. It's
cramped and hard to use, and the transcript/captions are hidden behind a tab. The
coach wants the detail view to be a **dedicated full page** with the
transcript/captions shown **inline**, including the rendered captioned cut when one
exists.

## Decision

Convert **both** detail views — video detail and manual-post detail — from the
overlay drawer to full pages, reusing the two routes that already exist. The drawer
(`DetailDrawer.tsx`) and its tab-switcher (`DrawerContent.tsx`) are removed. The
existing content components (`DrawerVideoHeader`, `TranscriptTab`, `PostsTab`,
`MetaTab`, `DrawerPostOnlyHeader`, `CaptionedCutPanel`, `MarkReadyButton`,
`GenerateQuoteCardsButton`) are **rearranged** into a two-column page layout — same
internals, so their behavior and tests carry over.

The video page uses a **two-column** layout (sticky left = 9:16 player + meta +
actions + Captioned Cut panel; scrolling right = Transcript/Captions, then Posts,
then a compact Meta), collapsing to a single stacked column on mobile.

## Routing (reuse existing routes, drop the overlay)

Both routes today render `{board underneath} + <DetailDrawer>`. They change to
render a full page and **stop fetching the board data** (pipeline/calendar), which
was only needed to paint the board behind the drawer.

- **[app/(admin)/admin/content/[videoId]/page.tsx](../../../app/(admin)/admin/content/[videoId]/page.tsx)**
  — `getDrawerData(videoId)` (unchanged; always `mode:"video"`) → render
  `<VideoDetailPage data={data} backHref={...} highlightPostId={postId ?? null} />`.
  Drop the `getPipelineData()` / `getCalendarData()` calls and the `underneath`
  switch.
- **[app/(admin)/admin/content/post/[postId]/page.tsx](../../../app/(admin)/admin/content/post/[postId]/page.tsx)**
  — `getDrawerDataForPost(postId)`. If `data.mode === "video"` (post has a source
  video) → `<VideoDetailPage>` with `highlightPostId = data.highlightPostId`. If
  `data.mode === "post-only"` → `<PostDetailPage data={data} backHref=... />`.
  Drop `getPipelineData()`.
- **Back target.** Preserve today's `closeHref` logic: read `?tab=` and build
  `/admin/content?tab=<shellTab>` (default `/admin/content`). This becomes the
  page's top-bar back link instead of the drawer's X / Escape handler.

No changes to `getDrawerData` / `getDrawerDataForPost` / `DrawerData` — the page
consumes the same shape.

## Components

New page components under `components/admin/content-studio/detail/`:

- **`VideoDetailPage.tsx`** (server-friendly; client bits stay in children) —
  the two-column shell for `mode:"video"`. Props: `{ data: DrawerData; backHref:
  string; highlightPostId: string | null }`.
  - **Top bar:** `← Back to {label}` link (label derived from `backHref`'s tab:
    Pipeline/Videos/Posts/Calendar), the title (`video.title ?? original_filename`),
    and `<MarkReadyButton videoUploadId={video.id} needsEdit={video.needs_edit} />`.
  - **Left column** (`lg:sticky lg:top-6 self-start`, full-width on mobile): the player +
    meta + actions + Captioned Cut. This is today's `DrawerVideoHeader` content;
    rename/move it to **`VideoDetailSidebar.tsx`** (same JSX: `<video>` preview,
    title/filename, date·duration·size, `GenerateQuoteCardsButton`,
    `CaptionedCutPanel`). `MarkReadyButton` moves up to the top bar (remove it from
    the sidebar to avoid duplication).
  - **Right column** (scrolls): section **"Transcript"** = `<TranscriptTab
    transcript={data.transcript} video={data.video} />`; section **"Posts (N)"** =
    `<PostsTab posts={data.posts} mediaByPost={data.mediaByPost}
    initialExpandedPostId={highlightPostId} />`; section **"Details"** = `<MetaTab
    video={data.video} transcript={data.transcript} posts={data.posts} />`. Each
    gets a lightweight section heading; no tab switching.
- **`PostDetailPage.tsx`** — single column for `mode:"post-only"`. Top bar with
  back link + "Manual post" title; body = `<PostsTab posts={data.posts}
  mediaByPost={data.mediaByPost} initialExpandedPostId={data.highlightPostId} />`
  and the compact `<MetaTab ... />`. Replaces `DrawerPostOnlyHeader` usage.

Removed after migration: `DetailDrawer.tsx`, `DrawerContent.tsx`,
`DrawerPostOnlyHeader.tsx` (folded into `PostDetailPage`). `DrawerVideoHeader.tsx`
is renamed to `VideoDetailSidebar.tsx` (content unchanged except dropping the
in-sidebar `MarkReadyButton`, which moves to the top bar).

## Layout details

- Container: full page width within the admin content area (no `max-w-[700px]`
  constraint). Two columns via `grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr]
  gap-6` (player column fixed-ish, content column flexes). Left column
  `lg:sticky lg:top-6 self-start` so the player stays in view while the transcript
  scrolls.
- The player keeps the existing `aspect-video bg-black` treatment (portrait video
  letterboxes inside, as today).
- Transcript section shows the full transcript text (today's `TranscriptTab`),
  always visible — no tab gate. When absent, `TranscriptTab`'s existing empty state
  shows.
- Captioned Cut: `CaptionedCutPanel` already GETs the latest rendered cut and plays
  it inline; reused as-is in the left column.

## Out of scope

- No change to the Captioned Cut render pipeline, the edit gate, or the pipeline
  board itself.
- No change to how cards link (they already point at `/admin/content/[videoId]`
  and `/admin/content/post/[postId]`).
- No new data fetching shape (`DrawerData` reused verbatim).
- The pipeline board's `?drawerTab=` deep-link param is retired for these views
  (the page shows all sections at once); leftover `drawerTab` in a URL is simply
  ignored.

## Testing

- **VideoDetailPage render test** (`__tests__/components/admin/content-studio/detail/VideoDetailPage.test.tsx`):
  given `mode:"video"` data → player present, transcript text present inline, a
  "Posts (N)" heading with N from `data.posts`, the Captioned Cut panel present
  (when `captionedCutEnabled`), and `MarkReadyButton` shown when `video.needs_edit`.
  Back link href matches the provided `backHref`.
- **PostDetailPage render test**: given `mode:"post-only"` data → post content +
  media present, NO transcript/player/captioned-cut.
- **Route smoke**: `[videoId]/page` returns the page (mock `getDrawerData`); 404
  when data is null. `post/[postId]/page` routes to video vs post-only by
  `data.mode` (mock `getDrawerDataForPost`).
- Reused component tests (`TranscriptTab`, `PostsTab`, `MetaTab`,
  `CaptionedCutPanel`, `MarkReadyButton`) continue to pass unchanged; update the
  `DrawerContent.test.tsx` / `DetailDrawer.test.tsx` suites (remove or repoint to
  the new pages, since those components are deleted).
- Component tests use Testing Library; route tests mock the `getDrawerData*` DAL
  (mirroring the existing route-test pattern).
