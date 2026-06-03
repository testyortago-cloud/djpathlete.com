# Reel Phase 3a — Backend: Auto-Render Default + needs_edit-Only Edit Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reel pipeline auto-render by default (no per-render flag), make posting gate on `needs_edit` ONLY (a rendered reel/cut no longer auto-unblocks posting), guard the auto-hook write from clobbering an edited hook, and fix the now-stale "render a captioned cut" copy.

**Architecture:** Two backend surfaces. (1) Functions: `chainSplitReelRender` stops reading the `split_reel_auto_render` setting and always enqueues the render after `broll_generation` completes; the auto-hook write becomes write-only-if-null. (2) App/lib edit gate: `isVideoPostable` drops its `hasCut` auto-unblock param and becomes `needs_edit === false`; the async route guard stops looking up a captioned cut; the pipeline-board column logic and the video-detail page drop the `hasCut` gate arg; user-facing "render a cut" copy becomes "mark ready". `hasCut`/`cutVideoIds` are KEPT where they only drive informational badges.

**Tech Stack:** Firebase Functions (TS ESM, `.js` suffixes, Vitest), Next.js app + `lib/` (TS, Vitest + Testing Library). The `isVideoPostable` signature change is a coupled multi-file commit (drop the 2nd arg at all call sites together or TS won't compile).

**Spec:** `docs/superpowers/specs/2026-06-03-one-click-reel-design.md` §4 (auto-render default) + §5 (edit-gate fix). Phase 3a of the one-click work; **Phase 3b** (one-click panel UI, editable hook field, retire Captioned Cut button) is a separate plan that depends on this.

**Environment notes (verified):**
- Functions typecheck: `cd functions && npx tsc --noEmit -p tsconfig.json`; tests: `cd functions && npm test`.
- App tests: `npm run test:run` (Vitest) from repo root; targeted: `npx vitest run <path>`.
- App full `tsc --noEmit` has unrelated pre-existing `NextRequest` errors in `__tests__/api/**` and a `VideoTranscript` error in `__tests__/db/video-uploads.test.ts` — ignore those; gate on "no NEW errors in the files this plan touches".

**Behavior change to be aware of (spec-approved, §5):** after this lands, a legacy video that is currently postable *only* because it has a rendered captioned cut (with `needs_edit` still true) becomes **gated** until someone clicks **Mark ready**. There is no data backfill. This is intended.

---

## File Structure

**Functions:**
- Modify: `functions/src/on-ai-job-completed.ts` — `chainSplitReelRender` always enqueues the render; drop the `split_reel_auto_render` read + the unused `getSupabase` import; update the comment.
- Modify: `functions/src/broll-generation.ts` — only write `hook_text` when it's currently null (the existing `TODO(phase-3)`).
- Modify (if it asserts the gate): `functions/src/__tests__/on-ai-job-completed.test.ts` — update the auto-render expectation.

**App / lib edit gate (the `isVideoPostable` signature change is ONE coupled commit):**
- Modify: `lib/content-studio/postable.ts` — `isVideoPostable(video)` drops `hasCut`.
- Modify: `lib/content-studio/edit-gate.ts` — drop the captioned-cut lookup + rewrite `GATED_REASON`.
- Modify: `lib/content-studio/pipeline-columns.ts` — drop `hasCut` arg at the gate call (keep `hasCut` for badges).
- Modify: `components/admin/content-studio/detail/VideoDetailPage.tsx` — drop `hasCut` arg at the gate call.
- Modify: `__tests__/lib/content-studio/edit-gate.test.ts` + `__tests__/lib/content-studio/pipeline-columns-with-edit.test.ts` — update to `needs_edit`-only behavior.

**Copy fixes:**
- Modify: `components/admin/content-studio/drawer/BatchPostActions.tsx` — "Render a cut / captioned cut …" → "Mark ready …".
- Modify: `components/admin/videos/VideoUploader.tsx` — the needs_edit checkbox helper copy.

---

## Task 1: Auto-render is unconditional (drop the `split_reel_auto_render` gate)

**Files:**
- Modify: `functions/src/on-ai-job-completed.ts`
- Modify (if present/asserting the gate): `functions/src/__tests__/on-ai-job-completed.test.ts`

- [ ] **Step 1: Make `chainSplitReelRender` always enqueue the render**

In `functions/src/on-ai-job-completed.ts`, find the `chainSplitReelRender` function. It currently has a gate block (reads `system_settings` key `split_reel_auto_render` and early-returns when it isn't `true`). Replace the function's body so it always enqueues the render. The function should become:

```ts
// Phase 3: the reel ALWAYS auto-renders once b-roll generation completes — the
// one-click "Create Reel" flow has no separate render step. The videoUploadId
// lives on the broll_generation job's INPUT (its result only carries counts).
async function chainSplitReelRender(parentJobId: string, after: JobShape): Promise<void> {
  const videoUploadId = after.input?.videoUploadId
  if (!videoUploadId) {
    console.warn(`[on-ai-job-completed] broll_generation ${parentJobId} completed without input.videoUploadId`)
    return
  }

  const db = getFirestore()
  const newJobRef = db.collection("ai_jobs").doc()
  await newJobRef.set({
    type: "split_reel_render",
    status: "pending",
    input: { videoUploadId },
    result: null,
    error: null,
    userId: after.userId ?? null,
    parentJobId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  console.log(
    `[on-ai-job-completed] Enqueued split_reel_render ${newJobRef.id} for video ${videoUploadId}`,
  )
}
```

(This removes the `const supabase = getSupabase()` + the `system_settings`/`split_reel_auto_render` query + the `if (setting?.value !== true) { … return }` block, and keeps the `getFirestore()` enqueue unchanged.)

- [ ] **Step 2: Remove the now-unused `getSupabase` import**

In the same file, delete the import line `import { getSupabase } from "./lib/supabase.js"` (it was only used by the gate block just removed). Leave all other imports.

- [ ] **Step 3: Typecheck functions**

Run: `cd functions && npx tsc --noEmit -p tsconfig.json`
Expected: exits 0. (If it reports `getSupabase` is unused or undefined, re-check Steps 1–2.)

- [ ] **Step 4: Update the auto-render test if it asserts the gate**

Read `functions/src/__tests__/on-ai-job-completed.test.ts`. If it has a test asserting that a completed `broll_generation` does NOT enqueue a render when `split_reel_auto_render` is off (or mocks the `system_settings` read), update it: the new behavior is that a completed `broll_generation` ALWAYS enqueues a `split_reel_render` job. Keep/Ë adjust any test that asserts the enqueue happens; delete or invert any test asserting the "gated/awaits approval" path. Remove any now-unneeded `system_settings` mock for this chain.

- [ ] **Step 5: Run functions tests**

Run: `cd functions && npm test`
Expected: all pass (with the updated auto-render test).

- [ ] **Step 6: Commit**

```bash
git add functions/src/on-ai-job-completed.ts functions/src/__tests__/on-ai-job-completed.test.ts
git commit -m "feat(reel): always auto-render after b-roll (drop split_reel_auto_render gate)"
```

---

## Task 2: Don't clobber an edited hook (write `hook_text` only when null)

**Files:**
- Modify: `functions/src/broll-generation.ts`

- [ ] **Step 1: Guard the auto-hook write**

In `functions/src/broll-generation.ts`, find the hook block (it currently has the `TODO(phase-3)` comment):

```ts
      const hook = await suggestHookFromTranscript(transcriptText)
      if (hook) {
        // TODO(phase-3): once the hook is editable, guard this write (e.g. only set
        // when hook_text is null) so a "Regenerate" doesn't clobber a coach-edited hook.
        const { error: hookErr } = await supabase
          .from("video_uploads")
          .update({ hook_text: hook })
          .eq("id", videoUploadId)
        if (hookErr) console.warn("[broll_generation] hook write failed (non-fatal):", hookErr.message)
      }
```

Replace it with (only writes when `hook_text` is still null, so a re-generate never overwrites a coach's edit):

```ts
      const hook = await suggestHookFromTranscript(transcriptText)
      if (hook) {
        // Only set the hook when none exists yet, so a "Regenerate"/re-run never
        // clobbers a coach-edited hook (the panel edits hook_text directly).
        const { error: hookErr } = await supabase
          .from("video_uploads")
          .update({ hook_text: hook })
          .eq("id", videoUploadId)
          .is("hook_text", null)
        if (hookErr) console.warn("[broll_generation] hook write failed (non-fatal):", hookErr.message)
      }
```

> Note: `.is("hook_text", null)` scopes the UPDATE to rows where `hook_text` is currently null — a no-op (0 rows) when a hook already exists. This is best-effort and still cannot fail the job.

- [ ] **Step 2: Typecheck functions**

Run: `cd functions && npx tsc --noEmit -p tsconfig.json`
Expected: exits 0.

- [ ] **Step 3: Run functions tests (regression)**

Run: `cd functions && npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add functions/src/broll-generation.ts
git commit -m "feat(reel): only auto-write hook when unset (don't clobber edits)"
```

---

## Task 3: Edit gate becomes `needs_edit`-only (coupled signature change)

**Files (all in ONE commit — the `isVideoPostable` signature change must land atomically):**
- Modify: `lib/content-studio/postable.ts`
- Modify: `lib/content-studio/edit-gate.ts`
- Modify: `lib/content-studio/pipeline-columns.ts`
- Modify: `components/admin/content-studio/detail/VideoDetailPage.tsx`
- Modify: `__tests__/lib/content-studio/edit-gate.test.ts`
- Modify: `__tests__/lib/content-studio/pipeline-columns-with-edit.test.ts`

- [ ] **Step 1: `isVideoPostable` drops the `hasCut` param**

In `lib/content-studio/postable.ts`, replace the function (and update its header comment) so it gates on `needs_edit` only:

```ts
import type { VideoUpload } from "@/types/database"

// Pure, client-safe edit-gate predicate. A video is postable once it is no longer
// gated: it has been marked ready (needs_edit === false). A rendered reel/cut does
// NOT auto-unblock posting — the operator releases it via "Mark ready". Kept in its
// OWN module with no DB/server imports so client bundles can import it.
// The server-side route guard (assertSourceVideoPostable) lives in ./edit-gate.
export function isVideoPostable(video: Pick<VideoUpload, "needs_edit">): boolean {
  return video.needs_edit === false
}
```

- [ ] **Step 2: Async route guard stops looking up a captioned cut + reword the reason**

In `lib/content-studio/edit-gate.ts`:
- Delete the import `import { getLatestCaptionedCutForVideo } from "@/lib/db/media-assets"`.
- Change `GATED_REASON` to: `const GATED_REASON = "Source video still needs editing — mark it ready to post."`
- In `assertSourceVideoPostable`, delete the line `const cut = await getLatestCaptionedCutForVideo(sourceVideoId)` and change `if (isVideoPostable(video, !!cut)) return { ok: true }` to `if (isVideoPostable(video)) return { ok: true }`.
- Update the module header comment (the lines describing "or it already has a rendered captioned cut") to reflect needs_edit-only. Leave the `export { isVideoPostable }` re-export.

- [ ] **Step 3: Pipeline-board column drops the `hasCut` gate arg (keeps `hasCut` for badges)**

In `lib/content-studio/pipeline-columns.ts`, change the gate call (around line 155) from `if (!isVideoPostable(video, signals.hasCut)) return "needs_edit"` to:

```ts
    if (!isVideoPostable(video)) return "needs_edit"
```

Leave `VideoEditSignals.hasCut` and the `hasCut: lookups.cutVideoIds.has(v.id)` population intact (still used for the "Cut"/"rendering" badges). Update the nearby comment that says "until it is postable (cut rendered or marked ready)" → "until marked ready".

- [ ] **Step 4: Video-detail page drops the `hasCut` gate arg**

In `components/admin/content-studio/detail/VideoDetailPage.tsx`, change `const isReady = isVideoPostable(video, data.hasCut)` to:

```ts
  const isReady = isVideoPostable(video)
```

Update the adjacent comment ("a cut has been rendered, or it was marked ready") → "marked ready". (`data.hasCut` may now be unused here — that's fine; it is removed from the producer in Phase 3b.)

- [ ] **Step 5: Update the two gate tests to needs_edit-only**

- In `__tests__/lib/content-studio/edit-gate.test.ts`: it currently asserts the 4 combinations of `needs_edit` × `hasCut`. Rewrite the `isVideoPostable` cases to the single-arg predicate: `isVideoPostable({ needs_edit: false })` → `true`; `isVideoPostable({ needs_edit: true })` → `false`. Remove the `hasCut`-based cases (e.g. the old "needs_edit true + hasCut true ⇒ true" must be deleted, not kept).
- In `__tests__/lib/content-studio/pipeline-columns-with-edit.test.ts`: the assertion (around line 75) expecting `videoColumnForWithEdit(..., sig({ hasCut: true }))` to be `"edited"` must flip to `"needs_edit"` (a cut no longer makes a still-`needs_edit` video postable). Keep tests that exercise `needs_edit: false ⇒ "edited"`.

- [ ] **Step 6: Typecheck the changed area (no NEW errors)**

Run: `npx tsc --noEmit 2>&1 | grep -E "postable\.ts|edit-gate\.ts|pipeline-columns\.ts|VideoDetailPage\.tsx" || echo "no errors in changed files"`
Expected: `no errors in changed files`.

- [ ] **Step 7: Run the gate tests**

Run: `npx vitest run __tests__/lib/content-studio/edit-gate.test.ts __tests__/lib/content-studio/pipeline-columns-with-edit.test.ts`
Expected: PASS (with the updated assertions).

- [ ] **Step 8: Commit**

```bash
git add lib/content-studio/postable.ts lib/content-studio/edit-gate.ts lib/content-studio/pipeline-columns.ts components/admin/content-studio/detail/VideoDetailPage.tsx __tests__/lib/content-studio/edit-gate.test.ts __tests__/lib/content-studio/pipeline-columns-with-edit.test.ts
git commit -m "feat(reel): posting gate keys on needs_edit only (reel/cut no longer auto-unblocks)"
```

---

## Task 4: Fix the now-stale "render a captioned cut" copy

**Files:**
- Modify: `components/admin/content-studio/drawer/BatchPostActions.tsx`
- Modify: `components/admin/videos/VideoUploader.tsx`

- [ ] **Step 1: BatchPostActions copy**

In `components/admin/content-studio/drawer/BatchPostActions.tsx`:
- The two button `title` fallbacks `"Render a cut or Mark ready first"` → `"Mark ready first"`.
- The `!isReady` hint paragraph `Render a captioned cut or “Mark ready” before sending these posts.` → `“Mark ready” before sending these posts.`
- Update the `isReady` prop comment `(cut rendered or marked ready)` → `(marked ready)`.

- [ ] **Step 2: Upload form checkbox copy**

In `components/admin/videos/VideoUploader.tsx`, the needs_edit checkbox helper text reads roughly "Needs editing — gate from posting until a cut is rendered". Change the trailing clause so it no longer implies a render unblocks it — e.g. "Needs editing — gate from posting until marked ready". (Match the exact surrounding text in the file; change only the "until a cut is rendered" portion.)

- [ ] **Step 3: Typecheck (no new errors in changed files)**

Run: `npx tsc --noEmit 2>&1 | grep -E "BatchPostActions\.tsx|VideoUploader\.tsx" || echo "no errors in changed files"`
Expected: `no errors in changed files`.

- [ ] **Step 4: Commit**

```bash
git add components/admin/content-studio/drawer/BatchPostActions.tsx components/admin/videos/VideoUploader.tsx
git commit -m "docs(reel): update edit-gate copy from 'render a cut' to 'mark ready'"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Functions — typecheck + tests**

Run: `cd functions && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: typecheck exits 0; all tests pass.

- [ ] **Step 2: App — gate + edit area tests**

Run: `npx vitest run __tests__/lib/content-studio` (and any `__tests__/components/admin/content-studio/detail` that exercise the gate)
Expected: PASS. If a `VideoDetailPage.test.tsx` / `PostDetailPage.test.tsx` fixture asserted the OLD `hasCut` postability, update it to the needs_edit-only behavior as part of this step (read the test, adjust the expectation, re-run).

- [ ] **Step 3: No-new-errors typecheck sweep over all changed files**

Run: `npx tsc --noEmit 2>&1 | grep -E "postable|edit-gate|pipeline-columns|VideoDetailPage|BatchPostActions|VideoUploader" || echo "clean"`
Expected: `clean`.

---

## Self-Review (completed during planning)

**Spec coverage:**
- §4 auto-render default → Task 1 (unconditional chain). ✓
- §5 gate = needs_edit-only; reel/cut doesn't auto-unblock; reason copy → Tasks 3 + 4. ✓
- §3/§5 hook clobber guard (editable hook safe) → Task 2. ✓
- "retire Captioned Cut button" + "one-click panel + editable hook UI" → **Phase 3b** (separate plan), not here. ✓

**Placeholder scan:** Functions + gate + copy edits give exact before/after. The test-file updates describe the precise new assertions (the implementer reads the test and applies them) because the tests' exact current text wasn't captured — this is the one place exact code isn't inlined; the new expected behavior is fully specified. ✓

**Type/name consistency:** `isVideoPostable` loses its 2nd param in `postable.ts`, and ALL three call sites (`edit-gate.ts`, `pipeline-columns.ts`, `VideoDetailPage.tsx`) drop the arg in the SAME commit (Task 3) so TS compiles. `hasCut`/`cutVideoIds`/`VideoEditSignals.hasCut` are deliberately KEPT for badges. ✓

**Risks handled:** legacy captioned-cut-only-postable videos become gated (spec-approved, noted up top); `hasCut` retained for badges; the gate is NOT re-wired to a reel signal (auto-unblock is removed, not swapped). Post-only / `VideoDetailPage.test.tsx` fixture updates are folded into Task 5.

**Out of scope (Phase 3b):** the one-click "Create Reel" button, the editable hook field in the panel, removing the `CaptionedCutPanel` mount + `captionedCutEnabled` threading, and the GET route returning `hook_text`.
