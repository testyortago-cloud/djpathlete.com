# Split Reel — Phase 3: Preview / Approve / Regenerate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or superpowers:executing-plans) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This plan has **Part A / B / C / D** — each part ends at a committable, independently sensible state; pause for review between parts.

**Goal:** Replace Phase 2's auto-chain (`broll_generation → split_reel_render`) with an **operator-reviewed gate**. After b-roll generation completes, the operator opens a Content Studio panel, previews each generated clip, edits prompts and **regenerates** individual windows, sees which moments were **dropped** by the cap/min-gap rules, and explicitly clicks **"Render reel"** to produce the final Split Reel. Generation no longer renders automatically.

**Architecture:** Four parts.
- **(A) Review-state backend + render gate.** Persist dropped windows as `broll_segments` rows; extend the GET split-reel route to return the finished reel (signed playback + posts) and dropped moments; add a `getLatestSplitReelForVideo` DAL (mirror of `getLatestCaptionedCutForVideo`); add the manual `POST .../render` and `POST .../broll/regenerate` endpoints; add a pure "all windows resolved" gate.
- **(B) Gate the auto-chain.** Make `chainSplitReelRender` conditional on a DB setting `split_reel_auto_render` (default **false** in Phase 3) so the render only fires on the explicit endpoint, while Phase 2's back-to-back E2E remains toggleable for testing.
- **(C) `SplitReelPanel` UI.** A sibling of `CaptionedCutPanel` with the full state machine: idle → generating → **review** (b-roll strip + per-window regenerate + dropped banner + "Render reel") → rendering → done (inline playback + draft-post links). Mounted in `VideoDetailSidebar` behind `feature_split_reel_enabled`.
- **(D) Pure-logic tests** for the gate + the regenerate cache-key/prompt update.

