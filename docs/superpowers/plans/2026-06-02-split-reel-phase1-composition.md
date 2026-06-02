# Split Reel — Phase 1: Dynamic Composition + Face Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. When writing the Remotion components, also consult the `remotion-best-practices` skill.

**Goal:** Build a renderable `SplitReel` Remotion composition whose layout switches over time — full-frame face-tracked talking head by default, two-row split (talking head + b-roll) only during selected windows — provable in Remotion Studio, with all pure layout/face math unit-tested.

**Architecture:** All changes live in the standalone `render-worker/` package (ESM, Remotion 4, React 19). Pure, deterministic helpers (`layout-timeline.ts`, `face-track.ts`) compute the layout timeline and the face-follow crop; thin Remotion components (`TrackedVideo`, `BrollRow`, `SplitReel`) consume them. Phase 1 feeds the composition a hand-authored face trajectory + b-roll window via `defaultProps`; the real face detector and the b-roll generation pipeline come in Phases 2–3. No app, DB, or `functions/` changes in this phase.

**Tech Stack:** Remotion 4.x, React 19, TypeScript (ESM, `moduleResolution: Bundler`), Vitest (added in Task 0).

**Spec:** `docs/superpowers/specs/2026-06-02-split-reel-fal-ai-design.md`

---

## File Structure (Phase 1)

| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `render-worker/package.json` | Modify | Add Vitest devDep + `test` scripts |
| `render-worker/vitest.config.ts` | Create | Vitest config (node env, `src/**/*.test.ts`) |
| `render-worker/tsconfig.json` | Modify | Exclude `*.test.ts` from the `tsc` build |
| `render-worker/src/lib/layout-timeline.ts` | Create | Pure: b-roll windows → contiguous `LayoutSegment[]`; `modeAtMs` |
| `render-worker/src/lib/layout-timeline.test.ts` | Create | Unit tests for the above |
| `render-worker/src/lib/face-track.ts` | Create | Pure: smooth trajectory, interpolate face at ms, per-mode crop transform |
| `render-worker/src/lib/face-track.test.ts` | Create | Unit tests for the above |
| `render-worker/src/remotion/TrackedVideo.tsx` | Create | Talking head; per-mode height + face-follow crop |
| `render-worker/src/remotion/BrollRow.tsx` | Create | Bottom-half b-roll clips during split windows (muted) |
| `render-worker/src/remotion/CaptionLayer.tsx` | Modify | Optional layout-aware caption anchor (lower-third vs seam) |
| `render-worker/src/remotion/SplitReel.tsx` | Create | The composition: assembles all layers over the layout timeline |
| `render-worker/src/remotion/Root.tsx` | Modify | Register `SplitReel` with sample props |

---

## Task 0: Add Vitest to render-worker

**Files:**
- Modify: `render-worker/package.json`
- Create: `render-worker/vitest.config.ts`
- Modify: `render-worker/tsconfig.json`

- [ ] **Step 1: Add the test script and devDependency to `render-worker/package.json`**

Edit the `scripts` and `devDependencies` blocks so they read:

```json
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "studio": "remotion studio src/remotion/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@remotion/cli": "^4.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.8"
  }
```

- [ ] **Step 2: Create `render-worker/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
```

- [ ] **Step 3: Exclude test files from the `tsc` production build**

In `render-worker/tsconfig.json`, add an `exclude` array (the build output should not contain test files, and `tsc` should not try to type-check Vitest globals):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

- [ ] **Step 4: Install dependencies**

Run (from the `render-worker/` directory):
```
npm install
```
Expected: installs `vitest` and its deps; exits 0.

- [ ] **Step 5: Verify the test runner works with no tests yet**

Run (from `render-worker/`):
```
npm test
```
Expected: Vitest reports `No test files found, exiting with code 0` (or a passing run with 0 tests). The command exits 0.

- [ ] **Step 6: Commit**

