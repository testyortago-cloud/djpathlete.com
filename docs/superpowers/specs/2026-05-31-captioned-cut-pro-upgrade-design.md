# Captioned Cut — Pro Upgrade (Tiers 1–3) — Design

**Date:** 2026-05-31
**Status:** Approved (design); pending implementation plans
**Builds on:** `2026-05-31-captioned-cut-design.md` (M1/M2 shipped), the loopback-render
fix + styling pass (commits `a9b5357` → `fe88c4b`).

## 1. Goal

Take the working captioned-cut (vertical 9:16, word-pop captions burned in) from
"clean" to a trend-grade short-form reel: dynamic captions, on-screen energy, and
production touches (b-roll, music, transitions) — while keeping the brand look and
the proven Cloud Run render pipeline.

Delivered in three milestones (M3 → M5), each independently shippable.

## 2. Decisions (from brainstorm 2026-05-31)

- **Control surface:** *Auto styling + light panel.* The house style (captions,
  zoom, progress bar, brand bug) applies automatically. A small drawer panel sets
  per-video content: hook text, music track. B-roll is automatic from the library.
- **B-roll sourcing:** *Keyword-matched library.* Admin maintains a tagged b-roll
  library; the worker auto-inserts clips where transcript keywords match tags.
- **Audio:** *Music + SFX.* A low background music bed (admin picks a track) plus
  caption/transition SFX. Original voice stays primary.
- **Reframe:** *Skipped.* Sources are shot vertical → keep center-crop. **No
  face-tracking / no AI preprocessing** (the one non-Remotion piece — explicitly
  out of scope).

## 3. Non-goals (out of scope)

- Face-tracking / landscape→vertical auto-reframe.
- AI-generated b-roll; b-roll generation of any kind (library is admin-curated).
- Music ducking / sidechain compression (constant low music volume in v1).
- A full multi-clip editing timeline (b-roll placement is automatic, not manual).
- Per-feature granular toggles (we chose auto + light panel).

## 4. Architecture

### 4.1 Composition decomposition

`render-worker/src/remotion/CaptionedCut.tsx` currently does everything in one
component. Split into focused layers under `render-worker/src/remotion/`, composed
by `CaptionedCut`:

| Layer | Responsibility | Key Remotion |
|---|---|---|
| `SourceLayer` | source video, center-crop, **punch-in zoom**, **b-roll overlays + transitions** | `OffthreadVideo`, `interpolate`/`spring` scale, `Series`/`Sequence`, `@remotion/transitions` |
| `CaptionLayer` | word-pop captions: **bounce**, **keyword emphasis**, **outline**, **highlight pill**, **entrance** | `spring`, `interpolate`, `-webkit-text-stroke` + `paint-order` |
| `HookCard` | first ~2 s animated hook title | `Sequence`, `spring` |
| `ProgressBar` | thin progress bar | width = `interpolate(frame,[0,total],[0,100])%` |
| `BrandBug` | animated `dj` logo / handle | `staticFile`, fade |
| `AudioLayer` | music bed + SFX | `@remotion/media` `Audio` (music), `Audio` (sfx), optional `visualizeAudio` |

Each layer is a pure component taking typed props; `CaptionedCut` wires them with
`<AbsoluteFill>` stacking. Goal: each file is independently understandable/testable.

### 4.2 Worker asset pipeline — everything local

Lesson from the render saga: **no remote fetches mid-render.** Today the worker
downloads the source to `/tmp` and serves it over a loopback HTTP server
(`lib/serve-file.ts`). Extend this:

- `serve-file.ts` → **serve the whole work directory** (path-routed, Range support)
  instead of a single file. Keep the existing single-file behavior as a thin wrapper.
- Worker downloads into `workDir`: source (as now) + each **matched b-roll clip** +
  the **chosen music track**. SFX are static, baked into the image and referenced
  via `staticFile` (no download).
- All `OffthreadVideo`/`Audio` `src` values are `http://127.0.0.1:<port>/<file>`
  (b-roll/music) or `staticFile(...)` (sfx). Zero external network during render.

### 4.3 Data model (Supabase)

Two new tables (migrations under `supabase/migrations/`):

