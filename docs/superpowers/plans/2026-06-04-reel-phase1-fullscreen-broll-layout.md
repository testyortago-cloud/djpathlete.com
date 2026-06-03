# Reel Phase 1 — Full-Screen B-roll Cutaway Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the `SplitReel` Remotion composition so b-roll moments render as **full-screen cutaways** (b-roll fills the whole 1080×1920 frame, talking head hidden, voice continues) instead of a two-row split, with captions staying lower-third throughout.

**Architecture:** Approach A (overlay) — keep the talking head **always full-frame and always mounted** (the unmuted `<OffthreadVideo>` carries the voice, so it must never unmount), and make `BrollRow` a **full-frame layer that only paints during its `<Sequence>` windows**. Because `BrollRow` already paints above `TrackedVideo` in the z-order, full-frame b-roll naturally covers the head during a window and reveals it otherwise. Captions become a constant lower-third anchor. This also fixes a latent bug where `BrollRow`'s always-mounted black background covered the bottom half of the head outside b-roll windows.

**Tech Stack:** Remotion 4 (React 19) in `render-worker/`, TypeScript (NodeNext ESM, `.js` import suffixes), Vitest for the pure-lib regression tests.

**Spec:** `docs/superpowers/specs/2026-06-03-one-click-reel-design.md` (§2). This plan is Phase 1 of 3; Phases 2 (hook in the reel) and 3 (one-click pipeline + edit-gate selector) get their own plans after this lands.

**Testing note:** These are declarative Remotion composition (JSX) changes with **no new pure logic**, so classic red-green TDD doesn't cleanly apply. We guard correctness with: (a) the **untouched** `layout-timeline`/`face-track` unit tests still passing (regression), (b) a clean `tsc` build (catches type/unused-import errors from removing the `layout` plumbing), and (c) a Remotion Studio visual check against the built-in `SPLIT_SAMPLE` (which has a 3–6s b-roll window). Forcing brittle pixel assertions on a composition would be poor test design.

**Working directory for all commands:** `render-worker/` (run `cd render-worker` once, or prefix commands). All file paths below are repo-relative.

---

## File Structure

Files modified (all in `render-worker/src/remotion/`):

- `BrollRow.tsx` — b-roll layer. Becomes full-frame; black background moves into each per-clip `<Sequence>` so it only paints during a window.
- `TrackedVideo.tsx` — talking head. Always full-frame + always the `"full"` face crop; stays mounted (voice continuous). Drops the `layout`/`mode` plumbing.
- `CaptionLayer.tsx` — captions. Constant lower-third (`paddingBottom = 420`); drops the `layout`/rise-to-seam plumbing.
- `SplitReel.tsx` — composition root. Stops computing/passing `layout` to its children.
- `Root.tsx` — update the stale `SPLIT_SAMPLE` explanatory comment (cosmetic).

Left untouched: `layout-timeline.ts` + `layout-timeline.test.ts`, `face-track.ts` + `face-track.test.ts` (their `split` mode/crop entries simply become unused), `AudioLayer.tsx`, `AccentGraphics.tsx`, `ProgressBar.tsx`, `BrandBug.tsx`, `HookCard.tsx`, `CaptionedCut.tsx` (separate composition).

---

## Task 1: Baseline — confirm build + tests are green before changes

**Files:** none (verification only)

- [ ] **Step 1: Install deps if needed and run the existing tests**

Run: `cd render-worker && npm test`
Expected: PASS — `layout-timeline.test.ts` and `face-track.test.ts` green (these stay untouched all plan; this is the regression baseline).

- [ ] **Step 2: Confirm a clean build baseline**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0 (no type errors). This is the baseline the later steps must preserve.

---

## Task 2: `BrollRow` → full-frame, window-scoped black background

**Files:**
- Modify: `render-worker/src/remotion/BrollRow.tsx`

- [ ] **Step 1: Replace the bottom-half wrapper with a full-frame, transparent container and move the black background inside each clip's `<Sequence>`**

Replace the entire file contents with:

