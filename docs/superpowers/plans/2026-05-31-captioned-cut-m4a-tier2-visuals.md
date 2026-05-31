# Captioned Cut — M4a (Tier 2a: On-Screen Energy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three trend-grade "energy" touches to the captioned cut — a subtle punch-in zoom on the source video, a thin brand-accent progress bar, and an animated corner brand bug — without touching the app, DB, or panel.

**Architecture:** Continue the composition decomposition started in M3 (which extracted `CaptionLayer`). Extract the source video into a `SourceLayer` (and give it the zoom), add a `ProgressBar` and a `BrandBug` layer, and compose all of them in `CaptionedCut`. The zoom and bar derive purely from `useCurrentFrame()` + `useVideoConfig().durationInFrames`; the brand bug renders a baked-in logo via `staticFile`. No new render `inputProps` are needed, so there are **no app/route/validator/DB changes** — this deploys via `gcloud` only, exactly like M3's visual tasks.

**Tech Stack:** Remotion 4.x (`interpolate`, `useCurrentFrame`, `useVideoConfig`, `OffthreadVideo`, `Img`, `staticFile`), TypeScript, the Cloud Run job `captioned-cut-render`, ffmpeg (frame sampling). No new npm deps.

**Scope:** This is **M4a of the M4/M5 pro-upgrade** (see `docs/superpowers/specs/2026-05-31-captioned-cut-pro-upgrade-design.md`, §5 M4). The remaining M4 features — **hook card** and **caption SFX** — are deferred to a separate **M4b** plan because they need cross-stack plumbing (panel → route → job input → worker) and user-supplied SFX assets. M4a is pure render-worker composition.

---

## Brand-bug rendering decision (no external asset)

The brand bug (Task 4) is rendered as a **styled `dj` text wordmark** (Lexend Exa, brand accent), not an image — so M4a has **no asset dependency** and ships entirely from code. (A logo image can be swapped in later by replacing `BrandBug`'s contents with `<Img src={staticFile(...)}>` once a logo is provided; that also needs a `render-worker/public/` dir + a Dockerfile `COPY public ./public` + a `publicDir` on `bundle()` — deferred until a real asset exists, and reused by M4b's SFX.)

---

## Environment gotchas (carried from M3 — read before working)

