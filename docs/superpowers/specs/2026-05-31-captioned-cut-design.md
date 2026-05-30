# Captioned Cut — Design Spec

**Date:** 2026-05-31
**Status:** Approved (user-reviewed 2026-05-31; Remotion licensing cleared — solo individual). Ready for implementation planning.
**Feature flag:** `feature_captioned_cut_enabled` — DB-backed row in
`system_settings` (default false), admin-togglable at runtime (no redeploy). NOT
env-driven.

## Summary

Add a **"Generate Captioned Cut"** action to Content Studio that turns a source
video into a vertical 9:16 MP4 with TikTok-style word-pop ("karaoke") captions
burned in, then drops the result back into the studio as a draft video social
post. It reuses the existing `ai_jobs` queue, AssemblyAI transcripts, accent
colors, `media_assets` table, and draft-post flow. The only genuinely new
infrastructure is a **Remotion render container on Cloud Run** (headless Chromium
is too heavy for a Firebase Function).

The feature is the video sibling of the existing **Generate Quote Cards** action
and follows that precedent end to end.

## Goals (v1)

- One caption style: **word-pop karaoke** (1–3 words on screen; current word pops
  in the video's accent color, others white, bold).
- One output: **1080×1920 (9:16)**, English.
- Two admin entry points, one backend:
  1. Content Studio video drawer (beside Generate Quote Cards).
  2. Team-videos review UI (on `approved` submissions).
- Auto-create **draft video social post(s)** with the rendered cut attached —
  one per video-compatible connected platform, mirroring the quote-card flow
  (`social_posts.platform` is NOT NULL, so a platform-agnostic draft is not
  possible without a schema change we are not making).
- Storage is **Firebase Storage** (project standing rule).

## Non-goals (v2+)

- Manual transcript/caption editing before render.
- Multiple aspect ratios or caption styles.
- Position / accent / font overrides.
- Client-facing access (admin-only in v1).
- Captioning `image_set` team submissions (they never become videos).

## Background — what already exists (reuse, don't rebuild)

Verified by codebase exploration on 2026-05-31:

| Capability | Existing implementation |
|---|---|
| Async job queue | Firestore `ai_jobs` + `onDocumentCreated` triggers in `functions/src/index.ts`; `createAiJob()` in [lib/ai-jobs.ts](../../../lib/ai-jobs.ts) |
| Transcription (word timestamps) | AssemblyAI. `video_transcripts.assemblyai_job_id` stores the transcript id ([app/api/webhooks/assemblyai/route.ts:203](../../../app/api/webhooks/assemblyai/route.ts)). `GET /v2/transcript/{id}` returns `words[]` with `start`/`end` ms per word. |
| Firebase Storage (admin) | `getAdminStorage()`, `getSignedVideoUrl()` in [lib/firebase-admin.ts](../../../lib/firebase-admin.ts) |
| Generated-asset precedent | Quote cards: render → Firebase Storage → `media_assets` row (`derived_from_video_id`) → draft `social_post` → `attachMedia()`. [app/api/admin/content-studio/quote-cards/route.ts](../../../app/api/admin/content-studio/quote-cards/route.ts) |
| `media_assets` table | Already supports `kind:'video'`, `duration_ms`, `derived_from_video_id`, `ai_analysis` (migration 00093). No schema change needed for the output. |
| Accent color | `accentForVideo(videoId)` → OKLCH string. [lib/content-studio/video-accent.ts](../../../lib/content-studio/video-accent.ts) |
| Feature flag (DB-backed) | `system_settings` table (`key`/jsonb `value`); read via `getSetting<boolean>(key, false)` ([lib/db/system-settings.ts](../../../lib/db/system-settings.ts)) and a fail-open twin for functions ([functions/src/lib/system-settings.ts](../../../functions/src/lib/system-settings.ts)). Flipped by a human via `/admin/automation` → `POST /api/admin/automation/toggle-cron`, audit-logged. |
| Job status UI | `useAiJob` hook (used by transcription / quote cards) |

### Team-videos connection (verified)

Team videos live in **separate** tables (`team_video_submissions` /
`team_video_versions`) that Content Studio never reads directly. They become
captioned-cut eligible **only after** an admin clicks "Send to Content Studio" on
an `approved` submission, which inserts a `video_uploads` row pointing at the
**same** Firebase Storage object (no copy) and auto-queues transcription
([send-to-content-studio/route.ts:66-90](../../../app/api/admin/team-videos/[id]/send-to-content-studio/route.ts)).
`video_uploads` has **no origin column**, and every Content Studio loader selects
by id alone — so a promoted team video is indistinguishable from an admin upload
and inherits all drawer actions for free.

`image_set` submissions go to `media_assets` + draft posts and never become
`video_uploads`, so they are categorically not captioned-cut eligible.

## Architecture

```
Trigger UI (Content Studio drawer OR team review StatusActions)
  → POST /api/admin/content-studio/captioned-cut { videoUploadId | submissionId }
      → promote-or-reuse helper (resolves to a single video_uploads row)
      → transcript guard: a video_transcripts row with source='speech'
        AND assemblyai_job_id IS NOT NULL must exist  (see "Transcript guard")
      → in-flight guard: if an ai_job (type=video_caption_render,
        input.videoUploadId=X, status in pending|processing) exists,
        return THAT jobId (no second render)         (see "Idempotency")
      → createAiJob("video_caption_render", { videoUploadId, userId })   [Firestore]
          → onDocumentCreated("ai_jobs/{jobId}")  [tiny trigger fn, guards type]
              → executes Cloud Run Job (heavy worker):
                   1. load video_uploads + video_transcripts (assemblyai_job_id, accent)
                   2. GET AssemblyAI /transcript/{id} → words[] (start/end ms)
                      (fetch fails past the guard = hard failure, no resubmit)
                   3. sign Firebase Storage URL for source MP4
                   4. caption-paging: words[] → timed ≤3-word pages
                   5. Remotion render → 1080×1920, word-pop overlay in accent color
                   6. upload → videos/{userId}/{ts}-captioned-cut.mp4  (Firebase Storage)
                   7. createMediaAsset({ kind:"video",
                      storage_path: <firebase object path>,
                      public_url: <same path string — signed on read>,
                      mime_type:"video/mp4", bytes:<rendered size>,
                      duration_ms, derived_from_video_id,
                      ai_analysis:{ origin:"captioned_cut" } })
                   8. for each video-compatible connected platform:
                      createSocialPost(platform, post_type:"video",
                      approval_status:"draft", source_video_id) + attachMedia(asset, 0)
                   9. ai_job → completed (result: { assetId, postIds })
  → UI polls job via useAiJob → preview + "view draft post"
```

## Components (each small, single-purpose)

1. **`GenerateCaptionedCutButton`** — `components/admin/content-studio/drawer/` —
   sibling of `GenerateQuoteCardsButton` in `DrawerVideoHeader.tsx`. Disabled
   unless a **speech** transcript exists (see Transcript guard) — for a
   vision-fallback video it shows a disabled state with "No speech transcript —
   captions need spoken audio". Rendered only when the flag is on — the parent
   server component reads `getSetting("feature_captioned_cut_enabled", false)`
   and passes it down as a prop. POSTs `videoUploadId`. Reuses the `useAiJob`
   hook (as the quote-cards UI does) to poll and show preview + draft-post link.
2. **Team review button** — added to
   [components/admin/team-videos/StatusActions.tsx](../../../components/admin/team-videos/StatusActions.tsx),
   enabled on `approved`, gated on the same flag (passed as a prop from the
   server). POSTs `submissionId`. ⚠️ `StatusActions` is currently a
   server-action / `router.refresh()` component, **not** a polling client — so
   wiring `useAiJob` job-status feedback here is **net-new** work (a small client
   island), not a free reuse like the drawer path.
3. **Create-job route** — `app/api/admin/content-studio/captioned-cut/route.ts` —
   admin-auth, **flag gate** (`getSetting("feature_captioned_cut_enabled", false)`
   → 403 if off), Zod-validated, runs promote-or-reuse, **transcript guard**,
   **in-flight guard** (returns the existing jobId if a render is already running
   for this video), then `createAiJob`. Returns `{ jobId }` (202; or `{ jobId }`
   200 when reusing an in-flight job).
4. **Promote-or-reuse helper (NEW)** — `lib/content-studio/promote-submission.ts`
   — idempotent resolution from `submissionId` → `video_uploads` row (see below).
   Does not exist yet; this spec creates it and refactors the existing
   `send-to-content-studio` route to call it.
5. **Trigger function** — new `onDocumentCreated("ai_jobs/{jobId}")` block in
   `functions/src/index.ts` guarding `type === "video_caption_render"`; executes
   the Cloud Run Job and returns. No rendering in the function runtime.
6. **Render worker** — new `render-worker/` at repo root (own `package.json` +
   `Dockerfile`, mirroring how `functions/` is its own root). Steps 1–9 above.
7. **Remotion composition** — `render-worker/remotion/` — `<OffthreadVideo>` of
   the source + word-pop caption overlay. 1080×1920.
8. **Pure caption-paging fn** — `lib/content-studio/caption-paging.ts` —
   `words[] → timed ≤3-word pages`. Pure + unit-tested; imported by the worker.

Worker step 8 mirrors the quote-card route: it lists connected platforms, filters
to those whose `post_type` supports `video` (`isPlatformPostTypeSupported`), and
creates one draft `social_post` per platform (`platform`, `approval_status:
'draft'`, `post_type: 'video'`, `source_video_id`), attaching the asset at
position 0 (the `media_url` mirror trigger then populates `social_posts.media_url`
automatically).

### New job type

Add `"video_caption_render"` to the `AiJobType` union in
[lib/ai-jobs.ts](../../../lib/ai-jobs.ts).

## Data model changes

One new nullable column on `video_uploads`:

```sql
-- supabase/migrations/00159_video_uploads_source_submission.sql
-- (00158 is the current ceiling; confirm it's merged/non-empty before adding this)
alter table public.video_uploads
  add column if not exists source_submission_id uuid
    references public.team_video_submissions(id) on delete set null;

create index if not exists idx_video_uploads_source_submission
  on public.video_uploads(source_submission_id);
```

**Why:** today `send-to-content-studio` creates a `video_uploads` row with no
back-reference and locks the submission. "Promote, then caption" called twice
would create duplicate rows. With `source_submission_id`, the promote-or-reuse
helper reuses an existing row instead of duplicating. This also makes the
existing Send button safely idempotent.

The rendered output needs **no** schema change — `media_assets` already covers it
(`kind:'video'`, `duration_ms`, `derived_from_video_id`,
`ai_analysis:{ origin:'captioned_cut' }`).

## Promote-or-reuse helper

```
resolveVideoUploadForSubmission(submissionId) -> { videoUploadId, transcribed }:
  existing = video_uploads where source_submission_id = submissionId
  if existing: return { existing.id, transcribed: hasTranscript(existing.id) }
  submission = getSubmissionById(submissionId)
  require submission.status in ('approved','locked')
  version  = getCurrentVersion(submissionId)
  row = createVideoUpload({ ...version fields, source_submission_id, status:'uploaded' })
  lockSubmission(submissionId)                          # existing behavior
  createAiJob('video_transcription', { videoUploadId: row.id })   # transcription, NOT render
  return { row.id, transcribed: false }
```

**Two distinct job types — keep them straight:**
- `video_transcription` is queued *here* (by the promote helper) only when a
  brand-new `video_uploads` row is created, exactly mirroring the current
  `send-to-content-studio` behavior. It produces the transcript.
- `video_caption_render` is queued *separately* by the create-route (architecture
  step, `createAiJob("video_caption_render", …)`) and is what this feature adds.

**Ordering consequence:** for a *freshly promoted* team submission, the transcript
won't exist yet, so the create-route's transcript guard returns a clear
"transcribing — try again once it's done" response (HTTP 409) rather than queuing
a render that has no word timestamps. For an *already-promoted/transcribed* video
(the common case, and always true for the Content Studio drawer path) the render
is queued immediately. The helper never queues a render itself.

The Content Studio drawer path skips this helper entirely (it already has a
`videoUploadId` with a transcript). The team path always goes through it. The
existing `send-to-content-studio` route is refactored to call the same helper so
there is exactly one promotion code path.

## Transcript guard (one definition, used everywhere)

Captioned cut needs **word-level speech timing**, which only the AssemblyAI
speech path produces. The single guard — used identically by the button-disable
logic, the create-route, and the worker — is:

> a `video_transcripts` row exists for the video **with `source='speech'` AND
> `assemblyai_job_id IS NOT NULL`**.

This matters because of the **vision fallback**: when AssemblyAI finds no speech,
the pipeline writes a `video_transcripts` row with `source='vision'` and a prose
frame description, and sets `video_uploads.status='analyzed'`
([video-vision.ts](../../../functions/src/video-vision.ts),
[webhooks/assemblyai/route.ts](../../../app/api/webhooks/assemblyai/route.ts)).
Such a video *has a transcript row and a "done" status but no word timings* —
captioned cut is **permanently impossible** for it, and re-transcription won't
help (there was no speech). So:

- The button is **disabled** for vision-only videos with the message *"No speech
  transcript — captions need spoken audio."* (NOT "transcribe this video first").
- The create-route returns **422** for the same case.
- "Not transcribed yet" (no row at all) is the only case that says *"still
  transcribing — try again once it's done"* (**409**).

## Render worker (Cloud Run Job)

- **Image:** Node + `@remotion/renderer` + its Chromium deps via Dockerfile.
- **Inputs (env/args):** `aiJobId`, `videoUploadId`.
- **Secrets / identity (no Firebase-functions precedent — specify explicitly):**
  - The existing functions use `defineSecret` wired by Firebase deploy tooling;
    that does **not** carry to a standalone Cloud Run Job. Instead deploy the job
    with `gcloud run jobs deploy --set-secrets` pulling
    `SUPABASE_SERVICE_ROLE_KEY` and `ASSEMBLYAI_API_KEY` from **Secret Manager**.
  - Give the job a **dedicated user-managed service account** (not the Compute
    default) with `roles/secretmanager.secretAccessor` + the Storage object roles
    it needs on the Firebase bucket.
  - Firebase Admin authenticates via **Application Default Credentials** from that
    SA — `initializeApp()` with no args, exactly as the functions do, but now
    relying on the job's bound SA having Storage IAM. Supabase auth is the
    injected service-role key (not GCP IAM).
- **Resources:** size memory to ~2–3× max expected source (Cloud Run local FS is
  RAM-backed). Start at **4 GiB / 2 vCPU**. Tuning signals: (a) target render
  wall-clock < 5 min for a 180s clip — if exceeded, raise vCPU first (Remotion
  scales render concurrency with cores); (b) keep peak RSS < 80% of allocated —
  on OOM, double memory; (c) Cloud Run Jobs have no min-instances, so first-run
  cold start (image pull + Chromium boot) is expected and acceptable for an
  admin-triggered, non-realtime feature.
- **maxRetries:** 1.
- **Word timestamps:** `GET /v2/transcript/{assemblyai_job_id}` → `words[]`
  (`{ text, start, end }` ms). The existing `getTranscript()` wrapper in
  `functions/src/lib/assemblyai.ts` is extended (twin copy for the worker) to
  surface `words`. **No auto-resubmit fallback** — the create-route's transcript
  guard already guarantees a `source='speech'` transcript with a non-null
  `assemblyai_job_id` exists, so a failed/empty GET is a genuine anomaly. The
  worker treats it as a **hard failure** (`ai_job.status='failed'`, clear
  message, UI re-run button) rather than silently re-transcribing — re-submitting
  is non-idempotent (mints a new id + re-bills), webhook-async (no synchronous
  wait), and would be untestable dead code on the happy path. (AssemblyAI
  transcript ids are durable handles, so "expired" is not a real condition.)
- **Storage:** read source via signed URL (the existing `getSignedVideoUrl`
  default TTL is **7 days** — far longer than the <5-min render, so no mid-render
  expiry handling is needed; if a future retry re-runs the worker it re-signs).
  Write output to
  `videos/{userId}/{ts}-captioned-cut.mp4` in the default Firebase bucket (the
  private `videos/` prefix). Because the object is private, `media_assets`
  follows the `video_uploads` convention: `public_url` stores the **storage path
  string** and the read layer mints a signed URL on demand
  (`getSignedVideoUrl`). The worker also sets `mime_type:"video/mp4"` and
  `bytes` (the rendered file size) — both are NOT NULL on `media_assets`.

### How the trigger function executes the Cloud Run Job

There is **no existing repo precedent** for invoking a Cloud Run Job from a
function (today's `onDocumentCreated` handlers run in-process), so this hop is
specified explicitly:

- **Mechanism:** the trigger function calls the Cloud Run Admin API
  `jobs.run` — via `@google-cloud/run` (`JobsClient.runJob`) — naming the
  `render-worker` job, with a **container override** injecting `AI_JOB_ID` and
  `VIDEO_UPLOAD_ID` as env vars for that execution. It does not wait for the
  render; `runJob` returns once the execution is created.
- **IAM:** the function's runtime service account needs `run.jobs.run` (e.g.
  `roles/run.developer`, or a minimal custom role) on the render-worker job, plus
  `iam.serviceAccounts.actAs` on the **job's** runtime service account (the one
  holding Supabase/AssemblyAI/Firebase-admin access).