```bash
git add render-worker/package.json render-worker/package-lock.json render-worker/vitest.config.ts render-worker/tsconfig.json
git commit -m "test(render-worker): add Vitest for pure helper unit tests"
```

---

## Task 1: `layout-timeline.ts` — windows → contiguous layout segments

**Files:**
- Create: `render-worker/src/lib/layout-timeline.ts`
- Test: `render-worker/src/lib/layout-timeline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `render-worker/src/lib/layout-timeline.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { buildLayoutTimeline, modeAtMs } from "./layout-timeline"

describe("buildLayoutTimeline", () => {
  it("returns a single full segment when there are no windows", () => {
    expect(buildLayoutTimeline([], 10_000)).toEqual([
      { mode: "full", startMs: 0, endMs: 10_000 },
    ])
  })

  it("returns [] when totalMs is not positive", () => {
    expect(buildLayoutTimeline([{ startMs: 0, endMs: 1000 }], 0)).toEqual([])
  })

  it("wraps a mid-reel window with full segments on both sides", () => {
    expect(buildLayoutTimeline([{ startMs: 3000, endMs: 5000 }], 10_000)).toEqual([
      { mode: "full", startMs: 0, endMs: 3000 },
      { mode: "split", startMs: 3000, endMs: 5000 },
      { mode: "full", startMs: 5000, endMs: 10_000 },
    ])
  })

  it("does not emit a leading full gap when a window starts at 0", () => {
    expect(buildLayoutTimeline([{ startMs: 0, endMs: 2000 }], 6000)).toEqual([
      { mode: "split", startMs: 0, endMs: 2000 },
      { mode: "full", startMs: 2000, endMs: 6000 },
    ])
  })

  it("does not emit a trailing full gap when a window ends at totalMs", () => {
    expect(buildLayoutTimeline([{ startMs: 4000, endMs: 6000 }], 6000)).toEqual([
      { mode: "full", startMs: 0, endMs: 4000 },
      { mode: "split", startMs: 4000, endMs: 6000 },
    ])
  })

  it("merges overlapping/touching windows", () => {
    expect(
      buildLayoutTimeline(
        [
          { startMs: 1000, endMs: 3000 },
          { startMs: 3000, endMs: 4000 },
          { startMs: 2500, endMs: 3500 },
        ],
        8000,
      ),
    ).toEqual([
      { mode: "full", startMs: 0, endMs: 1000 },
      { mode: "split", startMs: 1000, endMs: 4000 },
      { mode: "full", startMs: 4000, endMs: 8000 },
    ])
  })

  it("clamps windows that run past the total duration and drops empty ones", () => {
    expect(
      buildLayoutTimeline(
        [
          { startMs: 5000, endMs: 99_000 },
          { startMs: 2000, endMs: 2000 }, // empty → dropped
        ],
        6000,
      ),
    ).toEqual([
      { mode: "full", startMs: 0, endMs: 5000 },
      { mode: "split", startMs: 5000, endMs: 6000 },
    ])
  })
})

