# Reel Phase 3b — Frontend: One-Click "Create Reel" + Editable Hook + Retire Captioned Cut — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Split Reel drawer into a single **"Create Reel"** action that produces the finished reel (hook + captions + full-screen b-roll, auto-rendered by 3a), expose an **editable hook field** in the panel, and **retire the separate Captioned Cut button**.

**Architecture:** Phase 3a already made the reel auto-render after b-roll. So "Create Reel" is just the existing generate POST (the server auto-chains the render); the panel already transitions generate → rendering → done by observing `inFlightRenderJobId` from its GET. This phase: (1) the GET route returns the auto-written `hook_text`; (2) the `PATCH /videos/[id]` route accepts `hook_text` so the panel can save edits; (3) `SplitReelPanel` relabels to "Create Reel", shows an editable hook seeded from `hook_text`, and its Re-render saves the hook then re-renders (b-roll cached); (4) the `CaptionedCutPanel` mount + `captionedCutEnabled` threading are removed.

**Tech Stack:** Next.js App Router (route handlers + RSC), React client components, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-03-one-click-reel-design.md` §1, §3 (editable hook), §4 (one-click), §6 (refine loop). Phase 3b; depends on Phase 3a (auto-render default + needs_edit-only gate, already landed).

**Environment notes:** App tests: `npx vitest run <path>`. No-new-errors typecheck gate: `npx tsc --noEmit 2>&1 | grep -E "<file>" || echo clean` (the repo's full `tsc` has unrelated pre-existing `NextRequest`/`VideoTranscript` test errors — ignore those).

**Design decision (locked):** the reel panel's hook field has **no "Suggest" button** — the pipeline already auto-suggests the hook into `hook_text` during `broll_generation`, and the existing suggest-hook route is gated by `feature_captioned_cut_enabled` (being retired). The field is a plain editable input seeded from `hook_text`; re-suggesting is a future nicety.

---

## File Structure

- Modify: `app/api/admin/content-studio/split-reel/route.ts` — GET returns `hookText` (the video's `hook_text`).
- Modify: `app/api/admin/videos/[id]/route.ts` — PATCH also accepts optional `hook_text`.
- Modify: `components/admin/content-studio/drawer/SplitReelPanel.tsx` — "Create Reel" label, `hookText` in state, editable hook field, hook-saving Re-render.
- Modify: `components/admin/content-studio/detail/VideoDetailSidebar.tsx` — remove `CaptionedCutPanel` mount/import + `captionedCutEnabled` prop.
- Modify: `components/admin/content-studio/detail/VideoDetailPage.tsx` — stop passing `captionedCutEnabled`.
- Modify (if they assert the panel/prop): `__tests__/components/admin/content-studio/detail/VideoDetailPage.test.tsx`, `__tests__/components/admin/content-studio/detail/PostDetailPage.test.tsx`.

Left as harmless dead code (not in scope to delete): `CaptionedCutPanel.tsx`, the captioned-cut route, `feature_captioned_cut_enabled`, and `DrawerData.captionedCutEnabled`/`hasCut` (no longer consumed by the sidebar/gate; deleting them is optional later cleanup).

---

## Task 1: GET /split-reel returns the hook

**Files:**
- Modify: `app/api/admin/content-studio/split-reel/route.ts`

- [ ] **Step 1: Load the video's `hook_text` and return it**

In `app/api/admin/content-studio/split-reel/route.ts`:
- Add an import: `import { getVideoUploadById } from "@/lib/db/video-uploads"` (alongside the other DAL imports).
- In `getHandler`, add `getVideoUploadById(videoUploadId)` to the existing `Promise.all([...])` and capture it (e.g. add `video` to the destructured array).
- Add `hookText: typeof video?.hook_text === "string" ? video.hook_text : ""` to the returned `NextResponse.json({ ... })` object (next to `reel`).

- [ ] **Step 2: Typecheck (no new errors)**

Run: `npx tsc --noEmit 2>&1 | grep -E "content-studio/split-reel/route" || echo clean`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/content-studio/split-reel/route.ts
git commit -m "feat(reel): GET split-reel returns the auto-written hook"
```

---

## Task 2: PATCH /videos/[id] accepts `hook_text`

**Files:**
- Modify: `app/api/admin/videos/[id]/route.ts`

- [ ] **Step 1: Extend the PATCH body to accept an optional `hook_text`**

In `app/api/admin/videos/[id]/route.ts`, replace the `PATCH` handler body (the part that parses + validates + updates) so it accepts `needs_edit` and/or `hook_text` (at least one required). Replace:

```ts
  const body = (await request.json().catch(() => null)) as { needs_edit?: boolean } | null
  if (typeof body?.needs_edit !== "boolean") {
    return NextResponse.json({ error: "needs_edit (boolean) is required" }, { status: 400 })
  }

  const { id } = await params
  const updated = await updateVideoUpload(id, { needs_edit: body.needs_edit })
  return NextResponse.json({ id: updated.id, needs_edit: updated.needs_edit })
```

with:

```ts
  const body = (await request.json().catch(() => null)) as
    | { needs_edit?: boolean; hook_text?: string | null }
    | null

  const patch: { needs_edit?: boolean; hook_text?: string | null } = {}
  if (typeof body?.needs_edit === "boolean") patch.needs_edit = body.needs_edit
  if (typeof body?.hook_text === "string" || body?.hook_text === null) {
    // Trim + cap to the 80-char hook limit; empty → null (clears the card).
    const trimmed = typeof body.hook_text === "string" ? body.hook_text.trim().slice(0, 80) : ""
    patch.hook_text = trimmed.length > 0 ? trimmed : null
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "needs_edit (boolean) or hook_text (string|null) is required" }, { status: 400 })
  }

  const { id } = await params
  const updated = await updateVideoUpload(id, patch)
  return NextResponse.json({ id: updated.id, needs_edit: updated.needs_edit, hook_text: updated.hook_text ?? null })
```

Also update the file's top doc-comment line about PATCH to mention `hook_text` (e.g. `// PATCH — { needs_edit?: boolean; hook_text?: string|null } — edit-gate override + reel hook.`).

> Note: `updateVideoUpload(id, patch)` already accepts a `Partial<…VideoUpload…>` and `VideoUpload.hook_text` exists (Phase 2), so no DAL change is needed.

- [ ] **Step 2: Typecheck (no new errors)**

Run: `npx tsc --noEmit 2>&1 | grep -E "videos/\[id\]/route" || echo clean`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/videos/[id]/route.ts"
git commit -m "feat(reel): PATCH /videos/[id] accepts hook_text (editable reel hook)"
```

---

## Task 3: SplitReelPanel — "Create Reel" + editable hook + hook-saving Re-render

**Files:**
- Modify: `components/admin/content-studio/drawer/SplitReelPanel.tsx`

Read the full file first. Make these changes (preserve all existing job-tracking/progress logic):

- [ ] **Step 1: Add `hookText` to the panel state contract**

In the `ReelState` interface, add `hookText: string`. In `fetchState`, the GET response now includes `hookText` (Task 1) — it's already captured by `setState(s)`. In the two `setState({ ... })` error/fallback paths, add `hookText: ""` so the shape stays consistent.

- [ ] **Step 2: Add a `hook` editable state seeded from `hookText`**

Add `const [hook, setHook] = useState("")`. After `setState(s)` in `fetchState`, seed the field only when empty so it picks up the auto-written hook without clobbering edits:

```ts
      setHook((prev) => (prev.length > 0 ? prev : (s.hookText ?? "")))
