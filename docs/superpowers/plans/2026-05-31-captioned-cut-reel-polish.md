# Captioned Cut — Reel Polish (Audio + Overlays) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generated SFX layer (pop + whoosh), a low royalty-free music bed, and procedural overlay graphics (animated brand-accent corner brackets + a subtle caption-page transition) to the captioned cut — tuned for a professional coaching brand.

**Architecture:** A new `AudioLayer` (Remotion `<Audio>`) mixes a looped low-volume music track + a soft pop scheduled at each caption page + a whoosh on the hook, all from baked-in `staticFile` assets. A new `AccentGraphics` layer draws two accent corner brackets in. `CaptionLayer` gains a subtle page-level scale-pop. Music selection is threaded panel → route → `ai_jobs.input.music` → worker → `inputProps.music`, exactly like the M4b hook. Worker reads `input.music` with a sensible default.

**Tech Stack:** Remotion 4.x (`Audio`, `Sequence`, `staticFile`, `loop`, `interpolate`, `spring`), ffmpeg (SFX synthesis + audio verification), curl (Pixabay download), Zod + Next route + React panel (Part B), the Cloud Run job `captioned-cut-render`.

**Scope:** Implements `docs/superpowers/specs/2026-05-31-captioned-cut-reel-polish-design.md`. **Part A** (Tasks A1–A7) is worker-only (gcloud deploy, no Vercel) and ships the whole look + sound with a default music track. **Part B** (Tasks B1–B4) adds the panel music picker (app → Vercel). The worker reads `input.music` already in Part A, so Part B needs **no worker redeploy**.

---

## Environment gotchas (carried from M3/M4 — read first)

