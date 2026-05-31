# Captioned Cut — Pro Upgrade Handoff (2026-05-31)

Supersedes `HANDOFF-captioned-cut-2026-05-31.md` (that one documented the render-debugging
phase, now fully resolved). This doc reflects current reality and hands off the **pro-upgrade
build** (Tiers 1–3 = milestones M3/M4/M5).

---

## TL;DR — where we are

- **Captioned Cut works end-to-end in production.** Real renders succeed: 9:16 MP4 with
  word-pop captions, uploaded to Firebase Storage, `media_assets` row + draft `social_posts`
  created, `ai_jobs` doc → `completed`.
- **Captions are styled and on-brand** (Lexend Exa, exact brand accent, lower-third, no gaps).
- **Content Studio has a persistent panel** showing progress + the finished cut inline.
- **Next phase is fully specced + the first milestone is planned.** A pro-upgrade spec (Tiers
  1–3) and the **M3 implementation plan** are written and committed. **The immediate next
  action is to execute M3** (subagent-driven or inline).

---

## What's DONE and shipped (all on `origin/main`)

| Area | State | Commits |
|---|---|---|
| Render pipeline | Works. Source downloaded to `/tmp`, served over a **loopback HTTP server** (no remote streaming), `getVideoMetadata` on the local path, `OffthreadVideo` on the loopback URL. | `a9b5357` |
| Render reliability | `offthreadVideoCacheSizeInBytes` (4 GiB) fixed the "No frame found" cache-eviction crash; job runs **4 vCPU / 16 GiB / task-timeout 1800s / concurrency 4**. ~5 min for a 90 s clip. | `4af4cd7` |
| Firestore writes | Render SA granted **`roles/datastore.user`** (was missing → job status writes failed silently, docs stuck `processing`). | (IAM, not code) |
| Caption styling | Lexend Exa via `@remotion/google-fonts/LexendExa`; active word = exact brand accent **`#c4936b`**; lower-third; wider spacing; spring/interpolate pop; **gap-fill** (each page holds until the next begins). | `fe88c4b` |
| Content Studio UI | `CaptionedCutPanel` rehydrates from a new `GET /api/admin/content-studio/captioned-cut?videoUploadId=` (in-flight job + signed cut + draft posts via `getLatestCaptionedCutForVideo`); persistent progress + inline player + Re-render. | `0e52328` |
| Pro-upgrade design | Spec for Tiers 1–3. | `e62f75c` |
| M3 plan | 9-task TDD/still-verified plan for Tier 1. | `9b772d1` |