```tsx
// render-worker/src/remotion/BrollRow.tsx
import { AbsoluteFill, OffthreadVideo, Sequence, useVideoConfig } from "remotion"

// One selected b-roll window: the time range it occupies in the reel + its clip.
export type BrollClip = { startMs: number; endMs: number; src: string }

export type BrollRowProps = {
  clips: BrollClip[]
}

// Full-screen b-roll cutaway. The outer layer is full-frame and TRANSPARENT, so
// outside every window nothing paints here and the talking head shows through.
// During a window the clip's <Sequence> paints a full-frame black backing + the
// muted, cover-fit clip on top — covering the head (which keeps playing audio
// underneath). The voice comes from the talking head, so each clip stays MUTED.
export function BrollRow({ clips }: BrollRowProps) {
  const { fps } = useVideoConfig()
  const msToFrames = (ms: number) => Math.round((ms / 1000) * fps)

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {clips.map((clip, i) => {
        const from = msToFrames(clip.startMs)
        const duration = Math.max(1, msToFrames(clip.endMs) - from)
        return (
          <Sequence key={i} from={from} durationInFrames={duration} name={`broll-${i}`}>
            <AbsoluteFill style={{ backgroundColor: "black" }}>
              <OffthreadVideo
                src={clip.src}
                muted
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </AbsoluteFill>
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
```

- [ ] **Step 2: Build to confirm it compiles**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 3: Run tests (regression guard)**

Run: `cd render-worker && npm test`
Expected: PASS (unchanged — these cover the untouched libs).

- [ ] **Step 4: Commit**

```bash
git add render-worker/src/remotion/BrollRow.tsx
git commit -m "feat(reel): render b-roll full-frame; scope black bg to each window

Fixes the latent bug where BrollRow's always-mounted black background
covered the bottom half of the talking head outside b-roll windows."
```

---

## Task 3: `TrackedVideo` → always full-frame, always full crop (drop layout)

**Files:**
- Modify: `render-worker/src/remotion/TrackedVideo.tsx`

- [ ] **Step 1: Remove the `layout`/`mode` plumbing; always render full-frame with the `"full"` crop**

Replace the entire file contents with:

```tsx
// render-worker/src/remotion/TrackedVideo.tsx
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion"
import { faceAtMs, cropForMode, type FacePoint } from "../lib/face-track.js"

export type TrackedVideoProps = {
  videoSrc: string
  trajectory: FacePoint[]
}

// The talking head. Always fills the frame, face-tracked via the smoothed
// trajectory. It is ALWAYS mounted and UNMUTED — this element carries the
// client's voice, which must keep playing even while a full-screen b-roll clip
// is painted over it (BrollRow paints above this layer during its windows).
// AudioLayer only adds music/SFX.
export function TrackedVideo({ videoSrc, trajectory }: TrackedVideoProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const face = faceAtMs(trajectory, ms)
  const crop = cropForMode(face, "full")

  return (
    <AbsoluteFill
      style={{
        top: 0,
        height: "100%",
        overflow: "hidden",
        backgroundColor: "black",
      }}
    >
      <OffthreadVideo
        src={videoSrc}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${crop.scale}) translate(${crop.translateXPct}%, ${crop.translateYPct}%)`,
          transformOrigin: "center",
        }}
      />
    </AbsoluteFill>
  )
}
```

> Note: this removes the `layout` prop and the `modeAtMs`/`LayoutSegment` imports. `cropForMode`'s signature is unchanged (we just always pass `"full"`), so `face-track.ts` and its test stay untouched. `SplitReel.tsx` still passes `layout` to `TrackedVideo` at this point — that mismatch is fixed in Task 5, so **do not run the build between Task 3 and Task 5**; build after Task 5.

---

## Task 4: `CaptionLayer` → constant lower-third (drop layout)

**Files:**
- Modify: `render-worker/src/remotion/CaptionLayer.tsx`

- [ ] **Step 1: Replace the import line that pulls in the layout helper**

In `render-worker/src/remotion/CaptionLayer.tsx`, change:

```tsx
import type { CaptionPage } from "../lib/caption-paging.js"
import { modeAtMs, type LayoutSegment } from "../lib/layout-timeline.js"
```

to:

```tsx
import type { CaptionPage } from "../lib/caption-paging.js"
```

- [ ] **Step 2: Drop the `layout` prop from the props type**

Change:

```tsx
export type CaptionLayerProps = {
  pages: CaptionPage[]
  accentHex: string
  // When provided (Split Reel), captions rise to the seam during split windows.
  // Omitted (Captioned Cut) → always lower-third, unchanged behavior.
  layout?: LayoutSegment[]
}