**Tech stack:** Next.js App Router routes (`withAudit`), Supabase DAL, `@fal-ai/client` (queue submit, app-side), Firestore `ai_jobs` via `useAiJob`, React panel mirroring `CaptionedCutPanel`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-split-reel-fal-ai-design.md` (§UI, §API routes, §Phasing item 3).
**Builds on (merged in PR #1):** `broll_segments` table, `broll_generation` handler, `split_reel_render` trigger + worker path, the GET/POST `split-reel` route, the fal-broll webhook, `feature_split_reel_enabled`.

---

## Design notes (decisions)

- **Gate, don't delete, the auto-chain.** Phase 2's `chainSplitReelRender` stays but is guarded by a new boolean setting `split_reel_auto_render` (default `false`). Phase 3 leaves it off so generation stops at review; flipping it on restores Phase 2's straight-through E2E for testing. DB-backed per project rule.
- **Dropped windows become rows.** Phase 2 discards `dropped` windows (only a count in the job result). Phase 3 persists each dropped window as a `broll_segments` row with `status='dropped'`, indexed **after** the kept windows (so the `(video_upload_id, segment_index)` unique index holds and the worker — which loads only `status='ready'` — still ignores them). The panel surfaces them as a banner.
- **Regenerate is a single-clip re-submit from the app.** `@fal-ai/client` is already a root dep (Phase 2's `fal-result.ts`). The regenerate route updates the segment's prompt (recomputing `cache_key`), flips it to `generating`, clears `media_asset_id`, and submits ONE clip to `fal.queue.submit` with the SAME `…/api/webhooks/fal-broll?segment_id=&token=` callback. The existing webhook fills it back in. No new job type, no functions change.
- **Render gate = "all windows resolved".** The render endpoint refuses while any segment is `pending`/`generating` (a clip is still cooking). `ready` + `dropped` + `failed` are all terminal — render proceeds (failed/dropped just don't appear; a 0-ready reel renders full-frame-only, matching Phase 2).
- **Sibling panel, not a toggle.** The spec offered "layout toggle OR sibling `SplitReelPanel.tsx`." We ship a sibling panel to keep the proven captioned-cut path untouched; a unified toggle can come later.
- **Honest verification:** pure cores (gate, regenerate prompt/cache-key update) are unit-tested. Routes, the panel, and the fal round-trip are verified by type-check/build + a manual run (needs `feature_split_reel_enabled=true`, `FAL_KEY`, `BROLL_WEBHOOK_SECRET`). Each such task says so.

---

## File structure (Phase 3)

**Part A — review backend + gate:**
| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `lib/db/media-assets.ts` | Modify | add `getLatestSplitReelForVideo` (mirror `getLatestCaptionedCutForVideo`, `origin='split_reel'`) |
| `functions/src/broll-generation.ts` | Modify | persist dropped windows as `status='dropped'` rows (indexed after kept) |
| `lib/split-reel/render-gate.ts` (+ test) | Create | pure `canRenderSplitReel(segments)` + `segmentsRemaining(...)` |
| `lib/split-reel/fal-submit.ts` | Create | app-side single-clip `fal.queue.submit` wrapper (+ webhook URL builder) |
| `lib/db/broll-segments.ts` | Modify | add `regenerateBrollSegment` patch helper (prompt, cache_key, status, clear asset, request id) |
| `lib/validators/split-reel.ts` | Modify | add `splitReelRenderSchema`, `brollRegenerateSchema` |
| `lib/audit/actions.ts` | Modify | `split_reel.render`, `split_reel.regenerate` slugs |
| `app/api/admin/content-studio/split-reel/route.ts` | Modify | GET also returns finished reel + dropped windows |
| `app/api/admin/content-studio/split-reel/render/route.ts` | Create | `POST` enqueue `split_reel_render` (gated on all resolved) |
| `app/api/admin/content-studio/split-reel/broll/regenerate/route.ts` | Create | `POST` regenerate one window |

**Part B — gate the auto-chain:**
| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `supabase/migrations/00163_split_reel_auto_render_setting.sql` | Create | `split_reel_auto_render` setting (default `false`) |
| `functions/src/on-ai-job-completed.ts` | Modify | only `chainSplitReelRender` when `split_reel_auto_render` is true |

**Part C — UI:**
| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `components/admin/content-studio/drawer/SplitReelPanel.tsx` | Create | the review/approve/regenerate panel |
| `components/admin/content-studio/detail/VideoDetailSidebar.tsx` | Modify | mount `SplitReelPanel` behind `feature_split_reel_enabled` |

---

# PART A — Review-state backend + render gate

### Task A1: `getLatestSplitReelForVideo` DAL

**Files:** Modify `lib/db/media-assets.ts`

- [ ] **Step 1: Read** `getLatestCaptionedCutForVideo` in `lib/db/media-assets.ts` (~line 169) and its `AssetWithLinkedPosts` return type + the `ai_analysis?.origin === "captioned_cut"` filter.
- [ ] **Step 2: Add `getLatestSplitReelForVideo`** as a byte-for-byte clone of `getLatestCaptionedCutForVideo` but matching `ai_analysis?.origin === "split_reel"`. Same signature `(videoUploadId: string): Promise<AssetWithLinkedPosts | null>`.
- [ ] **Step 3: Type-check.** `npx tsc --noEmit -p tsconfig.json` — no new errors in `media-assets.ts`.
- [ ] **Step 4: Commit** `feat(split-reel): getLatestSplitReelForVideo DAL`

---

### Task A2: Persist dropped windows as rows

**Files:** Modify `functions/src/broll-generation.ts`

> Verified by functions build + the Part-C manual run.

- [ ] **Step 1:** After the `postProcessWindows` call, when `dropped.length > 0`, insert one `broll_segments` row per dropped window with `status='dropped'`, `segment_index` = `kept.length + i`, `media_asset_id=null`, `cache_key = brollCacheKey(prompt, model, windowSeconds)`. Do this **before** the `kept.length === 0` early-return so a fully-dropped video still records them.
- [ ] **Step 2: Functions build.** From `functions/`: `npm run build` exits 0.
- [ ] **Step 3: Commit** `feat(split-reel): persist dropped b-roll windows for the review banner`

---

### Task A3: Pure render gate (TDD)

**Files:** Create `lib/split-reel/render-gate.ts` + `__tests__/split-reel/render-gate.test.ts`

- [ ] **Step 1: Failing test.** Cover: all `ready` → `canRender=true`; any `pending`/`generating` → `false`; mix of `ready`+`dropped`+`failed` (no pending/generating) → `true`; empty list → `true` (full-frame-only reel). Also `segmentsRemaining` counts `pending`+`generating`.

```ts
import { describe, it, expect } from "vitest"
import { canRenderSplitReel, segmentsRemaining } from "@/lib/split-reel/render-gate"

