# One-Click Reel — one button → finished reel (hook + captions + full-screen b-roll)

**Status:** Design approved 2026-06-03 (supersedes `2026-06-03-split-reel-fullscreen-broll-cutaway-design.md`, whose full-screen layout change is folded in as §2)
**Owner:** Solo (work directly on `main`)
**Feature flag:** `feature_split_reel_enabled` (existing)
**Scope:** render-worker + functions + app UI + a small DB migration. The Captioned Cut output is retired from the UI.

## Summary

Collapse the current multi-step video flow into **one button**. Today there are two outputs (Captioned Cut, Split Reel) and a 3-step b-roll flow (Generate b-roll → review → Render reel). Replace all of it with a single **"Create Reel"** action that produces one finished vertical reel containing:

- an **auto-written hook card** (editable),
- **word-by-word captions** (lower-third throughout),
- **full-screen b-roll cutaways** at AI-selected moments (the client's voice continuing over them),
- a **face-tracked talking head** the rest of the time.

**One composition handles everything.** The `SplitReel` composition rendered with **zero** b-roll windows is already just a face-tracked talking head + captions + hook — i.e. a captioned cut. So whether the AI picks 0 or 6 b-roll moments, there is a single output type and a single render path. The separate Captioned Cut button is retired.

The **`needs_edit` checkbox** (already on the upload form) becomes the per-video "do I want to review this first?" selector.

## Goals

- **One click** on a video produces a finished, post-ready reel — hook + captions + full-screen b-roll — with no intermediate manual steps.
- B-roll is **always** part of the reel (one output type). 0 selected moments → a clean captioned-style reel.
- The hook is **auto-generated but editable**; the operator can tweak it (and regenerate weak b-roll clips) and **re-render** (b-roll cached → no extra Kling spend).
- The `needs_edit` checkbox controls whether the reel is **immediately postable** or **held as an editable, posting-gated draft**.

## Non-goals

- Renaming "Split Reel" / `SplitReel` / `split_reel_*` settings / `broll_segments` (cosmetic churn across DB + functions + worker; defer; relabel UI text only).
- Music in the one-click path (stays off/optional, unchanged).
- Crossfade transitions between head and b-roll (hard cut for v1).
- A configurable split-vs-fullscreen layout toggle (rejected — YAGNI).
- Fully-automatic-on-upload (rejected — the operator chooses which videos via the button; cost/timing stay predictable).

## Current state

- **Two compositions:** `CaptionedCut` (SourceLayer full-frame, captions, optional hook — not face-tracked) and `SplitReel` (TrackedVideo + BrollRow two-row split + captions; in production it is **not** passed a hook).
- **3-step b-roll flow:** `POST /split-reel` enqueues `broll_generation`; the panel reviews/regenerates; `POST /split-reel/render` enqueues `split_reel_render`. `split_reel_auto_render` (default false) can auto-chain generation→render.
- **Edit gate:** `isVideoPostable(video, hasCut) = needs_edit === false || hasCut` ([postable.ts](lib/content-studio/postable.ts)). `needs_edit` defaults true on upload (checkbox *"Needs editing — gate from posting until a cut is rendered"*). `hasCut` today means a **captioned cut** exists.

## Design

### 1. One output, one composition

The reel is always rendered via the `SplitReel` composition. With 0 b-roll windows it is a full-frame face-tracked head + hook + captions; with N windows it cuts to full-screen b-roll at those moments. The `CaptionedCut` composition + its UI button are retired (composition code may remain temporarily; the no-b-roll case is covered by the reel). Every reel is therefore face-tracked (an improvement over the old non-tracked captioned cut).

### 2. Full-screen b-roll cutaway layout (Approach A — folded in from the layout spec)

At b-roll moments, cut to **full-frame** b-roll with the talking head hidden and **voice continuing**; cut back to the face-tracked head otherwise; captions stay lower-third throughout. Approach A keeps the audio-bearing talking-head element **always mounted** (voice never stops) and lets a full-frame b-roll layer paint over it only during windows. Render-worker edits (all in `render-worker/src/`):

- **`BrollRow.tsx`** → full-frame (`top:0, height:100%`); move the `backgroundColor:"black"` from the always-mounted wrapper **into each clip's `<Sequence>`** so it only paints during a window. (Also fixes a **latent bug**: today the wrapper's black bg covers the bottom half of the head even outside b-roll.) Keep `muted` + per-clip timing.
- **`TrackedVideo.tsx`** → always `height:"100%"` and always the `"full"` face crop (drop the split branch + `layout`/`mode` usage). Stays mounted ⇒ voice continuous. Do **not** add `muted`.
- **`CaptionLayer.tsx`** → `paddingBottom = 420` constant (drop the rise-to-seam `split ? 1020 : 420`). Backward-compatible with the retired captioned cut's call site.
- **`SplitReel.tsx`** → drop the now-unused `buildLayoutTimeline`/`layout` plumbing.
- `face-track.ts` / `layout-timeline.ts` keep passing unit tests; their unused `split` bits can be removed later.

