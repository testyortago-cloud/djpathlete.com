# Split Reel — full-screen b-roll cutaways (replace the two-row split)

**Status:** Design approved 2026-06-03
**Owner:** Solo (work directly on `main`)
**Feature flag:** `feature_split_reel_enabled` (existing; this is a behavior change *within* Split Reel — no new flag)
**Scope:** `render-worker/` only (the Remotion `SplitReel` composition + its children). No DB, functions, API, or app changes.

## Summary

Today a Split Reel renders b-roll moments as a **two-row split** — talking head squeezed into the top half (1080×960), b-roll in the bottom half (1080×960). Change it to the **classic reel look**: the face-tracked talking head fills the whole frame by default, and at each AI-selected b-roll moment the reel **cuts to full-screen b-roll** (1080×1920) with the talking head hidden while **the client's voice keeps playing over it**, then cuts back to the talking head. Word-by-word captions stay **lower-third throughout** (no more rise-to-seam).

This is purely a rendering/layout change in the `SplitReel` Remotion composition. The b-roll generation pipeline (selection, prompts, fal/Kling submission, caching, the `broll_segments` table, the render gate, the review panel) is unchanged. The **Captioned Cut** composition is a separate, untouched output.

## Background — how the split is produced today

Three cooperating pieces in `render-worker/src/remotion/`, all keyed off the layout-timeline mode string `"split"` (vs `"full"`):

