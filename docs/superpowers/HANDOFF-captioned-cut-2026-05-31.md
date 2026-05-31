# Captioned Cut — Handoff (2026-05-31)

Live status of the "Generate Captioned Cut" feature: TikTok-style word-pop
captions burned onto a vertical 9:16 MP4, generated from a video's speech
transcript. Built, deployed to GCP, and **currently being debugged on the first
real render**. This doc lets a fresh session continue without re-discovery.

---

## TL;DR — where we are right now

- **Code + UI: DONE and shipped** (M1 + M2). All on `main`, pushed to `origin/main`.
- **GCP infra: DEPLOYED and working** (Cloud Run job + Firebase trigger). The
  button → job → trigger → Cloud Run chain fires correctly.
- **BLOCKER being fixed:** the actual Remotion render has **never succeeded**.
  Three failed attempts, each diagnosed one layer deeper. The latest fix
  (`ce4958a`) addresses the confirmed root cause; **a corrected Cloud Run image
  was deploying** (background task `bwi96elir`) and needs a fresh render to verify.
- **Immediate next step:** confirm that deploy finished, then have the user upload
  a fresh short video, wait for "Transcribed", click **Generate Captioned Cut**,
  and read the worker step-logs to confirm it reaches `step=render ok` +
  `step=upload ok`.

---

## The debugging journey (so you don't repeat it)

The first real render failed 3×. Each failure was diagnosed via worker logs:

1. **Guess #1 (WRONG): "Failed to launch browser"** → added full Chrome dep set
   to the Dockerfile (`3fc0946`). Harmless hygiene, but NOT the cause.
2. **Guess #2 (WRONG): missing compositor binary** → ruled out; the
   `@remotion/compositor-linux-x64-gnu` binary loaded fine (the error was a Rust
   backtrace FROM the compositor, proving it ran).
3. **Root cause (CONFIRMED via step-logging + Remotion docs):** the worker passed
   a **signed HTTPS URL** to `getVideoMetadata()`. Remotion docs state verbatim:
   *"Pass an absolute path to getVideoMetadata(). URLs are not supported."* The
   step-log proved it: `step=sign ok` → `step=metadata` → dead in 0.6s with
   `Compositor error: No such file or directory`.

**The fix (`ce4958a`):** download the source object from Firebase Storage to local
`/tmp` first, pass the **local path** to `getVideoMetadata`, and a **`file://`
URL** (via `pathToFileURL`) to `<OffthreadVideo>`. This also removes the fragile
remote-streaming dependency.

⚠️ **What is still UNPROVEN:** the render step itself (headless Chrome compositing
~172 caption words over the video → H.264). Every failure so far died at
`step=metadata`, BEFORE rendering. The next run is the first that can reach
`step=bundle → selectComposition → render → upload`. A new issue could surface
there (fonts, memory, Chrome flags) — the step-logging will pinpoint it instantly.

---

## How to verify the next render (the exact procedure)

1. **Confirm the latest deploy is live:**
   `gcloud run jobs describe captioned-cut-render --region us-central1 --project darrenjpaulcom --format="value(metadata.name)"`
   — and check the image is recent. The deploy that was in flight at handoff was
   background task `bwi96elir` (from commit `ce4958a`). If unsure, redeploy (see
   "Redeploy" below).
2. **User action:** `/admin/content` → **Upload → Video** (short clip w/ speech) →
   wait for green **Transcribed** pill → click **Generate Captioned Cut**.
3. **Watch the render** (read-only). Get the newest execution + its step-logs:
   ```bash
   gcloud run jobs executions list --job captioned-cut-render --region us-central1 --project darrenjpaulcom --limit 3
   # then, fresh logs since the click (adjust timestamp):
   gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="captioned-cut-render" AND timestamp>="<ISO8601>"' \
     --project darrenjpaulcom --limit 80 --order=asc --format="value(timestamp,severity,textPayload)"
   ```
   Success = log shows `step=render ok` then `step=upload ok`, the Firestore
   `ai_jobs` doc flips to `completed`, and a `media_assets` row +
   draft `social_post`(s) appear.
4. **Confirm Firestore job status** (read-only): query `ai_jobs` ordered by
   `createdAt` desc (see "Useful queries").

### Known gotcha: stuck in-flight job blocks retry on the SAME video
The create-route has an **in-flight guard**: if an `ai_jobs` doc of type
`video_caption_render` for that `videoUploadId` is still `pending`/`processing`,
it returns the existing (possibly dead) job instead of starting a new one. Failed
renders that never flip the doc to `failed` leave it stuck `processing`.
- **Stuck docs known at handoff:** `huAW9JnJU8RReNM5jugM` (vid 71778bc6),
  and the one from vid 6c7437dd / df7b7a92.