```
broll_clips
  id uuid pk, storage_path text, tags text[] not null default '{}',
  duration_ms int, width int, height int, title text,
  created_by uuid, created_at timestamptz default now()

music_tracks
  id uuid pk, storage_path text, title text not null,
  duration_ms int, mood text, created_by uuid, created_at timestamptz default now()
```

DAL: `lib/db/broll-clips.ts` (`list`, `create`, `updateTags`, `delete`) and
`lib/db/music-tracks.ts` (`list`, `create`, `delete`). Keyword-match helper lives in
`lib/content-studio/broll-match.ts` **with a worker twin**
`render-worker/src/lib/broll-match.ts` (the `functions/` ↔ `lib/` boundary applies
to `render-worker/` too — see CLAUDE.md). Unit-tested in the app copy.

### 4.4 B-roll keyword matching

Pure function `matchBroll(words, clips, opts)`:
- Normalize transcript words (lowercase, strip punctuation, optional simple stem).
- For each clip, find transcript windows where a clip tag appears.
- Schedule an overlay over the matching phrase window (clamped to clip duration).
- **Guardrails (all configurable, sensible defaults):** confidence = tag must match
  a whole word; `maxCutaways` per render (default 4); `minGapMs` between cutaways
  (default 6000); `maxCoveragePct` of the clip (default 35%); never overlay during
  the hook window. Returns `[{ clipId, startMs, endMs, src }]`.
- Deterministic (no RNG) so renders are reproducible.

`log()` what was matched/dropped so silent over/under-triggering is visible.

### 4.5 Control panel + library admin

- **`CaptionedCutPanel`** (extend existing): in idle/re-render state add — style
  preset selector (only **House** in v1; structure allows more later), **hook text**
  (auto-filled from the first transcript sentence, editable, or "off"), **music
  picker** (from `music_tracks` + "None"). Matched b-roll is automatic; after a
  render the panel lists which clips were used.
- **POST `/api/admin/content-studio/captioned-cut`** accepts optional
  `{ hook, musicTrackId, stylePreset, brollEnabled }`; persisted into the `ai_jobs`
  input and read by the worker.
- **Library manager** (new admin surface, e.g. `/admin/content/library`): upload +
  tag b-roll clips; upload + name music tracks. Reuses the existing media upload
  flow (signed PUT) + Firebase Storage; thin CRUD routes under
  `/api/admin/content-studio/broll` and `/music`.

### 4.6 inputProps schema (worker)

`CaptionedCutProps` grows (validated in the worker before render):
```
{ videoSrc, pages, accentHex,
  hook?: { text: string },
  broll?: Array<{ src: string; startMs: number; endMs: number }>,
  music?: { src: string; volume: number },
  sfx: { popEnabled: boolean },           // sfx files are staticFile in the image
  style: { preset: 'house' } }
```

## 5. Feature detail by milestone

### M3 — Tier 1: caption polish (pure composition)
1. **Spring bounce** — active word scales with `spring()` overshoot, then settles.
2. **Keyword emphasis** — `caption-paging` tags each word `emphasis: boolean`
   (numbers, ALL-CAPS, length ≥ 7, or a small power-word list); emphasized words
   render larger + accent. (Twin-copy rule applies to caption-paging.)
3. **Outline** — `-webkit-text-stroke` + `paint-order: stroke fill` (crisper than
   the current shadow; keep a soft shadow for depth).
4. **Highlight pill** — rounded accent background behind the active word.
5. **Word entrance** — each word springs up + fades in at its `startMs`.
6. *(Optional)* **Emoji** near keywords — **requires adding Noto Color Emoji to the
   Dockerfile**; gated behind that. If skipped, no behavior change.

Acceptance: local stills show all five over a real frame; full Cloud render green;
no regression to gap-fill / position / brand accent.

### M4 — Tier 2: energy & retention (composition + panel + sfx)
1. **Punch-in zoom** — subtle 1.0→1.06 slow zoom on the source; optional snap on
   emphasis beats.
2. **Progress bar** — thin brand-accent bar.
3. **Brand bug** — animated `dj` logo/handle, corner, fades in.
4. **Hook card** — first ~2 s animated title from panel hook text (auto/edited/off).
5. **SFX on word pops** — `<Audio staticFile('sfx/pop.mp3')>` scheduled at word
   starts (+ whoosh reserved for M5 transitions). Needs SFX assets in the image.

