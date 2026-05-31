# New-session prompt — Captioned Cut M3

Paste the block below into a fresh Claude Code session in this repo to continue the work.

---

I'm continuing the **Captioned Cut** feature in this repo (DJP Athlete — a Next.js app on Vercel + a separate `render-worker/` Remotion video worker on GCP Cloud Run, project `darrenjpaulcom`; DB is Supabase).

**Read these first, in order, before doing anything:**
1. `docs/superpowers/HANDOFF-captioned-cut-pro-upgrade-2026-05-31.md` — full current state, infra, gotchas, commits.
2. `docs/superpowers/specs/2026-05-31-captioned-cut-pro-upgrade-design.md` — the approved Tier 1–3 design.
3. `docs/superpowers/plans/2026-05-31-captioned-cut-m3-tier1.md` — the M3 plan you will execute.

**Where things stand:** the captioned-cut renders end-to-end in production (vertical 9:16, word-pop captions, on-brand styling, no gaps) and Content Studio has a persistent progress/preview panel — all shipped on `main`. The next phase is a "pro upgrade" to match trending reel styles, specced as 3 milestones (M3/M4/M5). **M3 (Tier 1: caption polish) is planned and ready to build.**

**Your task:** execute the **M3 plan** task-by-task using `superpowers:subagent-driven-development` (fresh subagent per task, review between tasks). Inline execution via `superpowers:executing-plans` is also fine if I ask. M3 is pure `render-worker/` composition + the `caption-paging` helper — **no app/DB/panel changes.** It adds: spring bounce, keyword emphasis, text outline, active-word highlight pill, and per-word entrance.

**Critical context (all detailed in the handoff):**
- Solo dev → commit directly to `main`; no branches/PRs/worktrees unless I ask.
- gcloud defaults to the wrong project — ALWAYS pass `--project darrenjpaulcom`.
- The Grep/Glob tools misfire in this workspace (space in the path) — use `git grep` / `git ls-files | grep` via Bash. Read works with absolute paths.
- Visual verification loop: `cd render-worker && npm run build`, then `npx remotion still dist/remotion/index.js CaptionedCut _still.png --frame=N --scale=0.5 --props=./_still-props.json`, then Read the PNG. Bundle the **compiled `dist/` entry, not `src/`**. The props `videoSrc` must be reachable — use `https://www.w3schools.com/html/mov_bbb.mp4` (BigBuckBunny 403s).
- Brand accent is `#c4936b` (the `#C49B7A` in CLAUDE.md is a grayer approximation — don't use it).
- Logic is TDD'd (Vitest); visuals are still-verified. `caption-paging` has a worker twin (`render-worker/src/lib/`) that MUST stay behavior-identical — guarded by `__tests__/render-worker/caption-paging-twin.test.ts`.
- The repo has ~150 pre-existing unrelated `tsc` errors + failing tests — verify captioned-cut files in isolation, don't be alarmed by repo-wide red.
- Pushing app/UI changes to `main` triggers a Vercel prod deploy; `render-worker/` changes deploy via `gcloud` (not Vercel). Ask before any prod deploy.
- M3 acceptance (plan Task 9): redeploy the worker (`--memory 16Gi --cpu 4 --task-timeout 1800s`) and render the test video (`AI_JOB_ID=23Ll7ee0ZWX1qp9Vh423`, `VIDEO_UPLOAD_ID=396afdd4-4ebc-4eaa-b39a-da074bca0285`, `--wait`), then sample frames with ffmpeg to confirm.

Start by reading the three docs, confirm your understanding of the M3 plan back to me, then begin Task 1.

---