describe("modeAtMs", () => {
  const segments = buildLayoutTimeline([{ startMs: 3000, endMs: 5000 }], 10_000)

  it("returns the mode covering the timestamp", () => {
    expect(modeAtMs(segments, 0)).toBe("full")
    expect(modeAtMs(segments, 3000)).toBe("split")
    expect(modeAtMs(segments, 4999)).toBe("split")
    expect(modeAtMs(segments, 5000)).toBe("full")
  })

  it("clamps a past-the-end timestamp to the last segment", () => {
    expect(modeAtMs(segments, 999_999)).toBe("full")
  })

  it("returns full for an empty timeline", () => {
    expect(modeAtMs([], 1234)).toBe("full")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `render-worker/`):
```
npx vitest run src/lib/layout-timeline.test.ts
```
Expected: FAIL — `Failed to resolve import "./layout-timeline"` / module not found.

- [ ] **Step 3: Write the implementation**

Create `render-worker/src/lib/layout-timeline.ts`:

```ts
// render-worker/src/lib/layout-timeline.ts
// Pure: turn the selected b-roll windows into a contiguous layout timeline over
// the full reel duration. Everything outside a window is "full" (full-frame
// talking head); each window is "split" (talking head + b-roll). No I/O.

export type LayoutMode = "full" | "split"
export type BrollWindow = { startMs: number; endMs: number }
export type LayoutSegment = { mode: LayoutMode; startMs: number; endMs: number }

export function buildLayoutTimeline(
  windows: BrollWindow[],
  totalMs: number,
): LayoutSegment[] {
  if (totalMs <= 0) return []

  // Clamp to [0, totalMs], drop empty/inverted, sort by start.
  const clean = windows
    .map((w) => ({
      startMs: Math.max(0, Math.min(w.startMs, totalMs)),
      endMs: Math.max(0, Math.min(w.endMs, totalMs)),
    }))
    .filter((w) => w.endMs > w.startMs)
    .sort((a, b) => a.startMs - b.startMs)

  // Merge overlapping/touching windows so we never emit a zero-length full gap.
  const merged: BrollWindow[] = []
  for (const w of clean) {
    const last = merged[merged.length - 1]
    if (last && w.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, w.endMs)
    } else {
      merged.push({ ...w })
    }
  }

  // Walk the timeline, filling "full" between (and around) the windows.
  const segments: LayoutSegment[] = []
  let cursor = 0
  for (const w of merged) {
    if (w.startMs > cursor) {
      segments.push({ mode: "full", startMs: cursor, endMs: w.startMs })
    }
    segments.push({ mode: "split", startMs: w.startMs, endMs: w.endMs })
    cursor = w.endMs
  }
  if (cursor < totalMs) {
    segments.push({ mode: "full", startMs: cursor, endMs: totalMs })
  }
  return segments
}

// Which layout mode is active at `ms`. Past the end (last-frame rounding) clamps
// to the final segment; an empty timeline is "full".
export function modeAtMs(segments: LayoutSegment[], ms: number): LayoutMode {
  for (const s of segments) {
    if (ms >= s.startMs && ms < s.endMs) return s.mode
  }
  const last = segments[segments.length - 1]
  return last ? last.mode : "full"
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `render-worker/`):
```
npx vitest run src/lib/layout-timeline.test.ts
```
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add render-worker/src/lib/layout-timeline.ts render-worker/src/lib/layout-timeline.test.ts
git commit -m "feat(split-reel): pure layout-timeline builder for dynamic b-roll windows"
```

---

## Task 2: `face-track.ts` — trajectory smoothing + per-mode crop

**Files:**
- Create: `render-worker/src/lib/face-track.ts`
- Test: `render-worker/src/lib/face-track.test.ts`

> The detector that PRODUCES the trajectory (MediaPipe/BlazeFace over sampled frames) is Phase 2 work. This module is the deterministic, testable core the composition consumes. Crop constants (`BASE_SCALE`, `ANCHOR_Y`) are visual-tuning knobs; the tests assert *relationships*, not exact pixels, so tuning them later won't break the suite.

- [ ] **Step 1: Write the failing test**

Create `render-worker/src/lib/face-track.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { smoothTrajectory, faceAtMs, cropForMode, type FacePoint } from "./face-track"

const P = (ms: number, cx: number, cy: number, size = 0.3): FacePoint => ({ ms, cx, cy, size })

describe("smoothTrajectory", () => {
  it("returns the input unchanged for <=2 points or a non-positive window", () => {
    const two = [P(0, 0.1, 0.1), P(100, 0.9, 0.9)]
    expect(smoothTrajectory(two, 500)).toEqual(two)
    const many = [P(0, 0.1, 0.1), P(100, 0.5, 0.5), P(200, 0.9, 0.9)]
    expect(smoothTrajectory(many, 0)).toEqual(many)
  })

  it("preserves length and pulls a spike toward its neighbours", () => {
    const pts = [P(0, 0.5, 0.5), P(100, 0.9, 0.9), P(200, 0.5, 0.5)]
    const out = smoothTrajectory(pts, 200)
    expect(out).toHaveLength(3)
    // The middle spike (0.9) is averaged with its 0.5 neighbours → strictly lower.
    expect(out[1].cx).toBeLessThan(0.9)
    expect(out[1].cx).toBeGreaterThan(0.5)
  })
})

describe("faceAtMs", () => {
  it("returns a centered face for an empty trajectory", () => {
    expect(faceAtMs([], 1000)).toMatchObject({ cx: 0.5, cy: 0.5 })
  })

  it("clamps before the first and after the last sample", () => {
    const pts = [P(1000, 0.2, 0.2), P(2000, 0.8, 0.8)]
    expect(faceAtMs(pts, 0)).toMatchObject({ cx: 0.2, cy: 0.2 })
    expect(faceAtMs(pts, 9999)).toMatchObject({ cx: 0.8, cy: 0.8 })
  })

  it("linearly interpolates between samples", () => {
    const pts = [P(0, 0.0, 0.0), P(1000, 1.0, 1.0)]
    const mid = faceAtMs(pts, 500)
    expect(mid.cx).toBeCloseTo(0.5, 5)
    expect(mid.cy).toBeCloseTo(0.5, 5)
  })
})

describe("cropForMode", () => {
  it("uses a tighter zoom for split than for full", () => {
    const face = P(0, 0.5, 0.5)
    expect(cropForMode(face, "split").scale).toBeGreaterThan(
      cropForMode(face, "full").scale,
    )
  })

  it("does not translate horizontally for a horizontally-centered face", () => {
    expect(cropForMode(P(0, 0.5, 0.4), "full").translateXPct).toBeCloseTo(0, 5)
  })

  it("pushes the frame right when the face is on the left, and vice versa", () => {
    expect(cropForMode(P(0, 0.3, 0.5), "full").translateXPct).toBeGreaterThan(0)
    expect(cropForMode(P(0, 0.7, 0.5), "full").translateXPct).toBeLessThan(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `render-worker/`):
```
npx vitest run src/lib/face-track.test.ts
```
Expected: FAIL — `Failed to resolve import "./face-track"`.

- [ ] **Step 3: Write the implementation**

Create `render-worker/src/lib/face-track.ts`:

```ts
// render-worker/src/lib/face-track.ts
// Pure trajectory math for the tracked talking-head crop. The detector that
// PRODUCES the trajectory lands with the worker wiring in Phase 2; this module is
// the deterministic core the composition consumes. No I/O.

// Local 2-value union (kept independent of layout-timeline so this stays a leaf
// module with no cross-file imports — simpler Vitest resolution).
export type CropMode = "full" | "split"

// Normalized face position in the SOURCE frame. cx/cy in [0,1]; size = face-box
// height as a fraction of the frame height.
export type FacePoint = { ms: number; cx: number; cy: number; size: number }

// Transform applied to the <OffthreadVideo> element (which is object-fit: cover).
export type CropRect = { scale: number; translateXPct: number; translateYPct: number }

const CENTER = { cx: 0.5, cy: 0.5, size: 0.3 }

// Where the face should sit vertically inside the visible box.
const ANCHOR_Y: Record<CropMode, number> = { full: 0.42, split: 0.5 }
// Baseline zoom per mode; split is tighter so the head fills the half-height box.
const BASE_SCALE: Record<CropMode, number> = { full: 1.1, split: 1.6 }

// Gaussian moving-average over a +/- windowMs neighbourhood (sigma = windowMs/2).
export function smoothTrajectory(points: FacePoint[], windowMs: number): FacePoint[] {
  if (points.length <= 2 || windowMs <= 0) return points
  const sorted = [...points].sort((a, b) => a.ms - b.ms)
  const sigma = windowMs / 2
  return sorted.map((p) => {
    let cx = 0, cy = 0, size = 0, wsum = 0
    for (const q of sorted) {
      const dt = q.ms - p.ms
      if (Math.abs(dt) > windowMs) continue
      const w = Math.exp(-(dt * dt) / (2 * sigma * sigma))
      cx += q.cx * w; cy += q.cy * w; size += q.size * w; wsum += w
    }
    return { ms: p.ms, cx: cx / wsum, cy: cy / wsum, size: size / wsum }
  })
}

// The (interpolated) face position at an arbitrary timestamp. Clamps outside the
// sampled range; falls back to centered when there are no samples.
export function faceAtMs(points: FacePoint[], ms: number): FacePoint {
  if (points.length === 0) return { ms, ...CENTER }
  const sorted = [...points].sort((a, b) => a.ms - b.ms)
  if (ms <= sorted[0].ms) return sorted[0]
  const lastPt = sorted[sorted.length - 1]
  if (ms >= lastPt.ms) return lastPt
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (ms >= a.ms && ms <= b.ms) {
      const t = (ms - a.ms) / (b.ms - a.ms)
      return {
        ms,
        cx: a.cx + (b.cx - a.cx) * t,
        cy: a.cy + (b.cy - a.cy) * t,
        size: a.size + (b.size - a.size) * t,
      }
    }
  }
  return lastPt
}

// Transform to keep the face on the per-mode anchor. The element is scaled about
// its center, so a face at cx maps toward center via translate (0.5 - cx).
export function cropForMode(point: FacePoint, mode: CropMode): CropRect {
  const scale = BASE_SCALE[mode]
  return {
    scale,
    translateXPct: (0.5 - point.cx) * 100,
    translateYPct: (ANCHOR_Y[mode] - point.cy) * 100,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `render-worker/`):
```
npx vitest run src/lib/face-track.test.ts
```
Expected: PASS.

- [ ] **Step 5: Run the full suite + the production build to confirm nothing regressed**

Run (from `render-worker/`):
```
npm test
npm run build
```
Expected: all tests PASS; `tsc` build exits 0 with no errors (test files are excluded).

- [ ] **Step 6: Commit**

```bash
git add render-worker/src/lib/face-track.ts render-worker/src/lib/face-track.test.ts
git commit -m "feat(split-reel): pure face-trajectory smoothing + per-mode crop math"
```

---

## Task 3: `TrackedVideo.tsx` — face-tracked talking head (both modes)

**Files:**
- Create: `render-worker/src/remotion/TrackedVideo.tsx`

> Remotion components are verified visually in Studio (Task 7), not by unit tests — the testable logic they call (`modeAtMs`, `faceAtMs`, `cropForMode`) is already covered in Tasks 1–2.

- [ ] **Step 1: Write the component**

Create `render-worker/src/remotion/TrackedVideo.tsx`:

```tsx
// render-worker/src/remotion/TrackedVideo.tsx
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion"
import { faceAtMs, cropForMode, type FacePoint } from "../lib/face-track.js"
import { modeAtMs, type LayoutSegment } from "../lib/layout-timeline.js"

export type TrackedVideoProps = {
  videoSrc: string
  trajectory: FacePoint[]
  layout: LayoutSegment[]
}

// The talking head. In "full" segments it fills the frame; in "split" segments it
// occupies the top half. In both, the crop follows the (smoothed) face. Audio stays
// ON here — this element carries the client's voice (AudioLayer only adds music/SFX).
export function TrackedVideo({ videoSrc, trajectory, layout }: TrackedVideoProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const mode = modeAtMs(layout, ms)
  const face = faceAtMs(trajectory, ms)
  const crop = cropForMode(face, mode)

  return (
    <AbsoluteFill
      style={{
        top: 0,
        height: mode === "split" ? "50%" : "100%",
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

- [ ] **Step 2: Type-check**

Run (from `render-worker/`):
```
npm run build
```
Expected: exits 0, no type errors. (Visual verification happens in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add render-worker/src/remotion/TrackedVideo.tsx
git commit -m "feat(split-reel): TrackedVideo — face-tracked talking head for full + split modes"
```

---

## Task 4: `BrollRow.tsx` — bottom-half b-roll during split windows

**Files:**
- Create: `render-worker/src/remotion/BrollRow.tsx`

- [ ] **Step 1: Write the component**

Create `render-worker/src/remotion/BrollRow.tsx`:

```tsx
// render-worker/src/remotion/BrollRow.tsx
import { AbsoluteFill, OffthreadVideo, Sequence, useVideoConfig } from "remotion"

// One selected b-roll window: the time range it occupies in the reel + its clip.
export type BrollClip = { startMs: number; endMs: number; src: string }

export type BrollRowProps = {
  clips: BrollClip[]
}

// Renders the bottom half. Each clip shows only during its window (a <Sequence>),
// cover-fit and MUTED (the voice comes from the talking head). Outside every
// window nothing renders here, so the talking head (full mode) shows through.
export function BrollRow({ clips }: BrollRowProps) {
  const { fps } = useVideoConfig()
  const msToFrames = (ms: number) => Math.round((ms / 1000) * fps)

  return (
    <AbsoluteFill style={{ top: "50%", height: "50%", overflow: "hidden", backgroundColor: "black" }}>
      {clips.map((clip, i) => {
        const from = msToFrames(clip.startMs)
        const duration = Math.max(1, msToFrames(clip.endMs) - from)
        return (
          <Sequence key={i} from={from} durationInFrames={duration} name={`broll-${i}`}>
            <OffthreadVideo
              src={clip.src}
              muted
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
```

- [ ] **Step 2: Type-check**

Run (from `render-worker/`):
```
npm run build
```
Expected: exits 0, no type errors.

- [ ] **Step 3: Commit**

```bash
git add render-worker/src/remotion/BrollRow.tsx
git commit -m "feat(split-reel): BrollRow — muted bottom-half b-roll sequenced to windows"
```

---

## Task 5: Make `CaptionLayer` layout-aware (lower-third vs seam)

**Files:**
- Modify: `render-worker/src/remotion/CaptionLayer.tsx`

> Captions sit lower-third by default (full-frame). During split windows they rise to the seam so they don't overlap the b-roll. This is backward compatible: `CaptionedCut` passes no `layout`, so it keeps the exact current lower-third behavior.

- [ ] **Step 1: Add the optional `layout` prop and import the mode selector**

In `render-worker/src/remotion/CaptionLayer.tsx`, update the imports and the props type. Change the import line and the `CaptionLayerProps` type:

```tsx
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion"
import { loadFont } from "@remotion/google-fonts/LexendExa"
import type { CaptionPage } from "../lib/caption-paging.js"
import { modeAtMs, type LayoutSegment } from "../lib/layout-timeline.js"

const { fontFamily } = loadFont("normal", { weights: ["800"], subsets: ["latin"] })

export type CaptionLayerProps = {
  pages: CaptionPage[]
  accentHex: string
  // When provided (Split Reel), captions rise to the seam during split windows.
  // Omitted (Captioned Cut) → always lower-third, unchanged behavior.
  layout?: LayoutSegment[]
}
```

- [ ] **Step 2: Update the function signature and compute the anchor**

Find this exact existing block at the top of the function body:

```tsx
export function CaptionLayer({ pages, accentHex }: CaptionLayerProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
```

…and replace it with (adds `layout` to the params and the anchor calc; the existing `frame`/`fps`/`ms` lines are kept exactly, not duplicated):

```tsx
export function CaptionLayer({ pages, accentHex, layout }: CaptionLayerProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000

  // Lower-third by default; during a split window lift captions to just above the
  // seam (frame is 1920 tall; seam at 960) so they clear the b-roll row.
  const mode = layout ? modeAtMs(layout, ms) : "full"
  const paddingBottom = mode === "split" ? 1020 : 420
```

- [ ] **Step 3: Use the computed `paddingBottom` in the outer `AbsoluteFill`**

Replace the hard-coded `padding: "0 72px 420px"` on the outer `AbsoluteFill` with the dynamic value:

```tsx
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        padding: `0 72px ${paddingBottom}px`,
      }}
    >
```

Leave everything else in the component unchanged.

- [ ] **Step 4: Type-check**

Run (from `render-worker/`):
```
npm run build
```
Expected: exits 0, no type errors. `CaptionedCut.tsx` still compiles (it calls `<CaptionLayer pages={...} accentHex={...} />` with no `layout`).

- [ ] **Step 5: Commit**

```bash
git add render-worker/src/remotion/CaptionLayer.tsx
git commit -m "feat(split-reel): layout-aware caption anchor (seam during split windows)"
```

---

## Task 6: `SplitReel.tsx` — the composition

**Files:**
- Create: `render-worker/src/remotion/SplitReel.tsx`

- [ ] **Step 1: Write the composition**

Create `render-worker/src/remotion/SplitReel.tsx`. It builds the layout timeline from the b-roll windows and the composition duration, then stacks the layers in z-order (audio → talking head → b-roll → accents → captions → hook → progress → bug):

```tsx
// render-worker/src/remotion/SplitReel.tsx
import { AbsoluteFill, useVideoConfig } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"
import type { FacePoint } from "../lib/face-track.js"
import { buildLayoutTimeline } from "../lib/layout-timeline.js"
import { TrackedVideo } from "./TrackedVideo.js"
import { BrollRow, type BrollClip } from "./BrollRow.js"
import { CaptionLayer } from "./CaptionLayer.js"
import { ProgressBar } from "./ProgressBar.js"
import { BrandBug } from "./BrandBug.js"
import { HookCard } from "./HookCard.js"
import { AudioLayer } from "./AudioLayer.js"
import { AccentGraphics } from "./AccentGraphics.js"

// A `type` (not `interface`) to satisfy Remotion's Props constraint on <Composition>.
export type SplitReelProps = {
  videoSrc: string
  pages: CaptionPage[]
  accentHex: string
  trajectory: FacePoint[]
  broll: BrollClip[]
  hook?: { text: string }
  music?: { track: string }
}

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

- [ ] **Step 2: Type-check**

Run (from `render-worker/`):
```
npm run build
```
Expected: exits 0, no type errors.

- [ ] **Step 3: Commit**

```bash
git add render-worker/src/remotion/SplitReel.tsx
git commit -m "feat(split-reel): SplitReel composition assembling dynamic layout layers"
```

---

## Task 7: Register `SplitReel` in Root + verify in Studio

**Files:**
- Modify: `render-worker/src/remotion/Root.tsx`

- [ ] **Step 1: Register the composition with sample props**

Replace the contents of `render-worker/src/remotion/Root.tsx` with (keeps the existing `CaptionedCut` registration and adds `SplitReel`):

```tsx
// render-worker/src/remotion/Root.tsx
import { Composition } from "remotion"
import { CaptionedCut, type CaptionedCutProps } from "./CaptionedCut.js"
import { SplitReel, type SplitReelProps } from "./SplitReel.js"

const FPS = 30
const WIDTH = 1080
const HEIGHT = 1920

const SAMPLE: CaptionedCutProps = {
  videoSrc:
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  pages: [
    {
      text: "let's get",
      words: [
        { text: "let's", startMs: 0, endMs: 400, emphasis: false },
        { text: "get", startMs: 400, endMs: 800, emphasis: false },
      ],
      startMs: 0,
      endMs: 800,
    },
  ],
  accentHex: "#C49B7A",
}

// 10s sample: full-frame 0-3s, split (b-roll) 3-6s, full-frame 6-10s. A moving
// face trajectory so the tracking crop is visibly doing something in Studio.
const SPLIT_SAMPLE: SplitReelProps = {
  videoSrc:
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  pages: [
    {
      text: "watch this",
      words: [
        { text: "watch", startMs: 0, endMs: 500, emphasis: false },
        { text: "this", startMs: 500, endMs: 1000, emphasis: true },
      ],
      startMs: 0,
      endMs: 1000,
    },
    {
      text: "right here",
      words: [
        { text: "right", startMs: 3200, endMs: 3700, emphasis: false },
        { text: "here", startMs: 3700, endMs: 4200, emphasis: false },
      ],
      startMs: 3200,
      endMs: 4200,
    },
  ],
  accentHex: "#C49B7A",
  trajectory: [
    { ms: 0, cx: 0.35, cy: 0.4, size: 0.32 },
    { ms: 2500, cx: 0.55, cy: 0.45, size: 0.34 },
    { ms: 5000, cx: 0.65, cy: 0.4, size: 0.3 },
    { ms: 10000, cx: 0.45, cy: 0.42, size: 0.33 },
  ],
  broll: [
    {
      startMs: 3000,
      endMs: 6000,
      src: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    },
  ],
}

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="CaptionedCut"
        component={CaptionedCut}
        durationInFrames={FPS * 10}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={SAMPLE}
      />
      <Composition
        id="SplitReel"
        component={SplitReel}
        durationInFrames={FPS * 10}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={SPLIT_SAMPLE}
      />
    </>
  )
}
```

- [ ] **Step 2: Type-check**

Run (from `render-worker/`):
```
npm run build
```
Expected: exits 0, no type errors.

- [ ] **Step 3: Open Remotion Studio and verify the dynamic layout**

Run (from `render-worker/`):
```
npm run studio
```
Then open the `SplitReel` composition in the browser and scrub the timeline. Verify:
- **0–3s:** full-frame video; captions sit lower-third; the crop slowly pans as the trajectory moves (face anchor drifts left→right).
- **3–6s:** layout splits — talking head fills the **top half**, the b-roll clip (Elephants Dream) fills the **bottom half**; captions have risen to just above the seam; b-roll audio is **silent** (only the top video's audio plays).
- **6–10s:** back to full-frame; captions back to lower-third.
- The brand bug, progress bar, and accent graphics render in all sections.

Fix any visual issues by tuning the constants in `face-track.ts` (`BASE_SCALE`, `ANCHOR_Y`) or the `paddingBottom` seam value in `CaptionLayer.tsx`, then re-check. (These are visual knobs; the unit tests assert relationships and will still pass.)

- [ ] **Step 4: Commit**

```bash
git add render-worker/src/remotion/Root.tsx
git commit -m "feat(split-reel): register SplitReel composition with dynamic sample props"
```

---

## Phase 1 Done — Definition of Done

- `npm test` (in `render-worker/`) passes: `layout-timeline` and `face-track` suites green.
- `npm run build` passes with no type errors.
- In Studio, the `SplitReel` composition shows full → split → full with a face-tracked top row, muted bottom-row b-roll, and captions that move to the seam during the split.

## What Phase 1 deliberately leaves for later

- **Real face detection** (MediaPipe/BlazeFace over sampled frames → trajectory) — Phase 2, with the render-worker job wiring.
- **fal.ai b-roll generation**, the `broll_generation` job, `broll_segments` table, webhook, caching — Phase 2.
- **`split_reel_render` ai_job + API routes + Cloud Run trigger** (rendering from real inputs instead of `defaultProps`) — Phase 2.
- **Preview/regenerate UI** in Content Studio — Phase 3.
- **Mode-transition polish** (ease vs hard cut), active-speaker selection — see spec "Open items".
