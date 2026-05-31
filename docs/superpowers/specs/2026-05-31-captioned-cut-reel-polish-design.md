# Captioned Cut — Reel Polish (Audio + Overlays) — Design

**Date:** 2026-05-31
**Status:** Approved (design); pending implementation plan
**Builds on:** M3 (caption polish) + M4a (zoom/progress-bar/brand-bug) + M4b (hook card), all shipped. Reuses the now-wired worker asset pipeline (`render-worker/public/` + Dockerfile `COPY public` + `bundle({ publicDir })`).

## 1. Goal

Make the captioned cut feel like a polished trending reel by adding **audio** (generated SFX + a low royalty-free music bed) and **procedural overlay graphics** (caption-page transitions + animated brand-accent graphics) — tuned for a **professional athletic-performance COACHING brand** (motivational, credible, premium), NOT a gimmicky meme aesthetic.

## 2. Decisions (from brainstorm 2026-05-31)

- **SFX:** *Generated, not pulled.* Synthesize a soft **pop** (caption-page appearances) and a **whoosh** (hook entrance + page transitions) with ffmpeg → fully owned, zero licensing. Baked into the image.
- **Music:** *Pulled royalty-free, user accepts license.* A few genuinely royalty-free tracks (Pixabay Content License / Mixkit License — commercial-OK, no attribution required) baked in, played **looped at low volume (~0.14)** under the original coaching voice (voice stays primary; **no ducking** in v1). Vibe = **coaching brand**: motivational / cinematic / clean-modern — **avoid hard trap / aggressive gym-bro**. Each track's source URL + license recorded in `render-worker/public/music/LICENSES.md`.
- **Overlays:** *Procedural Remotion, no assets.* (a) **Caption-page transitions** (phrases animate in, not hard cuts); (b) **`AccentGraphics`** layer (brand-accent corner brackets + a thin moving accent line + a subtle accent pulse on emphasis beats). **No grain/vignette, no emoji** (not chosen).
- **Intensity:** *Punchy but tasteful* — clearly more energetic, but on-brand and restrained for a coaching business.
- **Music control:** A **panel music picker** (None + track names), threaded exactly like the M4b hook (panel → route → `ai_jobs.input.music` → worker → `AudioLayer`). **SFX auto-on** (no toggle in v1).

## 3. Non-goals (out of scope)

