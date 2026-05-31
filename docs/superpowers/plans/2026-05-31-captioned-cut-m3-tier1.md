# Captioned Cut — M3 (Tier 1: Caption Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the burned-in captions from a flat scale-pop to trend-grade motion — spring bounce, keyword emphasis, crisp outline, active-word highlight pill, and per-word entrance — while keeping the brand font/accent, lower-third position, and gap-fill already shipped.

**Architecture:** Add per-word `emphasis` detection to the pure `caption-paging` helper (canonical + worker twin), then extract the caption rendering out of `CaptionedCut.tsx` into a focused `CaptionLayer.tsx` and enhance it. Logic is unit-tested (Vitest); the visual changes are verified with the proven local-still loop (`remotion still` on the compiled entry → Read the PNG) before a final Cloud render.

**Tech Stack:** Remotion 4.0.469 (`spring`, `interpolate`, `useCurrentFrame`), `@remotion/google-fonts/LexendExa`, TypeScript, Vitest, ffmpeg (frame sampling), Cloud Run job `captioned-cut-render`.

**Scope:** This is **M3 of 3** (see `docs/superpowers/specs/2026-05-31-captioned-cut-pro-upgrade-design.md`). M4 (energy) and M5 (production) get their own plans after M3 ships. M3 is pure render-worker composition + the `caption-paging` helper — **no app, DB, or panel changes.**

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `lib/content-studio/caption-paging.ts` | canonical pager + new `isEmphasisWord` + `emphasis` field | Modify |
| `render-worker/src/lib/caption-paging.ts` | worker twin (must match canonical behavior) | Modify |
| `__tests__/lib/content-studio/caption-paging.test.ts` | unit tests incl. emphasis | Modify |
| `render-worker/src/remotion/CaptionLayer.tsx` | all caption rendering (bounce, emphasis, outline, pill, entrance) | Create |
| `render-worker/src/remotion/CaptionedCut.tsx` | composes source video + `<CaptionLayer>` | Modify |
| `render-worker/src/remotion/Root.tsx` | sample props (now need `emphasis`) | Modify |

> Decomposition note: M3 only extracts **`CaptionLayer`** (the part it changes). `SourceLayer`, `HookCard`, `ProgressBar`, `BrandBug`, `AudioLayer` are extracted in M4/M5 when their features land. Don't pre-create them here (YAGNI).

---

## Task 1: Add `emphasis` detection to the canonical pager

**Files:**
- Modify: `lib/content-studio/caption-paging.ts`
- Test: `__tests__/lib/content-studio/caption-paging.test.ts`

- [ ] **Step 1: Write failing tests for `isEmphasisWord` + the `emphasis` field**

Add to `__tests__/lib/content-studio/caption-paging.test.ts` (new import + new describe block):

```typescript
import { pageCaptions, isEmphasisWord, type TranscriptWord } from "@/lib/content-studio/caption-paging"

describe("isEmphasisWord", () => {
  it("emphasizes words containing a number (reps, %, etc.)", () => {
    expect(isEmphasisWord("5")).toBe(true)
    expect(isEmphasisWord("20%")).toBe(true)
    expect(isEmphasisWord("3x")).toBe(true)
  })
  it("emphasizes ALL-CAPS words of 2+ letters", () => {
    expect(isEmphasisWord("STOP")).toBe(true)
    expect(isEmphasisWord("go")).toBe(false)
    expect(isEmphasisWord("I")).toBe(false) // single letter
  })
  it("emphasizes long (>=7 letter) content words", () => {
    expect(isEmphasisWord("deceleration")).toBe(true)
    expect(isEmphasisWord("ankle")).toBe(false)
  })
  it("emphasizes power words regardless of length", () => {
    expect(isEmphasisWord("never")).toBe(true)
    expect(isEmphasisWord("key")).toBe(true)
  })
  it("returns false for short filler and empty input", () => {
    expect(isEmphasisWord("the")).toBe(false)
    expect(isEmphasisWord("")).toBe(false)
    expect(isEmphasisWord("  ")).toBe(false)
  })
})
```

