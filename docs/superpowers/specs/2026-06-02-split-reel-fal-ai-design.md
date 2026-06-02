# Split Reel — fal.ai b-roll + face-tracked dynamic reels

**Status:** Design approved 2026-06-02 (revised same day for dynamic/selective b-roll)
**Owner:** Solo (work directly on `main`)
**Feature flag:** `feature_split_reel_enabled` (system_settings, default `false`)

## Summary

Add a second rendered video layout — **Split Reel** — alongside the existing single-track
**Captioned Cut**. A Split Reel is a 1080×1920 vertical video with a **dynamic layout** driven
by the content:

- **Default — full-frame talking head:** the client's uploaded video fills the frame,
  **face-tracked** so the crop follows the speaker (Gaussian-smoothed, motion-preset controlled).
- **B-roll moments — two-row split:** at moments the AI decides are worth illustrating, the reel
  cuts to a two-row split — talking head in the **top half (1080×960)**, a **fal.ai text-to-video
  b-roll** clip in the **bottom half (1080×960)** — then cuts back to full-frame.

**B-roll is the exception, not the whole clip.** The AI reads the transcript and selects only the
moments that genuinely benefit from b-roll (concrete, visual concepts), bounded by a hard cap on
the number of b-roll windows. The reel uses the **full upload duration** for now; trimming to an
AI-picked highlight is a deferred future feature.

Everything else (word-by-word captions, optional hook card, brand bug, accent graphics, progress
bar, source audio, optional music) is reused from Captioned Cut. Captions run throughout, sitting
lower-third during full-frame and rising to the seam during split windows.

Generation is **two-phase** so the slow/costly fal.ai step is isolated, cached, retryable, and
previewable before the final render commits.

## Goals

- Produce a polished reel from a single talking-head upload with no manual editing.
- Keep the client's face well-framed at all times (active face tracking, in both layout modes).
- Add b-roll **only where it adds value** — the AI picks the moments; b-roll never blankets the
  whole reel.
- Use fal.ai to generate relevant b-roll for those moments, prompted from what the client says.
- Let the operator **preview and regenerate** b-roll clips before paying for a full render.
- Control cost: cheap no-audio model by default, a hard cap on b-roll windows, and caching so
  re-renders never re-pay fal.ai.

## Non-goals

- Picture-in-picture, overlay-sticker, or >2 row layouts (layout options C/D from brainstorming).
- AI voiceover, AI music, or AI avatars.
- **Highlight trimming** (AI-picked best moment or manual in/out) — deferred; v1 renders the full
  upload with selective b-roll.
- Replacing Captioned Cut — Split Reel is an additional layout, selected per render.

## Decisions (locked during brainstorming)

| Question | Decision |
| --- | --- |
| Final format | **Dynamic layout**: full-frame talking head by default, two-row split only at b-roll moments |
| Top content | Client talking head with **active face tracking** auto-reframe (both modes) |
| B-roll source | **Text-to-video** AI b-roll from fal.ai |
| B-roll content | **Auto from transcript** — AI prompts per selected moment |
| B-roll coverage | **Selective / dynamic** — AI chooses the moments; capped # of windows; never the whole clip |
| Reel length | **Full upload** for v1; highlight-trimming deferred |
| Architecture | **Approach 2** — two-phase: cached/retryable b-roll job → fast dynamic render job |
| B-roll review | **Preview + approve/regenerate** before final render |
| Caption position | Lower-third in full-frame; rises to the **seam** during split windows |
| Cost control | Hard cap on b-roll windows; dropped/over-cap moments **surfaced in UI**, never silent |
| Phasing | Prove the dynamic composition + face tracking first, then fal.ai, then preview UI |

## Architecture

### Pipeline overview (two-phase)