- **Region:** pin the Cloud Run Job to the **same region** as the existing
  functions (`us-central1`, per `functions/src/index.ts`).
- **Failure to launch** (API error / quota) → the trigger function sets the
  `ai_job` to `failed` with the error so the UI surfaces it, same as any other
  stage.

### functions/ ↔ worker boundary

Per CLAUDE.md, `functions/` cannot import from `lib/`. The render worker is a
third runtime. The pure `caption-paging` logic and the AssemblyAI `words[]`
fetch are kept as small modules copied into the worker (twin-file pattern),
mirroring how self-critique/few-shots helpers are duplicated today. The
canonical copy of `caption-paging` lives in `lib/content-studio/` so the Vitest
suite covers it.

## Remotion composition (word-pop)

- Root: `<OffthreadVideo src={signedUrl}>` filling 1080×1920 with **`object-fit:
  cover` semantics** — scale to fill, center-crop the overflow. v1 always
  center-crops; focal-point / pan control is deferred to v2 (non-goal). Source is
  assumed landscape-or-square; portrait sources already fit.
- Overlay: current page (≤3 words) centered; the active word scaled up
  (~1.1–1.2×) and colored with the video's accent, others white; bold, heavy text
  shadow for legibility over any footage. **Accent is converted from the
  `accentForVideo()` oklch string to sRGB hex before it enters the composition**
  (guarantees fidelity through the H.264/yuv420p encode and avoids any
  Chromium-version oklch dependency).
