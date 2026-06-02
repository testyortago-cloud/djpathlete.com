# Split Reel — Phase 2: Face Detection + fal.ai B-roll + End-to-End Render — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Consult `remotion-best-practices` for the worker render path. This is a large plan split into **Part A / B / C** — each part ends at a committable, independently sensible state; pause for review between parts.

**Goal:** Make the Phase-1 `SplitReel` composition render from REAL inputs end-to-end: real face tracking (detector in the worker), fal.ai-generated b-roll (auto-selected from the transcript, cached), and a triggerable pipeline (API → `broll_generation` job → fal webhook → `split_reel_render` job → finished reel attached to posts).

**Architecture:** Three parts. **(A)** The Cloud Run render-worker gains a face detector (`@vladmandic/human` on the tfjs WASM backend + static ffmpeg frame sampling) producing the `FacePoint[]` trajectory Phase 1 already consumes. **(B)** A `broll_generation` Firebase function uses Anthropic to pick b-roll moments + prompts from the transcript, writes `broll_segments` rows, and submits each to `fal.queue.submit(...)` with a webhook; the `/api/webhooks/fal-broll` route downloads each finished clip to Firebase Storage as a `media_asset` and marks the segment ready; when all are ready it completes the job, which auto-chains to render. **(C)** A `split_reel_render` trigger launches the SAME render-worker container with `RENDER_MODE=split_reel`; the worker face-detects, loads the ready b-roll clips, renders `SplitReel`, uploads, and attaches to draft posts (reusing the captioned-cut attach logic). All gated by `feature_split_reel_enabled`.

**Tech Stack:** Cloud Run render-worker (Node 22, ESM, Remotion 4, `@vladmandic/human`, `@tensorflow/tfjs` + `tfjs-backend-wasm`, `jpeg-js`, `ffmpeg-static`); Firebase Functions (`@fal-ai/client`, `functions/src/ai/anthropic.ts`); Next.js App Router API routes; Supabase (migration 00162); Vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-split-reel-fal-ai-design.md`
**Builds on:** `docs/superpowers/plans/2026-06-02-split-reel-phase1-composition.md` (the `SplitReel` composition + `face-track.ts` already exist and are tested).

---

## Design notes (decisions made from codebase exploration)

- **fal generation host = Firebase function + `fal.queue.submit` + webhook** (not the worker, not `fal.subscribe`). Reason: text-to-video takes minutes per clip and multiple clips per reel; `fal.queue.submit` returns immediately and the webhook completes each segment independently — no long-held compute, and it matches the existing webhook pattern. (The existing `fal-client.ts` uses `fal.subscribe` for fast images; we add a queue wrapper for slow video.)
- **One render-worker container, `RENDER_MODE` branch.** `RENDER_MODE=split_reel` selects the new path; absent/`caption` keeps the existing captioned-cut path. The existing Cloud Run job is reused — only env overrides differ. No new Cloud Run job to provision.
- **Auto-chain in Phase 2.** When `broll_generation` completes, `on-ai-job-completed` enqueues `split_reel_render`. Phase 3 will insert the preview/approve gate between these two; Phase 2 runs them back-to-back so the pipeline is testable end-to-end now.
- **Anthropic selection lives in the function** (`functions/src/ai/anthropic.ts` already exists). The worker gets NO Anthropic dependency — only the face detector.
- **Caching** by `cache_key = sha256(visual_prompt + model + window_seconds)`: before submitting to fal, reuse any existing `ready` `media_asset` with the same key.
- **Honest verification:** unit tests cover the pure cores (segment post-processing, cache-key, face-box normalization, validators). The Firebase handlers, webhook, worker render path, and Dockerfile are verified by type-check/build + **manual** deploy steps — a true end-to-end run needs a deploy, `FAL_KEY` credits, and network access to fal + the sample assets. Each such task says so explicitly.

---

## File structure (Phase 2)

**Part A — face detection (render-worker/):**
| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `render-worker/package.json` | Modify | add `@vladmandic/human`, `@tensorflow/tfjs`, `@tensorflow/tfjs-backend-wasm`, `jpeg-js`, `ffmpeg-static` |
| `render-worker/src/lib/face-box.ts` (+ test) | Create | pure: normalize a pixel face box → `FacePoint` |
| `render-worker/src/lib/detect-face.ts` | Create | sample frames (ffmpeg) → detect (human/wasm) → `FacePoint[]` |
| `render-worker/Dockerfile` | Modify | bake tfjs `.wasm`, human models, static ffmpeg |

**Part B — DB + selection + fal generation + webhook:**
| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `supabase/migrations/00162_broll_segments_and_split_reel_settings.sql` | Create | `broll_segments` table + `system_settings` rows |
| `types/database.ts` | Modify | `BrollSegmentStatus`, `BrollSegment` |
| `lib/db/broll-segments.ts` | Create | DAL for `broll_segments` |
| `lib/split-reel/broll-selection.ts` (+ test) | Create | pure: post-process selected windows; `brollCacheKey` |
| `lib/validators/split-reel.ts` (+ test) | Create | Zod request schemas |
| `lib/ai-jobs.ts` | Modify | add job types + in-flight dedupe helpers |
| `lib/feature-flag-catalog.ts` | Modify | `feature_split_reel_enabled` |
| `lib/audit/actions.ts` | Modify | `split_reel.*` slugs |
| `functions/src/lib/assemblyai-words.ts` | Create | twin of the worker's word fetcher |
| `functions/src/lib/fal-broll.ts` | Create | `fal.queue.submit` wrapper for text-to-video |
| `functions/src/ai/broll-select.ts` | Create | Anthropic call → segments with prompts |
| `functions/src/broll-generation.ts` | Create | the `broll_generation` job handler |
| `functions/src/index.ts` | Modify | dispatch `broll_generation` |
| `functions/src/on-ai-job-completed.ts` | Modify | chain `broll_generation` → `split_reel_render` |
| `app/api/webhooks/fal-broll/route.ts` | Create | fal completion → media_asset + segment ready |

**Part C — render trigger + worker split path + API:**
| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `functions/src/split-reel-render-trigger.ts` | Create | launch render-worker with `RENDER_MODE=split_reel` |
| `functions/src/index.ts` | Modify | dispatch `split_reel_render` to the trigger |
| `render-worker/src/lib/broll-fetch.ts` | Create | load ready `broll_segments` + download clips |
| `render-worker/src/index.ts` | Modify | `RENDER_MODE` branch + `runSplitReel()` |
| `app/api/admin/content-studio/split-reel/route.ts` | Create | GET state, POST enqueue `broll_generation` |

---

# PART A — Face detection in the render-worker

### Task A1: Add face-detection dependencies to the worker

**Files:** Modify `render-worker/package.json`

- [ ] **Step 1: Add the dependencies.** In `render-worker/package.json`, add to `dependencies` (keep existing entries):

```json
    "@tensorflow/tfjs": "^4.22.0",
    "@tensorflow/tfjs-backend-wasm": "^4.22.0",
    "@vladmandic/human": "^3.3.6",
    "ffmpeg-static": "^5.2.0",
    "jpeg-js": "^0.4.4"
```

- [ ] **Step 2: Install.** From `render-worker/`: `npm install`. Expected: exits 0, lockfile updated.

- [ ] **Step 3: Confirm the build still passes.** From `render-worker/`: `npm run build` then `npm test`. Expected: tsc exits 0; existing 23 tests still pass.

- [ ] **Step 4: Commit**
```bash
git add render-worker/package.json render-worker/package-lock.json
git commit -m "build(render-worker): add face-detection deps (human, tfjs-wasm, ffmpeg-static, jpeg-js)"
```

---

### Task A2: Pure face-box normalization (TDD)

**Files:** Create `render-worker/src/lib/face-box.ts` + `render-worker/src/lib/face-box.test.ts`

- [ ] **Step 1: Write the failing test.** Create `render-worker/src/lib/face-box.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { normalizeFaceBox } from "./face-box"