```
Upload → transcribe (existing AssemblyAI speech transcript)
   │
   ▼  operator picks "Split Reel" layout → "Generate b-roll"
[broll_generation ai_job]            (Firebase function — no GPU needed)
   • SELECT b-roll moments: Anthropic reads the transcript and returns the windows that
     warrant b-roll (concrete/visual concepts), each ~N seconds, capped at max_broll_windows
   • for each selected window: Anthropic writes a visual b-roll prompt
   • cache check first: hash(window_text + model + params) → reuse existing media_asset
   • fal.queue.submit(model, { input, webhookUrl }) per uncached window
   • webhook → download clip → Firebase Storage → media_asset (origin='ai_broll')
   • when every selected window is ready → job complete
   │
   ▼  operator reviews windows/clips in the panel, regenerates any, then "Render reel"
[split_reel_render ai_job]           (Cloud Run render-worker — Remotion, existing infra)
   • download source + the selected b-roll clips to /tmp
   • face-detect sampled frames → smoothed face trajectory (layout-agnostic)
   • build a LAYOUT TIMELINE: full-frame everywhere except the selected b-roll windows (split)
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
  a webhook handler finishes each window asynchronously.
- **`split_reel_render`** needs the Remotion renderer and ffmpeg, so it extends the existing
  **Cloud Run render-worker** (the same one that renders Captioned Cut).

### B-roll moment selection (the core of "not the whole clip")

A two-step Anthropic pass in the b-roll job:

1. **Select windows.** Given the transcript with word timings, return an ordered list of b-roll
   opportunities: `{ start_ms, end_ms, concept }`. The model is instructed to pick only moments
   where a concrete visual genuinely helps (named things, places, actions, metaphors) and to skip
   abstract/filler speech. Hard-capped at `split_reel_max_broll_windows`; if more qualify, keep
   the strongest and **surface the rest as dropped** (count + ranges) in the UI.
2. **Prompt each window.** For each selected window, write a concise visual prompt (+ a shared
   brand/style preamble so clips look consistent).

Windows are non-overlapping and spaced by a minimum gap so the layout doesn't flicker.

### fal.ai integration

- Client: `@fal-ai/client`, configured server-side with `FAL_KEY`.
- Calls used: `fal.queue.submit(endpointId, { input, webhookUrl })`, plus
  `fal.queue.status` / `fal.queue.result` as a polling fallback if a webhook is missed.
- Default model: a cheap **no-audio** text-to-video endpoint (we keep the client's voice from the
  source). Candidates: **LTX-2** (~$0.0018/megapixel) or **Kling 2.5 Turbo Pro** (~$0.07/s).
  Stored as a DB setting (`split_reel_broll_model`) so it can change without a deploy.
- Per the `functions/` ↔ `lib/` boundary, the fal helper for the b-roll job lives at
  `functions/src/lib/fal.ts`; if any fal call is also needed app-side, mirror as `lib/fal/*.ts`.

### Face tracking (render-worker, local — not fal.ai)

Per-frame face detection would be thousands of API calls, so detection runs **locally** in the
worker on the downloaded source video.

1. Sample frames at a fixed interval (e.g. every ~100 ms).
2. Run a local face detector (MediaPipe Tasks FaceDetector or BlazeFace) → bounding boxes.
3. Select the primary face (start simple: largest/most-central; active-speaker heuristic later).
4. Build a trajectory of face centers; **Gaussian-smooth** it (window = motion preset).
5. The trajectory is **layout-agnostic**; the crop window is derived per mode:
   - **Full-frame:** crop the source to 9:16 around the face filling 1080×1920.
   - **Split:** crop to keep the face framed within the top 1080×960 region.
6. Emit crop keyframes for each mode; Remotion `interpolate`s between them. Mode changes are quick
   cuts (optionally a 2–3 frame ease), not slow morphs.
7. Fallback: no face found → static center crop.

Motion presets map to smoothing-window size: `slower` (default, for talking heads), `default`,
`faster`.

## Components

### Remotion (`render-worker/src/remotion/`)
- **`SplitReel.tsx`** — new composition (1080×1920, 30fps). Reads a **layout timeline** prop and
  switches between full-frame and split sections; composes reused layers.
- **`TrackedVideo.tsx`** — wraps `OffthreadVideo`; applies the per-mode crop-keyframe transform
  for the talking head (full-frame fill vs top-half framing).
- **`BrollRow.tsx`** — renders the bottom half during split windows only; each window's clip in a
  `<Sequence>` timed to `start_ms`/`end_ms`, cover-fit, muted.
- **Reused:** `CaptionLayer` (with a `captionAnchor` that follows the active mode — lower-third
  vs seam), `HookCard`, `BrandBug`, `AccentGraphics`, `ProgressBar`, `AudioLayer`.
- **`Root.tsx`** — register the new `SplitReel` composition.

### Render-worker libs (`render-worker/src/lib/`)
- **`face-track.ts`** — sample → detect → select → smooth → trajectory. Pure, unit-testable math
  split from the I/O (frame extraction).
- **`layout-timeline.ts`** — build the ordered `{mode, start_ms, end_ms}` timeline from the
  selected b-roll windows over the full source duration. Pure.
- **`broll-fetch.ts`** — download the selected b-roll clips for a render to `/tmp`.
- Reuse `serve-file.ts`, `assemblyai-words.ts`, `caption-paging.ts`.

### B-roll generation (`functions/src/`)
- **`broll-selector.ts`** — Anthropic: transcript → selected b-roll windows `{start,end,concept}`
  (capped, min-gap, non-overlapping).
- **`broll-prompt.ts`** — Anthropic: window concept/text → concise visual prompt (+ style preamble).
- **`functions/src/lib/fal.ts`** — fal queue client wrapper (submit, status, result).
- **`broll-generation` handler** — select → cache-check → submit → mark pending.
- **fal webhook handler** — completion → download → store media_asset → update window; when all
  windows `ready`, mark the job complete.

### UI (`components/admin/content-studio/`)
- Extend **`CaptionedCutPanel.tsx`** (or a sibling `SplitReelPanel.tsx`) with:
  - a layout toggle: **Captioned Cut** | **Split Reel**;
  - a **b-roll strip**: per selected window → timestamp + concept, thumbnail/clip, the prompt
    (editable), a **Regenerate** button (new prompt/seed, re-submits just that window);
  - a **"Render reel"** button enabled once all windows are `ready`;
  - a banner when moments were dropped by the window cap (count + timestamps).
- Reuse `useAiJob`, render-progress subscription, signed playback.

### API routes (`app/api/admin/content-studio/split-reel/`)
All admin routes wrapped with `withAudit()`; add new action slugs to `lib/audit/actions.ts`.
- `POST .../broll` — enqueue `broll_generation` (validate `videoUploadId`, model, window params).
- `POST .../broll/regenerate` — regenerate one window (`segmentId`, optional new prompt/seed).
- `POST .../render` — enqueue `split_reel_render` (require all windows `ready`).
- `GET  .../split-reel` — current state: windows + clips + in-flight render job.
- `POST /api/admin/internal/fal-broll-webhook` — fal.ai completion callback (service-auth).

## Data model

### New table `broll_segments` (Supabase migration) — one row per selected b-roll window
| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `video_upload_id` | uuid fk → video_uploads | |
| `segment_index` | int | order within the reel |
| `start_ms`, `end_ms` | int | the window where the split + b-roll shows |
| `concept` | text | what the b-roll depicts (from the selector) |
| `prompt` | text | the (editable) visual prompt |
| `media_asset_id` | uuid fk → media_assets, null | the generated clip |
| `fal_request_id` | text, null | for status/result lookups |
| `cache_key` | text | hash(window_text + model + params) |
| `status` | text | `pending` \| `generating` \| `ready` \| `failed` \| `dropped` |
| `created_at`, `updated_at` | timestamptz | |

Unique index on `(video_upload_id, segment_index)`; index on `cache_key` for reuse lookups.

### Reused
- **`media_assets`** — b-roll clips and the final reel are rows here; add `ai_analysis.origin`
  values **`'ai_broll'`** and **`'split_reel'`** (alongside existing `'captioned_cut'`). Store
  `cache_key`, `segment_index`, `concept`, `prompt`, `fal_request_id` in `ai_analysis` for b-roll.
- **`social_post_media`** — final reel attaches to draft posts via existing `attach-plan`.

### Firestore ai_jobs
- New types: **`broll_generation`** and **`split_reel_render`** (status flow:
  `pending → processing → completed | failed`).

## Configuration (DB-backed, per project rule)

`system_settings` keys (admin-togglable, not env-driven):
- `feature_split_reel_enabled` — boolean, default `false`.
- `split_reel_broll_model` — fal endpoint id, default a cheap no-audio model.
- `split_reel_broll_window_seconds` — int, default `5` (length of each b-roll window).
- `split_reel_max_broll_windows` — int hard cap per reel (cost guard). Extra qualifying moments are
  marked `dropped` and **surfaced in the UI** (count + timestamps).
- `split_reel_min_gap_seconds` — int, default `4` (minimum spacing between b-roll windows so the
  layout doesn't flicker).

Secret: `FAL_KEY` → env + `.env.example` (and Firebase function config / Cloud Run env).

## Cost & latency notes

- Text-to-video is the dominant cost and wall-time, but selective b-roll means **only a few clips
  per reel** (capped), not one-per-segment-across-the-whole-video — much cheaper than always-split.
- Caching by `cache_key` makes re-renders and unchanged windows free.
- The window cap bounds worst-case spend per reel; regeneration is per-window, not whole-reel.

## Testing

- **Unit (pure):** b-roll window selection post-processing (cap, min-gap, non-overlap, drop list);
  prompt builder; `cache_key`; face-trajectory smoothing + per-mode crop interpolation; layout-
  timeline builder; caption-anchor-by-mode.
- **Integration:** fal webhook handler updates window + media_asset and completes the job when all
  windows are ready; regenerate replaces a single window's clip.
- **Render:** Remotion composition snapshot covering a full-frame→split→full-frame transition.
- **Manual E2E:** real talking-head upload → generate → preview → regenerate one → render → verify
  face stays framed in both modes, b-roll appears only at the selected moments, captions reposition.

## Phasing

1. **Render proof:** `SplitReel` composition with a layout timeline (full-frame ↔ split) +
   `TrackedVideo` face tracking, fed a manual/placeholder b-roll window. Proves the dynamic look
   and face framing in both modes.
2. **fal.ai generation:** `broll_generation` job (selector + prompts + fal queue + webhook) +
   caching + the `broll_segments` table.
3. **Preview/regenerate UI:** the b-roll strip in the panel, per-window regenerate, dropped-moment
   banner, then final-render gating.

All phases ship behind `feature_split_reel_enabled`.

## Open items / future

- **Highlight trimming** (deferred non-goal): AI-picked best moment(s) or manual in/out, so reels
  can be a true short cut of a long upload rather than the full duration.
- Active-speaker selection when multiple faces are present (Phase 1 uses largest/central).
- B-roll style consistency across windows (shared style preamble; consider seed reuse).
- Optional later: image-to-video or AI-images+Ken-Burns as cheaper b-roll modes (model is already
  pluggable via the DB setting).
- Transition polish between layout modes (hard cut vs short ease).