- [ ] **Step 2: Update the existing word-shape assertion (it will break when `emphasis` is added)**

In the same file, change the single-word assertion (currently `expect(pages[0].words).toEqual([{ text: "go", startMs: 100, endMs: 400 }])`) to include the new field:

```typescript
    expect(pages[0].words).toEqual([{ text: "go", startMs: 100, endMs: 400, emphasis: false }])
```

(The other assertions use `.text`/`.startMs`/`.endMs`/`.map(p => p.text)` and are unaffected.)

- [ ] **Step 3: Run the tests — verify they fail**

Run: `npx vitest run __tests__/lib/content-studio/caption-paging.test.ts`
Expected: FAIL — `isEmphasisWord` is not exported; the `toEqual` word-shape check fails (no `emphasis`).

- [ ] **Step 4: Implement `isEmphasisWord` + the `emphasis` field in the canonical pager**

In `lib/content-studio/caption-paging.ts`: add `emphasis: boolean` to `CaptionPageWord`, add the exported `isEmphasisWord`, and set `emphasis` in the `.map`:

```typescript
export interface CaptionPageWord {
  text: string
  startMs: number
  endMs: number
  emphasis: boolean
}
```

Add above `pageCaptions` (after the `DEFAULT_MAX_WORDS_PER_PAGE` const):

```typescript
// Words worth visually emphasizing in captions (Hormozi-style keyword pop). Kept
// deliberately small; the visual aggressiveness is tuned in the composition.
const POWER_WORDS = new Set([
  "never", "always", "every", "best", "worst", "most", "key", "secret", "proven",
  "elite", "stop", "start", "must", "critical", "essential", "power", "strong",
  "fast", "faster", "explosive", "mistake", "truth", "results", "win", "change",
])

/** Should this caption word be visually emphasized? Numbers, ALL-CAPS, long
 *  content words (>=7 letters), or a small power-word list. Pure + deterministic. */
export function isEmphasisWord(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/\d/.test(t)) return true
  const letters = t.replace(/[^A-Za-z]/g, "")
  if (letters.length >= 2 && letters === letters.toUpperCase()) return true
  const word = letters.toLowerCase()
  if (word.length >= 7) return true
  return POWER_WORDS.has(word)
}
```

In the `.map<CaptionPageWord>` inside `pageCaptions`, add the field:

```typescript
    .map<CaptionPageWord>((w) => ({
      text: w.text.trim(),
      startMs: w.start,
      endMs: Math.max(w.start, w.end), // clamp inverted ranges
      emphasis: isEmphasisWord(w.text),
    }))
```

- [ ] **Step 5: Run the tests — verify they pass**

Run: `npx vitest run __tests__/lib/content-studio/caption-paging.test.ts`
Expected: PASS (all, including the new `isEmphasisWord` block).

- [ ] **Step 6: Commit**

```bash
git add lib/content-studio/caption-paging.ts __tests__/lib/content-studio/caption-paging.test.ts
git commit -m "feat(captioned-cut): per-word emphasis detection in caption-paging"
```

---

## Task 2: Sync the worker twin + keep Root sample building

**Files:**
- Modify: `render-worker/src/lib/caption-paging.ts`
- Modify: `render-worker/src/remotion/Root.tsx`
- Test: `__tests__/render-worker/caption-paging-twin.test.ts` (existing — must stay green)

- [ ] **Step 1: Apply the identical change to the worker twin**

Make `render-worker/src/lib/caption-paging.ts` match the canonical from Task 1 exactly — add `emphasis: boolean` to `CaptionPageWord`, the same `POWER_WORDS` + `isEmphasisWord` (export it), and `emphasis: isEmphasisWord(w.text)` in the `.map`. (Behavior must be identical; the twin test compares outputs.)

- [ ] **Step 2: Update the Root sample props to include `emphasis`**