const s = (status: string) => ({ status })
describe("canRenderSplitReel", () => {
  it("true when all ready", () => expect(canRenderSplitReel([s("ready"), s("ready")])).toBe(true))
  it("false when a window is still generating", () => expect(canRenderSplitReel([s("ready"), s("generating")])).toBe(false))
  it("false when a window is still pending", () => expect(canRenderSplitReel([s("pending")])).toBe(false))
  it("true with ready+dropped+failed and nothing in flight", () => expect(canRenderSplitReel([s("ready"), s("dropped"), s("failed")])).toBe(true))
  it("true for an empty list (full-frame-only)", () => expect(canRenderSplitReel([])).toBe(true))
})
describe("segmentsRemaining", () => {
  it("counts pending+generating", () => expect(segmentsRemaining([s("pending"), s("generating"), s("ready")])).toBe(2))
})
```

- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3: Implement** `lib/split-reel/render-gate.ts`:

```ts
// lib/split-reel/render-gate.ts
// Pure: a Split Reel may render once no b-roll window is still cooking.
export type GateSegment = { status: string }
const IN_FLIGHT = new Set(["pending", "generating"])
export function segmentsRemaining(segments: GateSegment[]): number {
  return segments.filter((s) => IN_FLIGHT.has(s.status)).length
}
export function canRenderSplitReel(segments: GateSegment[]): boolean {
  return segmentsRemaining(segments) === 0
}
```

- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(split-reel): pure render gate (all windows resolved)`

---

### Task A4: App-side fal submit + DAL regenerate helper

**Files:** Create `lib/split-reel/fal-submit.ts`, modify `lib/db/broll-segments.ts`

> Read Phase 2's `functions/src/lib/fal-broll.ts` (`submitBrollClip`) and `lib/split-reel/fal-result.ts` (the `fal.config` guard) — mirror them app-side.

- [ ] **Step 1: `lib/split-reel/fal-submit.ts`** — `submitBrollClip({ model, prompt, durationSeconds, webhookUrl })` using `fal.queue.submit` (same input shape as Phase 2: `{ prompt, duration, aspect_ratio: "9:16" }`), returning `{ requestId }`. Plus `brollWebhookUrl(segmentId)` building `${base}/api/webhooks/fal-broll?segment_id=${segmentId}&token=${BROLL_WEBHOOK_SECRET}` from `NEXT_PUBLIC_APP_URL ?? APP_URL` (throw if unset).
- [ ] **Step 2: `regenerateBrollSegment`** in `lib/db/broll-segments.ts` — patch `{ prompt, cache_key, status: "generating", media_asset_id: null, fal_request_id: requestId }` by id.
- [ ] **Step 3: Type-check** (`npx tsc --noEmit`). Confirm `@fal-ai/client` resolves at root (Phase 2 added it).
- [ ] **Step 4: Commit** `feat(split-reel): app-side fal submit + segment regenerate helper`

---

### Task A5: Validators + audit slugs

**Files:** Modify `lib/validators/split-reel.ts`, `lib/audit/actions.ts`

- [ ] **Step 1:** Add to `lib/validators/split-reel.ts`:

```ts
export const splitReelRenderSchema = z.object({ videoUploadId: uuid })
export const brollRegenerateSchema = z.object({
  segmentId: uuid,
  prompt: z.string().min(1).max(800).optional(),
})
```

- [ ] **Step 2:** Add audit slugs to `lib/audit/actions.ts` (admin_write):

```ts
  { slug: "split_reel.render", category: "admin_write", description: "Split Reel render started" },
  { slug: "split_reel.regenerate", category: "admin_write", description: "Split Reel b-roll window regenerated" },
```

- [ ] **Step 3: Type-check.** `npx tsc --noEmit` (the `satisfies` on `AUDIT_ACTIONS` guards the shape).
- [ ] **Step 4: Commit** `feat(split-reel): render + regenerate validators and audit slugs`

---

### Task A6: Extend GET state (finished reel + dropped)

**Files:** Modify `app/api/admin/content-studio/split-reel/route.ts`

> Read Phase 2's GET handler + the captioned-cut GET (`getLatestCaptionedCutForVideo` + signed-url block) to mirror the playback signing.