export function CaptionLayer({ pages, accentHex, layout }: CaptionLayerProps) {
```

to:

```tsx
export type CaptionLayerProps = {
  pages: CaptionPage[]
  accentHex: string
}

export function CaptionLayer({ pages, accentHex }: CaptionLayerProps) {
```

- [ ] **Step 3: Replace the mode-driven anchor with a constant lower-third anchor**

Change:

```tsx
  // Lower-third by default; during a split window lift captions to just above the
  // seam (frame is 1920 tall; seam at 960) so they clear the b-roll row.
  const mode = layout ? modeAtMs(layout, ms) : "full"
  const paddingBottom = mode === "split" ? 1020 : 420
```

to:

```tsx
  // Captions sit lower-third throughout — including over full-screen b-roll
  // cutaways (no more rise-to-seam, since there is no longer a split row).
  const paddingBottom = 420
```

> Note: `ms` is still used below (page selection + active-word timing), so it stays. As with Task 3, `SplitReel.tsx` still passes `layout` here until Task 5 — build after Task 5.

---

## Task 5: `SplitReel` → stop computing/passing `layout`

**Files:**
- Modify: `render-worker/src/remotion/SplitReel.tsx`

- [ ] **Step 1: Remove the unused imports**

Change:

```tsx
import { AbsoluteFill, useVideoConfig } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"
import type { FacePoint } from "../lib/face-track.js"
import { buildLayoutTimeline } from "../lib/layout-timeline.js"
import { TrackedVideo } from "./TrackedVideo.js"
```

to:

```tsx
import { AbsoluteFill } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"
import type { FacePoint } from "../lib/face-track.js"
import { TrackedVideo } from "./TrackedVideo.js"
```

- [ ] **Step 2: Drop the `layout` computation and stop passing it to the children**

Change:

```tsx
export function SplitReel({
  videoSrc,
  pages,
  accentHex,
  trajectory,
  broll,
  hook,
  music,
}: SplitReelProps) {
  const { durationInFrames, fps } = useVideoConfig()
  const totalMs = (durationInFrames / fps) * 1000
  const layout = buildLayoutTimeline(
    broll.map((b) => ({ startMs: b.startMs, endMs: b.endMs })),
    totalMs,
  )

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AudioLayer pages={pages} music={music} hasHook={Boolean(hook?.text)} />
      <TrackedVideo videoSrc={videoSrc} trajectory={trajectory} layout={layout} />
      <BrollRow clips={broll} />
      <AccentGraphics accentHex={accentHex} />
      <CaptionLayer pages={pages} accentHex={accentHex} layout={layout} />
      {hook?.text ? <HookCard text={hook.text} accentHex={accentHex} /> : null}
      <ProgressBar accentHex={accentHex} />
      <BrandBug />
    </AbsoluteFill>
  )
}
```

to:

```tsx
export function SplitReel({
  videoSrc,
  pages,
  accentHex,
  trajectory,
  broll,
  hook,
  music,
}: SplitReelProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AudioLayer pages={pages} music={music} hasHook={Boolean(hook?.text)} />
      <TrackedVideo videoSrc={videoSrc} trajectory={trajectory} />
      <BrollRow clips={broll} />
      <AccentGraphics accentHex={accentHex} />
      <CaptionLayer pages={pages} accentHex={accentHex} />
      {hook?.text ? <HookCard text={hook.text} accentHex={accentHex} /> : null}
      <ProgressBar accentHex={accentHex} />
      <BrandBug />
    </AbsoluteFill>
  )
}
```

> Note: `SplitReelProps` is unchanged (still includes `broll`, `hook?`, `music?`). Only the internal `layout` wiring is removed.

- [ ] **Step 3: Build — the layout-prop removal across Tasks 3–5 is now consistent**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0. (If it reports an unused import or a missing `layout` prop, re-check Tasks 3–5 were all applied.)

- [ ] **Step 4: Run tests (regression guard)**

Run: `cd render-worker && npm test`
Expected: PASS (the untouched `layout-timeline`/`face-track` tests still pass even though the render path no longer imports them).

- [ ] **Step 5: Commit the full-screen-cutaway trio**

```bash
git add render-worker/src/remotion/TrackedVideo.tsx render-worker/src/remotion/CaptionLayer.tsx render-worker/src/remotion/SplitReel.tsx
git commit -m "feat(reel): full-screen b-roll cutaway (hide head, voice continues)