`render-worker/src/remotion/Root.tsx` builds a `SAMPLE` with hand-written words. Now that `CaptionPageWord` requires `emphasis`, add it to each sample word:

```tsx
      words: [
        { text: "let's", startMs: 0, endMs: 400, emphasis: false },
        { text: "get", startMs: 400, endMs: 800, emphasis: false },
      ],
```

- [ ] **Step 3: Run the twin parity test + build the worker**

Run: `npx vitest run __tests__/render-worker/caption-paging-twin.test.ts`
Expected: PASS (worker twin output === canonical output for every case).

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0 (Root sample now type-checks against the new `CaptionPageWord`).

- [ ] **Step 4: Commit**

```bash
git add render-worker/src/lib/caption-paging.ts render-worker/src/remotion/Root.tsx
git commit -m "feat(captioned-cut): sync caption-paging twin with emphasis field"
```

---

## Task 3: Extract `CaptionLayer` (pure refactor — no visual change)

**Files:**
- Create: `render-worker/src/remotion/CaptionLayer.tsx`
- Modify: `render-worker/src/remotion/CaptionedCut.tsx`

- [ ] **Step 1: Create `CaptionLayer.tsx` with the CURRENT caption rendering**

This moves the existing caption JSX out of `CaptionedCut` verbatim (same gap-fill, position, font, accent, current pop) so output is unchanged. Create `render-worker/src/remotion/CaptionLayer.tsx`:

```tsx
// render-worker/src/remotion/CaptionLayer.tsx
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { loadFont } from "@remotion/google-fonts/LexendExa"
import type { CaptionPage } from "../lib/caption-paging.js"

const { fontFamily } = loadFont("normal", { weights: ["800"], subsets: ["latin"] })

export function CaptionLayer({ pages, accentHex }: { pages: CaptionPage[]; accentHex: string }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000

  let page: CaptionPage | null = null
  for (let i = 0; i < pages.length; i += 1) {
    const start = pages[i].startMs
    const end = i + 1 < pages.length ? pages[i + 1].startMs : pages[i].endMs
    if (ms >= start && ms < end) {
      page = pages[i]
      break
    }
  }
  if (!page) return null

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: "0 72px 420px" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "16px 36px",
          fontFamily,
          fontWeight: 800,
          fontSize: 88,
          lineHeight: 1.18,
          textAlign: "center",
          textShadow: "0 4px 24px rgba(0,0,0,0.85), 0 2px 6px rgba(0,0,0,0.9)",
        }}
      >
        {page.words.map((wd, i) => {
          const active = ms >= wd.startMs && ms < wd.endMs
          const pop = active
            ? interpolate(ms - wd.startMs, [0, 90], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
            : 0
          return (
            <span
              key={i}
              style={{
                color: active ? accentHex : "white",
                transform: `scale(${1 + 0.08 * pop})`,
                transformOrigin: "center",
                display: "inline-block",
              }}
            >
              {wd.text}
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
```

- [ ] **Step 2: Replace the inline caption JSX in `CaptionedCut.tsx` with `<CaptionLayer>`**

In `render-worker/src/remotion/CaptionedCut.tsx`: remove the `loadFont`, the page-selection loop, and the caption `<AbsoluteFill>`/`<div>` block; keep the `<OffthreadVideo>`. Result:

```tsx
// render-worker/src/remotion/CaptionedCut.tsx
import { AbsoluteFill, OffthreadVideo } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"
import { CaptionLayer } from "./CaptionLayer.js"

export type CaptionedCutProps = {
  videoSrc: string
  pages: CaptionPage[]
  accentHex: string
}

export function CaptionedCut({ videoSrc, pages, accentHex }: CaptionedCutProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <OffthreadVideo src={videoSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <CaptionLayer pages={pages} accentHex={accentHex} />
    </AbsoluteFill>
  )
}
```

- [ ] **Step 3: Build the worker**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 4: Create the still-test props file** (reused by later tasks)

Create `render-worker/_still-props.json` (scratch — do NOT commit):

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