Acceptance: panel writes hook/music into the job; render shows hook → captions →
bar/bug; SFX audible and synced; timing within the 1800 s budget.

### M5 — Tier 3: production (data + library UI + worker matching)
1. **B-roll library + keyword matching + transitions** — tables, DAL, match helper,
   library manager UI; worker downloads matched clips and plays each as a
   **full-frame cutaway** (b-roll fills the 9:16 frame for the matched window, then
   returns to the speaker) via `Sequence`, with `@remotion/transitions`
   (cross-fade/slide) in and out. The caption / progress-bar / brand-bug layers
   stay composited **on top** of the b-roll, so captions never disappear during a
   cutaway. (PiP-style overlay is explicitly not the v1 behavior.)
2. **Music bed** — chosen track downloaded + served locally, mixed under the voice
   at low volume (~0.12–0.18).
3. **Audio-reactive accent** *(small, optional)* — a subtle accent pulse driven by
   `visualizeAudio` of the music. Ship if cheap; defer if it complicates the render.

Acceptance: a transcript keyword triggers a tasteful b-roll cutaway with clean
transitions; music bed present under the voice; guardrails respected (cap/spacing);
library manager round-trips upload→tag→use.

## 6. Prerequisites (user-provided assets)
- **SFX** (M4): short `pop`, `whoosh` files → `render-worker/public/sfx/` (baked in).
- **Music tracks** (M5): a few licensed tracks → uploaded via the library manager.
- **B-roll clips** (M5): seed clips → uploaded + tagged via the library manager.
- **Noto Color Emoji** (M3 optional): added to the Dockerfile if we want emoji.

## 7. Risks & mitigations
- **Render memory/time with b-roll** (more `OffthreadVideo` instances). Mitigate:
  `maxCutaways` cap, keep 16 GiB / 4 vCPU, keep all assets local, watch step-logs.
- **Keyword-match quality** (miss / over-trigger). Mitigate: whole-word match +
  cap + spacing + coverage limits; panel shows matched clips; `log()` drops.
- **Composition decomposition regressing the working render.** Mitigate: refactor
  in M3 behind the same output; verify with the local-still + frame-sample loop
  before each Cloud deploy.
- **Audio licensing** — tracks must be licensed; admin-supplied only.
- **`@remotion/transitions` + OffthreadVideo interplay** — verify with a still/short
  render before committing the M5 approach.

## 8. Testing strategy
- **Unit (Vitest, app copies):** `broll-match` (windows, threshold, cap, spacing,
  coverage, determinism), keyword `emphasis` detection, caption-paging unchanged,
  `broll-clips`/`music-tracks` DAL.
- **Visual loop (cheap):** local `remotion still` per feature against a real frame
  (the workflow proven this session) before any Cloud deploy.
- **E2E:** one full Cloud render per milestone + ffmpeg frame-sampling to confirm.
- **Twin sync:** any `lib/` ↔ `render-worker/src/lib/` helper (broll-match,
  caption-paging) kept identical; note in PR/commit.

## 9. Visual tuning (deferred to build-time, decided cheaply via stills)
Exact bounce intensity/damping, emphasis aggressiveness (size step + which words),
pill vs. underline vs. both, zoom amount, hook card style, transition type/length.
These are dialed in with local stills during each milestone, not pre-decided here.

## 10. File map (new / changed)
- `render-worker/src/remotion/{CaptionedCut,SourceLayer,CaptionLayer,HookCard,ProgressBar,BrandBug,AudioLayer}.tsx`
- `render-worker/src/lib/{serve-file (dir mode), broll-match}.ts`
- `render-worker/src/index.ts` (asset download/serve, inputProps, hook/music/b-roll wiring)
- `render-worker/public/sfx/*`, Dockerfile (sfx; optional Noto emoji)
- `lib/content-studio/{caption-paging (emphasis), broll-match}.ts` (+ twins)
- `lib/db/{broll-clips,music-tracks}.ts`, `supabase/migrations/*broll*`, `*music_tracks*`
- `components/admin/content-studio/drawer/CaptionedCutPanel.tsx` (hook/music/preset)
- Library manager page + `/api/admin/content-studio/{broll,music}` routes
- `lib/validators/captioned-cut.ts` (hook/music/style fields)