- Music **ducking** / sidechain compression (constant low music in v1).
- Emoji / sticker accents (not chosen) and film grain / vignette (not chosen).
- B-roll / cutaways / video overlays (that's M5/Tier 3).
- Per-SFX granular controls (SFX is auto-on, fixed level).
- Generating music with AI/synthesis as the primary source (only a fallback — see §7).

## 4. Architecture

### 4.1 New / changed Remotion layers (`render-worker/src/remotion/`)

| Layer | Responsibility | Key Remotion |
|---|---|---|
| `AudioLayer` (new) | music bed (looped, low vol) + scheduled SFX (pop per caption page, whoosh on hook/transitions) | `@remotion/media` / `Audio`, `Sequence`, `staticFile`, `loop` |
| `AccentGraphics` (new) | brand-accent corner brackets + thin moving line + emphasis-beat pulse | `interpolate`/`spring`, `AbsoluteFill`, SVG/divs |
| `CaptionLayer` (modify) | add a subtle **page-level transition** (container slide/fade on page change) layered under the existing per-word entrance | `interpolate`/`spring` keyed to page start |
| `CaptionedCut` (modify) | compose `AudioLayer` + `AccentGraphics`; accept `music?` prop | `<AbsoluteFill>` stacking |

`SourceLayer`, `ProgressBar`, `BrandBug`, `HookCard` are untouched.

### 4.2 Audio detail

- **Voice:** the source video's own audio (via `OffthreadVideo`) stays primary and unmuted — the worker render already mixes it.
- **Music:** `<Audio src={staticFile('music/<track>.mp3')} volume={0.14} loop />`. The track filename comes from `inputProps.music?.track` (panel choice) or a sensible **default** track when none is chosen. `None` → no music `<Audio>`.
- **SFX:**
  - **pop** — a short, soft transient at each caption **page** start: for each page, `<Sequence from={round(page.startMs/1000*fps)} durationInFrames={~8}><Audio src={staticFile('sfx/pop.mp3')} volume={0.5} /></Sequence>`. (Per-page, not per-word — ~one every 1.5 s, the phrase rhythm; per-word would be noisy.)
  - **whoosh** — at the hook-card entrance (frame 0) and at page transitions if it reads well; `volume` moderate. Tuned at build time.
- **Levels** are tuned with a short test render + headphones-by-proxy (the user) — defaults: voice 1.0, music ~0.14, pop ~0.5, whoosh ~0.6.

### 4.3 SFX generation (ffmpeg, owned)

Generated at build time and committed (small, static):
- `pop.mp3` — a soft click/pop: a short (~90 ms) sine blip with a fast decay envelope (e.g. a 660→880 Hz quick chirp + exponential fade), low-passed so it's soft, not clicky.
- `whoosh.mp3` — a ~350 ms filtered-noise sweep (white noise through a moving band-pass, fade in/out) for transitions.
Exact ffmpeg recipes live in the plan; both are CC0/owned (synthesized).

### 4.4 AccentGraphics (procedural, on-brand)

Restrained, professional motion in the brand palette (accent `#c4936b`, primary `#0E3F50`):
- **Corner brackets** — thin accent L-brackets in two corners that *draw in* (stroke-dashoffset or width interpolate) over the first ~0.6 s, then hold. Frames the shot like a premium coaching graphic.
- **Thin accent line** — a subtle horizontal accent line near the lower third that slides/grows in, anchoring the captions.
- **Emphasis pulse** — a soft accent glow/pulse timed to emphasis-word beats (cheap: a low-opacity accent vignette that briefly brightens). Optional; ship if it reads tasteful.
All deterministic, no RNG.

### 4.5 Caption-page transition

When a page becomes active, the **container** does a small slide-up + fade over the first ~6 frames (on top of which the per-word entrance still runs). Kept subtle so it doesn't fight the word-level motion. Synced with a whoosh. Tuned via stills + a short render.

### 4.6 Control surface + data flow

- **Validator** (`lib/validators/captioned-cut.ts`): add optional `music` (a short track id/filename from a known set, or `"none"`).
- **POST route**: forward `music` into the `createAiJob` input (like `hook`).
- **Panel** (`CaptionedCutPanel`): a **music `<select>`** (None + baked track names) next to the hook input; value sent in the POST body.
- **Worker** (`index.ts`): read `input.music` off the job doc; resolve to a track filename; pass `inputProps.music = { track }` (or omit for none). Defaults to a chosen default track if the field is absent (so existing/re-run jobs get music too) — OR default to none; decided in the plan (lean: default = a specific brand-default track).
- **inputProps / `CaptionedCutProps`**: add `music?: { track: string }`.

### 4.7 Asset pipeline

- `render-worker/public/sfx/{pop,whoosh}.mp3` (generated, committed).
- `render-worker/public/music/*.mp3` (pulled royalty-free, committed) + `render-worker/public/music/LICENSES.md`.
- `public/` already ships in the image (Dockerfile `COPY public ./public`) and resolves via `bundle({ publicDir })` — done in the logo work.

## 5. Sequencing (two shippable parts)

- **Part A — worker-only (gcloud deploy, NO Vercel):** generate SFX; pull + bake music; `AudioLayer` (SFX + music bed with a **default** track auto-selected); caption-page transitions; `AccentGraphics`. Ships the whole look + sound. Cloud-render accepted via frame-grid + an audio check (ffprobe shows the mixed audio; spot-listen by the user).
- **Part B — app (Vercel):** validator `music` field + route forward + panel music picker → per-video track choice end-to-end. (Mirrors the M4b hook plumbing.)

Each part gets verified before the next.

## 6. Testing strategy

- **Unit (Vitest):** validator `music` field (Part B); any pure helper (e.g. track-name resolution) if added.
- **Visual loop:** local `remotion still` for the overlays (accent graphics, caption transition frames) — Read the PNG.
- **Audio:** can't "hear" a still — verify via a short **Cloud render** + `ffprobe` (confirm an audio stream with the expected duration), an ffmpeg **waveform/spectrogram PNG** to confirm music+sfx are present and at sane levels, and the **user spot-listens** to the saved mp4 for taste/levels.
- **E2E:** one full Cloud render per part + frame-grid (and the audio checks above).

## 7. Risks & mitigations

- **Music fetch feasibility / quality (primary risk).** Royalty-free CDNs may block hotlinking or need site flows; I also can't audition tracks. Mitigation: source from permissive, directly-downloadable licenses (Pixabay/Mixkit), **validate each file is a clean MP3** (ffprobe), pick by title/tags for the coaching vibe, and document licenses. **Fallback:** if reliable download fails, ship SFX + overlays now and either (a) generate a simple ambient pad with ffmpeg as a placeholder bed, or (b) switch music to "you supply" — and tell the user which.
- **Licensing.** ONLY permissive, commercial-OK, no-attribution licenses; record source URL + license per track; generated SFX are owned.
- **Audio level / taste.** Conservative defaults + a user spot-listen before finalizing; levels are easy to tune.
- **Too much motion (un-coaching-like).** Keep accent graphics + transitions restrained; tune via stills; bias toward subtle.
- **Render memory/time with extra `<Audio>`.** Minimal — audio is light vs `OffthreadVideo`; keep the 16 GiB / 4 vCPU config.

## 8. File map (new / changed)

- `render-worker/src/remotion/{AudioLayer,AccentGraphics}.tsx` (new); `{CaptionLayer,CaptionedCut}.tsx` (modify)
- `render-worker/src/index.ts` (read `input.music`; inputProps)
- `render-worker/public/sfx/{pop,whoosh}.mp3`, `render-worker/public/music/*.mp3` + `LICENSES.md`
- `lib/validators/captioned-cut.ts` (+`music`), `app/api/admin/content-studio/captioned-cut/route.ts` (forward music), `components/admin/content-studio/drawer/CaptionedCutPanel.tsx` (music picker)

## 9. Visual/audio tuning (decided cheaply at build time)

Exact SFX timbre + levels, music track choices + bed volume, transition slide distance/length, accent-graphic size/opacity/which corners, whether the emphasis pulse ships — all dialed in with stills + a short render + a user spot-listen, not pre-decided here.