- [ ] **Step 1:** In `getHandler`, additionally call `getLatestSplitReelForVideo(videoUploadId)`; if present, sign the asset (`getAdminStorage().bucket().file(...).getSignedUrl`, v4 read, ~6h) and include a `reel` object (`assetId, signedUrl, width, height, durationMs, createdAt, posts[]`) exactly like captioned-cut's `cut`. Split `segments` into `windows` (status ≠ `dropped`) and `dropped` (status = `dropped`, mapped to `{ startMs, endMs, concept }`).
- [ ] **Step 2: Type-check.** `npx tsc --noEmit` — no new errors in the route.
- [ ] **Step 3: Commit** `feat(split-reel): GET returns finished reel + dropped windows`

---

### Task A7: `POST .../render` (gated manual render)

**Files:** Create `app/api/admin/content-studio/split-reel/render/route.ts`

- [ ] **Step 1:** Admin-guard + `feature_split_reel_enabled` check (mirror Phase 2's POST). Parse `splitReelRenderSchema`. Load segments via `getBrollSegmentsForVideo`; if `!canRenderSplitReel(segments)` → `409 { error: "windows still generating" }`. Dedupe via `findInFlightSplitRender`; if in-flight, return its id. Else `createAiJob({ type: "split_reel_render", userId, input: { videoUploadId } })` → `202 { jobId }`. Wrap with `withAudit({ action: "split_reel.render", category: "admin_write" }, postHandler)`.
- [ ] **Step 2: Type-check.** `npx tsc --noEmit`.
- [ ] **Step 3: Commit** `feat(split-reel): manual render endpoint (gated on resolved windows)`

---

### Task A8: `POST .../broll/regenerate`

**Files:** Create `app/api/admin/content-studio/split-reel/broll/regenerate/route.ts`

> Manual/build-verified (real round-trip needs `FAL_KEY` + `BROLL_WEBHOOK_SECRET`).

- [ ] **Step 1:** Admin-guard + flag check. Parse `brollRegenerateSchema`. Load segment via `getBrollSegmentById`; 404 if absent; 409 if `status==="dropped"` (can't regenerate a dropped window). Resolve `split_reel_broll_model` + `split_reel_broll_window_seconds` via `getSetting`. `prompt = body.prompt?.trim() || segment.prompt`. `cacheKey = brollCacheKey(prompt, model, windowSeconds)`. `submitBrollClip({ model, prompt, durationSeconds: windowSeconds, webhookUrl: brollWebhookUrl(segment.id) })`. `regenerateBrollSegment(segment.id, { prompt, cache_key: cacheKey, fal_request_id: requestId })`. Return `200 { ok: true }`. Wrap with `withAudit({ action: "split_reel.regenerate", category: "admin_write" }, postHandler)`.
- [ ] **Step 2: Type-check.** `npx tsc --noEmit`.
- [ ] **Step 3: Commit** `feat(split-reel): per-window b-roll regenerate endpoint`

**Part A done when:** new Vitest suite green; `npx tsc --noEmit` clean for the new/changed app files; functions build clean.

---

# PART B — Gate the auto-chain

### Task B1: `split_reel_auto_render` setting (migration)

**Files:** Create `supabase/migrations/00163_split_reel_auto_render_setting.sql`

- [ ] **Step 1:** Write the migration:

```sql
insert into system_settings (key, value, description) values
  ('split_reel_auto_render', 'false'::jsonb,
   'When true, broll_generation auto-chains to split_reel_render (Phase 2 behavior). Phase 3 leaves this OFF so the operator approves the render.')
on conflict (key) do nothing;
```

- [ ] **Step 2: Apply** via Supabase MCP `apply_migration` (name `00163_split_reel_auto_render_setting`). Verify the row exists.
- [ ] **Step 3: Commit** `feat(split-reel): split_reel_auto_render setting (migration 00163)`

---

### Task B2: Gate `chainSplitReelRender`

**Files:** Modify `functions/src/on-ai-job-completed.ts`

- [ ] **Step 1:** In `chainSplitReelRender`, before enqueuing, read `split_reel_auto_render` from `system_settings` (via the functions Supabase client, `getSupabase`). If not `true`, log and return (no render job). Keep the existing enqueue when true. Add `supabaseUrl`/`supabaseServiceRoleKey` to the `onAiJobCompleted` `secrets` array in `index.ts` if not already present (it needs DB access now).
- [ ] **Step 2: Functions build.** `npm run build` exits 0.
- [ ] **Step 3: Commit** `feat(split-reel): gate auto-render behind split_reel_auto_render`

**Part B done when:** migration applied; functions build clean; with the flag off, a completed `broll_generation` enqueues **no** render job.

---

# PART C — SplitReelPanel UI

### Task C1: `SplitReelPanel.tsx`

**Files:** Create `components/admin/content-studio/drawer/SplitReelPanel.tsx`

> Read `CaptionedCutPanel.tsx` and reuse its shape (`useAiJob`, `renderPhase`/`formatElapsed`, `PanelShell`/`ProgressStep`, signed-video playback, post links). Build-verified; behavior verified in the manual run.

- [ ] **Step 1: Implement the state machine.** `useState` for `state` (from GET), `genJobId`, `renderJobId`; `useAiJob(genJobId)` and `useAiJob(renderJobId)`. `fetchState()` hits the GET route and seeds in-flight job ids. Render branches:
  - **initial load** → spinner.
  - **generating** (genJob pending/processing) → progress steps (Selecting → Generating clips → Ready).
  - **review** (`state.windows` present, no in-flight render, no finished reel OR user chose to re-review): the **b-roll strip** — per window: timestamp + concept, status chip, clip `<video>` when `ready`, an editable prompt textarea, a **Regenerate** button (POST `/broll/regenerate`, then refetch). A **dropped banner** listing `state.dropped` (count + timestamps). A **"Render reel"** button enabled only when `canRenderSplitReel` over the windows (POST `/render`, set `renderJobId`).
  - **rendering** (renderJob pending/processing) → progress steps (Queued → Rendering → Ready) + elapsed timer.
  - **done** (`state.reel`) → inline `<video src={reel.signedUrl}>`, dimensions/duration, draft-post links, and a "Regenerate b-roll" button that re-opens the generate flow.
  - **idle** (no segments, no reel) → "Generate b-roll" button (POST the existing Phase 2 `split-reel` route), gated on `hasTranscript`.
- [ ] **Step 2: Build.** `npm run build` (or `npx tsc --noEmit`) — no new errors. (Heavy: prefer `npx tsc --noEmit`.)
- [ ] **Step 3: Commit** `feat(split-reel): review/approve/regenerate panel`

---

### Task C2: Mount the panel

**Files:** Modify `components/admin/content-studio/detail/VideoDetailSidebar.tsx`

- [ ] **Step 1: Read** how `captionedCutEnabled` is resolved (the flag fetch) and where `CaptionedCutPanel` is mounted (~line 71).
- [ ] **Step 2:** Resolve `feature_split_reel_enabled` the same way and mount `{splitReelEnabled && <SplitReelPanel videoUploadId={video.id} hasTranscript={hasTranscript} />}` directly below the captioned-cut panel.
- [ ] **Step 3: Type-check.** `npx tsc --noEmit`.
- [ ] **Step 4: Commit** `feat(split-reel): mount SplitReelPanel in the video drawer`

**Part C done when:** type-checks/builds pass; with `feature_split_reel_enabled=true`, the panel renders all five states.

---

# PART D — verification

### Task D1: Full suite + manual E2E checklist

- [ ] **Step 1:** Run the app's new Vitest suites (`render-gate`, plus Phase 2's still green) and `npx tsc --noEmit`, `functions` build.
- [ ] **Step 2 (manual, needs deploy + `feature_split_reel_enabled=true` + `split_reel_auto_render=false` + `FAL_KEY` + `BROLL_WEBHOOK_SECRET`):** real upload → "Generate b-roll" → watch windows go `generating`→`ready` in the strip → edit one prompt + **Regenerate** → confirm the single clip re-renders → confirm the dropped banner → **Render reel** → reel plays, attached to draft posts. Record cost/time + any quality issues.

---

## What Phase 3 defers (spec "Open items / future")
- Active-speaker selection for multi-face frames; transition easing (full ↔ split); image-to-video / Ken-Burns cheaper b-roll modes; b-roll style consistency (shared preamble / seed reuse); highlight trimming (AI-picked best moment).