- Timing driven by `words[].start/end` mapped to frames at the composition fps.
- Brand: Lexend Exa for caption text to match the site's heading font.
- Local iteration via `npx remotion studio` with a sample clip + sample
  `words[]` JSON — zero Cloud Run cost while designing the look.

## Data flow / state

Job state on the Firestore `ai_job` doc:
`pending → processing → completed | failed`. The worker writes
`result: { assetId, postIds }` (note: **postIds**, plural — one draft per
video-compatible platform). The drawer reuses `useAiJob` (as quote-cards does)
to poll and, on completion, shows a preview + link(s) to the draft post(s). The
team UI needs a small client island to do the same (it's server-action based
today — see Components note).

## Error handling

- **Per-stage try/catch** in the worker → on failure set `ai_job.status="failed"`
  + human-readable message; both UIs surface it with a **re-run** button.
- **Transcript guard** (see its own section) → 409 "still transcribing" when no
  row yet; 422 "no speech transcript" for vision-only videos; render proceeds
  only with a `source='speech'` + `assemblyai_job_id` transcript.
- **Transcript fetch fails in the worker** (should be unreachable past the guard)
  → hard failure with a clear message, **not** an auto-resubmit (see Word
  timestamps).
- **Duplicate job delivery** (Firestore `onDocumentCreated` is at-least-once) →
  the trigger function **atomically claims** the job in a transaction
  (`pending → processing` only if still `pending`); a re-delivery finds it
  already claimed and no-ops. This is stricter than the existing
  transcribe/vision handlers (which flip to `processing` unconditionally) and
  follows the guard pattern in `blog-generation.ts`. A shared
  `claimAiJob(jobId)` helper in `lib/ai-jobs.ts` is the clean home.