Talking head is always full-frame and mounted (voice never cuts);
b-roll covers it only during its windows. Captions stay lower-third
throughout. Removes the now-unused layout/mode plumbing from the
SplitReel render path."
```

---

## Task 6: Update the stale `SPLIT_SAMPLE` comment in `Root.tsx`

**Files:**
- Modify: `render-worker/src/remotion/Root.tsx`

- [ ] **Step 1: Reword the comment above `SPLIT_SAMPLE`**

Open `render-worker/src/remotion/Root.tsx`, find the comment above the `SPLIT_SAMPLE` constant that describes the old two-row split (it reads roughly: `10s sample: full-frame 0-3s, split (b-roll) 3-6s, full-frame 6-10s`). Replace that comment text with:

```tsx
// 10s sample: full-frame face-tracked head 0-3s, FULL-SCREEN b-roll cutaway
// (head hidden, voice continues) 3-6s, full-frame head 6-10s; lower-third
// captions throughout. The broll window (3000-6000) marks the cutaway.
```

Do not change the `SPLIT_SAMPLE` data itself (the `broll` window at `startMs:3000`/`endMs:6000` already marks the cutaway).

- [ ] **Step 2: Build**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 3: Commit**

```bash
git add render-worker/src/remotion/Root.tsx
git commit -m "docs(reel): update SPLIT_SAMPLE comment for full-screen cutaway"
```

---

## Task 7: Visual verification in Remotion Studio (human check)

**Files:** none (verification only)

- [ ] **Step 1: Launch Remotion Studio and open the `SplitReel` composition**

Run: `cd render-worker && npm run studio`
Then in the browser, select the **`SplitReel`** composition (it loads `SPLIT_SAMPLE`: a 10s reel with a b-roll window at 3–6s).

- [ ] **Step 2: Scrub the timeline and confirm each behavior**

Verify against this checklist:
- [ ] **0–3s (no b-roll):** the talking head fills the **whole frame** (not a black bottom half), face-tracked.
- [ ] **3–6s (b-roll window):** b-roll fills the **whole frame**; the talking head is **not visible**; captions remain **lower-third** (not lifted to the middle).
- [ ] **6–10s:** back to the full-frame talking head.
- [ ] **Captions** sit at the same lower-third position the entire time.
- [ ] **Brand bug, progress bar, accent corners** stay visible over the b-roll during 3–6s.
- [ ] Press play: **audio is continuous** across the 3–6s window (the sample's `videoSrc` voice keeps playing; the b-roll is silent).

- [ ] **Step 3: If anything fails the checklist, stop and revisit Tasks 2–5** before declaring Phase 1 done. If all pass, Phase 1 is complete.

---

## Self-Review (completed during planning)

**Spec coverage (§2 of the one-click spec):**
- "b-roll full-frame, head hidden, voice continues" → Tasks 2, 3 (BrollRow full-frame painting over an always-mounted, unmuted head). ✓
- "captions lower-third throughout (no rise-to-seam)" → Task 4. ✓
- "drop the unused layout plumbing" → Task 5. ✓
- "fixes the latent always-black-bottom-half bug" → Task 2 (black bg moved into each `<Sequence>`). ✓
- "brand overlays / captions overlay the b-roll" → preserved by unchanged z-order; verified in Task 7. ✓
- "face-track/layout-timeline tests stay green" → Tasks 1, 5 (regression runs). ✓
- "stale Root sample comment" → Task 6. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/vague steps — every code step shows the full file or the exact before/after block. ✓

**Type consistency:** `TrackedVideoProps` loses `layout` (Task 3) and `SplitReel` stops passing it (Task 5); `CaptionLayerProps` loses `layout` (Task 4) and `SplitReel` stops passing it (Task 5) — the two are applied as one build-gated set (build only after Task 5, per the notes). `BrollClip`/`BrollRowProps` are unchanged. `cropForMode(face, "full")` matches the existing `cropForMode(point, mode)` signature. ✓

**Out of scope (later phases):** hook in the reel, the one-click pipeline, the edit-gate selector, and retiring `CaptionedCut` are Phases 2–3, not this plan.