1. **Grep/Glob tools misfire in this workspace** (space in the path). Use **`git grep`** / `git ls-files | grep` via Bash. The Read tool works with absolute paths and **renders PNGs visually** — use it to inspect stills.
2. **gcloud default project is `speakersplit-9899f`** → ALWAYS pass `--project darrenjpaulcom`.
3. **The worker bundles the COMPILED `dist/` entry**, not `src/` (source uses `.js` import specifiers the CLI won't resolve). Always `cd render-worker && npm run build` before `remotion still`.
4. **Local `remotion still` needs a reachable test video** — BigBuckBunny on commondatastorage 403s; use `https://www.w3schools.com/html/mov_bbb.mp4` (in the `_still-props.json` recreated in Task 1).
5. **Brand accent is `#c4936b`** (the `#C49B7A` in CLAUDE.md is a grayer approximation — don't use it). The worker passes `accentHex="#c4936b"` at render time.
6. **The repo has ~150 pre-existing unrelated `tsc` errors + failing tests** — the **render-worker package builds independently** (`cd render-worker && npm run build` must exit 0). Ignore the app-level red.
7. **Pushing app changes to `main` triggers a Vercel prod deploy; `render-worker/` changes do NOT** (the worker deploys via `gcloud`). M4a touches only `render-worker/` → no Vercel deploy. **Ask the user before the Task 5 `gcloud` deploy** (it is a prod deploy of the worker).
8. **Commit with EXPLICIT `git add` paths** (never `git add -A`) so scratch `_still*.png` / `_still-props.json` are never staged. Solo-dev: commit **directly to `main`**, no branch/PR. `C:/Users/tayaw` is itself a git repo — never `cd ..` past the project root in chained git commands.
9. **No unit tests in M4a.** These are pure Remotion composition features with no extractable pure logic; they are **still-verified** (render a frame → Read the PNG) then accepted by a full Cloud render, exactly like M3's Tasks 4–8. Do **not** invent logic to TDD here (YAGNI).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `render-worker/src/remotion/SourceLayer.tsx` | source `OffthreadVideo` (center-crop) **+ punch-in zoom** | Create |
| `render-worker/src/remotion/ProgressBar.tsx` | thin brand-accent progress bar (top edge) | Create |
| `render-worker/src/remotion/BrandBug.tsx` | corner `dj` text wordmark, fades in | Create |
| `render-worker/src/remotion/CaptionedCut.tsx` | composes `SourceLayer` + `CaptionLayer` + `ProgressBar` + `BrandBug` | Modify |

> Decomposition note: M4a extracts **`SourceLayer`** (the layer it changes) and adds `ProgressBar`/`BrandBug`. `HookCard` and `AudioLayer` are deferred to M4b. Don't pre-create them (YAGNI). `CaptionLayer` (M3) is untouched.

---

## Task 1: Extract `SourceLayer` (pure refactor — no visual change)

**Files:**
- Create: `render-worker/src/remotion/SourceLayer.tsx`
- Modify: `render-worker/src/remotion/CaptionedCut.tsx`
- Scratch: `render-worker/_still-props.json` (gitignored; recreated here)

- [ ] **Step 1: Create `SourceLayer.tsx` with the CURRENT source rendering (verbatim)**

This moves the existing `<OffthreadVideo>` out of `CaptionedCut` unchanged (same `object-fit: cover`) so output is identical. Create `render-worker/src/remotion/SourceLayer.tsx`:

```tsx
// render-worker/src/remotion/SourceLayer.tsx
import { AbsoluteFill, OffthreadVideo } from "remotion"

export type SourceLayerProps = {
  videoSrc: string
}

export function SourceLayer({ videoSrc }: SourceLayerProps) {
  return (
    <AbsoluteFill>
      {/* object-fit: cover — fill 1080x1920, center-crop the overflow */}
      <OffthreadVideo src={videoSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </AbsoluteFill>
  )
}
```

- [ ] **Step 2: Replace the inline `<OffthreadVideo>` in `CaptionedCut.tsx` with `<SourceLayer>`**

`render-worker/src/remotion/CaptionedCut.tsx` becomes:

```tsx
// render-worker/src/remotion/CaptionedCut.tsx
import { AbsoluteFill } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"
import { CaptionLayer } from "./CaptionLayer.js"
import { SourceLayer } from "./SourceLayer.js"

// A `type` (not `interface`) so it satisfies Remotion's
// `Props extends Record<string, unknown>` constraint on <Composition>.
export type CaptionedCutProps = {
  videoSrc: string
  pages: CaptionPage[]
  accentHex: string
}

export function CaptionedCut({ videoSrc, pages, accentHex }: CaptionedCutProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <SourceLayer videoSrc={videoSrc} />
      <CaptionLayer pages={pages} accentHex={accentHex} />
    </AbsoluteFill>
  )
}
```

- [ ] **Step 3: Build the worker**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 4: (Re)create the scratch still-test props** (gitignored; do NOT commit)

Create `render-worker/_still-props.json`:

```json
{
  "videoSrc": "https://www.w3schools.com/html/mov_bbb.mp4",
  "accentHex": "#c4936b",
  "pages": [
    {
      "text": "5 mistakes athletes make",
      "words": [
        { "text": "5", "startMs": 0, "endMs": 350, "emphasis": true },
        { "text": "mistakes", "startMs": 350, "endMs": 800, "emphasis": true },
        { "text": "athletes", "startMs": 800, "endMs": 1300, "emphasis": true },
        { "text": "make", "startMs": 1300, "endMs": 1700, "emphasis": false }
      ],
      "startMs": 0,
      "endMs": 1700
    }
  ]
}
```

- [ ] **Step 5: Render a still and verify it looks identical to today's output**

Run: `cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still-src.png --frame=21 --scale=0.5 --props=./_still-props.json`
Then Read `render-worker/_still-src.png`. Expected: the BigBuckBunny frame fills the 9:16 frame (center-cropped) with the M3 captions in the lower third ("mistakes" in its accent pill) — i.e. **unchanged** by the refactor. Leave the PNG on disk; report its filename.

- [ ] **Step 6: Commit** (source only, explicit paths)

```bash
git add render-worker/src/remotion/SourceLayer.tsx render-worker/src/remotion/CaptionedCut.tsx
git commit -m "refactor(captioned-cut): extract SourceLayer (no visual change)"
```
End the message with a blank line then `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (use a Bash heredoc).

---

## Task 2: Punch-in zoom on the source

**Files:**
- Modify: `render-worker/src/remotion/SourceLayer.tsx`

- [ ] **Step 1: Add a slow zoom (1.0 → 1.06 across the whole clip)**

Replace `render-worker/src/remotion/SourceLayer.tsx` with:

```tsx
// render-worker/src/remotion/SourceLayer.tsx
import { AbsoluteFill, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig } from "remotion"

export type SourceLayerProps = {
  videoSrc: string
}

export function SourceLayer({ videoSrc }: SourceLayerProps) {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  // Slow "punch-in": ease the source from 1.0 to 1.06 across the whole clip so the
  // frame feels alive without obvious motion. object-fit:cover already fills the
  // frame, so scaling up just crops further in — no black edges appear.
  const zoom = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [1, 1.06], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <AbsoluteFill>
      {/* object-fit: cover — fill 1080x1920, center-crop the overflow */}
      <OffthreadVideo
        src={videoSrc}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${zoom})`,
          transformOrigin: "center",
        }}
      />
    </AbsoluteFill>
  )
}
```

- [ ] **Step 2: Build**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 3: Render stills at the start and end; verify the zoom**

The Root sample composition is 300 frames (10 s), so compare the first and last frames. Render two distinct, persistent files and Read each:

```bash
cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still-zoom-f0.png --frame=0 --scale=0.5 --props=./_still-props.json
cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still-zoom-f299.png --frame=299 --scale=0.5 --props=./_still-props.json
```

Read both. Expected: at frame 299 the source content is **slightly more zoomed in** (subjects ~6% larger, edges cropped further) than at frame 0 — a subtle, deliberate punch-in. (It is intentionally subtle; if the two frames look indistinguishable, sample `--frame=150` too and confirm a monotonic crop-in.) Leave the PNGs on disk; report filenames. If it reads as too strong/weak, note it for build-time tuning (the `1.06` target) — don't change the spec value yourself.

- [ ] **Step 4: Commit**

```bash
git add render-worker/src/remotion/SourceLayer.tsx
git commit -m "feat(captioned-cut): slow punch-in zoom on the source video"
```
(same Co-Authored-By trailer)

---

## Task 3: Brand-accent progress bar

**Files:**
- Create: `render-worker/src/remotion/ProgressBar.tsx`
- Modify: `render-worker/src/remotion/CaptionedCut.tsx`

- [ ] **Step 1: Create `ProgressBar.tsx`**

A thin bar pinned to the top edge whose fill grows 0 → 100% across the clip. Create `render-worker/src/remotion/ProgressBar.tsx`:

```tsx
// render-worker/src/remotion/ProgressBar.tsx
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion"

export type ProgressBarProps = {
  accentHex: string
}

export function ProgressBar({ accentHex }: ProgressBarProps) {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  // Fill grows linearly with playback. A faint track sits under the accent fill so
  // the bar reads even before much has elapsed.
  const pct = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: 10,
        backgroundColor: "rgba(255,255,255,0.18)",
      }}
    >
      <div style={{ width: `${pct}%`, height: "100%", backgroundColor: accentHex }} />
    </div>
  )
}
```

- [ ] **Step 2: Compose it in `CaptionedCut.tsx`** (above the captions so it's never occluded)

In `render-worker/src/remotion/CaptionedCut.tsx`, add the import and render `<ProgressBar>` last (top of the z-stack):

```tsx
import { AbsoluteFill } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"
import { CaptionLayer } from "./CaptionLayer.js"
import { SourceLayer } from "./SourceLayer.js"
import { ProgressBar } from "./ProgressBar.js"

export type CaptionedCutProps = {
  videoSrc: string
  pages: CaptionPage[]
  accentHex: string
}

export function CaptionedCut({ videoSrc, pages, accentHex }: CaptionedCutProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <SourceLayer videoSrc={videoSrc} />
      <CaptionLayer pages={pages} accentHex={accentHex} />
      <ProgressBar accentHex={accentHex} />
    </AbsoluteFill>
  )
}
```

- [ ] **Step 3: Build**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 4: Render stills across the timeline; verify the bar grows**

```bash
cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still-bar-f0.png --frame=0 --scale=0.5 --props=./_still-props.json
cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still-bar-f150.png --frame=150 --scale=0.5 --props=./_still-props.json
cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still-bar-f299.png --frame=299 --scale=0.5 --props=./_still-props.json
```

Read all three. Expected: a thin accent (`#c4936b`) bar across the very top — empty at frame 0, ~half-filled at 150, nearly full at 299 — over a faint white track. Confirm it doesn't collide with the captions (lower third). Leave PNGs on disk; report filenames.

- [ ] **Step 5: Commit**

```bash
git add render-worker/src/remotion/ProgressBar.tsx render-worker/src/remotion/CaptionedCut.tsx
git commit -m "feat(captioned-cut): brand-accent progress bar"
```
(same Co-Authored-By trailer)

---

## Task 4: Animated brand bug (corner `dj` text wordmark)

No external asset — renders a styled `dj` / `ATHLETE` lockup as text (the logo image can be swapped in later).

**Files:**
- Create: `render-worker/src/remotion/BrandBug.tsx`
- Modify: `render-worker/src/remotion/CaptionedCut.tsx`

- [ ] **Step 1: Create `BrandBug.tsx`**

Renders a `dj` wordmark (white) over a small letter-spaced `ATHLETE` (brand accent) in the top-left corner (clear of the top progress bar), fading in over the first ~0.5 s. Create `render-worker/src/remotion/BrandBug.tsx`:

```tsx
// render-worker/src/remotion/BrandBug.tsx
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { loadFont } from "@remotion/google-fonts/LexendExa"

// Reuse the brand heading font (idempotent — CaptionLayer also loads it).
const { fontFamily } = loadFont("normal", { weights: ["800"], subsets: ["latin"] })

export type BrandBugProps = {
  accentHex: string
}

export function BrandBug({ accentHex }: BrandBugProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // Fade in over the first ~0.5s, then hold for the rest of the clip.
  const opacity = interpolate(frame, [0, fps * 0.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <div
      style={{
        position: "absolute",
        top: 40,
        left: 48,
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        lineHeight: 1,
        fontFamily,
        // Shadow so the white wordmark reads over a bright frame.
        textShadow: "0 2px 10px rgba(0,0,0,0.7)",
      }}
    >
      <span style={{ fontWeight: 800, fontSize: 54, color: "white", letterSpacing: "-0.02em" }}>dj</span>
      <span style={{ fontWeight: 800, fontSize: 17, color: accentHex, letterSpacing: "0.4em", marginTop: 2 }}>
        ATHLETE
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Compose `<BrandBug>` in `CaptionedCut.tsx`** (top of the z-stack, with the bar)

```tsx
import { AbsoluteFill } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"
import { CaptionLayer } from "./CaptionLayer.js"
import { SourceLayer } from "./SourceLayer.js"
import { ProgressBar } from "./ProgressBar.js"
import { BrandBug } from "./BrandBug.js"

export type CaptionedCutProps = {
  videoSrc: string
  pages: CaptionPage[]
  accentHex: string
}

export function CaptionedCut({ videoSrc, pages, accentHex }: CaptionedCutProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <SourceLayer videoSrc={videoSrc} />
      <CaptionLayer pages={pages} accentHex={accentHex} />
      <ProgressBar accentHex={accentHex} />
      <BrandBug accentHex={accentHex} />
    </AbsoluteFill>
  )
}
```

- [ ] **Step 3: Build**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 4: Render a still and verify the brand bug**

Run: `cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still-bug-f21.png --frame=21 --scale=0.5 --props=./_still-props.json`
(frame 21 ≈ 0.7 s → past the 0.5 s fade-in, so fully opaque.)
Read `render-worker/_still-bug-f21.png`. Expected: the `dj` wordmark (white) over a small accent `ATHLETE` sits in the top-left corner (just below the progress bar), fully faded in, legible over the video. Confirm it doesn't overlap the progress bar or the captions. Leave the PNG on disk; report its filename. If size/position is off, note it for build-time tuning (the `fontSize` / `top` / `left`) — don't change the spec values yourself.

- [ ] **Step 5: Commit** (source only, explicit paths)

```bash
git add render-worker/src/remotion/BrandBug.tsx render-worker/src/remotion/CaptionedCut.tsx
git commit -m "feat(captioned-cut): animated corner brand bug (dj text wordmark)"
```
(same Co-Authored-By trailer)

---

## Task 5: Deploy + Cloud render acceptance

**Files:** none (deploy + verify). **Ask the user before deploying — this is a prod deploy of the render worker.**

- [ ] **Step 1: Deploy the worker** (same prod config as M3)

```bash
gcloud run jobs deploy captioned-cut-render --source render-worker \
  --region us-central1 --project darrenjpaulcom \
  --service-account captioned-cut-render@darrenjpaulcom.iam.gserviceaccount.com \
  --memory 16Gi --cpu 4 --task-timeout 1800s --max-retries 1 \
  --set-secrets "SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,ASSEMBLYAI_API_KEY=ASSEMBLYAI_API_KEY:latest" \
  --set-env-vars "FIREBASE_STORAGE_BUCKET=darrenjpaulcom.firebasestorage.app"
```
Expected: "Job [captioned-cut-render] has successfully been deployed."

- [ ] **Step 2: Render the test video**

```bash
gcloud run jobs execute captioned-cut-render --region us-central1 --project darrenjpaulcom \
  --update-env-vars AI_JOB_ID=23Ll7ee0ZWX1qp9Vh423,VIDEO_UPLOAD_ID=396afdd4-4ebc-4eaa-b39a-da074bca0285 --wait
```
Expected: exit 0; logs show `step=render ok` then the execution "successfully completed"; no `No frame found`. (Re-running reuses the doc and creates a fresh `media_assets` row — the harmless test-data dup.)

- [ ] **Step 3: Download the result + sample frames**

Find the newest captioned-cut asset (Supabase: newest `media_assets` row with `derived_from_video_id='396afdd4-4ebc-4eaa-b39a-da074bca0285'` and `ai_analysis->>'origin'='captioned_cut'`), download it, and build a grid:

```bash
gcloud storage cp "gs://darrenjpaulcom.firebasestorage.app/<storage_path>" ./_m4.mp4 --project darrenjpaulcom
ffmpeg -y -i _m4.mp4 -vf "fps=1/6,scale=170:302,tile=3x5" -frames:v 1 _m4grid.png
```
Read `_m4grid.png` (and pull a couple of full-res detail frames, e.g. `ffmpeg -y -ss 6 -i _m4.mp4 -frames:v 1 -vf scale=620:-1 _m4det.png`). Expected across the timeline: the **progress bar** fills L→R along the top; the **brand bug** is present top-left from ~0.5 s on; the source shows a **subtle punch-in** (slightly tighter framing late vs early); and the **M3 captions still render correctly** (bounce/emphasis/outline/pill/entrance, lower third, no gaps). No clipping, no missing logo, no crash.

- [ ] **Step 4: Clean scratch** (do not commit grids/frames/mp4 — they are NOT gitignored at the repo root)

```bash
rm -f _m4.mp4 _m4grid.png _m4det.png render-worker/_still*.png render-worker/_still-props.json
```

M4a is complete when the frames confirm the zoom + progress bar + brand bug all render correctly over the real video **without regressing the M3 captions.**

---

## Self-Review

**Spec coverage (M4 §5, the Tier-2 items that belong to M4a):** punch-in zoom → Task 2 ✓; progress bar → Task 3 ✓; brand bug → Task 4 ✓; composition decomposition (SourceLayer extracted; ProgressBar/BrandBug added) → Tasks 1/3/4 ✓. **Deferred to M4b (out of scope here, by decision):** hook card + caption SFX (need panel/route/job-input plumbing + user SFX assets). The "optional snap on emphasis beats" for the zoom (spec §5 M4.1) is intentionally omitted — it would couple SourceLayer to caption word-timings; the slow zoom is the core (YAGNI), and bounce intensity is a build-time still decision (spec §9).

**No new inputProps / app changes:** verified — `CaptionedCutProps` is unchanged (`videoSrc`, `pages`, `accentHex`); the zoom/bar derive from `useVideoConfig().durationInFrames`, the bug is pure text. **No `index.ts`/Dockerfile/route/validator/panel/DB edits and no Vercel deploy** — `gcloud` only.

**Placeholders:** none — every code step shows the actual component/diff; commands have expected output. Task 5 Step 3 leaves the storage-path lookup as a described one-liner because the asset id isn't known until render time (the mechanism — newest `media_assets` row for the video — is explicit, and is the same lookup used successfully in M3).

**Type consistency:** `SourceLayerProps { videoSrc: string }`, `ProgressBarProps { accentHex: string }`, and `BrandBugProps { accentHex: string }` are consistent across their create/compose tasks; `CaptionedCut` passes exactly those.

**Gating:** all tasks unblocked (no external assets). Task 5 is a prod deploy of the worker.