Edge cases: b-roll clip load failure → black for that window (graceful); brand bug / progress bar / accent corners / captions overlay the full-screen b-roll (visible throughout); hard cut at window boundaries.

### 3. Hook in the reel

- The `SplitReel` composition already supports a `hook?:{text}` (renders `HookCard` for the first ~2s); the render just isn't passing it today.
- **Auto-generation:** the `broll_generation` job (functions, has the transcript + Anthropic) generates the hook via the existing suggest-hook logic and stores it on **`video_uploads.hook_text`** (new nullable column).
- **Render:** `runSplitReel` reads `hook_text` and passes `hook:{text}` into the composition.
- **Editable:** the panel edits `hook_text` (PATCH) and re-renders.

### 4. One-click pipeline ("Create Reel")

A single button on a video with a speech transcript runs the pipeline end-to-end:

```
Create Reel
  → suggest hook  → video_uploads.hook_text
  → broll_generation (Opus 4.8 select + Kling generate; 0 windows OK)
  → (auto) split_reel_render  → reel = hook + captions + full-screen b-roll + tracked head
  → attach to draft posts
```

- Auto-render is the **default behavior** of this pipeline (the `split_reel_auto_render` flag's gating is folded into the one-click path; effectively always-on for this button).
- The existing `POST /api/admin/content-studio/split-reel` is **extended** to kick off hook-suggest + b-roll + auto-render in one call (no new endpoint). The separate `POST .../split-reel/render` stays for the explicit **Re-render** action; it is removed from the happy-path UI.

### 5. The `needs_edit` checkbox as the per-video selector

| `needs_edit` (upload checkbox) | Behavior |
| --- | --- |
| **false** (unchecked / Mark ready) | Fully auto: reel renders and is **immediately postable**. |
| **true** (default) | Reel still renders (one click), but lands as an **editable, posting-gated draft**: tweak hook, regenerate clips, re-render, then **Mark ready** to release. |

**The catch fix (edit gate):** a rendered **reel must not auto-unblock posting**, or "checked" wouldn't hold anything.

- Posting gate becomes **`needs_edit === false`** for reels — do **not** wire a rendered reel into `isVideoPostable` as a cut.
- Retire the captioned-cut `hasCut` auto-unblock path and update the gate reason copy (drop "render a captioned cut" → "mark it ready"): [edit-gate.ts](lib/content-studio/edit-gate.ts), [postable.ts](lib/content-studio/postable.ts).
- Update [drawer-data.ts](lib/content-studio/drawer-data.ts)'s `hasCut`-based "postable while needs_edit" override so a reel no longer bypasses the gate.
- This ships **with** the redesign so today's captioned-cut behavior isn't changed prematurely.

### 6. Refine loop

After the reel renders, the panel shows the reel + an **editable hook field** + the b-roll windows (each regeneratable). Editing hook or a clip → **Re-render** (b-roll cached → render-only, no Kling spend). Mark ready releases the posting gate.

## Components by layer

- **App UI** (`components/admin/content-studio/...`): replace the multi-button Split Reel panel with one **Create Reel** button + editable hook + per-clip regenerate + Re-render + Mark ready; remove the separate Captioned Cut button. Update `VideoCard`/pipeline badges that referenced the captioned cut.
- **Functions** (`functions/src/`): in `broll-generation`, generate + persist the hook; always auto-chain `broll_generation → split_reel_render` ([on-ai-job-completed.ts](functions/src/on-ai-job-completed.ts)).
- **Render-worker** (`render-worker/src/`): §2 layout edits + read `hook_text` and pass the hook into the `SplitReel` composition.
- **DB:** migration `00165` — add `video_uploads.hook_text text null`. (No change to `broll_segments`.)

## Cost & timing

Every reel now spends ~$2 Kling + a few minutes (always-b-roll, by choice). The 6-window cap bounds worst-case spend; caching keeps re-renders render-only. 0 selected windows → no Kling spend, fast render.

## Backward compatibility & migration

- **Captioned Cut:** retired from the UI; existing rendered captioned-cut assets remain valid and attached. The gate change removes the `hasCut` auto-unblock — legacy videos relying on it become gated on `needs_edit` only (acceptable; they can be Marked ready).
- **`SplitReel` composition / `split_reel_*` names** unchanged internally; only the button label changes.

## Testing

- Existing `layout-timeline.test.ts` / `face-track.test.ts` stay green (untouched signatures/mode strings).
- Edit-gate predicate tests updated for the `needs_edit`-only rule.
- Composition smoke: render the `SplitReel` sample (full → full-screen cutaway → full) and verify hook card, full-screen b-roll, continuous voice, lower-third captions throughout, face-tracked head on return.
- Manual E2E: upload (box checked) → Create Reel → editable hook + gated draft → edit + re-render → Mark ready → postable; and (box unchecked) → immediately postable.

## Out of scope / future

- Crossfade transitions; caption scrim over busy b-roll.
- Removing dead `layout-timeline`/`split` crop code and the `CaptionedCut` composition.
- Renaming "Split Reel" → "Reel" across DB/functions.
- Optional music in the one-click path.