```

(Place this right after `setState(s)` inside `fetchState`'s success path.)

- [ ] **Step 3: Add a small editable hook input rendered in the REVIEW and DONE states**

Add this component at the bottom of the file (near the other helpers):

```tsx
function HookField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-[11px] text-muted-foreground">Hook title (optional)</span>
      <input
        type="text"
        value={value}
        maxLength={80}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 5 Mistakes Athletes Make"
        className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
      />
    </label>
  )
}
```

Render `<HookField value={hook} onChange={setHook} />` inside the REVIEW state (the `windows.length > 0` branch, near `<CurrentReel … compact />`) and inside the DONE state (the `if (reel)` branch, above its existing button).

- [ ] **Step 4: Make Re-render save the hook first**

Add a `reRender` callback that PATCHes the hook (only when it differs from the loaded `state.hookText`) and then calls the existing `startRender`:

```ts
  async function reRender() {
    const desired = hook.trim()
    if (state && desired !== (state.hookText ?? "")) {
      try {
        await fetch(`/api/admin/videos/${encodeURIComponent(videoUploadId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hook_text: desired || null }),
        })
      } catch {
        toast.error("Failed to save the hook")
        return
      }
    }
    await startRender()
  }
```

In the REVIEW state, change the existing **"Render reel"** button's `onClick` from `startRender` to `reRender` and relabel it **"Render reel"** → keep label (it renders with the current/edited hook). In the DONE state, the existing button becomes **"Re-render"** wired to `reRender` (so an edited hook re-renders the finished reel; b-roll is cached).

- [ ] **Step 5: Relabel the idle CTA to "Create Reel"**

In the IDLE state (the `Generate b-roll` button), change the visible label `Generate b-roll` → `Create Reel` and keep `onClick={startGenerate}` (the server now auto-renders, so one click runs the whole pipeline). Update its `title` to reflect creating the full reel. Keep the `Clapperboard`/`Film` icon. Also relabel the DONE-state "Regenerate b-roll" button to "Re-create" (still `onClick={startGenerate}`), and the toast in `startGenerate` from "Generating b-roll…" to "Creating reel… picking moments, rendering clips, then the reel."

- [ ] **Step 6: Typecheck (no new errors) + targeted test**

Run: `npx tsc --noEmit 2>&1 | grep -E "SplitReelPanel" || echo clean` → expect `clean`.
If a `SplitReelPanel` test exists (`__tests__/.../SplitReelPanel*.test.tsx`), run it and update any label assertion ("Generate b-roll" → "Create Reel"). Otherwise skip.

- [ ] **Step 7: Commit**

```bash
git add components/admin/content-studio/drawer/SplitReelPanel.tsx
git commit -m "feat(reel): one-click Create Reel + editable hook in the Split Reel panel"
```

---

## Task 4: Retire the Captioned Cut button

**Files:**
- Modify: `components/admin/content-studio/detail/VideoDetailSidebar.tsx`
- Modify: `components/admin/content-studio/detail/VideoDetailPage.tsx`
- Modify (if needed): the two detail page tests.

- [ ] **Step 1: Remove the CaptionedCutPanel mount + prop from the sidebar**

In `components/admin/content-studio/detail/VideoDetailSidebar.tsx`:
- Delete the import `import { CaptionedCutPanel } from "@/components/admin/content-studio/drawer/CaptionedCutPanel"`.
- Delete the line `{captionedCutEnabled && <CaptionedCutPanel videoUploadId={video.id} hasTranscript={hasTranscript} />}`.
- Remove `captionedCutEnabled?: boolean` from `VideoDetailSidebarProps` and remove `captionedCutEnabled = false` from the destructured params.

- [ ] **Step 2: Stop passing `captionedCutEnabled` from the page**

In `components/admin/content-studio/detail/VideoDetailPage.tsx`, delete the line `captionedCutEnabled={data.captionedCutEnabled}` from the `<VideoDetailSidebar … />` props (leave `splitReelEnabled`).

- [ ] **Step 3: Update detail tests if they assert the captioned-cut panel**

Read `__tests__/components/admin/content-studio/detail/VideoDetailPage.test.tsx` and `__tests__/components/admin/content-studio/detail/PostDetailPage.test.tsx`. If either renders with `captionedCutEnabled: true` and asserts the Captioned Cut panel/button appears, remove that assertion (the panel is retired). If they pass `captionedCutEnabled` in a `DrawerData` fixture, that's harmless (the field still exists on the type) — leave it. Only change assertions that expect the captioned-cut UI to render.

- [ ] **Step 4: Typecheck + run the detail tests**

Run: `npx tsc --noEmit 2>&1 | grep -E "VideoDetailSidebar|VideoDetailPage" || echo clean` → expect `clean`.
Run: `npx vitest run __tests__/components/admin/content-studio/detail` → expect PASS.

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/detail/VideoDetailSidebar.tsx components/admin/content-studio/detail/VideoDetailPage.tsx __tests__/components/admin/content-studio/detail
git commit -m "feat(reel): retire the Captioned Cut button (one reel output)"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: No-new-errors typecheck across changed files**

Run: `npx tsc --noEmit 2>&1 | grep -E "split-reel/route|videos/\[id\]/route|SplitReelPanel|VideoDetailSidebar|VideoDetailPage" || echo clean`
Expected: `clean`.

- [ ] **Step 2: App content-studio test sweep**

Run: `npx vitest run __tests__/components/admin/content-studio __tests__/lib/content-studio`
Expected: PASS (update any remaining fixture that asserted the captioned-cut panel or the old "Generate b-roll" label, then re-run).

- [ ] **Step 3: Manual E2E (after deploy)**

On a video with a speech transcript: open the drawer → click **Create Reel** (one click) → watch it generate b-roll then auto-render → the finished reel shows with its auto-written hook in an editable field → edit the hook → **Re-render** → the reel updates with the new hook (no new Kling spend) → the video stays posting-gated until **Mark ready** (since `needs_edit` defaults true). Confirm there is no separate Captioned Cut button.

---

## Self-Review (completed during planning)

**Spec coverage:**
- §4 one-click "Create Reel" (no separate render click) → Task 3 (relabel; render auto-fires from 3a). ✓
- §1 one output / retire Captioned Cut button → Task 4. ✓
- §3/§6 editable hook + Re-render (cached b-roll) → Tasks 1 (GET returns hook), 2 (PATCH saves hook), 3 (field + reRender). ✓
- §5 needs_edit gate (Mark ready) → already shipped in 3a; the panel doesn't touch it. ✓

**Placeholder scan:** route changes have exact before/after; the panel changes are precise functional steps with exact new component/callback code, integrated by the implementer against the current file (a UI integration task). Test updates are conditional ("if it asserts X, change to Y") with the exact new expectation. ✓

**Type/name consistency:** `hookText` is the field on the GET response, `ReelState`, and the seed; `hook_text` is the DB column / PATCH key / `VideoUpload` field (Phase 2). `reRender` calls the existing `startRender`. The PATCH accepts `{ needs_edit?, hook_text? }` and `updateVideoUpload` already takes a partial. ✓

**Risks handled:** no "Suggest" button (avoids the `feature_captioned_cut_enabled` gating of the suggest-hook route); hook seeds only when empty (no clobber of edits); Captioned Cut composition/route/flag left as harmless dead code (minimal-risk retirement); detail-page test fixtures updated only where they assert the retired UI.

**Out of scope:** deleting `CaptionedCutPanel.tsx` / the captioned-cut route / `feature_captioned_cut_enabled` / `DrawerData.captionedCutEnabled`+`hasCut` (optional later cleanup); a re-suggest-hook button; music in the reel.