- **Cleanest workaround (no DB write):** test with a **fresh uploaded video** each
  time — the guard only blocks the specific stuck video.
- Resetting a stuck doc to `failed` requires a production Firestore write, which
  the auto-mode classifier **blocks** unless the user explicitly authorizes it.

---

## What's deployed (GCP project `darrenjpaulcom`, region `us-central1`)

- **Cloud Run JOB** `captioned-cut-render` — 4 GiB / 2 vCPU, task-timeout 900s,
  max-retries 1. Built from `render-worker/` via `gcloud run jobs deploy --source`.
- **Service account** `captioned-cut-render@darrenjpaulcom.iam.gserviceaccount.com`
  — bucket `objectAdmin` on `darrenjpaulcom.firebasestorage.app`,
  `secretAccessor` on SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ASSEMBLYAI_API_KEY,
  Token-Creator on itself. Worker auth = **ADC** (no key file; commit `03baf99`).
- **Firebase function** `captionRender` (gen2, Firestore `document.created` on
  `ai_jobs/{jobId}`) — ACTIVE. Runtime SA `455823721275-compute@developer.gserviceaccount.com`
  has `run.developer` on the job + `actAs` on the render SA. Launches the job via
  `@google-cloud/run` `JobsClient.runJob` with env overrides AI_JOB_ID + VIDEO_UPLOAD_ID.
- **Secrets** live in Secret Manager: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `ASSEMBLYAI_API_KEY` (all pre-existing). `FIREBASE_SERVICE_ACCOUNT_KEY` is NOT
  used (ADC instead).
- **Feature flag** `feature_captioned_cut_enabled` in `system_settings` = **TRUE**
  (already flipped on). DB-backed, not env-driven.

### Redeploy the worker (after any render-worker/ change)
```bash
gcloud run jobs deploy captioned-cut-render --source render-worker \
  --region us-central1 --project darrenjpaulcom \
  --service-account captioned-cut-render@darrenjpaulcom.iam.gserviceaccount.com \
  --memory 4Gi --cpu 2 --task-timeout 900s --max-retries 1 \
  --set-secrets "SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,ASSEMBLYAI_API_KEY=ASSEMBLYAI_API_KEY:latest" \
  --set-env-vars "FIREBASE_STORAGE_BUCKET=darrenjpaulcom.firebasestorage.app"
```
⚠️ gcloud's default project is `speakersplit-9899f` — ALWAYS pass
`--project darrenjpaulcom`. Bucket is `darrenjpaulcom.firebasestorage.app`.

---

## Architecture (data flow)

```
Content Studio drawer OR team-review StatusActions
  → POST /api/admin/content-studio/captioned-cut { videoUploadId | submissionId }
      → flag gate + transcript guard (speech transcript w/ assemblyai_job_id) + in-flight guard
      → createAiJob("video_caption_render", { videoUploadId })   [Firestore ai_jobs]
          → captionRender onDocumentCreated trigger: atomic claim (pending→processing),
            then JobsClient.runJob(captioned-cut-render, env: AI_JOB_ID, VIDEO_UPLOAD_ID)
              → Cloud Run worker (render-worker/src/index.ts):
                  1 load video_uploads + speech video_transcripts
                  2 fetch AssemblyAI words[]
                  3 DOWNLOAD source to /tmp  (was: sign URL — that was the bug)
                  4 getVideoMetadata(localPath) + 180s cap
                  5 pageCaptions(words) → ≤3-word timed pages
                  6 Remotion render (OffthreadVideo file:// + word-pop overlay) → /tmp mp4
                  7 upload to videos/{userId}/{ts}-captioned-cut.mp4
                  8 media_assets row (ai_analysis.origin='captioned_cut') + draft social_post per platform
                  9 ai_jobs → completed { assetId, postIds }
  → UI polls via useAiJob → preview + draft post link
```

---

## Key files

**App (Next.js):**
- `app/api/admin/content-studio/captioned-cut/route.ts` — create-job route
- `components/admin/content-studio/drawer/GenerateCaptionedCutButton.tsx` — drawer button
- `components/admin/team-videos/StatusActions.tsx` — team-review button (via ReviewSurface)
- `lib/content-studio/promote-submission.ts` — promote-or-reuse helper (team path)
- `lib/db/media-assets.ts` — `listCaptionedCutVideoIds()` (Cut-badge data)
- `lib/content-studio/pipeline-data.ts` + `pipeline/VideoCard.tsx` — "Cut" badge
- `lib/db/video-transcripts.ts` — `getSpeechTranscriptForVideo()` guard
- `lib/feature-flag-catalog.ts` — DB flag registration
- `functions/src/caption-render-trigger.ts` + `functions/src/index.ts` (captionRender)