- [ ] **Step 5: Render a still and verify it looks identical to today's captions**

Run: `cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still.png --frame=21 --scale=0.5 --props=./_still-props.json`
(frame 21 ≈ 700 ms → "mistakes" active.)
Then open `render-worker/_still.png` (Read it). Expected: caption in lower third, Lexend Exa, "mistakes" in accent `#c4936b`, white others — i.e. the current look, unchanged by the refactor.

- [ ] **Step 6: Commit** (the scratch props/png are gitignored by the next step; commit only source)

```bash
git add render-worker/src/remotion/CaptionLayer.tsx render-worker/src/remotion/CaptionedCut.tsx
git commit -m "refactor(captioned-cut): extract CaptionLayer (no visual change)"
```

- [ ] **Step 7: Ignore scratch render artifacts**

Append to `render-worker/.gitignore` (create if absent):

```
_still*.png
_still-props.json
```

```bash
git add render-worker/.gitignore && git commit -m "chore(captioned-cut): gitignore still-test scratch files"
```

---

## Task 4: Spring bounce on the active word

**Files:**
- Modify: `render-worker/src/remotion/CaptionLayer.tsx`

- [ ] **Step 1: Replace the linear `interpolate` pop with a `spring` bounce**

In `CaptionLayer.tsx`, update the import and the active-word scale. Change the import line to:

```tsx
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion"
```

Replace the `const pop = active ? interpolate(...) : 0` and the `transform` with a spring keyed to when the word became active:

```tsx
          const active = ms >= wd.startMs && ms < wd.endMs
          // Spring "bounce": overshoot then settle, starting when the word goes active.
          const startFrame = (wd.startMs / 1000) * fps
          const bounce = active
            ? spring({ frame: frame - startFrame, fps, config: { damping: 9, stiffness: 180, mass: 0.5 } })
            : 0
          const scale = 1 + 0.14 * bounce
          return (
            <span
              key={i}
              style={{
                color: active ? accentHex : "white",
                transform: `scale(${scale})`,
                transformOrigin: "center",
                display: "inline-block",
              }}
            >
              {wd.text}
            </span>
          )
```

- [ ] **Step 2: Build**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0 (no remaining `interpolate` import needed — remove it if `tsc` flags it unused).

- [ ] **Step 3: Render stills at the start and settle of the active word; verify the bounce**

Run both, Reading each PNG:
`cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still.png --frame=12 --scale=0.5 --props=./_still-props.json` (≈400 ms, just-active "mistakes" → larger, mid-overshoot)
`... --frame=21 ...` (≈700 ms, settled → near 1.0 scale)
Expected: the active word is visibly larger right after it becomes active, then settles — a "pop," not a static size.

- [ ] **Step 4: Commit**

```bash
git add render-worker/src/remotion/CaptionLayer.tsx
git commit -m "feat(captioned-cut): spring bounce on the active caption word"
```

---

## Task 5: Crisp outline (text stroke)

**Files:**
- Modify: `render-worker/src/remotion/CaptionLayer.tsx`

- [ ] **Step 1: Add a stroke to the caption container style**

In the caption `<div>` style object in `CaptionLayer.tsx`, add these properties (keep the existing `textShadow` for depth):

```tsx
            WebkitTextStroke: "3px rgba(0,0,0,0.92)",
            paintOrder: "stroke fill",
```

