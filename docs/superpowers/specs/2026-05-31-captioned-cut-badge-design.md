# Captioned-Cut Badge on Video Cards — Design Spec

**Date:** 2026-05-31
**Status:** Approved (user lgtm)

## Problem

In the Content Studio Videos lane, a video lands in the **"Generated"** column the
moment it has any draft social post ([pipeline-columns.ts:25-31](../../../lib/content-studio/pipeline-columns.ts)).
Both outputs create such posts — the text-caption fan-out (from the transcript)
**and** the captioned cut (the rendered 9:16 video). So a video with a rendered
cut looks **identical** to one with only text captions. There's no way to tell, at
a glance, which kind of output a video has.

## Decision

This is a **display** problem, not a status/data-model problem — the distinction
already exists in the data. Surface it with a small badge on the video card. Do
**not** add a new pipeline column (breaks the one-column-per-video model — a video
can have both cut + text posts) or a new `VideoUploadStatus` (needs a migration the
column logic derives-from-posts would ignore).

## Existing data we key off

Every captioned cut writes a `media_assets` row with:
- `ai_analysis->>'origin' = 'captioned_cut'`
- `derived_from_video_id = <video id>`

Text-caption fan-out never sets that origin. Verified the filter SQL runs cleanly
(returns 0 today — no cut has rendered yet, but the query is valid):
`select count(*) from media_assets where ai_analysis->>'origin' = 'captioned_cut'`.

## Changes (three small, isolated)

1. **DAL** — `listCaptionedCutVideoIds(): Promise<Set<string>>` in
   [lib/db/media-assets.ts](../../../lib/db/media-assets.ts):
   selects `derived_from_video_id` from `media_assets` where
   `ai_analysis->>'origin' = 'captioned_cut'` and `derived_from_video_id` is not
   null, deduped into a `Set<string>`.

2. **Pipeline data** — add the query to the existing `Promise.all` in
   `getPipelineData()` ([lib/content-studio/pipeline-data.ts](../../../lib/content-studio/pipeline-data.ts))
   and expose `cutVideoIds: Set<string>` on `PipelineData`. Thread it through
   `PipelineBoard → VideosLane → VideoCard`.

3. **VideoCard** — when `hasCut` is true, render a small **🎬 Cut** chip
   (Clapperboard icon, accent style) next to the duration row. Purely additive;
   nothing else moves. Add an optional `hasCut?: boolean` prop (default false).

## Threading note

`PipelineBoard` runs `applyFilters` over videos/posts and rebuilds the `data`
object it passes to `VideosLane`. `cutVideoIds` is a flat Set keyed by video id —
it is filter-independent, so it passes straight through unchanged (spread with the
rest of `initialData`).

## Testing

- **DAL unit test** (`__tests__/db/media-assets-cut-ids.test.ts`): insert a
  `captioned_cut` asset → its `derived_from_video_id` is in the returned Set;
  insert a non-cut asset (e.g. `origin: 'quote_card'` or null) → its video id is
  NOT in the Set; no cut assets → empty Set. Real Supabase, TAG-prefixed cleanup
  (mirrors existing media-assets / video-uploads DB tests).
- **VideoCard render test** (`__tests__/components/admin/content-studio/pipeline/VideoCard-cut.test.tsx`):
  `hasCut` true → "Cut" chip present; `hasCut` false/omitted → absent.

## Out of scope (this round)

Videos **list** view, post cards, and the video drawer. Badge on the **pipeline
VideoCard only** (user's call). No migration, no worker change, no new status.