1. **Grep/Glob misfire** here (space in path). Use `git grep` via Bash. Read works with absolute paths and renders PNGs.
2. **gcloud default project is wrong** → ALWAYS `--project darrenjpaulcom`.
3. **Worker bundles the COMPILED `dist/` entry**; always `cd render-worker && npm run build` before `remotion still`. The `public/` dir already ships in the image (`COPY public ./public`) and resolves via `bundle({ publicDir })` (done in the logo work) — so `staticFile("sfx/...")` / `staticFile("music/...")` will resolve.
4. **Local `remotion still` needs a reachable test video** — `https://www.w3schools.com/html/mov_bbb.mp4` (in `_still-props.json`).
5. **Brand accent `#c4936b`**, brand primary `#0E3F50`.
6. **render-worker builds independently** (`cd render-worker && npm run build` exits 0). The app repo has ~150 pre-existing unrelated tsc errors — for the Part B app files, verify only that your touched files add no new errors (`npx tsc --noEmit | grep <file>`).
7. **Commit with EXPLICIT `git add` paths** (never `git add -A`) so scratch `_still*.png`/`_still-props.json`/`_probe*`/`_audio*` are never staged. Solo-dev: commit **directly to `main`**. `C:/Users/tayaw` is itself a git repo — never `cd ..` past project root in git chains. Bash + heredoc for commit messages, ending with a blank line then `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
8. **Audio can't be still-verified.** SFX/music are verified at the Cloud render (A7) via `ffprobe` (audio stream present) + `ffmpeg volumedetect` (not clipping) + a `showwavespic` waveform PNG + the **user spot-listens** the saved mp4. Component tasks (A3) verify only that the build is green and a still shows no visual regression.
9. **Part A deploy (gcloud) and Part B push (Vercel) are prod deploys** — the user has authorized them for this work.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `render-worker/public/sfx/{pop,whoosh}.mp3` | generated SFX (owned) | Add (A1) |
| `render-worker/public/music/*.mp3` + `LICENSES.md` | royalty-free music (Pixabay) + license record | Add (A2) |
| `render-worker/src/remotion/AudioLayer.tsx` | music bed + scheduled SFX | Create (A3) |
| `render-worker/src/remotion/AccentGraphics.tsx` | accent corner brackets (draw-in) | Create (A4) |
| `render-worker/src/remotion/CaptionLayer.tsx` | + subtle page-level scale pop | Modify (A5) |
| `render-worker/src/remotion/CaptionedCut.tsx` | compose AudioLayer + AccentGraphics; `music?` prop | Modify (A3/A4) |
| `render-worker/src/index.ts` | read `input.music` (default track); inputProps `music` | Modify (A6) |
| `lib/validators/captioned-cut.ts` | + optional `music` | Modify (B1) |
| `__tests__/lib/validators/captioned-cut.test.ts` | + `music` cases | Modify (B1) |
| `app/api/admin/content-studio/captioned-cut/route.ts` | forward `music` into job input | Modify (B2) |
| `components/admin/content-studio/drawer/CaptionedCutPanel.tsx` | music `<select>` | Modify (B3) |

---

# PART A — Worker (look + sound; gcloud only, no Vercel)

## Task A1: Generate SFX (pop + whoosh)

**Files:** Add `render-worker/public/sfx/pop.mp3`, `render-worker/public/sfx/whoosh.mp3`

- [ ] **Step 1: Synthesize the SFX with ffmpeg**

```bash
mkdir -p render-worker/public/sfx
# pop — short soft sine blip (fast attack, quick decay, low-passed)
ffmpeg -y -f lavfi -i "sine=frequency=660:duration=0.09" \
  -af "afade=t=in:st=0:d=0.004,afade=t=out:st=0.012:d=0.078,lowpass=f=2400,volume=0.7" \
  -ac 2 -ar 44100 -b:a 192k render-worker/public/sfx/pop.mp3
# whoosh — band-limited pink-noise swell (fade in/out)
ffmpeg -y -f lavfi -i "anoisesrc=d=0.4:c=pink:a=0.5" \
  -af "highpass=f=420,lowpass=f=7000,afade=t=in:st=0:d=0.16,afade=t=out:st=0.2:d=0.2,volume=1.2" \
  -ac 2 -ar 44100 -b:a 192k render-worker/public/sfx/whoosh.mp3
```

- [ ] **Step 2: Validate both are clean short MP3s**

```bash
for f in pop whoosh; do echo "== $f =="; ffprobe -v error -show_entries format=duration,format_name:stream=codec_name,channels -of default=noprint_wrappers=1 render-worker/public/sfx/$f.mp3; done
```
Expected: `codec_name=mp3`, `channels=2`, pop `duration≈0.09`, whoosh `duration≈0.4`.

- [ ] **Step 3: Commit** (these are owned/CC0 — committed)

```bash
git add render-worker/public/sfx/pop.mp3 render-worker/public/sfx/whoosh.mp3
git commit -m "feat(captioned-cut): generated pop + whoosh SFX (owned)"
```

> Timbre/level are tuned later via the user spot-listen (spec §9); these recipes are the starting point.

---

## Task A2: Pull royalty-free music (Pixabay) + license record

**Files:** Add `render-worker/public/music/*.mp3`, `render-worker/public/music/LICENSES.md`

Pixabay Content License = commercial use OK, **no attribution required**. The download method is proven: curl the track page with a browser UA → grep the `cdn.pixabay.com/download/audio/...mp3` URL → download with a Pixabay referer → validate with ffprobe.

- [ ] **Step 1: Download the curated coaching-vibe tracks**

```bash
mkdir -p render-worker/public/music
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
dl() {  # $1 = pixabay page URL, $2 = output filename
  local cdn
  cdn=$(curl -sL -A "$UA" --max-time 30 "$1" | grep -oE "https://cdn\.pixabay\.com/[^\"']*\.mp3[^\"']*" | head -1)
  if [ -z "$cdn" ]; then echo "NO CDN URL for $1"; return 1; fi
  curl -sL -A "$UA" -e "https://pixabay.com/" --max-time 120 -o "render-worker/public/music/$2" "$cdn" || return 1
  echo "downloaded $2 <- $cdn"
}
dl "https://pixabay.com/music/main-title-inspiring-cinematic-music-409347/" "motivational-cinematic.mp3"
dl "https://pixabay.com/music/modern-classical-inspirational-cinematic-motivational-music-379731/" "inspirational.mp3"
dl "https://pixabay.com/music/main-title-cinematic-motivational-136831/" "cinematic.mp3"
```

- [ ] **Step 2: Validate each is a clean MP3 (≥30s)**

```bash
for f in render-worker/public/music/*.mp3; do echo "== $f =="; ffprobe -v error -show_entries format=duration:stream=codec_name,channels,sample_rate -of default=noprint_wrappers=1 "$f"; done
```
Expected: each `codec_name=mp3`, stereo, duration ≥ 30s. **If a track fails to download or validate**, replace it: `curl -sL -A "$UA" "https://pixabay.com/music/search/motivational%20cinematic/" | grep -oE "/music/[a-z0-9-]+-[0-9]+/" | sort -u | head` to find another track slug, then `dl "https://pixabay.com$SLUG" "<name>.mp3"`. Keep at least 2 valid tracks; `motivational-cinematic.mp3` is the default and must be present.

- [ ] **Step 3: Record licenses** — create `render-worker/public/music/LICENSES.md`:

```markdown
# Music licenses

All tracks are royalty-free under the **Pixabay Content License**
(https://pixabay.com/service/license-summary/) — free for commercial use, no
attribution required. Downloaded 2026-05-31.

| File | Source (Pixabay) |
|---|---|
| motivational-cinematic.mp3 | https://pixabay.com/music/main-title-inspiring-cinematic-music-409347/ |
| inspirational.mp3 | https://pixabay.com/music/modern-classical-inspirational-cinematic-motivational-music-379731/ |
| cinematic.mp3 | https://pixabay.com/music/main-title-cinematic-motivational-136831/ |
```
(Update the table to match the tracks actually kept.)

- [ ] **Step 4: Commit**

```bash
git add render-worker/public/music
git commit -m "feat(captioned-cut): royalty-free music bed tracks (Pixabay license)"
```

---

## Task A3: `AudioLayer` (music bed + SFX) + compose

**Files:** Create `render-worker/src/remotion/AudioLayer.tsx`; Modify `render-worker/src/remotion/CaptionedCut.tsx`

- [ ] **Step 1: Create `AudioLayer.tsx`**

```tsx
// render-worker/src/remotion/AudioLayer.tsx
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"

export type AudioLayerProps = {
  pages: CaptionPage[]
  music?: { track: string }
  hasHook: boolean
}

// Low bed so the coaching voice stays primary; SFX accent, not dominate.
const MUSIC_VOLUME = 0.14
const POP_VOLUME = 0.45
const WHOOSH_VOLUME = 0.6

export function AudioLayer({ pages, music, hasHook }: AudioLayerProps) {
  const { fps } = useVideoConfig()
  const popFrames = Math.max(1, Math.round(0.27 * fps)) // window long enough to hold the ~90ms pop
  return (
    <>
      {music?.track ? <Audio src={staticFile(`music/${music.track}`)} volume={MUSIC_VOLUME} loop /> : null}
      {hasHook ? (
        <Sequence from={0} durationInFrames={Math.round(0.5 * fps)} name="whoosh">
          <Audio src={staticFile("sfx/whoosh.mp3")} volume={WHOOSH_VOLUME} />
        </Sequence>
      ) : null}
      {pages.map((p, i) => (
        <Sequence key={i} from={Math.round((p.startMs / 1000) * fps)} durationInFrames={popFrames} name={`pop-${i}`}>
          <Audio src={staticFile("sfx/pop.mp3")} volume={POP_VOLUME} />
        </Sequence>
      ))}
    </>
  )
}
```

- [ ] **Step 2: Add `music?` to `CaptionedCutProps` and compose `<AudioLayer>`**

In `render-worker/src/remotion/CaptionedCut.tsx`: add the `music` prop and render `<AudioLayer>` (audio is invisible; place it first, inside the `<AbsoluteFill>`):

```tsx
// render-worker/src/remotion/CaptionedCut.tsx
import { AbsoluteFill } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"
import { CaptionLayer } from "./CaptionLayer.js"
import { SourceLayer } from "./SourceLayer.js"
import { ProgressBar } from "./ProgressBar.js"
import { BrandBug } from "./BrandBug.js"
import { HookCard } from "./HookCard.js"
import { AudioLayer } from "./AudioLayer.js"

export type CaptionedCutProps = {
  videoSrc: string
  pages: CaptionPage[]
  accentHex: string
  hook?: { text: string }
  music?: { track: string }
}

export function CaptionedCut({ videoSrc, pages, accentHex, hook, music }: CaptionedCutProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AudioLayer pages={pages} music={music} hasHook={Boolean(hook?.text)} />
      <SourceLayer videoSrc={videoSrc} />
      <CaptionLayer pages={pages} accentHex={accentHex} />
      {hook?.text ? <HookCard text={hook.text} accentHex={accentHex} /> : null}
      <ProgressBar accentHex={accentHex} />
      <BrandBug />
    </AbsoluteFill>
  )
}
```

- [ ] **Step 3: Build + still (visual must be unchanged; audio verified later)**

```bash
cd render-worker && npm run build
```
Expected: tsc 0. Then recreate `render-worker/_still-props.json` (add a `music` field) and render a still to confirm the audio layer didn't break the picture:
```json
{ "videoSrc": "https://www.w3schools.com/html/mov_bbb.mp4", "accentHex": "#c4936b",
  "music": { "track": "motivational-cinematic.mp3" },
  "pages": [ { "text": "5 mistakes athletes make",
    "words": [ {"text":"5","startMs":0,"endMs":350,"emphasis":true},{"text":"mistakes","startMs":350,"endMs":800,"emphasis":true},{"text":"athletes","startMs":800,"endMs":1300,"emphasis":true},{"text":"make","startMs":1300,"endMs":1700,"emphasis":false} ],
    "startMs": 0, "endMs": 1700 } ] }
```
`cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still-audio.png --frame=21 --scale=0.5 --props=./_still-props.json` → Read it. Expected: captions + logo + bar render as before (audio is invisible). (Note: `staticFile` for `music/...` must resolve at bundle time — if the still errors with "file not found", confirm `render-worker/public/music/motivational-cinematic.mp3` exists from A2.)

- [ ] **Step 4: Commit**

```bash
git add render-worker/src/remotion/AudioLayer.tsx render-worker/src/remotion/CaptionedCut.tsx
git commit -m "feat(captioned-cut): AudioLayer — music bed + scheduled pop/whoosh SFX"
```

---

## Task A4: `AccentGraphics` (corner brackets)

**Files:** Create `render-worker/src/remotion/AccentGraphics.tsx`; Modify `render-worker/src/remotion/CaptionedCut.tsx`

- [ ] **Step 1: Create `AccentGraphics.tsx`** — two accent L-brackets (top-right, bottom-left) that draw in over ~0.6 s, then hold. Corners chosen to avoid the logo (top-left), progress bar (top edge), and captions (lower-third center).

```tsx
// render-worker/src/remotion/AccentGraphics.tsx
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"

export type AccentGraphicsProps = {
  accentHex: string
}

export function AccentGraphics({ accentHex }: AccentGraphicsProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // Brackets "draw in" over the first ~0.6s.
  const draw = interpolate(frame, [0, Math.round(0.6 * fps)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const ARM = 96 // full bracket arm length (px)
  const INSET = 46 // distance from the frame edge
  const STROKE = 5
  const len = ARM * draw
  const bar = (s: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    backgroundColor: accentHex,
    opacity: 0.9,
    ...s,
  })
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* top-right bracket (opens toward bottom-left) */}
      <div style={bar({ top: INSET, right: INSET, width: len, height: STROKE })} />
      <div style={bar({ top: INSET, right: INSET, width: STROKE, height: len })} />
      {/* bottom-left bracket (opens toward top-right) */}
      <div style={bar({ bottom: INSET, left: INSET, width: len, height: STROKE })} />
      <div style={bar({ bottom: INSET, left: INSET, width: STROKE, height: len })} />
    </AbsoluteFill>
  )
}
```

- [ ] **Step 2: Compose `<AccentGraphics>` in `CaptionedCut.tsx`** — add the import and render it just under the source (above captions is fine; it's thin/edge-only). Insert after `<SourceLayer>`:

```tsx
import { AccentGraphics } from "./AccentGraphics.js"
// ...
      <SourceLayer videoSrc={videoSrc} />
      <AccentGraphics accentHex={accentHex} />
      <CaptionLayer pages={pages} accentHex={accentHex} />