describe("normalizeFaceBox", () => {
  it("maps a centered pixel box to cx/cy ~0.5 and size = boxHeight/frameHeight", () => {
    // 100x100 box centered in a 1000x1000 frame at (450,450)
    const p = normalizeFaceBox([450, 450, 100, 100], 1000, 1000, 2000)
    expect(p.cx).toBeCloseTo(0.5, 5)
    expect(p.cy).toBeCloseTo(0.5, 5)
    expect(p.size).toBeCloseTo(0.1, 5)
    expect(p.ms).toBe(2000)
  })

  it("clamps cx/cy into [0,1] for an out-of-bounds box", () => {
    const p = normalizeFaceBox([-50, -50, 100, 100], 1000, 1000, 0)
    expect(p.cx).toBeGreaterThanOrEqual(0)
    expect(p.cy).toBeGreaterThanOrEqual(0)
  })

  it("puts a left-third face at cx ~0.2", () => {
    const p = normalizeFaceBox([100, 400, 200, 200], 1000, 1000, 0)
    expect(p.cx).toBeCloseTo(0.2, 5)
  })
})
```

- [ ] **Step 2: Run to verify it fails.** From `render-worker/`: `npx vitest run src/lib/face-box.test.ts`. Expected FAIL: cannot resolve `./face-box`.

- [ ] **Step 3: Implement.** Create `render-worker/src/lib/face-box.ts`:

```ts
// render-worker/src/lib/face-box.ts
// Pure: convert a detector's pixel-space face box into the normalized FacePoint
// the composition consumes. No I/O. Box is [x, y, width, height] in pixels.
import type { FacePoint } from "./face-track.js"

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export function normalizeFaceBox(
  box: [number, number, number, number],
  frameWidth: number,
  frameHeight: number,
  ms: number,
): FacePoint {
  const [x, y, w, h] = box
  return {
    ms,
    cx: clamp01((x + w / 2) / frameWidth),
    cy: clamp01((y + h / 2) / frameHeight),
    size: clamp01(h / frameHeight),
  }
}
```

- [ ] **Step 4: Run to verify it passes.** `npx vitest run src/lib/face-box.test.ts`. Expected PASS.

- [ ] **Step 5: Commit**
```bash
git add render-worker/src/lib/face-box.ts render-worker/src/lib/face-box.test.ts
git commit -m "feat(split-reel): pure face-box → FacePoint normalization"
```

---

### Task A3: Frame sampling + detection module

**Files:** Create `render-worker/src/lib/detect-face.ts`

> This module does I/O (ffmpeg + model inference); it is verified by build + a manual local run, not a unit test. The pure math it relies on (`normalizeFaceBox`, `smoothTrajectory`) is already tested.

- [ ] **Step 1: Implement `detect-face.ts`.** Create `render-worker/src/lib/detect-face.ts`:

```ts
// render-worker/src/lib/detect-face.ts
// Given a local MP4, sample frames with a static ffmpeg binary, run BlazeFace
// (via @vladmandic/human on the tfjs WASM backend), and return a normalized
// FacePoint[] trajectory (one point per sampled frame that has a face). Models
// and wasm are baked into the image (see Dockerfile); nothing is downloaded.
import { Human, type Config } from "@vladmandic/human"
import * as tf from "@tensorflow/tfjs"
import "@tensorflow/tfjs-backend-wasm"
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm"
import jpeg from "jpeg-js"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import ffmpegPath from "ffmpeg-static"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { normalizeFaceBox } from "./face-box.js"
import type { FacePoint } from "./face-track.js"

const execFileP = promisify(execFile)

let human: Human | null = null

async function getHuman(): Promise<Human> {
  if (human) return human
  setWasmPaths(path.join(process.cwd(), "wasm") + "/")
  const config: Partial<Config> = {
    backend: "wasm",
    modelBasePath: "file://" + path.join(process.cwd(), "models") + "/",
    face: {
      enabled: true,
      detector: { enabled: true, rotation: false },
      mesh: { enabled: false },
      iris: { enabled: false },
      description: { enabled: false },
      emotion: { enabled: false },
    },
    body: { enabled: false },
    hand: { enabled: false },
    gesture: { enabled: false },
    filter: { enabled: false },
  }
  const h = new Human(config)
  await tf.setBackend("wasm")
  await tf.ready()
  await h.load()
  human = h
  return h
}