- **Cost/safety bounds:**
  - **MIME:** reject non-video at the route.
  - **Size (200 MB):** enforced today by a **Firebase Storage rule**
    (`storage.rules`) — i.e. at *upload*, not at this route. The spec relies on
    that existing rule; no duplicate route check.
  - **Duration (`MAX_CAPTION_CLIP_SECONDS = 180`, a named constant):**
    `video_uploads.duration_seconds` is nullable and client-supplied, so it is
    **not trusted**. The worker probes the real duration from the downloaded
    media (ffprobe/Remotion) and aborts beyond the cap. The route may do a
    best-effort early reject when `duration_seconds` is present, but the worker
    probe is the source of truth. The cap is a provisional guardrail (raise it
    by editing the constant) — post-launch, check the `video_uploads.duration_*`
    distribution to set a data-driven value.
  - Cloud Run Job `maxRetries=1`.
- **Idempotency (two independent layers):**
  1. *Promotion:* `source_submission_id` reuse prevents duplicate `video_uploads`
     rows from the same team submission (catches the **completed** case).
  2. *In-flight render:* `source_submission_id` does **not** cover a double-click
     while a render is still running (the output row doesn't exist yet). So the
     create-route, before queuing, **queries `ai_jobs` for an existing
     `type='video_caption_render'` doc with `input.videoUploadId === X` and
     `status in (pending, processing)`; if found, it returns that `jobId`
     (HTTP 200) instead of creating a second job.** Firestore has no native
     unique constraint, so this read-then-create is wrapped in a **transaction**
     to close the TOCTOU window. The UI then just watches the returned job.
- **Feature flag** (`feature_captioned_cut_enabled`, DB-backed) off by default —
  nothing ships hot; an admin flips it on at runtime via the automation page, no
  redeploy.

## Testing

- **Vitest units:**
  - `caption-paging` — word arrays → timed ≤3-word pages; edge cases: inter-word
    gaps, very long words, sub-second words, empty/one-word input.
  - Zod validator for the create-route payload.
  - `resolveVideoUploadForSubmission` — reuse vs create; non-approved rejection.
  - transcript guard — speech-row passes; vision-only → 422; no-row → 409.
  - in-flight guard — second call while a render is pending/processing returns
    the same jobId (no second `ai_jobs` doc created).
- **Remotion:** `npx remotion studio` in `render-worker/` with sample inputs.
- **Playwright:** both trigger buttons render and POST; render mocked.

## Open questions / risks

- **Remotion licensing:** RESOLVED (2026-05-31) — solo individual operator, so
  Remotion's free tier applies; no company license / Cloud Rendering Units needed.
- **Cloud Run Job cold start + Chromium image size:** acceptable for an
  admin-triggered, non-realtime feature; monitor render wall-clock.
- **`MAX_CAPTION_CLIP_SECONDS` (180s)** is a starting guardrail; revisit once real
  clip lengths are known (post-launch, from the `video_uploads` duration data).

## Rollout — two milestones

The core render path is independent of the team-UI entry point, so ship them as
separable milestones. **M1 needs no schema change.**

### Milestone 1 — core captioned cut (Content Studio drawer)

1. `caption-paging` + Zod validator + add `video_caption_render` to the
   `AiJobType` union (pure, unit-tested).
2. Render worker + Dockerfile + Remotion composition (iterate locally with
   `remotion studio`).
3. Cloud Run Job deploy + trigger function (incl. the `jobs.run` + IAM wiring).
4. Register `feature_captioned_cut_enabled` for admin toggling: add it to the
   allow-list the `toggle-cron` route validates against (`lib/cron-catalog.ts` or
   its feature-flag equivalent) and surface a toggle on `/admin/automation`. The
   create-route reads the flag server-side and passes the resolved boolean to the
   client button as a prop (DB-backed, so no redeploy to flip).
5. Create-route + the **Content Studio drawer** button.
6. Flip the flag on in a controlled environment; verify end to end.

### Milestone 2 — team-review entry point

7. Migration `00159_video_uploads_source_submission` + refactor
   `send-to-content-studio` to the shared promote-or-reuse helper (safe, no
   behavior change on its own).
8. `resolveVideoUploadForSubmission` helper (unit-tested: reuse vs create,
   non-approved rejection).
9. **Team-review** button in `StatusActions.tsx` (gated on the same flag),
   POSTing `submissionId`; verify the freshly-promoted → "still transcribing"
   path and the already-transcribed → renders path.