- [ ] **Step 2: Build**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0. (If TS complains about `paintOrder`/`WebkitTextStroke` on the style type, cast the style object `as React.CSSProperties` — both are valid CSS Remotion's Chromium renders.)

- [ ] **Step 3: Render a still and verify the outline**

Run: `cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still.png --frame=21 --scale=0.5 --props=./_still-props.json`
Read `_still.png`. Expected: each letter has a clean thick black outline (legible over any background), with the fill (white / accent) inside the stroke (not covered by it).

- [ ] **Step 4: Commit**

```bash
git add render-worker/src/remotion/CaptionLayer.tsx
git commit -m "feat(captioned-cut): bold text outline for caption legibility"
```

---

## Task 6: Keyword emphasis rendering

**Files:**
- Modify: `render-worker/src/remotion/CaptionLayer.tsx`

- [ ] **Step 1: Render emphasized words larger + always-accent**

In the `page.words.map(...)`, read `wd.emphasis` and apply a larger size + accent color (emphasized words stay accent even when not the active word; active still bounces). Replace the `<span>` block with:

```tsx
          const active = ms >= wd.startMs && ms < wd.endMs
          const startFrame = (wd.startMs / 1000) * fps
          const bounce = active
            ? spring({ frame: frame - startFrame, fps, config: { damping: 9, stiffness: 180, mass: 0.5 } })
            : 0
          const scale = 1 + 0.14 * bounce
          const color = active || wd.emphasis ? accentHex : "white"
          return (
            <span
              key={i}
              style={{
                color,
                fontSize: wd.emphasis ? "1.18em" : "1em",
                transform: `scale(${scale})`,
                transformOrigin: "center",
                display: "inline-block",
              }}
            >
              {wd.text}
            </span>
          )
```

- [ ] **Step 2: Build**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 3: Render a still and verify emphasis**

Run: `cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still.png --frame=45 --scale=0.5 --props=./_still-props.json`
(≈1500 ms → "make" active; "5"/"mistakes"/"athletes" are `emphasis:true`.)
Read `_still.png`. Expected: the emphasized words ("5", "mistakes", "athletes") render larger + accent; "make" (non-emphasis, active) bounces in accent. Confirm it reads as tasteful, not every-word-huge — if too aggressive, note for build-time tuning (reduce `1.18em` or tighten `isEmphasisWord`).

- [ ] **Step 4: Commit**

```bash
git add render-worker/src/remotion/CaptionLayer.tsx
git commit -m "feat(captioned-cut): keyword emphasis (size + accent) on key words"
```

---

## Task 7: Active-word highlight pill

**Files:**
- Modify: `render-worker/src/remotion/CaptionLayer.tsx`

- [ ] **Step 1: Add a rounded accent background behind the active word**

Give the active `<span>` a translucent accent pill. Update the `<span>` style to add background + padding + radius **only when active** (keep emphasis/bounce logic from Task 6):

```tsx
              style={{
                color: active ? "#0E3F50" : wd.emphasis ? accentHex : "white",
                fontSize: wd.emphasis ? "1.18em" : "1em",
                transform: `scale(${scale})`,
                transformOrigin: "center",
                display: "inline-block",
                backgroundColor: active ? accentHex : "transparent",
                borderRadius: active ? "12px" : 0,
                padding: active ? "0 14px" : 0,
                WebkitTextStrokeColor: active ? "transparent" : undefined,
              }}
```

(When the word is in its accent pill, switch its text to the dark brand primary `#0E3F50` for contrast against the accent fill, and drop the black stroke on the pilled word so it stays clean.)

- [ ] **Step 2: Build**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 3: Render a still and verify the pill**

Run: `cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still.png --frame=21 --scale=0.5 --props=./_still-props.json`
Read `_still.png`. Expected: the active word sits in a rounded accent (`#c4936b`) pill with dark text; neighbors are white/accent with outline. Confirm the pill doesn't collide with neighbors (the `gap: 16px 36px` should hold; if tight, note for tuning).

- [ ] **Step 4: Commit**

```bash
git add render-worker/src/remotion/CaptionLayer.tsx
git commit -m "feat(captioned-cut): active-word highlight pill"
```

---

## Task 8: Per-word entrance

**Files:**
- Modify: `render-worker/src/remotion/CaptionLayer.tsx`

- [ ] **Step 1: Add a spring entrance (rise + fade) as each word appears**

Each word fades + rises into place over ~180 ms starting at its `startMs`. Add an `enter` value and apply `opacity` + a `translateY` combined with the existing `scale`:

```tsx
          const startFrame = (wd.startMs / 1000) * fps
          const enter = spring({
            frame: frame - startFrame,
            fps,
            config: { damping: 200 }, // no overshoot for the entrance itself
            durationInFrames: Math.round(0.18 * fps),
          })
          const active = ms >= wd.startMs && ms < wd.endMs
          const bounce = active
            ? spring({ frame: frame - startFrame, fps, config: { damping: 9, stiffness: 180, mass: 0.5 } })
            : 0
          const scale = 1 + 0.14 * bounce
```

Then in the `<span>` style, set `opacity: enter` and include the rise in the transform:

```tsx
                opacity: enter,
                transform: `translateY(${(1 - enter) * 24}px) scale(${scale})`,
```

(Replace the existing standalone `transform: scale(...)` line with this combined transform; keep the rest of the style from Task 7.)

- [ ] **Step 2: Build**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 3: Render stills mid-entrance and settled; verify**

Run, Reading each:
`cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still.png --frame=11 --scale=0.5 --props=./_still-props.json` (≈360 ms — "mistakes" rising/fading in)
`... --frame=21 ...` (settled)
Expected: at frame 11 a just-appeared word is slightly lower + semi-transparent; by frame 21 it's in place at full opacity.

- [ ] **Step 4: Clean scratch + commit**

```bash
cd render-worker && rm -f _still.png _still-props.json
cd .. && git add render-worker/src/remotion/CaptionLayer.tsx
git commit -m "feat(captioned-cut): per-word caption entrance (rise + fade)"
```

---

## Task 9: Deploy + Cloud render acceptance

**Files:** none (deploy + verify)

- [ ] **Step 1: Deploy the worker** (same config as production)

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
Expected: exit 0; logs show `step=render ok` then `Container called exit(0)`; no `No frame found`.

- [ ] **Step 3: Download the result + sample frames**

```bash
storage_path=$(... newest captioned_cut asset for 396afdd4 ...)   # via Supabase: media_assets order by created_at desc
gcloud storage cp "gs://darrenjpaulcom.firebasestorage.app/<storage_path>" /tmp/m3.mp4 --project darrenjpaulcom
ffmpeg -y -i /tmp/m3.mp4 -vf "fps=1/6,scale=170:302,tile=3x5" -frames:v 1 _m3grid.png
```
Read `_m3grid.png`. Expected: across the timeline — bounce + emphasis + outline + pill + entrance all visible over real content, captions in lower third, brand accent, no gaps. Extract a full-res frame (`ffmpeg -y -ss 24 -i /tmp/m3.mp4 -frames:v 1 -vf scale=600:-1 _m3frame.png`) to confirm detail.

- [ ] **Step 4: Clean scratch (do not commit grids/frames)**

```bash
rm -f _m3grid.png _m3frame.png
```

M3 is complete when the frames confirm all five caption upgrades render correctly over the real video.

---

## Self-Review

**Spec coverage (M3 section of the design):** spring bounce → Task 4 ✓; keyword emphasis (detection + render) → Tasks 1/2 + 6 ✓; outline → Task 5 ✓; highlight pill → Task 7 ✓; word entrance → Task 8 ✓; composition decomposition (CaptionLayer) → Task 3 ✓; twin-copy obligation → Task 2 ✓. Emoji (spec-optional, needs Noto font) is intentionally deferred — noted in the spec as "if skipped, no behavior change"; not in M3.

**Placeholders:** none — every code step shows the actual code; commands have expected output. (Task 9 Step 3 leaves the storage-path lookup as a one-liner description because the asset id isn't known until render time; the mechanism — newest `media_assets` row for the video — is explicit.)

**Type consistency:** `CaptionPageWord` gains `emphasis: boolean` in both copies (Tasks 1–2); `CaptionLayer` props `{ pages: CaptionPage[]; accentHex: string }` are consistent across Tasks 3–8; `CaptionedCut` passes exactly those. `isEmphasisWord` signature `(text: string) => boolean` is consistent.
