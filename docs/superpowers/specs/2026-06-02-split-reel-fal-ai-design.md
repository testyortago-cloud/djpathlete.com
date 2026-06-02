# Split Reel — fal.ai b-roll + face-tracked two-row cuts

**Status:** Design approved 2026-06-02
**Owner:** Solo (work directly on `main`)
**Feature flag:** `feature_split_reel_enabled` (system_settings, default `false`)

## Summary

Add a second rendered video layout — **Split Reel** — alongside the existing single-track
**Captioned Cut**. A Split Reel is a 1080×1920 vertical video with two stacked rows:

- **Top half (1080×960):** the client's uploaded talking-head video, **face-tracked** so the
  crop window follows the speaker's face (Gaussian-smoothed, motion-preset controlled).
- **Bottom half (1080×960):** a sequence of **fal.ai text-to-video b-roll** clips, one per
  transcript segment, muted and cover-fit, prompted **automatically from the transcript**.

Everything else (word-by-word captions, optional hook card, brand bug, accent graphics,
progress bar, source audio, optional music) is reused from Captioned Cut. Captions render on
the **seam** between the two rows.

Generation is **two-phase** so the slow/costly fal.ai step is isolated, cached, retryable, and
previewable before the final render commits.

## Goals

- Produce a polished two-row reel from a single talking-head upload with no manual editing.
- Keep the client's face well-framed in the top row even when they move (active face tracking).
- Use fal.ai to generate relevant b-roll for the bottom row, prompted from what the client says.
- Let the operator **preview and regenerate** b-roll clips before paying for a full render.
- Control cost: cheap no-audio model by default, a hard per-reel clip cap, and caching so
  re-renders never re-pay fal.ai.

## Non-goals