- **`TrackedVideo.tsx`** — the talking head. `height: mode === "split" ? "50%" : "100%"` ([TrackedVideo.tsx:27](render-worker/src/remotion/TrackedVideo.tsx#L27)) shrinks it to the top half during b-roll. Its `<OffthreadVideo src={videoSrc}>` is **unmuted and carries the client's voice** — there is no separate voice track (`AudioLayer` only adds music/SFX).
- **`BrollRow.tsx`** — b-roll pinned to the bottom half via `<AbsoluteFill style={{ top:"50%", height:"50%", backgroundColor:"black" }}>` ([BrollRow.tsx:19](render-worker/src/remotion/BrollRow.tsx#L19)); each clip is a muted `<OffthreadVideo>` inside a `<Sequence>` timed to its window.
- **`CaptionLayer.tsx`** — `paddingBottom = mode === "split" ? 1020 : 420` ([CaptionLayer.tsx:29](render-worker/src/remotion/CaptionLayer.tsx#L29)) lifts captions above the seam during b-roll.

`SplitReel.tsx` computes `layout = buildLayoutTimeline(broll, totalMs)` once and threads it into `TrackedVideo` and `CaptionLayer`. Z-order (back→front): `AudioLayer → TrackedVideo → BrollRow → AccentGraphics → CaptionLayer → HookCard? → ProgressBar → BrandBug`. Crucially, **`BrollRow` paints above `TrackedVideo`**.

### Latent bug found during design

`BrollRow`'s wrapper sets `backgroundColor:"black"` on an `<AbsoluteFill>` that is **always mounted**, so it paints a black bottom-half over the talking head **even outside b-roll windows** — contradicting the file's own comment ("Outside every window nothing renders here, so the talking head … shows through"). Split Reel is days old and was never rendered end-to-end with real content (content was wiped 2026-06-03), so this was never caught. The redesign fixes it by moving the black background *inside* each clip's `<Sequence>`.

## Goals

- At AI-selected moments, cut to **full-screen (1080×1920) b-roll** with the talking head hidden.
- **The client's voice continues** over the b-roll (b-roll itself stays muted).
- Cut back to the **full-frame, face-tracked** talking head between b-roll moments.
- **Captions stay lower-third** the whole time, legible over full-screen b-roll.
- Keep brand bug, progress bar, and accent corners visible throughout (brand consistency).
- Fix the latent always-black-bottom-half bug.

## Non-goals

- Renaming "Split Reel" / `SplitReel` / `split_reel_*` settings / `broll_segments` (cosmetic churn across DB + functions + worker; defer; optionally relabel UI text only).
- Crossfade transitions (v1 is a hard cut; a 2–3 frame ease is a later polish).
- A configurable split-vs-fullscreen toggle (rejected — YAGNI).
- Any change to b-roll generation, captions content, face detection, or the Captioned Cut.

## Approach

**Chosen: Overlay (Approach A).** Keep the talking head **always full-frame and always mounted** so its audio never stops, and make b-roll a **full-frame layer that only paints during its windows**. The existing z-order (b-roll above the head) means b-roll naturally covers the face during a cutaway and reveals it otherwise. The voice — which rides on the always-mounted talking-head element — is never interrupted, so "voice continues over b-roll" requires **no audio changes at all**.

**Rejected alternatives:**

- **B — Hide head + decouple voice into a separate `<Audio src={videoSrc}>`.** More "textbook" separation and avoids the face peeking if a b-roll clip fails to load, but it re-architects audio (introduces a double-audio failure mode) to handle a rare corner case. More code, more risk, no real benefit over A.
- **C — Make layout a per-render setting (split | full-screen).** Keeps both looks. More UI, a new DB setting, more surface for a feature nobody requested. YAGNI.

## Detailed design (Approach A)

All edits are in `render-worker/src/`. The `SplitReel` composition and its children change; everything else (b-roll job, DB, app, Captioned Cut) is untouched.

### 1. `BrollRow.tsx` — full-frame, window-scoped black background
- Wrapper `<AbsoluteFill>`: drop `top:"50%"` and `height:"50%"` (→ full 1080×1920) and **remove the persistent `backgroundColor:"black"`** so the layer is transparent outside windows.
- Each clip's `<Sequence>` wraps a full-frame `<AbsoluteFill style={{ backgroundColor:"black" }}>` containing the existing muted, `objectFit:"cover"` `<OffthreadVideo>`. So during a window the frame is opaque (black bg covers any letterboxing + the clip on top); outside windows nothing paints and the talking head shows through.
- Per-clip `<Sequence from/durationInFrames>` timing is unchanged.

### 2. `TrackedVideo.tsx` — always full-frame, always full crop
- Wrapper: always `height:"100%"` (remove the `mode === "split" ? "50%" : "100%"` ternary).
- Always use the `"full"` crop: call `cropForMode(face, "full")` (drop the `modeAtMs`/`layout` lookup). `cropForMode`'s signature is unchanged, so `face-track.ts` and `face-track.test.ts` stay green; the `split` entries in `ANCHOR_Y`/`BASE_SCALE` simply go unused.
- The element stays mounted for the whole reel ⇒ **the voice plays continuously**. Do **not** add `muted` here.
- `TrackedVideoProps.layout` is no longer used; remove it from the prop type and the call site.

### 3. `CaptionLayer.tsx` — constant lower-third
- `const paddingBottom = 420` (remove the `mode === "split" ? 1020 : 420` branch and the `modeAtMs`/`layout` usage).
- Remove the now-unused `layout?` prop (or leave it ignored). **Backward-compatible with Captioned Cut**, which already renders captions at 420 because it passes no `layout`.
- Update the stale "rise to the seam" comment.

### 4. `SplitReel.tsx` — drop the unused layout plumbing
- Remove `buildLayoutTimeline(...)`/`layout` computation and stop passing `layout` to `TrackedVideo` and `CaptionLayer` (both are now mode-agnostic).
- Children order and the other layers (AudioLayer, AccentGraphics, CaptionLayer, ProgressBar, BrandBug) are unchanged; they now overlay full-screen b-roll, which is the desired brand-consistent look.

### 5. `Root.tsx` — comment only
- Update the `SPLIT_SAMPLE` comment that describes "split (b-roll) 3–6s" to describe the full-screen cutaway. No prop change (the sample's `broll` window already marks the cutaway).

### Left as-is (now-unused, removed in a follow-up if desired)
- `layout-timeline.ts` (`buildLayoutTimeline`/`modeAtMs`/`LayoutMode`) becomes unused by the render path but keeps its passing unit tests. `face-track.ts`'s `split` crop constants go unused. Leaving these avoids churn and keeps the change focused on visible behavior; a later cleanup PR can delete them.

## Rendering behavior (resulting timeline)

- **Outside b-roll windows:** full-frame face-tracked talking head (full crop), lower-third captions, brand bug / progress bar / accent corners, voice + (any) music.
- **During a b-roll window:** full-screen b-roll (muted) covers the head; **voice keeps playing** from the still-mounted head element; captions stay lower-third over the b-roll; brand overlays remain on top.
- **Transition:** hard cut at the window's `start_ms`/`end_ms` (the `<Sequence>` boundaries).

## Edge cases

- **b-roll clip fails to load:** the `<Sequence>`'s black `<AbsoluteFill>` shows black for that window (graceful) — never a half-broken or face-peeking frame.
- **Caption legibility over busy b-roll:** captions already have a heavy stroke + shadow; expected fine. A subtle scrim behind captions is optional later polish, not v1.
- **Frame-boundary parity:** the head is always full-frame and merely covered, so there's no top-half/full-frame geometry to flicker at window edges; only the clean hard cut remains.

## Backward compatibility

- **Captioned Cut** (`CaptionedCut.tsx`, composition id `"CaptionedCut"`) is a separate composition with no `BrollRow`/`TrackedVideo`/layout; it is not touched. The shared `CaptionLayer` change is safe because Captioned Cut already gets the 420 lower-third (it passes no `layout`).
- Both attach to the same draft posts via `planCutAttachment`; that logic is unchanged.

## Testing

- **Existing unit tests stay green:** `layout-timeline.test.ts` and `face-track.test.ts` are untouched (we keep `cropForMode`'s signature and the mode strings).
- **Composition smoke:** render the `SplitReel` Studio sample (`SPLIT_SAMPLE`, full→cutaway→full over 10s) and verify: full-screen b-roll at 3–6s, talking head hidden then back, audio continuous, captions lower-third throughout, brand overlays visible.
- **Manual E2E:** a real talking-head upload → Generate b-roll (Kling) → Render reel → confirm full-screen cutaways, continuous voice, captions, and a face-tracked head on return.

## Deployment

- The change is in the **render-worker** (Cloud Run Job). It ships by rebuilding + redeploying the render-worker image; no DB migration, no functions/app deploy required for this change. (Separately, the pending Kling `duration`-as-string fix still needs its functions/app deploy.)

## Out of scope / future

- Crossfade / ease transitions between head and b-roll.
- Optional caption scrim for busy b-roll backgrounds.
- Removing the now-dead `layout-timeline` plumbing + `split` crop constants.
- Renaming "Split Reel" → a more accurate user-facing label.