**Worker (separate package, render-worker/):**
- `render-worker/src/index.ts` — entrypoint (the file under active debugging)
- `render-worker/src/remotion/{Root,CaptionedCut,index}.tsx` — composition
- `render-worker/src/lib/{caption-paging,assemblyai-words,color}.ts` — twin helpers
- `render-worker/Dockerfile` — Chromium deps + Lexend Exa font + ensureBrowser

**Specs/plans:** `docs/superpowers/specs/2026-05-31-captioned-cut-design.md`,
`docs/superpowers/plans/2026-05-31-captioned-cut-m1-core.md` (+ m2),
`docs/superpowers/specs/2026-05-31-captioned-cut-badge-design.md`.

---

## Commit history (most recent first, all on origin/main)

- `ce4958a` download source to /tmp; getVideoMetadata needs local path **(the root-cause fix)**
- `0c9bb7d` worker step logging + enableMultiProcessOnLinux + ensure tmp dir
- `03baf99` worker uses ADC instead of a SA key file
- `9891abe` exclude render-worker from root tsconfig (fixed a RED Vercel build)
- `3fc0946` complete Chrome dep set (guess #1 — harmless)
- (earlier) `9ca5ae2` M2 hermetic mocks; `c9f4fb2` M2 team button; plus the full
  M1+M2 + badge series. ~30 captioned-cut commits total.

---

## Tests (all green at handoff)
Full captioned-cut + pipeline suite passes. Notable: `caption-paging` (7),
`captioned-cut-route` (10), `promote-submission` (6), `media-assets-cut-ids` (4),
`VideoCard-cut` (3), `GenerateCaptionedCutButton` (2), StatusActions (5).
DB tests hit real Supabase via `.env.local`.

---

## Environment gotchas (cost real time — read before debugging)

1. **PowerShell 5.1 batch cancellation:** if ANY tool call in a multi-call batch
   errors (e.g. `tsc` exit-2 from pre-existing repo errors, a failing test, a
   non-zero grep), the harness **cancels all sibling calls** in that batch. Run
   verification/test/commit calls **one at a time**, not batched with edits.
2. **PowerShell here-strings + git commit:** embedded double-quotes in a commit
   message passed to native git get mangled (message splits into pathspecs). Use
   **single-line commit messages without embedded double-quotes**, or `git commit`
   via the Bash tool with a heredoc.
3. **`/tmp` does NOT persist across Bash tool calls** — files written in one call
   vanish in the next. Write diagnostic output to a **repo-local** file (e.g.
   `_scratch.txt`), read it with the Read tool, then `rm` it. (Don't commit these.)
4. **Cloud Run job logs** use `resource.type="cloud_run_job"` (NOT
   `cloud_run_revision`, which is the Firebase function `captionrender` service).
   Payloads are often in `textPayload`; filter out `STARTUP TCP probe` /
   `Starting new instance` noise.
5. **The pre-existing repo has ~150 unrelated `tsc` errors and ~86 failing tests**
   (gsc-sync, shop/printful, ai-schemas Zod-v4 drift, etc.) — NOT caused by this
   work. Verify captioned-cut files in isolation; don't be alarmed by the repo-wide
   red.
6. **Two MCP write-guards to expect:** production Firestore writes and
   recursive Cloud Storage deletes are blocked by the auto-mode classifier unless
   the user explicitly authorizes the specific action. This is correct; ask the user.
7. **Repo `tsconfig.json` excludes `functions` + `render-worker`** — the app build
   does NOT type-check the worker (it has its own deps in render-worker/node_modules
   that Vercel never installs). The worker is type-checked by its own `npm run build`.

---

## Useful queries (read-only)

**Recent ai_jobs (look for video_caption_render + status):**
```bash
TOKEN=$(gcloud auth print-access-token)
curl -s -X POST "https://firestore.googleapis.com/v1/projects/darrenjpaulcom/databases/%28default%29/documents:runQuery" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"structuredQuery":{"from":[{"collectionId":"ai_jobs"}],"orderBy":[{"field":{"fieldPath":"createdAt"},"direction":"DESCENDING"}],"limit":6}}'
```

**Confirm a cut asset exists (post-success):** via Supabase MCP —
`select count(*) from media_assets where ai_analysis->>'origin' = 'captioned_cut';`

---

## What's left (priority order)
1. **Verify the render completes** (the one open item). Deploy `ce4958a` if not
   already live, fresh-video render, read step-logs to `step=upload ok`.
2. If render reveals a new failure (fonts/memory/Chrome flags) — fix per the
   step-log, redeploy, re-verify.
3. Minor cleanup (non-blocking): the source-file `/tmp` cleanup line didn't apply
   in `ce4958a` (Cloud Run tears down /tmp anyway, so cosmetic). Fold in next time
   render-worker/src/index.ts is touched.
4. Memory file `captioned_cut_deployed.md` exists but predates the render debugging
   — update its "what remains" once the render is verified.