```

- [ ] **Step 3: Build + still**

```bash
cd render-worker && npm run build
cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still-accent.png --frame=30 --scale=0.5 --props=./_still-props.json
```
Read `_still-accent.png`. Expected: thin accent L-brackets in the top-right and bottom-left corners (fully drawn by frame 30 ≈ 1 s), not colliding with the logo/bar/captions. If too prominent, note for tuning (`ARM`/`STROKE`/`opacity`/`INSET`) — don't change values arbitrarily; keep "tasteful."

- [ ] **Step 4: Commit**

```bash
git add render-worker/src/remotion/AccentGraphics.tsx render-worker/src/remotion/CaptionedCut.tsx
git commit -m "feat(captioned-cut): animated accent corner brackets"
```

---

## Task A5: Subtle caption-page transition

**Files:** Modify `render-worker/src/remotion/CaptionLayer.tsx`

- [ ] **Step 1: Add a per-page scale pop to the caption container**

In `CaptionLayer.tsx`, after the active `page` is selected (right before the `return`), compute a page-level entrance and apply it to the caption container `<div>` (the flex container). Add `spring` to the remotion import if not present.

Add this just before the `return (`:
```tsx
  // Subtle page-level "pop" when a new phrase appears (distinct from the per-word
  // entrance below): the whole block scales 0.97 -> 1.0 over ~0.16s.
  const pageStartFrame = (page.startMs / 1000) * fps
  const pageEnter = spring({
    frame: frame - pageStartFrame,
    fps,
    config: { damping: 200 },
    durationInFrames: Math.round(0.16 * fps),
  })
  const pageScale = 0.97 + 0.03 * pageEnter
```
Then on the caption container `<div>` style (the one with `display: "flex"`, `fontSize: 88`, etc.), add:
```tsx
          transform: `scale(${pageScale})`,
          transformOrigin: "center",
```
(Ensure `spring` is imported: `import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion"`.)

- [ ] **Step 2: Build + stills (page pop at change vs settled)**

```bash
cd render-worker && npm run build
cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still-pageA.png --frame=1 --scale=0.5 --props=./_still-props.json
cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still-pageB.png --frame=12 --scale=0.5 --props=./_still-props.json
```
Read both. Expected: at frame 1 the caption block is slightly smaller (≈0.97) and by frame 12 it has settled to full size — a subtle pop. Confirm it's gentle, not a big zoom.

- [ ] **Step 3: Commit**

```bash
git add render-worker/src/remotion/CaptionLayer.tsx
git commit -m "feat(captioned-cut): subtle caption-page scale-pop transition"
```

---

## Task A6: Worker wiring — read `input.music` (default track)

**Files:** Modify `render-worker/src/index.ts`

- [ ] **Step 1: Resolve the music track and pass it in `inputProps`**

In `render-worker/src/index.ts`, the hook block reads `jobSnap`. Right after the `hookText` lines (before `const inputProps = {`), add music resolution; the worker defends against a missing/unknown track by checking the file exists. Add `import` for nothing new (`fs`, `path` are already imported).

Add:
```tsx
    // Music selection (panel → route → ai_jobs.input.music). Absent → the brand
    // default; "none" → no music; otherwise the chosen track IF it exists in the
    // baked public/music dir (guard against a bad name crashing the render).
    const DEFAULT_MUSIC = "motivational-cinematic.mp3"
    const rawMusic = jobSnap.data()?.input?.music
    const musicSel = typeof rawMusic === "string" ? rawMusic.trim() : ""
    const requestedTrack = musicSel === "none" ? "" : musicSel || DEFAULT_MUSIC
    const musicTrack =
      requestedTrack && fs.existsSync(path.join(process.cwd(), "public", "music", requestedTrack))
        ? requestedTrack
        : musicSel === "none"
          ? ""
          : fs.existsSync(path.join(process.cwd(), "public", "music", DEFAULT_MUSIC))
            ? DEFAULT_MUSIC
            : ""
    console.log(`[render-worker] step=music ${musicTrack ? `track=${musicTrack}` : "none"}`)
```

Then extend the `inputProps` object (which already spreads `hook`) to also spread `music`:
```tsx
    const inputProps = {
      videoSrc: videoSrcUrl,
      pages,
      accentHex: BRAND_ACCENT_HEX,
      ...(hookText ? { hook: { text: hookText } } : {}),
      ...(musicTrack ? { music: { track: musicTrack } } : {}),
    }
```

- [ ] **Step 2: Build**

```bash
cd render-worker && npm run build
```
Expected: tsc 0 (the `music` inputProp now matches `CaptionedCutProps.music`).

- [ ] **Step 3: Commit**

```bash
git add render-worker/src/index.ts
git commit -m "feat(captioned-cut): worker resolves input.music (default track) for the bed"
```

---

## Task A7: Deploy + Cloud render + AUDIO verification

**Files:** none (deploy + verify). Prod deploy of the worker — authorized.

- [ ] **Step 1: Deploy the worker**

```bash
gcloud run jobs deploy captioned-cut-render --source render-worker \
  --region us-central1 --project darrenjpaulcom \
  --service-account captioned-cut-render@darrenjpaulcom.iam.gserviceaccount.com \
  --memory 16Gi --cpu 4 --task-timeout 1800s --max-retries 1 \
  --set-secrets "SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,ASSEMBLYAI_API_KEY=ASSEMBLYAI_API_KEY:latest" \
  --set-env-vars "FIREBASE_STORAGE_BUCKET=darrenjpaulcom.firebasestorage.app"
```
Expected: "Job [captioned-cut-render] has successfully been deployed." (This rebuild bundles the new `public/sfx` + `public/music`.)

- [ ] **Step 2: Render the test video**

```bash
gcloud run jobs execute captioned-cut-render --region us-central1 --project darrenjpaulcom \
  --update-env-vars AI_JOB_ID=23Ll7ee0ZWX1qp9Vh423,VIDEO_UPLOAD_ID=396afdd4-4ebc-4eaa-b39a-da074bca0285 --wait
```
Expected: exit 0; logs show `step=hook none`, `step=music track=motivational-cinematic.mp3`, `step=render ok`.

- [ ] **Step 3: Download + verify VIDEO (overlays) and AUDIO (mix)**

Find the newest captioned-cut asset (Supabase: newest `media_assets` for `derived_from_video_id='396afdd4-...'`, `ai_analysis->>'origin'='captioned_cut'`), download to `_reel.mp4`, then:
```bash
# overlays: frame grid + a detail frame
ffmpeg -y -i _reel.mp4 -vf "fps=1/6,scale=170:302,tile=3x5" -frames:v 1 _reelgrid.png
ffmpeg -y -ss 8 -i _reel.mp4 -frames:v 1 -vf scale=640:-1 _reeldet.png
# audio: stream present? levels sane (not clipping)? waveform?
ffprobe -v error -show_entries stream=codec_type,codec_name,channels,duration -of default=noprint_wrappers=1 _reel.mp4
ffmpeg -hide_banner -i _reel.mp4 -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume"
ffmpeg -y -i _reel.mp4 -filter_complex "showwavespic=s=1000x240" -frames:v 1 _reelwave.png
```
Read `_reelgrid.png`, `_reeldet.png`, `_reelwave.png`. Expected: accent brackets + caption page-pop visible; an **audio stream** present (~90 s, stereo); `max_volume` below 0 dB (not clipping); the waveform shows continuous content (voice + music) with periodic transients (pops). **Save `_reel.mp4` to the user's Desktop and ask them to spot-listen** for music level + SFX taste (the only true audio judge).

- [ ] **Step 4: Clean scratch**

```bash
rm -f _reel.mp4 _reelgrid.png _reeldet.png _reelwave.png render-worker/_still*.png render-worker/_still-props.json
```

Part A is complete when the frames show the overlays, the audio checks confirm a non-clipping mixed track, and the user is happy with the sound after a spot-listen.

---

# PART B — App: panel music picker (Vercel)

> The worker already reads `input.music` (Task A6), so Part B is **app-only** (no worker redeploy).

## Task B1: Validator `music` field (TDD)

**Files:** Modify `lib/validators/captioned-cut.ts`; Modify `__tests__/lib/validators/captioned-cut.test.ts`

- [ ] **Step 1: Add failing tests** to `__tests__/lib/validators/captioned-cut.test.ts` (new cases in the existing describe):

```typescript
  it("accepts an optional music track filename", () => {
    const r = captionedCutRequestSchema.safeParse({ videoUploadId: VID, music: "cinematic.mp3" })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.music).toBe("cinematic.mp3")
  })
  it("accepts 'none' for music", () => {
    expect(captionedCutRequestSchema.safeParse({ videoUploadId: VID, music: "none" }).success).toBe(true)
  })
  it("rejects a music value with unsafe characters", () => {
    expect(captionedCutRequestSchema.safeParse({ videoUploadId: VID, music: "../etc/passwd" }).success).toBe(false)
  })
```

- [ ] **Step 2: Run — verify FAIL** — `npx vitest run __tests__/lib/validators/captioned-cut.test.ts` (the unsafe-char test fails: no `music` field yet so it passes through as success).

- [ ] **Step 3: Implement** — add to the `.object({...})` in `lib/validators/captioned-cut.ts` (after `hook`):
```typescript
    // Optional music selection: a baked track filename or "none". Filename-safe
    // charset only (the worker also checks the file exists before using it).
    music: z
      .string()
      .trim()
      .max(60)
      .regex(/^[a-zA-Z0-9._-]+$/, "Invalid music selection")
      .optional(),
```

- [ ] **Step 4: Run — verify PASS** — `npx vitest run __tests__/lib/validators/captioned-cut.test.ts` → all pass.

- [ ] **Step 5: Commit**
```bash
git add lib/validators/captioned-cut.ts __tests__/lib/validators/captioned-cut.test.ts
git commit -m "feat(captioned-cut): optional music field on the request validator"
```

## Task B2: Route forwards `music`

**Files:** Modify `app/api/admin/content-studio/captioned-cut/route.ts`

- [ ] **Step 1:** In the POST handler, alongside the existing `hook` line, add a `music` var and include it in the job input:
```typescript
  const music = parsed.data.music && parsed.data.music.length > 0 ? parsed.data.music : undefined
  const { jobId } = await createAiJob({
    type: "video_caption_render",
    userId: session.user.id,
    input: {
      videoUploadId,
      ...(hook ? { hook } : {}),
      ...(music ? { music } : {}),
    },
  })
```
(Replace the existing `createAiJob({...})` call; keep the `hook` derivation line above it.)

- [ ] **Step 2:** `npx tsc --noEmit 2>&1 | grep "content-studio/captioned-cut/route" || echo "route clean"` → `route clean`.

- [ ] **Step 3: Commit**
```bash
git add app/api/admin/content-studio/captioned-cut/route.ts
git commit -m "feat(captioned-cut): forward music selection into the render job input"
```

## Task B3: Panel music picker

**Files:** Modify `components/admin/content-studio/drawer/CaptionedCutPanel.tsx`

- [ ] **Step 1: Add music state + a `<select>` + send it in the POST.**

1. After the `hook` state, add:
```tsx
  const [music, setMusic] = useState("")
```
2. In `generate()`, extend the POST body:
```tsx
        body: JSON.stringify({ videoUploadId, hook: hook.trim() || undefined, music: music || undefined }),
```
3. Add a `MusicPicker` helper at the bottom of the file (next to `HookInput`) — the track list mirrors the baked `render-worker/public/music` files; "" = default, `none` = no music:
```tsx
const MUSIC_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Default (Motivational Cinematic)" },
  { value: "inspirational.mp3", label: "Inspirational" },
  { value: "cinematic.mp3", label: "Cinematic" },
  { value: "none", label: "No music" },
]

function MusicPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-[11px] text-muted-foreground">Music</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
      >
        {MUSIC_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
```
4. Render `<MusicPicker value={music} onChange={setMusic} />` directly below `<HookInput ... />` in BOTH the idle branch and the done/re-render branch.

- [ ] **Step 2:** `npx tsc --noEmit 2>&1 | grep "CaptionedCutPanel" || echo "panel clean"` → `panel clean`.

- [ ] **Step 3: Commit**
```bash
git add components/admin/content-studio/drawer/CaptionedCutPanel.tsx
git commit -m "feat(captioned-cut): music picker in the Content Studio panel"
```

## Task B4: Push + verify

**Files:** none (push + verify). App-only → triggers Vercel; worker already supports `input.music`.

- [ ] **Step 1: Final checks** — `npx vitest run __tests__/lib/validators/captioned-cut.test.ts` (pass) + `npx tsc --noEmit 2>&1 | grep -E "captioned-cut/route|CaptionedCutPanel|validators/captioned-cut" || echo "touched app files clean"`.
- [ ] **Step 2: Push** — `git push origin main` (Vercel builds the app; the music picker goes live). No worker redeploy needed.
- [ ] **Step 3: (optional) End-to-end** — once Vercel is live, a render started from the panel with a chosen track will log `step=music track=<chosen>` and mix that track. (The Part A render already proved the default-track path.)

Part B is complete when the validator tests pass, the app pushes cleanly, and the panel shows the music picker.

---

## Self-Review

**Spec coverage:** SFX generated → A1 ✓; royalty-free music pulled + licensed → A2 ✓; `AudioLayer` (music bed + pop/whoosh) → A3 ✓; accent graphics → A4 ✓; caption-page transition → A5 ✓; worker reads `input.music` w/ default → A6 ✓; audio verification approach (ffprobe/volumedetect/waveform/spot-listen) → A7 ✓; panel music picker threaded like the hook (validator/route/panel) → B1–B3 ✓. **Deferred per spec:** music ducking, emoji, grain/vignette, b-roll, emphasis-pulse graphic (omitted as YAGNI — brackets are the accent graphic).

**Placeholders:** none — ffmpeg recipes, the proven curl-download method, full component code, and exact verification commands are all concrete. A2 Step 2 gives an explicit fallback for a failed track download.

**Type consistency:** `CaptionedCutProps.music?: { track: string }` matches `AudioLayer`'s `music?: { track: string }` and the worker's `inputProps.music = { track: musicTrack }`. `AudioLayerProps { pages, music?, hasHook }` and `AccentGraphicsProps { accentHex }` are consistent across create/compose. Validator `music: string` → route forwards string → worker reads `input.music` string → resolves to a `{ track }` — consistent end to end.

**Sequencing:** A1/A2 (assets) precede A3 (which `staticFile`s them); A6 (worker reads music) precedes the A7 render; Part B (app) needs no worker change because A6 already reads `input.music`.