**Brand-accent correction:** `CLAUDE.md` / `MEMORY.md` list the accent hex as `#C49B7A`, but the
true sRGB of the site's `--accent: oklch(0.7 0.08 60)` is **`#c4936b`** (verified by conversion).
The render uses `#c4936b`. (The docs' hex is still uncorrected — optional cleanup.)

---

## What's PLANNED (the pro upgrade)

**Spec:** `docs/superpowers/specs/2026-05-31-captioned-cut-pro-upgrade-design.md`
**M3 plan:** `docs/superpowers/plans/2026-05-31-captioned-cut-m3-tier1.md`

**Approved decisions (brainstorm 2026-05-31):**
- **Control surface:** auto house style + a **light drawer panel** (hook text, music pick). B-roll automatic.
- **B-roll:** admin-maintained **tagged library**; worker auto-inserts clips on transcript-keyword match.
- **Audio:** low **music bed** (admin picks track) + caption/transition **SFX**.
- **Reframe:** skipped — sources are vertical → center-crop stays. **No face-tracking** (out of scope).

**Milestones (each its own plan + Cloud-render acceptance):**
- **M3 — Tier 1 (PLANNED, ready to build):** spring bounce, keyword emphasis, outline, highlight pill, per-word entrance. Pure render-worker composition + the `caption-paging` helper. No app/DB/panel changes.
- **M4 — Tier 2 (spec only):** punch-in zoom, progress bar, brand bug, hook card, caption SFX. Composition + panel + SFX assets.
- **M5 — Tier 3 (spec only):** keyword-matched b-roll library + full-frame cutaways with transitions, music bed, optional audio-reactive accent. New Supabase tables + library-manager UI + worker matching.

**Prereqs you (the user) supply before M4/M5:** SFX files (pop/whoosh), licensed music tracks,
seed b-roll clips. Optional for M3: add **Noto Color Emoji** to the Dockerfile if emoji is wanted
(M3 ships fine without it).

---

## How to execute M3

The plan is bite-sized TDD + visual verification:
1. **Logic is unit-tested** (Vitest): `isEmphasisWord` + the `emphasis` field in `caption-paging`
   (canonical `lib/content-studio/caption-paging.ts` **and** the worker twin
   `render-worker/src/lib/caption-paging.ts`; parity guarded by
   `__tests__/render-worker/caption-paging-twin.test.ts`).
2. **Visuals are still-verified** with the proven local loop:
   ```bash
   cd render-worker && npm run build
   npx remotion still dist/remotion/index.js CaptionedCut _still.png \
     --frame=21 --scale=0.5 --props=./_still-props.json
   # then Read render-worker/_still.png
   ```
   - Bundle the **compiled** `dist/remotion/index.js` entry (NOT `src/...` — the `.js` import
     specifiers break the CLI's source bundling).
   - The still needs a reachable test video in props. **BigBuckBunny on commondatastorage 403s**;
     use `https://www.w3schools.com/html/mov_bbb.mp4` (in the plan's `_still-props.json`).
3. **Acceptance:** deploy + render the test video, then sample frames with ffmpeg.

**Execution modes:** subagent-driven (fresh subagent per task, review between — recommended) or
inline (executing-plans). Start at Task 1.

---

## Infra (GCP project `darrenjpaulcom`, region `us-central1`)

- **Cloud Run job** `captioned-cut-render` — 4 vCPU / 16 GiB / task-timeout 1800s / max-retries 1.
  Deploy: `gcloud run jobs deploy captioned-cut-render --source render-worker --project darrenjpaulcom ...`
  (full flags in the M3 plan, Task 9, and the redeploy block below).
- **Service account** `captioned-cut-render@darrenjpaulcom.iam.gserviceaccount.com` — bucket
  `objectAdmin`, `secretAccessor` on the 3 secrets, Token-Creator on itself, **`roles/datastore.user`**.
  Auth = ADC (no key file).
- **Firebase function** `captionRender` (gen2, Firestore `document.created` on `ai_jobs/{jobId}`)
  launches the job with env overrides `AI_JOB_ID` + `VIDEO_UPLOAD_ID`.
- **Secrets** (Secret Manager): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ASSEMBLYAI_API_KEY`.
- **Bucket:** `darrenjpaulcom.firebasestorage.app`. **Flag** `feature_captioned_cut_enabled` = ON.
- ⚠️ gcloud's default project is `speakersplit-9899f` — ALWAYS pass `--project darrenjpaulcom`.

**Redeploy the worker (after any `render-worker/` change):**
```bash
gcloud run jobs deploy captioned-cut-render --source render-worker \
  --region us-central1 --project darrenjpaulcom \
  --service-account captioned-cut-render@darrenjpaulcom.iam.gserviceaccount.com \
  --memory 16Gi --cpu 4 --task-timeout 1800s --max-retries 1 \
  --set-secrets "SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,ASSEMBLYAI_API_KEY=ASSEMBLYAI_API_KEY:latest" \
  --set-env-vars "FIREBASE_STORAGE_BUCKET=darrenjpaulcom.firebasestorage.app"
```

**Verify a render without the UI** (worker reads these from env; on success writes the asset + flips the doc):
```bash
gcloud run jobs execute captioned-cut-render --region us-central1 --project darrenjpaulcom \
  --update-env-vars AI_JOB_ID=23Ll7ee0ZWX1qp9Vh423,VIDEO_UPLOAD_ID=396afdd4-4ebc-4eaa-b39a-da074bca0285 --wait
```
(Test video `396afdd4` has a valid 172-word speech transcript. Re-running reuses doc
`23Ll7ee0ZWX1qp9Vh423` and creates a fresh `media_assets` row each time — harmless test-data dup.)

**Read render step-logs** (note: execution name ≠ the gcloud task id):
```bash
EXEC=$(gcloud run jobs executions list --job captioned-cut-render --region us-central1 --project darrenjpaulcom --limit 1 --format="value(metadata.name)")
gcloud logging read "resource.type=\"cloud_run_job\" AND labels.\"run.googleapis.com/execution_name\"=\"$EXEC\"" \
  --project darrenjpaulcom --limit 200 --order=asc --format="value(timestamp,textPayload)"
```

---

## Render data flow

```
Content Studio drawer (CaptionedCutPanel) → POST /api/admin/content-studio/captioned-cut
  → flag + transcript + in-flight guards → createAiJob("video_caption_render")  [Firestore ai_jobs]
    → captionRender trigger: atomic claim (pending→processing) → JobsClient.runJob(env: AI_JOB_ID, VIDEO_UPLOAD_ID)
      → Cloud Run worker (render-worker/src/index.ts):
          load video + speech transcript → AssemblyAI words → DOWNLOAD source to /tmp
          → serve workDir over 127.0.0.1 loopback (Range) → getVideoMetadata(localPath)
          → pageCaptions(words) → bundle dist/remotion → selectComposition → renderMedia
            (OffthreadVideo=loopback URL, offthreadVideoCacheSizeInBytes=4GiB, concurrency=4)
          → upload mp4 → media_assets (ai_analysis.origin='captioned_cut') + draft social_posts
          → ai_jobs → completed { assetId, postIds }
  → panel polls useAiJob (Firestore onSnapshot) → inline player + draft links
```

---

## Key files

**Worker (`render-worker/`):** `src/index.ts` (entry: download/serve/render/upload/DB),
`src/lib/serve-file.ts` (loopback Range server — M5 extends to dir mode),
`src/lib/caption-paging.ts` (twin), `src/remotion/{Root,CaptionedCut}.tsx`
(M3 adds `CaptionLayer.tsx`), `Dockerfile` (Chromium + Lexend; M4 adds SFX, M3-opt adds Noto emoji).

**App:** `app/api/admin/content-studio/captioned-cut/route.ts` (POST + GET),
`components/admin/content-studio/drawer/CaptionedCutPanel.tsx`,
`lib/db/media-assets.ts` (`getLatestCaptionedCutForVideo`, `listCaptionedCutVideoIds`),
`lib/content-studio/caption-paging.ts` (canonical twin).

---

## Environment gotchas (cost real time — read before working)

1. **Grep/Glob tools misfire in this workspace** (the space in "Darren Paul Projects"). Use
   **`git grep`** / `git ls-files | grep` via Bash instead. Read works fine with absolute paths.
2. **gcloud default project = `speakersplit-9899f`** → always `--project darrenjpaulcom`.
3. **Worker bundles the COMPILED `dist/` entry**, not `src/` (source uses `.js` import specifiers
   the CLI won't resolve). Always `npm run build` before `remotion still`.
4. **Local `remotion still` needs a reachable test video** — BigBuckBunny 403s; use the w3schools mp4.
5. **PowerShell 5.1 batch cancellation:** if one call in a multi-call batch errors, siblings cancel.
   Run verify/commit calls individually. Use the **Bash tool + heredoc** for multi-line commit messages.
6. **Pushing the app (UI) to `main` triggers a Vercel prod deploy;** `render-worker/` changes do NOT
   (excluded from the app build) and the worker deploys via `gcloud`.
7. **The repo has pre-existing unrelated `tsc` errors + failing tests** — verify captioned-cut files in
   isolation (`tsc | grep <file>`, scoped vitest), don't be alarmed by repo-wide red.
8. **Twin obligation:** `lib/` ↔ `render-worker/src/lib/` helpers must stay behavior-identical
   (caption-paging today; broll-match in M5). Guarded by `*-twin.test.ts`.

---

## Commit history (most recent first, all on `origin/main`)
- `9b772d1` M3 (Tier 1) implementation plan
- `e62f75c` pro-upgrade spec (Tiers 1–3)
- `fe88c4b` brand font + exact accent, lower-third, spacing, no gaps
- `0e52328` persistent Content Studio panel (progress + inline cut)
- `4af4cd7` 4-way concurrency + 4 GiB cache; clear stale error
- `a9b5357` loopback file server + 2 GiB cache (the core render fix)
- (earlier) the full M1/M2 + original render-debug series.

---

## What's left (priority order)
1. **Execute M3** per its plan (the open item).
2. Write the **M4 plan** (after M3 ships), then build M4. Needs SFX assets.
3. Write the **M5 plan**, then build M5. Needs music + b-roll assets + the two Supabase tables + library UI.
4. Optional cleanups: correct the brand-accent hex in `CLAUDE.md`/`MEMORY.md` (`#C49B7A` → `#c4936b`);
   add the gap-fill change into the unit-tested `caption-paging` twin if desired (currently in the composition).