export async function detectFaceTrajectory(
  localPath: string,
  opts: { sampleEveryMs?: number } = {},
): Promise<FacePoint[]> {
  const sampleEveryMs = opts.sampleEveryMs ?? 200
  const h = await getHuman()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "facedet-"))
  try {
    const fps = (1000 / sampleEveryMs).toString()
    if (!ffmpegPath) throw new Error("ffmpeg-static binary not found")
    await execFileP(ffmpegPath, [
      "-i", localPath, "-vf", `fps=${fps}`, "-q:v", "3",
      path.join(dir, "f-%05d.jpg"),
    ])
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort()
    const points: FacePoint[] = []
    for (let i = 0; i < files.length; i += 1) {
      const raw = fs.readFileSync(path.join(dir, files[i]))
      const img = jpeg.decode(raw, { useTArray: true })
      const rgb = tf.tidy(() =>
        tf.tensor3d(img.data, [img.height, img.width, 4], "int32").slice([0, 0, 0], [img.height, img.width, 3]),
      )
      const res = await h.detect(rgb)
      rgb.dispose()
      const face = res.face?.[0]
      if (face?.box) {
        const [x, y, w, hgt] = face.box as [number, number, number, number]
        points.push(normalizeFaceBox([x, y, w, hgt], img.width, img.height, i * sampleEveryMs))
      }
      // no face → skip; smoothTrajectory/faceAtMs interpolate over the gap
    }
    return points
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
```

- [ ] **Step 2: Type-check.** From `render-worker/`: `npm run build`. Expected exits 0. (If `@vladmandic/human` types complain about the partial `Config`, keep the `Partial<Config>` annotation as written; it matches Human's public API.)

- [ ] **Step 3: Commit**
```bash
git add render-worker/src/lib/detect-face.ts
git commit -m "feat(split-reel): face-trajectory detector (ffmpeg sample + human/wasm BlazeFace)"
```

---

### Task A4: Bake models, wasm, and ffmpeg into the Docker image

**Files:** Modify `render-worker/Dockerfile`

> Manual/build verification only (requires `docker build`). The goal: the runtime never downloads models or wasm, and a static ffmpeg is on the binary path used by `ffmpeg-static`.

- [ ] **Step 1: Read the current Dockerfile** (`render-worker/Dockerfile`) to find where `node_modules` are installed and where `dist`/`public` are copied.

- [ ] **Step 2: Add a step that copies the tfjs WASM artifacts and the Human BlazeFace model into the image's working dir**, AFTER `npm install`/`npm ci` and before/with the `dist` copy. Add these lines (adjust the exact stage to match the file's structure — they must run after deps are installed so `node_modules/@tensorflow/...` and `node_modules/@vladmandic/human/models` exist):

```dockerfile
# Bake tfjs WASM backend artifacts so the runtime never fetches them from a CDN.
RUN mkdir -p /app/wasm \
  && cp node_modules/@tensorflow/tfjs-backend-wasm/dist/*.wasm /app/wasm/

# Bake the BlazeFace face-detector model (weights ship inside the human package).
RUN mkdir -p /app/models \
  && cp node_modules/@vladmandic/human/models/blazeface.json /app/models/ \
  && cp node_modules/@vladmandic/human/models/blazeface.bin /app/models/
```

(If `@vladmandic/human` does not ship `models/` in the installed package, instead `RUN node -e "require('fs').cpSync('node_modules/@vladmandic/human/models','/app/models',{recursive:true})"` — and if the package has no bundled models at all, add a build step that downloads them from `https://github.com/vladmandic/human-models` into `/app/models` at BUILD time, never at runtime. Verify which is true with `ls node_modules/@vladmandic/human/models` during the build.)

- [ ] **Step 3: Ensure `ffmpeg-static`'s binary is present at runtime.** `ffmpeg-static` ships a prebuilt binary inside `node_modules` and resolves it via its default export, so as long as `node_modules` is in the final image it works. If the Dockerfile uses a multi-stage build that prunes dev files, confirm `node_modules/ffmpeg-static/ffmpeg` survives into the final stage (it's a production dep). Add a sanity line:
```dockerfile
RUN node -e "const p=require('ffmpeg-static'); require('fs').accessSync(p); console.log('ffmpeg-static ok:', p)"
```

- [ ] **Step 4: Verify the image builds.** Run `docker build -t djp-render-worker:phase2 render-worker` (from the repo root). Expected: build succeeds; the `ffmpeg-static ok:` line prints. (If Docker isn't available in your environment, mark this step DONE_WITH_CONCERNS and note that the image must be built/verified on the deploy machine.)

- [ ] **Step 5: Commit**
```bash
git add render-worker/Dockerfile
git commit -m "build(render-worker): bake tfjs wasm + BlazeFace model + verify ffmpeg-static"
```

**Part A done when:** `npm test` (worker) green incl. `face-box`; `npm run build` clean; image builds with models/wasm/ffmpeg baked in.

---

# PART B — DB, AI moment-selection, fal.ai generation, webhook

### Task B1: Migration — `broll_segments` table + settings

**Files:** Create `supabase/migrations/00162_broll_segments_and_split_reel_settings.sql`

> Apply via the Supabase MCP `apply_migration` (not CLI), per project convention.

- [ ] **Step 1: Write the migration.** Create the file with:

```sql
-- ── Split Reel: b-roll segments + settings ───────────────────────────────────
-- One row per selected b-roll moment for a video. The broll_generation job writes
-- these; the fal webhook fills media_asset_id + flips status to 'ready'; the
-- split_reel_render worker reads the 'ready' rows to compose the reel.

create table if not exists broll_segments (
  id                 uuid primary key default gen_random_uuid(),
  video_upload_id    uuid not null references video_uploads(id) on delete cascade,
  generation_job_id  text not null,                 -- the broll_generation ai_jobs doc id
  segment_index      int  not null,
  start_ms           int  not null,
  end_ms             int  not null,
  concept            text not null default '',
  prompt             text not null,
  media_asset_id     uuid references media_assets(id) on delete set null,
  fal_request_id     text,
  cache_key          text not null,
  status             text not null default 'pending'
                     check (status in ('pending','generating','ready','failed','dropped')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists broll_segments_video_idx
  on broll_segments (video_upload_id, segment_index);
create index if not exists broll_segments_cache_key_idx on broll_segments (cache_key);
create index if not exists broll_segments_job_idx on broll_segments (generation_job_id);

alter table broll_segments enable row level security;
create policy "Admins manage broll_segments" on broll_segments
  for all to authenticated
  using (exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin'))
  with check (exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin'));

comment on table broll_segments is 'Selected b-roll moments per video for Split Reel; one fal text-to-video clip each.';

-- ── Settings (jsonb values, idempotent) ──────────────────────────────────────
insert into system_settings (key, value, description) values
  ('feature_split_reel_enabled', 'false'::jsonb, 'Master flag for the Split Reel (dynamic b-roll) feature'),
  ('split_reel_broll_model', '"fal-ai/ltx-video"'::jsonb, 'fal.ai text-to-video endpoint id for b-roll clips'),
  ('split_reel_broll_window_seconds', '5'::jsonb, 'Length (s) of each b-roll window'),
  ('split_reel_max_broll_windows', '6'::jsonb, 'Hard cap on b-roll windows per reel'),
  ('split_reel_min_gap_seconds', '4'::jsonb, 'Minimum gap (s) between b-roll windows')
on conflict (key) do nothing;
```

- [ ] **Step 2: Apply the migration** via the Supabase MCP `apply_migration` tool with name `00162_broll_segments_and_split_reel_settings` and the SQL above. Expected: success.

- [ ] **Step 3: Verify** via MCP `execute_sql`: `select key from system_settings where key like 'split_reel%' or key='feature_split_reel_enabled';` → 5 rows. And `select count(*) from broll_segments;` → 0 (table exists).

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/00162_broll_segments_and_split_reel_settings.sql
git commit -m "feat(split-reel): broll_segments table + split-reel settings (migration 00162)"
```

---

### Task B2: Types for `broll_segments`

**Files:** Modify `types/database.ts`

- [ ] **Step 1: Add the enum + interface.** Near the other media/video types in `types/database.ts`, add:

```ts
export type BrollSegmentStatus = "pending" | "generating" | "ready" | "failed" | "dropped"

export interface BrollSegment {
  id: string
  video_upload_id: string
  generation_job_id: string
  segment_index: number
  start_ms: number
  end_ms: number
  concept: string
  prompt: string
  media_asset_id: string | null
  fal_request_id: string | null
  cache_key: string
  status: BrollSegmentStatus
  created_at: string
  updated_at: string
}
```

- [ ] **Step 2: Type-check.** From repo root: `npx tsc --noEmit -p tsconfig.json` (or `npm run build`). Expected: no NEW errors from this change. (The repo may have pre-existing unrelated errors; confirm none reference `types/database.ts` additions.)

- [ ] **Step 3: Commit**
```bash
git add types/database.ts
git commit -m "feat(split-reel): BrollSegment types"
```

---

### Task B3: `broll_segments` DAL

**Files:** Create `lib/db/broll-segments.ts`

> Verified by type-check; DB calls aren't unit-tested (matches the codebase's DAL convention — pure logic is tested separately in B4).

- [ ] **Step 1: Implement the DAL.** Create `lib/db/broll-segments.ts`:

```ts
// lib/db/broll-segments.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { BrollSegment, BrollSegmentStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export type NewBrollSegment = Omit<BrollSegment, "id" | "created_at" | "updated_at">

export async function insertBrollSegments(rows: NewBrollSegment[]): Promise<BrollSegment[]> {
  if (rows.length === 0) return []
  const supabase = getClient()
  const { data, error } = await supabase.from("broll_segments").insert(rows).select()
  if (error) throw error
  return data as BrollSegment[]
}

export async function getBrollSegmentsForVideo(videoUploadId: string): Promise<BrollSegment[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("broll_segments")
    .select("*")
    .eq("video_upload_id", videoUploadId)
    .order("segment_index", { ascending: true })
  if (error) throw error
  return (data ?? []) as BrollSegment[]
}

export async function getBrollSegmentsForJob(generationJobId: string): Promise<BrollSegment[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("broll_segments")
    .select("*")
    .eq("generation_job_id", generationJobId)
    .order("segment_index", { ascending: true })
  if (error) throw error
  return (data ?? []) as BrollSegment[]
}

export async function getBrollSegmentById(id: string): Promise<BrollSegment | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("broll_segments").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as BrollSegment) ?? null
}

export async function updateBrollSegment(
  id: string,
  patch: Partial<Pick<BrollSegment, "status" | "media_asset_id" | "fal_request_id">>,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("broll_segments")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}
```

(Caching reuse-by-cache-key is done inside the `broll_generation` function against its own Supabase client — see B11 — because `functions/` cannot import this DAL. No app-side cache-lookup helper is needed in Phase 2.)

- [ ] **Step 2: Type-check.** `npm run build` (or `tsc --noEmit`). Expected: no new errors.

- [ ] **Step 3: Commit**
```bash
git add lib/db/broll-segments.ts
git commit -m "feat(split-reel): broll_segments DAL"
```

---

### Task B4: Pure b-roll selection post-processing + cache key (TDD)

**Files:** Create `lib/split-reel/broll-selection.ts` + `__tests__/split-reel/broll-selection.test.ts`

- [ ] **Step 1: Write the failing test.** Create `__tests__/split-reel/broll-selection.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { postProcessWindows, brollCacheKey, type RawWindow } from "@/lib/split-reel/broll-selection"

const w = (startMs: number, endMs: number, concept = "x", prompt = "p"): RawWindow => ({ startMs, endMs, concept, prompt })

describe("postProcessWindows", () => {
  it("keeps non-overlapping windows within the cap and sorts by start", () => {
    const r = postProcessWindows([w(8000, 13000), w(0, 5000)], { maxWindows: 6, minGapMs: 2000, totalMs: 60000 })
    expect(r.kept.map((k) => k.startMs)).toEqual([0, 8000])
    expect(r.dropped).toEqual([])
  })

  it("drops a window that violates the minimum gap from the previous kept window", () => {
    const r = postProcessWindows([w(0, 5000), w(5500, 9000)], { maxWindows: 6, minGapMs: 2000, totalMs: 60000 })
    expect(r.kept.map((k) => k.startMs)).toEqual([0])
    expect(r.dropped).toHaveLength(1)
  })

  it("drops overlapping windows", () => {
    const r = postProcessWindows([w(0, 5000), w(3000, 8000)], { maxWindows: 6, minGapMs: 0, totalMs: 60000 })
    expect(r.kept).toHaveLength(1)
    expect(r.dropped).toHaveLength(1)
  })

  it("enforces the max-windows cap, dropping the overflow", () => {
    const raw = [w(0, 4000), w(10000, 14000), w(20000, 24000), w(30000, 34000)]
    const r = postProcessWindows(raw, { maxWindows: 2, minGapMs: 1000, totalMs: 60000 })
    expect(r.kept).toHaveLength(2)
    expect(r.dropped).toHaveLength(2)
  })

  it("clamps to totalMs and drops windows entirely past the end", () => {
    const r = postProcessWindows([w(58000, 65000), w(70000, 75000)], { maxWindows: 6, minGapMs: 0, totalMs: 60000 })
    expect(r.kept).toEqual([{ startMs: 58000, endMs: 60000, concept: "x", prompt: "p" }])
    expect(r.dropped).toHaveLength(1)
  })
})

describe("brollCacheKey", () => {
  it("is stable for the same inputs and differs when any input changes", () => {
    const a = brollCacheKey("a calm sunrise run", "fal-ai/ltx-video", 5)
    const b = brollCacheKey("a calm sunrise run", "fal-ai/ltx-video", 5)
    const c = brollCacheKey("a calm sunrise run", "fal-ai/ltx-video", 6)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `npx vitest run __tests__/split-reel/broll-selection.test.ts`. Expected FAIL: cannot resolve module.

- [ ] **Step 3: Implement.** Create `lib/split-reel/broll-selection.ts`:

```ts
// lib/split-reel/broll-selection.ts
// Pure post-processing of AI-selected b-roll windows: clamp to duration, drop
// overlaps and min-gap violations, enforce the window cap. Plus a stable cache key.
import { createHash } from "node:crypto"

export type RawWindow = { startMs: number; endMs: number; concept: string; prompt: string }
export type KeptWindow = RawWindow
export type PostProcessResult = { kept: KeptWindow[]; dropped: RawWindow[] }

export function postProcessWindows(
  raw: RawWindow[],
  opts: { maxWindows: number; minGapMs: number; totalMs: number },
): PostProcessResult {
  const { maxWindows, minGapMs, totalMs } = opts
  const dropped: RawWindow[] = []

  // Clamp to [0,totalMs]; drop empty/inverted/past-end.
  const clamped = raw
    .map((r) => ({ ...r, startMs: Math.max(0, Math.min(r.startMs, totalMs)), endMs: Math.max(0, Math.min(r.endMs, totalMs)) }))
    .filter((r) => {
      if (r.endMs > r.startMs) return true
      dropped.push(r)
      return false
    })
    .sort((a, b) => a.startMs - b.startMs)

  const kept: KeptWindow[] = []
  for (const win of clamped) {
    if (kept.length >= maxWindows) { dropped.push(win); continue }
    const last = kept[kept.length - 1]
    if (last && win.startMs < last.endMs + minGapMs) { dropped.push(win); continue }
    kept.push(win)
  }
  return { kept, dropped }
}

export function brollCacheKey(prompt: string, model: string, windowSeconds: number): string {
  return createHash("sha256").update(`${prompt}::${model}::${windowSeconds}`).digest("hex")
}
```

- [ ] **Step 4: Run to verify it passes.** `npx vitest run __tests__/split-reel/broll-selection.test.ts`. Expected PASS (all cases). Note the clamp test expects the past-end window dropped and the partial window clamped to `endMs:60000`.

- [ ] **Step 5: Commit**
```bash
git add lib/split-reel/broll-selection.ts __tests__/split-reel/broll-selection.test.ts
git commit -m "feat(split-reel): pure b-roll window post-processing + cache key"
```

---

### Task B5: Request validators (TDD)

**Files:** Create `lib/validators/split-reel.ts` + `__tests__/validators/split-reel.test.ts`

- [ ] **Step 1: Write the failing test.** Create `__tests__/validators/split-reel.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { splitReelGenerateSchema } from "@/lib/validators/split-reel"

describe("splitReelGenerateSchema", () => {
  it("accepts a bare videoUploadId", () => {
    const r = splitReelGenerateSchema.safeParse({ videoUploadId: "11111111-1111-1111-1111-111111111111" })
    expect(r.success).toBe(true)
  })
  it("rejects a missing videoUploadId", () => {
    expect(splitReelGenerateSchema.safeParse({}).success).toBe(false)
  })
  it("rejects a non-uuid videoUploadId", () => {
    expect(splitReelGenerateSchema.safeParse({ videoUploadId: "nope" }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `npx vitest run __tests__/validators/split-reel.test.ts`. Expected FAIL: cannot resolve module.

- [ ] **Step 3: Implement.** Create `lib/validators/split-reel.ts`:

```ts
// lib/validators/split-reel.ts
import { z } from "zod"

const uuid = z.string().uuid()

export const splitReelGenerateSchema = z.object({
  videoUploadId: uuid,
})
export type SplitReelGenerateRequest = z.infer<typeof splitReelGenerateSchema>
```

- [ ] **Step 4: Run to verify it passes.** `npx vitest run __tests__/validators/split-reel.test.ts`. Expected PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/validators/split-reel.ts __tests__/validators/split-reel.test.ts
git commit -m "feat(split-reel): request validators"
```

---

### Task B6: ai-jobs types + in-flight dedupe helpers

**Files:** Modify `lib/ai-jobs.ts`

- [ ] **Step 1: Add the two job types** to the `AiJobType` union in `lib/ai-jobs.ts` (append to the union list):

```ts
  | "broll_generation"
  | "split_reel_render"
```

- [ ] **Step 2: Add dedupe helpers** at the end of `lib/ai-jobs.ts` (mirror `findInFlightCaptionRender`):

```ts
export async function findInFlightBrollGeneration(videoUploadId: string): Promise<string | null> {
  const db = getAdminFirestore()
  const snap = await db
    .collection("ai_jobs")
    .where("type", "==", "broll_generation")
    .where("input.videoUploadId", "==", videoUploadId)
    .where("status", "in", ["pending", "processing"])
    .limit(1)
    .get()
  return snap.empty ? null : snap.docs[0].id
}

export async function findInFlightSplitRender(videoUploadId: string): Promise<string | null> {
  const db = getAdminFirestore()
  const snap = await db
    .collection("ai_jobs")
    .where("type", "==", "split_reel_render")
    .where("input.videoUploadId", "==", videoUploadId)
    .where("status", "in", ["pending", "processing"])
    .limit(1)
    .get()
  return snap.empty ? null : snap.docs[0].id
}
```

(Use the same `getAdminFirestore` import already present in the file.)

- [ ] **Step 3: Type-check.** `npm run build`. Expected: no new errors.

- [ ] **Step 4: Commit**
```bash
git add lib/ai-jobs.ts
git commit -m "feat(split-reel): ai_job types + in-flight dedupe for broll/render"
```

---

### Task B7: Feature flag + audit actions

**Files:** Modify `lib/feature-flag-catalog.ts`, `lib/audit/actions.ts`

- [ ] **Step 1: Add the feature flag** to the catalog array in `lib/feature-flag-catalog.ts`:

```ts
  {
    key: "feature_split_reel_enabled",
    label: "Split Reel (AI b-roll cuts)",
    description: "Dynamic two-row reels: full-frame talking head that cuts to a face-tracked split with fal.ai b-roll at AI-selected moments.",
    defaultEnabled: false,
  },
```

- [ ] **Step 2: Add the audit slug** to the `AUDIT_ACTIONS` array in `lib/audit/actions.ts` (only the POST that starts generation is audited in Phase 2; the manual "render" + "regenerate" slugs land in Phase 3 with their endpoints):

```ts
  { slug: "split_reel.broll_generate", category: "admin_write", description: "Split Reel b-roll generation started" },
```

- [ ] **Step 3: Type-check.** `npm run build`. Expected: no new errors (the `satisfies` on `AUDIT_ACTIONS` will fail loudly if the shape is wrong).

- [ ] **Step 4: Commit**
```bash
git add lib/feature-flag-catalog.ts lib/audit/actions.ts
git commit -m "feat(split-reel): feature flag + audit action slugs"
```

---

### Task B8: AssemblyAI words twin for functions

**Files:** Create `functions/src/lib/assemblyai-words.ts`

> Twin of `render-worker/src/lib/assemblyai-words.ts` (per the functions/ ↔ lib/ boundary). Read the worker copy first and replicate it exactly so the two stay in sync.

- [ ] **Step 1: Read** `render-worker/src/lib/assemblyai-words.ts` to get the exact `fetchTranscriptWords` implementation and the `TranscriptWord` shape.

- [ ] **Step 2: Create `functions/src/lib/assemblyai-words.ts`** as a byte-for-byte copy of the worker file's logic (same fetch to `https://api.assemblyai.com/v2/transcript/{id}`, same `ASSEMBLYAI_API_KEY` env usage, same `{ text, start, end }` return). Add a header comment:
```ts
// TWIN COPY of render-worker/src/lib/assemblyai-words.ts. functions/ cannot import
// the worker package; keep the two in sync.
```

- [ ] **Step 3: Type-check functions.** From `functions/`: `npm run build` (or the project's functions build command — check `functions/package.json` scripts). Expected: exits 0.

- [ ] **Step 4: Commit**
```bash
git add functions/src/lib/assemblyai-words.ts
git commit -m "feat(split-reel): assemblyai-words twin for functions runtime"
```

---

### Task B9: fal queue wrapper for text-to-video

**Files:** Create `functions/src/lib/fal-broll.ts`

> Read `functions/src/lib/fal-client.ts` first to reuse its `fal.config({ credentials: FAL_KEY })` initialization pattern.

- [ ] **Step 1: Implement.** Create `functions/src/lib/fal-broll.ts`:

```ts
// functions/src/lib/fal-broll.ts
// Submit a single text-to-video b-roll clip to fal's QUEUE (async) with a webhook.
// Unlike fal.subscribe (used for fast images), queue.submit returns immediately so
// the function isn't held open for the multi-minute video generation.
import { fal } from "@fal-ai/client"

let configured = false
function ensureConfigured() {
  if (configured) return
  const apiKey = process.env.FAL_KEY
  if (!apiKey) throw new Error("FAL_KEY not set")
  fal.config({ credentials: apiKey })
  configured = true
}

export async function submitBrollClip(opts: {
  model: string
  prompt: string
  durationSeconds: number
  webhookUrl: string
}): Promise<{ requestId: string }> {
  ensureConfigured()
  const { request_id } = await fal.queue.submit(opts.model, {
    input: {
      prompt: opts.prompt,
      // Most fal text-to-video endpoints accept these; extras are ignored by the model.
      duration: opts.durationSeconds,
      aspect_ratio: "9:16",
    },
    webhookUrl: opts.webhookUrl,
  })
  return { requestId: request_id }
}

export async function fetchBrollResult(model: string, requestId: string): Promise<{ videoUrl: string | null }> {
  ensureConfigured()
  const res = (await fal.queue.result(model, { requestId })) as { data?: { video?: { url?: string } } }
  return { videoUrl: res?.data?.video?.url ?? null }
}
```

- [ ] **Step 2: Type-check functions.** From `functions/`: `npm run build`. Expected exits 0. (If `@fal-ai/client` typings differ for `queue.submit`/`queue.result` return shapes, adjust the destructuring to match the installed `^1.10.0` types — verify against `functions/node_modules/@fal-ai/client`.)

- [ ] **Step 3: Commit**
```bash
git add functions/src/lib/fal-broll.ts
git commit -m "feat(split-reel): fal queue wrapper for text-to-video b-roll"
```

---

### Task B10: Anthropic b-roll moment selector

**Files:** Create `functions/src/ai/broll-select.ts`

> Read `functions/src/ai/anthropic.ts` to confirm the exact `callAgent` signature + exported `MODEL_SONNET`. Follow `lib/ai/schemas.ts` constraints (no `.int()/.min()/.max()` on numbers/strings — enforce ranges in the prompt).

- [ ] **Step 1: Implement.** Create `functions/src/ai/broll-select.ts`:

```ts
// functions/src/ai/broll-select.ts
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./anthropic.js"

const segmentSchema = z.object({
  segments: z.array(
    z.object({
      start_ms: z.number(),
      end_ms: z.number(),
      concept: z.string(),
      visual_prompt: z.string(),
    }),
  ),
})
export type SelectedSegments = z.infer<typeof segmentSchema>

export type TranscriptWord = { text: string; start: number; end: number }

// Build a compact "[ms] word" stream so the model can anchor windows to real times.
function transcriptWithTimings(words: TranscriptWord[]): string {
  return words.map((w) => `[${w.start}] ${w.text}`).join(" ")
}

export async function selectBrollMoments(opts: {
  words: TranscriptWord[]
  windowSeconds: number
  maxWindows: number
}): Promise<SelectedSegments> {
  const system = [
    "You pick moments in a talking-head video that would genuinely benefit from a short b-roll cutaway,",
    "and you write a vivid text-to-video prompt for each. Choose ONLY concrete, visualizable moments",
    "(named objects, places, actions, vivid metaphors). SKIP abstract filler, greetings, and transitions.",
    `Return at most ${opts.maxWindows} windows. Each window must be about ${opts.windowSeconds} seconds long`,
    "(end_ms ≈ start_ms + window length), non-overlapping, spaced apart. start_ms/end_ms are milliseconds",
    "and must fall within the transcript's timestamps. visual_prompt: one concrete sentence describing the",
    "b-roll footage (no text overlays, no talking people, vertical 9:16, brand-neutral, cinematic).",
    "concept: 2-4 words naming what it depicts.",
  ].join(" ")

  const user = `Transcript (each token prefixed with its start time in ms):\n\n${transcriptWithTimings(opts.words)}`

  const res = await callAgent(system, user, segmentSchema, { model: MODEL_SONNET, cacheSystemPrompt: true })
  return res.content
}
```

- [ ] **Step 2: Type-check functions.** From `functions/`: `npm run build`. Expected exits 0. (Adjust the `callAgent` import/return-access (`res.content`) to match the actual `functions/src/ai/anthropic.ts` API.)

- [ ] **Step 3: Commit**
```bash
git add functions/src/ai/broll-select.ts
git commit -m "feat(split-reel): Anthropic b-roll moment selector"
```

---

### Task B11: `broll_generation` job handler

**Files:** Create `functions/src/broll-generation.ts`

> Read `functions/src/blog-image-generation.ts` for the handler shape (status transition, Supabase via `functions/src/lib/supabase.ts`, error→failed). This handler does NOT wait for video gen — it submits to fal's queue and exits; the webhook completes segments. The ai_job is completed by the webhook when the last segment lands.

- [ ] **Step 1: Implement.** Create `functions/src/broll-generation.ts`:

```ts
// functions/src/broll-generation.ts
// Handler for ai_jobs of type "broll_generation". Selects b-roll moments from the
// transcript, writes broll_segments rows, reuses cached clips, and submits the rest
// to fal's queue with a webhook. Leaves the job in "processing"; the fal webhook
// flips it to "completed" once every segment is ready.
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getServiceSupabase } from "./lib/supabase.js"
import { fetchTranscriptWords } from "./lib/assemblyai-words.js"
import { selectBrollMoments } from "./ai/broll-select.js"
import { submitBrollClip } from "./lib/fal-broll.js"
import { postProcessWindows, brollCacheKey } from "./lib/broll-selection.js"

// NOTE: broll-selection is a twin — see Step 0.

export async function handleBrollGeneration(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)
  const supabase = getServiceSupabase()

  try {
    const jobSnap = await jobRef.get()
    const input = jobSnap.data()?.input as { videoUploadId: string } | undefined
    const videoUploadId = input?.videoUploadId
    if (!videoUploadId) throw new Error("broll_generation: missing videoUploadId")

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    // Settings
    const settings = await loadSplitReelSettings(supabase)

    // Transcript words
    const { data: tx } = await supabase
      .from("video_transcripts")
      .select("assemblyai_job_id")
      .eq("video_upload_id", videoUploadId)
      .eq("source", "speech")
      .not("assemblyai_job_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!tx?.assemblyai_job_id) throw new Error("no speech transcript for video")
    const words = await fetchTranscriptWords(tx.assemblyai_job_id)
    if (words.length === 0) throw new Error("transcript has no words")
    const totalMs = words[words.length - 1].end

    // AI selection → post-process
    const selected = await selectBrollMoments({
      words,
      windowSeconds: settings.windowSeconds,
      maxWindows: settings.maxWindows,
    })
    const { kept, dropped } = postProcessWindows(
      selected.segments.map((s) => ({ startMs: s.start_ms, endMs: s.end_ms, concept: s.concept, prompt: s.visual_prompt })),
      { maxWindows: settings.maxWindows, minGapMs: settings.minGapSeconds * 1000, totalMs },
    )

    if (kept.length === 0) {
      // Nothing to illustrate — complete immediately so the chain can still render
      // a full-frame-only reel.
      await jobRef.update({
        status: "completed",
        error: null,
        result: { segmentCount: 0, droppedCount: dropped.length },
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }

    const baseUrl = requireBaseUrl()
    const secret = process.env.BROLL_WEBHOOK_SECRET
    if (!secret) throw new Error("BROLL_WEBHOOK_SECRET not set")

    // Write rows, reuse cache, submit the rest.
    for (let i = 0; i < kept.length; i += 1) {
      const win = kept[i]
      const cacheKey = brollCacheKey(win.prompt, settings.model, settings.windowSeconds)
      const cachedAssetId = await findReadyAssetByCacheKey(supabase, cacheKey)

      const { data: seg, error: segErr } = await supabase
        .from("broll_segments")
        .insert({
          video_upload_id: videoUploadId,
          generation_job_id: jobId,
          segment_index: i,
          start_ms: win.startMs,
          end_ms: win.endMs,
          concept: win.concept,
          prompt: win.prompt,
          cache_key: cacheKey,
          media_asset_id: cachedAssetId,
          status: cachedAssetId ? "ready" : "pending",
        })
        .select()
        .single()
      if (segErr || !seg) throw new Error(`insert broll_segment ${i} failed: ${segErr?.message}`)
      if (cachedAssetId) continue // reused — no fal call

      const webhookUrl = `${baseUrl}/api/webhooks/fal-broll?segment_id=${seg.id}&token=${secret}`
      const { requestId } = await submitBrollClip({
        model: settings.model,
        prompt: win.prompt,
        durationSeconds: settings.windowSeconds,
        webhookUrl,
      })
      await supabase.from("broll_segments").update({ status: "generating", fal_request_id: requestId }).eq("id", seg.id)
    }

    // If every kept segment was cache-served, complete now; else the webhook will.
    await maybeCompleteJob(supabase, jobRef, jobId)
  } catch (err) {
    await jobRef
      .update({ status: "failed", error: (err as Error).message ?? "broll_generation failed", updatedAt: FieldValue.serverTimestamp() })
      .catch(() => {})
    console.error("[broll_generation]", err)
  }
}

type SplitReelSettings = { model: string; windowSeconds: number; maxWindows: number; minGapSeconds: number }
async function loadSplitReelSettings(supabase: ReturnType<typeof getServiceSupabase>): Promise<SplitReelSettings> {
  const { data } = await supabase.from("system_settings").select("key,value").in("key", [
    "split_reel_broll_model",
    "split_reel_broll_window_seconds",
    "split_reel_max_broll_windows",
    "split_reel_min_gap_seconds",
  ])
  const map = new Map((data ?? []).map((r) => [r.key as string, r.value]))
  return {
    model: (map.get("split_reel_broll_model") as string) ?? "fal-ai/ltx-video",
    windowSeconds: (map.get("split_reel_broll_window_seconds") as number) ?? 5,
    maxWindows: (map.get("split_reel_max_broll_windows") as number) ?? 6,
    minGapSeconds: (map.get("split_reel_min_gap_seconds") as number) ?? 4,
  }
}

async function findReadyAssetByCacheKey(supabase: ReturnType<typeof getServiceSupabase>, cacheKey: string): Promise<string | null> {
  const { data } = await supabase
    .from("broll_segments")
    .select("media_asset_id")
    .eq("cache_key", cacheKey)
    .eq("status", "ready")
    .not("media_asset_id", "is", null)
    .limit(1)
    .maybeSingle()
  return (data?.media_asset_id as string | undefined) ?? null
}

// Exported so the webhook reuses the same completion logic.
export async function maybeCompleteJob(
  supabase: ReturnType<typeof getServiceSupabase>,
  jobRef: FirebaseFirestore.DocumentReference,
  jobId: string,
): Promise<void> {
  const { data } = await supabase.from("broll_segments").select("status").eq("generation_job_id", jobId)
  const rows = data ?? []
  const pendingOrGenerating = rows.filter((r) => r.status === "pending" || r.status === "generating")
  if (pendingOrGenerating.length > 0) return
  const ready = rows.filter((r) => r.status === "ready").length
  await jobRef.update({
    status: "completed",
    error: null,
    result: { segmentCount: ready },
    updatedAt: FieldValue.serverTimestamp(),
  })
}

function requireBaseUrl(): string {
  // Reuse whatever base-URL env the AssemblyAI webhook submission uses. Grep the
  // transcription submit code for how it builds its webhook_url and use the SAME env.
  const base = process.env.APP_BASE_URL || process.env.NEXTAUTH_URL
  if (!base) throw new Error("APP_BASE_URL/NEXTAUTH_URL not set for webhook callback")
  return base.replace(/\/$/, "")
}
```

- [ ] **Step 0 (do FIRST): create the broll-selection twin for functions.** `functions/` can't import `lib/`. Copy `lib/split-reel/broll-selection.ts` to `functions/src/lib/broll-selection.ts` (byte-for-byte; both pure). Add the twin header comment. (Its test stays the single copy in `__tests__/`.)

- [ ] **Step 2: Confirm helpers exist.** Verify `getServiceSupabase` is the actual export name in `functions/src/lib/supabase.ts` (the exploration noted a `supabase.ts` twin — use its real exported function name; adjust if different). Verify `fetchTranscriptWords`, `selectBrollMoments`, `submitBrollClip` import paths.

- [ ] **Step 3: Type-check functions.** From `functions/`: `npm run build`. Expected exits 0.

- [ ] **Step 4: Commit**
```bash
git add functions/src/broll-generation.ts functions/src/lib/broll-selection.ts
git commit -m "feat(split-reel): broll_generation job handler (select → cache → fal queue)"
```

---

### Task B12: Dispatch `broll_generation` in the functions index

**Files:** Modify `functions/src/index.ts`

- [ ] **Step 1: Read** the `onDocumentCreated("ai_jobs/{jobId}")` dispatcher block in `functions/src/index.ts` to see how existing types (e.g. `blog_image_generation`) are routed.

- [ ] **Step 2: Add a dispatch branch** for `type === "broll_generation"` that lazy-imports and calls the handler, mirroring the existing branches exactly:

```ts
    if (data.type === "broll_generation") {
      const { handleBrollGeneration } = await import("./broll-generation.js")
      await handleBrollGeneration(jobId)
      return
    }
```

(Place it alongside the other `if (data.type === ...)` branches, matching their style — some dispatchers use a switch; follow whatever is there.)

- [ ] **Step 3: Type-check + build functions.** From `functions/`: `npm run build`. Expected exits 0.

- [ ] **Step 4: Commit**
```bash
git add functions/src/index.ts
git commit -m "feat(split-reel): dispatch broll_generation jobs"
```

---

### Task B13: fal completion webhook

**Files:** Create `app/api/webhooks/fal-broll/route.ts`

> Read `app/api/webhooks/assemblyai/route.ts` for the query-param-auth + idempotency pattern, and `lib/firebase-admin.ts` for `getAdminStorage`/`getAdminFirestore`. Verified by build + manual; a real round-trip needs a deploy + fal credits.

- [ ] **Step 1: Implement.** Create `app/api/webhooks/fal-broll/route.ts`:

```ts
// app/api/webhooks/fal-broll/route.ts
// fal calls this when a b-roll clip finishes. We download the result, store it as a
// media_asset, mark the segment ready, and (when the batch is done) complete the
// broll_generation ai_job — which on-ai-job-completed then chains to the render.
import { NextResponse, type NextRequest } from "next/server"
import { getAdminStorage, getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { createServiceRoleClient } from "@/lib/supabase"
import { getBrollSegmentById, updateBrollSegment, getBrollSegmentsForJob } from "@/lib/db/broll-segments"
import { createMediaAsset } from "@/lib/db/media-assets"
import { fetchBrollResultUrl } from "@/lib/split-reel/fal-result"

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const segmentId = searchParams.get("segment_id")
  const token = searchParams.get("token")
  if (!segmentId || token !== process.env.BROLL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const segment = await getBrollSegmentById(segmentId)
  if (!segment) return NextResponse.json({ error: "unknown segment" }, { status: 404 })
  if (segment.status === "ready") return NextResponse.json({ ok: true }) // idempotent

  const payload = (await request.json().catch(() => ({}))) as {
    status?: string
    payload?: { video?: { url?: string } }
    error?: string
  }

  try {
    if (payload.status && payload.status !== "OK" && payload.status !== "completed") {
      await updateBrollSegment(segmentId, { status: "failed" })
      await maybeCompleteGenerationJob(segment.generation_job_id)
      return NextResponse.json({ ok: true })
    }

    // Prefer the URL in the webhook payload; fall back to fetching the result.
    const videoUrl =
      payload.payload?.video?.url ??
      (segment.fal_request_id ? await fetchBrollResultUrl(segment.fal_request_id, segment.video_upload_id) : null)
    if (!videoUrl) throw new Error("no video url in fal result")

    // Download → Firebase Storage
    const res = await fetch(videoUrl)
    if (!res.ok) throw new Error(`download fal clip failed: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const storagePath = `videos/broll/${segment.video_upload_id}/${segment.segment_index}-${Date.now()}.mp4`
    await getAdminStorage().bucket().file(storagePath).save(buf, { contentType: "video/mp4" })

    const asset = await createMediaAsset({
      kind: "video",
      storage_path: storagePath,
      public_url: storagePath,
      mime_type: "video/mp4",
      width: 1080,
      height: 960,
      duration_ms: (segment.end_ms - segment.start_ms),
      bytes: buf.length,
      derived_from_video_id: segment.video_upload_id,
      ai_alt_text: null,
      ai_analysis: { origin: "ai_broll", cache_key: segment.cache_key, concept: segment.concept },
      created_by: null,
    })

    await updateBrollSegment(segmentId, { status: "ready", media_asset_id: asset.id })
    await maybeCompleteGenerationJob(segment.generation_job_id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    await updateBrollSegment(segmentId, { status: "failed" }).catch(() => {})
    await maybeCompleteGenerationJob(segment.generation_job_id).catch(() => {})
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

async function maybeCompleteGenerationJob(jobId: string): Promise<void> {
  const segments = await getBrollSegmentsForJob(jobId)
  if (segments.some((s) => s.status === "pending" || s.status === "generating")) return
  const ready = segments.filter((s) => s.status === "ready").length
  const db = getAdminFirestore()
  await db.collection("ai_jobs").doc(jobId).update({
    status: "completed",
    error: null,
    result: { segmentCount: ready },
    updatedAt: FieldValue.serverTimestamp(),
  })
}
```

- [ ] **Step 2: Create the tiny fal-result helper** `lib/split-reel/fal-result.ts` (app-side, so the route can fetch a result URL if the webhook payload omits it):

```ts
// lib/split-reel/fal-result.ts
import { fal } from "@fal-ai/client"
import { getSetting } from "@/lib/db/system-settings"

let configured = false
function ensure() {
  if (configured) return
  const key = process.env.FAL_KEY
  if (!key) throw new Error("FAL_KEY not set")
  fal.config({ credentials: key })
  configured = true
}

export async function fetchBrollResultUrl(requestId: string, _videoUploadId: string): Promise<string | null> {
  ensure()
  const model = await getSetting<string>("split_reel_broll_model", "fal-ai/ltx-video")
  const res = (await fal.queue.result(model, { requestId })) as { data?: { video?: { url?: string } } }
  return res?.data?.video?.url ?? null
}
```

- [ ] **Step 3: Type-check.** `npm run build`. Expected: no new errors. Confirm `getAdminFirestore`/`getAdminStorage` exports exist in `lib/firebase-admin.ts` (adjust import if the names differ).

- [ ] **Step 4: Commit**
```bash
git add app/api/webhooks/fal-broll/route.ts lib/split-reel/fal-result.ts
git commit -m "feat(split-reel): fal b-roll completion webhook → media_asset + segment ready"
```

---

### Task B14: Chain `broll_generation` → `split_reel_render`

**Files:** Modify `functions/src/on-ai-job-completed.ts`

- [ ] **Step 1: Read** `functions/src/on-ai-job-completed.ts` to see how it chains completed jobs (e.g. blog_generation → blog_image_generation) and how it reads `before`/`after` status + `createAiJob`-equivalent in the functions runtime.

- [ ] **Step 2: Add a chain branch:** when a job transitions to `completed` and its `type === "broll_generation"`, enqueue a `split_reel_render` job with the same `videoUploadId` and `userId`. Mirror the existing chaining code exactly (use the same Firestore write / job-create helper the file already uses):

```ts
    if (after.type === "broll_generation" && becameCompleted) {
      const videoUploadId = (after.input as { videoUploadId?: string } | undefined)?.videoUploadId
      if (videoUploadId) {
        await firestore.collection("ai_jobs").doc().set({
          type: "split_reel_render",
          status: "pending",
          input: { videoUploadId, userId: after.userId },
          result: null,
          error: null,
          userId: after.userId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
    }
```

(Use the exact variable names the file already uses for the after-snapshot and the "became completed" check; this snippet shows intent — match local style.)

- [ ] **Step 3: Type-check + build functions.** From `functions/`: `npm run build`. Expected exits 0.

- [ ] **Step 4: Commit**
```bash
git add functions/src/on-ai-job-completed.ts
git commit -m "feat(split-reel): chain broll_generation → split_reel_render"
```

**Part B done when:** migration applied; all new Vitest suites green; app + functions type-check clean. (End-to-end fal generation is verified in Part C's manual run.)

---

# PART C — Render trigger, worker split path, API

### Task C1: `split_reel_render` Cloud Run trigger

**Files:** Create `functions/src/split-reel-render-trigger.ts`, modify `functions/src/index.ts`

> Read `functions/src/caption-render-trigger.ts` and copy its structure (atomic pending→processing claim + `JobsClient.runJob` with the SAME `RENDER_JOB` name + region). The only difference: add a `RENDER_MODE=split_reel` env override.

- [ ] **Step 1: Implement the trigger.** Create `functions/src/split-reel-render-trigger.ts` mirroring `caption-render-trigger.ts`, with the env overrides:

```ts
    overrides: {
      containerOverrides: [
        {
          env: [
            { name: "AI_JOB_ID", value: jobId },
            { name: "VIDEO_UPLOAD_ID", value: videoUploadId },
            { name: "RENDER_MODE", value: "split_reel" },
          ],
        },
      ],
    },
```

Keep the same job name (`projects/${project}/locations/${REGION}/jobs/${RENDER_JOB}`), the same atomic-claim transaction, and the same `videoUploadId` extraction from `input` as the caption trigger. Export `handleSplitReelRender(jobId)`.

- [ ] **Step 2: Dispatch it** in `functions/src/index.ts` (alongside the `video_caption_render` branch):

```ts
    if (data.type === "split_reel_render") {
      const { handleSplitReelRender } = await import("./split-reel-render-trigger.js")
      await handleSplitReelRender(jobId)
      return
    }
```

- [ ] **Step 3: Type-check + build functions.** From `functions/`: `npm run build`. Expected exits 0.

- [ ] **Step 4: Commit**
```bash
git add functions/src/split-reel-render-trigger.ts functions/src/index.ts
git commit -m "feat(split-reel): split_reel_render Cloud Run trigger (RENDER_MODE=split_reel)"
```

---

### Task C2: Worker b-roll fetch helper

**Files:** Create `render-worker/src/lib/broll-fetch.ts`

> Read `render-worker/src/lib/serve-file.ts` (`serveFileLocally`) to reuse loopback serving for each clip.

- [ ] **Step 1: Implement.** Create `render-worker/src/lib/broll-fetch.ts`:

```ts
// render-worker/src/lib/broll-fetch.ts
// Load the ready b-roll segments for a video from Supabase, download each clip to a
// local dir, and serve each over loopback (OffthreadVideo needs http://, not file://).
import type { SupabaseClient } from "@supabase/supabase-js"
import path from "node:path"
import fs from "node:fs"
import { serveFileLocally } from "./serve-file.js"

export type ReadyBrollClip = { startMs: number; endMs: number; url: string; close: () => Promise<void> }

export async function loadReadyBrollClips(
  supabase: SupabaseClient,
  bucket: { file: (p: string) => { download: (o: { destination: string }) => Promise<unknown> } },
  videoUploadId: string,
  workDir: string,
): Promise<ReadyBrollClip[]> {
  const { data: segs, error } = await supabase
    .from("broll_segments")
    .select("segment_index,start_ms,end_ms,media_asset_id,status")
    .eq("video_upload_id", videoUploadId)
    .eq("status", "ready")
    .not("media_asset_id", "is", null)
    .order("segment_index", { ascending: true })
  if (error) throw error
  const rows = segs ?? []
  if (rows.length === 0) return []

  const assetIds = rows.map((r) => r.media_asset_id as string)
  const { data: assets, error: aErr } = await supabase
    .from("media_assets")
    .select("id,storage_path")
    .in("id", assetIds)
  if (aErr) throw aErr
  const pathById = new Map((assets ?? []).map((a) => [a.id as string, a.storage_path as string]))

  const clips: ReadyBrollClip[] = []
  for (const r of rows) {
    const storagePath = pathById.get(r.media_asset_id as string)
    if (!storagePath) continue
    const local = path.join(workDir, `broll-${r.segment_index}.mp4`)
    await bucket.file(storagePath).download({ destination: local })
    const server = await serveFileLocally(local)
    clips.push({ startMs: r.start_ms as number, endMs: r.end_ms as number, url: server.url, close: server.close })
  }
  return clips
}
```

- [ ] **Step 2: Type-check.** From `render-worker/`: `npm run build`. Expected exits 0. (Adjust the `serveFileLocally` return shape — `{ url, close }` — to match the actual export.)

- [ ] **Step 3: Commit**
```bash
git add render-worker/src/lib/broll-fetch.ts
git commit -m "feat(split-reel): worker helper to load + serve ready b-roll clips"
```

---

### Task C3: Worker `RENDER_MODE` branch + `runSplitReel()`

**Files:** Modify `render-worker/src/index.ts`

> This is the biggest worker change. Read the full current `index.ts` first. Keep the existing caption path intact; add a sibling `runSplitReel()` that reuses the same helpers (download, metadata, serveFileLocally, pageCaptions, bundle, upload, attach). Verified by type-check/build + the Part-C manual run.

- [ ] **Step 1: Branch at the entry.** Change the bottom `void main()` to select by mode:

```ts
const mode = process.env.RENDER_MODE === "split_reel" ? "split_reel" : "caption"
void (mode === "split_reel" ? runSplitReel() : main())
```

- [ ] **Step 2: Add `runSplitReel()`** in `render-worker/src/index.ts`. It mirrors `main()` but renders the `SplitReel` composition with detected trajectory + b-roll clips:

```ts
async function runSplitReel(): Promise<void> {
  const aiJobId = process.env.AI_JOB_ID
  const videoUploadId = process.env.VIDEO_UPLOAD_ID
  if (!aiJobId || !videoUploadId) throw new Error("AI_JOB_ID and VIDEO_UPLOAD_ID required")

  const app = fbApp()
  const firestore = getFirestore(app)
  const bucket = getStorage(app).bucket()
  const jobRef = firestore.collection("ai_jobs").doc(aiJobId)
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })

  const servers: Array<{ close: () => Promise<void> }> = []
  try {
    // 1. video + speech transcript
    const { data: video, error: vErr } = await supabase.from("video_uploads").select("*").eq("id", videoUploadId).single()
    if (vErr || !video) throw new Error(`video_uploads ${videoUploadId} not found`)
    const { data: tx } = await supabase
      .from("video_transcripts").select("*").eq("video_upload_id", videoUploadId)
      .eq("source", "speech").not("assemblyai_job_id", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (!tx?.assemblyai_job_id) throw new Error("no speech transcript with an AssemblyAI id")

    // 2. words + pages
    const words = await fetchTranscriptWords(tx.assemblyai_job_id)
    const pages = pageCaptions(words)

    // 3. download source
    const workDir = path.join(os.tmpdir(), "split-reel", aiJobId)
    fs.mkdirSync(workDir, { recursive: true })
    const srcExt = path.extname(video.storage_path) || ".mp4"
    const srcPath = path.join(workDir, `source${srcExt}`)
    await bucket.file(video.storage_path).download({ destination: srcPath })

    const meta = await getVideoMetadata(srcPath)
    const durationInSeconds = meta.durationInSeconds
    if (durationInSeconds === null) throw new Error("could not determine video duration")
    if (durationInSeconds > MAX_CAPTION_CLIP_SECONDS) throw new Error(`clip exceeds ${MAX_CAPTION_CLIP_SECONDS}s cap`)

    // 4. face trajectory (detect on the local file, then smooth)
    const rawTrajectory = await detectFaceTrajectory(srcPath, { sampleEveryMs: 200 })
    const trajectory = smoothTrajectory(rawTrajectory, 600)

    // 5. serve source + ready b-roll clips over loopback
    const srcServer = await serveFileLocally(srcPath)
    servers.push(srcServer)
    const brollClips = await loadReadyBrollClips(supabase, bucket, videoUploadId, workDir)
    brollClips.forEach((c) => servers.push({ close: c.close }))

    // 6. render SplitReel
    const entry = path.join(process.cwd(), "dist", "remotion", "index.js")
    const serveUrl = await bundle({ entryPoint: entry, publicDir: path.join(process.cwd(), "public") })
    const durationInFrames = Math.max(1, Math.ceil(durationInSeconds * FPS))
    const inputProps = {
      videoSrc: srcServer.url,
      pages,
      accentHex: BRAND_ACCENT_HEX,
      trajectory,
      broll: brollClips.map((c) => ({ startMs: c.startMs, endMs: c.endMs, src: c.url })),
    }
    const comp = await selectComposition({ serveUrl, id: "SplitReel", inputProps })
    const outDir = path.join(os.tmpdir(), "split-reel")
    fs.mkdirSync(outDir, { recursive: true })
    const outPath = path.join(outDir, `${aiJobId}.mp4`)
    await renderMedia({
      composition: { ...comp, durationInFrames, fps: FPS, width: 1080, height: 1920 },
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
      chromiumOptions: { enableMultiProcessOnLinux: true },
      offthreadVideoCacheSizeInBytes: 4 * 1024 * 1024 * 1024,
      concurrency: 4,
    })

    await Promise.all(servers.map((s) => s.close().catch(() => {})))
    fs.rmSync(srcPath, { force: true })

    // 7. upload + media_asset(origin='split_reel')
    const userId = (video.uploaded_by as string | null) ?? "system"
    const storagePath = `videos/${userId}/${Date.now()}-split-reel.mp4`
    await bucket.upload(outPath, { destination: storagePath, contentType: "video/mp4" })
    const bytes = fs.statSync(outPath).size
    fs.rmSync(outPath, { force: true })

    const { data: asset, error: aErr } = await supabase.from("media_assets").insert({
      kind: "video", storage_path: storagePath, public_url: storagePath, mime_type: "video/mp4",
      bytes, width: 1080, height: 1920, duration_ms: Math.round(durationInSeconds * 1000),
      derived_from_video_id: videoUploadId, ai_alt_text: null,
      ai_analysis: { origin: "split_reel" }, created_by: video.uploaded_by ?? null,
    }).select().single()
    if (aErr || !asset) throw new Error(`media_asset insert failed: ${aErr?.message}`)

    // 8. attach to existing posts (reuse the caption attach logic)
    await attachSplitReelToPosts(supabase, videoUploadId, asset.id)

    // 9. complete
    await jobRef.update({ status: "completed", error: null, result: { assetId: asset.id }, updatedAt: FieldValue.serverTimestamp() })
    process.exit(0)
  } catch (err) {
    await Promise.all(servers.map((s) => s.close().catch(() => {})))
    await jobRef.update({ status: "failed", error: (err as Error).message ?? "split render failed", updatedAt: FieldValue.serverTimestamp() }).catch(() => {})
    console.error("[split-reel]", err)
    process.exit(1)
  }
}
```

- [ ] **Step 3: Add the imports** at the top of `index.ts`:
```ts
import { detectFaceTrajectory } from "./lib/detect-face.js"
import { smoothTrajectory } from "./lib/face-track.js"
import { loadReadyBrollClips } from "./lib/broll-fetch.js"
```

- [ ] **Step 4: Factor the post-attach logic.** Extract the caption path's "attach to existing posts" block (index.ts lines ~280-336) into a shared `attachSplitReelToPosts(supabase, videoUploadId, assetId)` that the new `runSplitReel()` calls, OR copy the same logic inline. (Reuse `planCutAttachment` exactly as the caption path does so a Split Reel attaches to the same draft posts.) Keep the caption path behavior unchanged.

- [ ] **Step 5: Type-check.** From `render-worker/`: `npm run build`. Expected exits 0. Then `npm test` — the 24 existing tests still pass.

- [ ] **Step 6: Commit**
```bash
git add render-worker/src/index.ts
git commit -m "feat(split-reel): RENDER_MODE=split_reel worker path (detect → broll → render SplitReel)"
```

---

### Task C4: Admin API route (enqueue generation + state)

**Files:** Create `app/api/admin/content-studio/split-reel/route.ts`

> Read `app/api/admin/content-studio/captioned-cut/route.ts` and copy its auth + flag-check + dedupe + `withAudit` structure.

- [ ] **Step 1: Implement.** Create `app/api/admin/content-studio/split-reel/route.ts`:

```ts
// app/api/admin/content-studio/split-reel/route.ts
import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { getSetting } from "@/lib/db/system-settings"
import { splitReelGenerateSchema } from "@/lib/validators/split-reel"
import { getSpeechTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createAiJob, findInFlightBrollGeneration, findInFlightSplitRender } from "@/lib/ai-jobs"
import { getBrollSegmentsForVideo } from "@/lib/db/broll-segments"
import { withAudit } from "@/lib/audit/with-audit"

async function getHandler(request: NextRequest) {
  const session = await auth()
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 })
  const videoUploadId = new URL(request.url).searchParams.get("videoUploadId")
  if (!videoUploadId) return NextResponse.json({ error: "videoUploadId required" }, { status: 400 })

  const [genJob, renderJob, segments] = await Promise.all([
    findInFlightBrollGeneration(videoUploadId),
    findInFlightSplitRender(videoUploadId),
    getBrollSegmentsForVideo(videoUploadId),
  ])
  return NextResponse.json({
    inFlightBrollJobId: genJob,
    inFlightRenderJobId: renderJob,
    segments: segments.map((s) => ({ id: s.id, index: s.segment_index, concept: s.concept, status: s.status, startMs: s.start_ms, endMs: s.end_ms })),
  })
}

async function postHandler(request: NextRequest) {
  const session = await auth()
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const enabled = await getSetting<boolean>("feature_split_reel_enabled", false)
  if (!enabled) return NextResponse.json({ error: "feature disabled" }, { status: 403 })

  const parsed = splitReelGenerateSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 })
  const { videoUploadId } = parsed.data

  const transcript = await getSpeechTranscriptForVideo(videoUploadId)
  if (!transcript) return NextResponse.json({ error: "no speech transcript" }, { status: 409 })

  const existing = await findInFlightBrollGeneration(videoUploadId)
  if (existing) return NextResponse.json({ jobId: existing }, { status: 200 })

  const { jobId } = await createAiJob({ type: "broll_generation", userId: session.user.id, input: { videoUploadId } })
  return NextResponse.json({ jobId }, { status: 202 })
}

// GET is a plain state read (not audited — reads of render state don't need an
// audit trail, and the single "split_reel.broll_generate" slug is admin_write).
export const GET = getHandler
export const POST = withAudit({ action: "split_reel.broll_generate", category: "admin_write" }, postHandler)
```

- [ ] **Step 2: Type-check.** `npm run build`. Confirm `getSpeechTranscriptForVideo` is the real export name in `lib/db/video-transcripts.ts` (the caption route uses it — match exactly).

- [ ] **Step 3: Commit**
```bash
git add app/api/admin/content-studio/split-reel/route.ts
git commit -m "feat(split-reel): admin API route (enqueue b-roll generation + state)"
```

---

### Task C5: Manual end-to-end verification (deploy required)

> No code; this is the honest E2E check that the pipeline works. It needs: migration applied (B1), functions + worker deployed, `FAL_KEY` with credits, `BROLL_WEBHOOK_SECRET` set, `APP_BASE_URL` reachable by fal, and `feature_split_reel_enabled=true`.

- [ ] **Step 1: Set secrets/flags.** Set `BROLL_WEBHOOK_SECRET` (functions + app env). Confirm `FAL_KEY` present. Flip `feature_split_reel_enabled` to `true` (admin settings or `system_settings`). Confirm `split_reel_broll_model` is a valid current fal text-to-video endpoint id (verify against fal's model list; update the setting if `fal-ai/ltx-video` has changed).
- [ ] **Step 2: Deploy** functions (`functions:default:onAiJobCreated`/dispatcher, `onAiJobCompleted`, the new triggers — use the codebase's `functions:default:<name>` deploy convention) and the render-worker container (rebuild the image from Part A so models/wasm/ffmpeg are baked in).
- [ ] **Step 3: Trigger** via `POST /api/admin/content-studio/split-reel` with a real `videoUploadId` that has a speech transcript. Expect `202 { jobId }`.
- [ ] **Step 4: Observe** the chain in Firestore `ai_jobs`: `broll_generation` (processing) → `broll_segments` rows go `generating` → fal webhook flips them `ready` → `broll_generation` `completed` → a `split_reel_render` job appears → render worker runs → `completed` with `result.assetId`.
- [ ] **Step 5: Verify the output.** The `media_assets` row with `ai_analysis.origin='split_reel'` exists; sign + play it: confirm full-frame face-tracked talking head, cutting to the two-row split with real fal b-roll at the selected moments, captions on the seam, attached to the draft posts. Note any quality issues for tuning (`split_reel_*` settings, crop constants in `face-track.ts`).
- [ ] **Step 6: Record results** (what worked, fal cost/time per clip, any failures) in a short note appended to this plan file, and commit that note.

**Part C done when:** all type-checks/builds pass; the manual E2E produces a real Split Reel attached to posts (or, if deploy isn't available in this environment, every code task is committed and the E2E checklist is handed to the operator).

---

## Self-review checklist (run after writing, fix inline)
- Spec coverage: face tracking (A), moment selection + fal generation + caching + webhook (B), `broll_segments` table + settings (B1), `split_reel_render` worker + API + auto-chain (C), feature flag + audit + dropped-surfacing (B4 returns `dropped`; surfaced in GET state + job result). Preview/regenerate UI is correctly deferred to Phase 3.
- Type consistency: `BrollSegment` (B2) ↔ DAL (B3) ↔ migration (B1) ↔ worker fetch (C2) ↔ webhook (B13); `RawWindow` (B4) ↔ handler (B11); `FacePoint` reused from Phase 1 (A2/A3) ↔ `SplitReelProps.trajectory`/`broll` (C3 inputProps) ↔ Phase-1 composition.
- Naming: job types `broll_generation` / `split_reel_render` consistent across ai-jobs (B6), dispatch (B12/C1), chain (B14), trigger (C1).

## What Phase 2 deliberately defers to Phase 3
- Preview/regenerate UI in Content Studio (the b-roll strip, per-window regenerate, dropped-moment banner) and gating the render behind human approval (Phase 2 auto-chains generation → render).
- Active-speaker selection for multi-face frames; mode-transition easing; image-to-video / Ken-Burns b-roll modes.