- Picture-in-picture, overlay-sticker, or >2 row layouts (layout options C/D from brainstorming).
- AI voiceover, AI music, or AI avatars.
- Editing/trimming the source video timeline (we crop+reframe, we don't cut).
- Replacing Captioned Cut — Split Reel is an additional layout, selected per render.

## Decisions (locked during brainstorming)

| Question | Decision |
| --- | --- |
| Final format | Two-row split (top + bottom), 1080×1920 |
| Top row | Client talking head with **active face tracking** auto-reframe |
| Bottom row | **Text-to-video** AI b-roll from fal.ai |
| B-roll content | **Auto from transcript** (AI prompts per segment) |
| Architecture | **Approach 2** — two-phase: cached/retryable b-roll job → fast split render job |
| B-roll review | **Preview + approve/regenerate** before final render |
| Caption position | On the **seam** (center) between the rows |
| Cost control | Hard per-reel clip cap; dropped segments **surfaced in UI**, never silently truncated |
| Phasing | Prove the render (composition + face tracking) first, then wire fal.ai, then preview UI |

## Architecture

### Pipeline overview (two-phase)

```
Upload → transcribe (existing AssemblyAI speech transcript)
   │
   ▼  operator picks "Split Reel" layout → "Generate b-roll"
[broll_generation ai_job]            (Firebase function — no GPU needed)
   • segment transcript into ~5s scenes
   • Anthropic turns each segment text into a visual b-roll prompt
   • fal.queue.submit(model, { input, webhookUrl }) per segment
   • cache check first: hash(segment_text + model + params) → reuse existing media_asset
   • webhook → download clip → Firebase Storage → media_asset (origin='ai_broll')
   • when every segment is ready → job complete
   │
   ▼  operator reviews clips in the panel, regenerates any, then "Render reel"
[split_reel_render ai_job]           (Cloud Run render-worker — Remotion, existing infra)
   • download source + all b-roll clips to /tmp
   • face-detect sampled frames → smoothed crop keyframes
   • bundle + render SplitReel composition → MP4 → Firebase Storage
   • media_asset (origin='split_reel') → attach to draft social posts (existing attach-plan)
   │
   ▼  live progress via Firebase RTDB (existing render-progress pattern)
       playable in the Content Studio drawer; "Cut" badge on the video
```

### Why two phases / two runtimes

- **`broll_generation`** is orchestration + waiting on fal.ai webhooks — no GPU, no Remotion.
  It runs as a **Firebase function** (cheap, event-driven), matching the existing
  "one ai_job per phase" pattern. fal.ai's queue + webhook means the function submits and exits;
  a webhook handler finishes each segment asynchronously.
- **`split_reel_render`** needs the Remotion renderer and ffmpeg, so it extends the existing
  **Cloud Run render-worker** (the same one that renders Captioned Cut).

### fal.ai integration

- Client: `@fal-ai/client`, configured server-side with `FAL_KEY`.
- Calls used: `fal.queue.submit(endpointId, { input, webhookUrl })`, plus
  `fal.queue.status` / `fal.queue.result` as a polling fallback if a webhook is missed.
- Default model: a cheap **no-audio** text-to-video endpoint (we keep the client's voice from
  the source). Candidates: **LTX-2** (~$0.0018/megapixel) or **Kling 2.5 Turbo Pro** (~$0.07/s).
  Stored as a DB setting (`split_reel_broll_model`) so it can change without a deploy.
- Per the `functions/` ↔ `lib/` boundary, the fal helper for the b-roll job lives at
  `functions/src/lib/fal.ts`; if any fal call is also needed app-side, mirror as `lib/fal/*.ts`.

### Face tracking (render-worker, local — not fal.ai)

Per-frame face detection would be thousands of API calls, so detection runs **locally** in the
worker on the downloaded source video.

1. Sample frames at a fixed interval (e.g. every ~100 ms).
2. Run a local face detector (MediaPipe Tasks FaceDetector or BlazeFace) → bounding boxes.
3. Select the primary face (start simple: largest/most-central; active-speaker heuristic later).
4. Build a trajectory of crop centers; **Gaussian-smooth** it (window = motion preset).
5. Emit crop keyframes `(frameIndex → {cropX, cropY, scale})`.
6. Pass keyframes as a composition prop; Remotion `interpolate`s between them.
7. Fallback: no face found → static center crop.

Motion presets map to smoothing-window size: `slower` (default, for interviews/talking heads),
`default`, `faster`.

## Components

### Remotion (`render-worker/src/remotion/`)
- **`SplitReel.tsx`** — new composition (1080×1920, 30fps). Composes the two rows + reused layers.
- **`TrackedVideo.tsx`** — wraps `OffthreadVideo`; applies the crop-keyframe transform for the
  top row (translate/scale interpolated from keyframes).
- **`BrollRow.tsx`** — sequences the b-roll clips in the bottom row, each in a `<Sequence>` timed
  to its segment `start_ms`/`end_ms`, cover-fit, muted.
- **Reused:** `CaptionLayer` (repositioned to the seam via a `captionAnchor` prop), `HookCard`,
  `BrandBug`, `AccentGraphics`, `ProgressBar`, `AudioLayer`.
- **`Root.tsx`** — register the new `SplitReel` composition.

### Render-worker libs (`render-worker/src/lib/`)
- **`face-track.ts`** — sample → detect → select → smooth → keyframes. Pure, unit-testable math
  split from the I/O (frame extraction).
- **`broll-fetch.ts`** — download the ordered b-roll clips for a render to `/tmp`.
- Reuse `serve-file.ts`, `assemblyai-words.ts`, `caption-paging.ts`.

### B-roll generation (`functions/src/`)
- **`transcript-segmenter.ts`** — group caption pages/word-timings into ~`N`-second segments.
- **`broll-prompt.ts`** — Anthropic: segment text → concise visual b-roll prompt
  (+ a brand/style preamble so clips look consistent).
- **`functions/src/lib/fal.ts`** — fal queue client wrapper (submit, status, result).
- **`broll-generation` handler** — segment → cache-check → submit → mark pending.
- **fal webhook handler** — receives completion → download → store media_asset → update segment;
  when all segments `ready`, mark the job complete.

### UI (`components/admin/content-studio/`)
- Extend **`CaptionedCutPanel.tsx`** (or a sibling `SplitReelPanel.tsx`) with:
  - a layout toggle: **Captioned Cut** | **Split Reel**;
  - a **b-roll strip**: per segment → thumbnail/clip, the auto prompt (editable), a
    **Regenerate** button (new prompt/seed, re-submits just that segment);
  - a **"Render reel"** button enabled once all segments are `ready`;
  - a banner when segments were dropped by the clip cap (count + which).
- Reuse `useAiJob`, render-progress subscription, signed playback.

### API routes (`app/api/admin/content-studio/split-reel/`)
All admin routes wrapped with `withAudit()`; add new action slugs to `lib/audit/actions.ts`.
- `POST .../broll` — enqueue `broll_generation` (validate `videoUploadId`, model, segment params).
- `POST .../broll/regenerate` — regenerate one segment (`segmentId`, optional new prompt/seed).
- `POST .../render` — enqueue `split_reel_render` (require all segments `ready`).
- `GET  .../split-reel` — current state: segments + clips + in-flight render job.
- `POST /api/admin/internal/fal-broll-webhook` — fal.ai completion callback (service-auth).

## Data model

### New table `broll_segments` (Supabase migration)
| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `video_upload_id` | uuid fk → video_uploads | |
| `segment_index` | int | order within the reel |
| `start_ms`, `end_ms` | int | timing within the source/reel |
| `prompt` | text | the (editable) visual prompt |
| `media_asset_id` | uuid fk → media_assets, null | the generated clip |
| `fal_request_id` | text, null | for status/result lookups |
| `cache_key` | text | hash(segment_text + model + params) |
| `status` | text | `pending` \| `generating` \| `ready` \| `failed` \| `dropped` |
| `created_at`, `updated_at` | timestamptz | |

Unique index on `(video_upload_id, segment_index)`; index on `cache_key` for reuse lookups.

### Reused
- **`media_assets`** — b-roll clips and the final reel are rows here; add
  `ai_analysis.origin` values **`'ai_broll'`** and **`'split_reel'`** (alongside existing
  `'captioned_cut'`). Store `cache_key`, `segment_index`, `prompt`, `fal_request_id` in
  `ai_analysis` for b-roll clips.
- **`social_post_media`** — final reel attaches to draft posts via existing `attach-plan`.

### Firestore ai_jobs
- New types: **`broll_generation`** and **`split_reel_render`** (same status flow:
  `pending → processing → completed | failed`).

## Configuration (DB-backed, per project rule)

`system_settings` keys (admin-togglable, not env-driven):
- `feature_split_reel_enabled` — boolean, default `false`.
- `split_reel_broll_model` — fal endpoint id, default a cheap no-audio model.
- `split_reel_seconds_per_segment` — int, default `5`.
- `split_reel_max_broll_clips` — int hard cap per reel (cost guard). When the transcript would
  exceed it, the extra segments are marked `dropped` and **surfaced in the UI** (count + ranges).

Secret: `FAL_KEY` → env + `.env.example` (and Firebase function config / Cloud Run env).

## Cost & latency notes

- Text-to-video is the dominant cost and wall-time. A 30–60s reel ≈ 4–8 segments; at a cheap
  no-audio model that's roughly $1–3 and a few minutes of generation per reel.
- Caching by `cache_key` makes re-renders and unchanged segments free.
- The clip cap bounds worst-case spend per reel; regeneration is per-segment, not whole-reel.

## Testing

- **Unit (pure):** transcript → segments; prompt builder; `cache_key`; face-trajectory smoothing
  and crop interpolation math; clip-cap/drop logic.
- **Integration:** fal webhook handler updates segment + media_asset and completes the job when
  all segments are ready; regenerate replaces a single segment's clip.
- **Render:** Remotion composition snapshot / a short real render behind the flag.
- **Manual E2E:** real talking-head upload → generate → preview → regenerate one → render →
  verify framing tracks the face and b-roll aligns to segments.

## Phasing

1. **Render proof:** `SplitReel` composition + `TrackedVideo` face tracking, fed a manual or
   placeholder b-roll clip. Validates the two-row look and face framing end-to-end.
2. **fal.ai generation:** `broll_generation` job (segmenter + Anthropic prompts + fal queue +
   webhook) + caching + the `broll_segments` table.
3. **Preview/regenerate UI:** the b-roll strip in the panel, per-segment regenerate, clip-cap
   banner, then final-render gating.

All phases ship behind `feature_split_reel_enabled`.

## Open items / future

- Active-speaker selection when multiple faces are present (Phase 1 uses largest/central).
- B-roll style consistency across segments (shared style preamble; consider seed reuse).
- Optional later: image-to-video or AI-images+Ken-Burns as cheaper b-roll modes (model is
  already pluggable via the DB setting).
