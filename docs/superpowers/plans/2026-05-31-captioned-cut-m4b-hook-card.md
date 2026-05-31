# Captioned Cut — M4b (Tier 2b: Hook Card) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an animated "hook card" — a bold title that springs in for the first ~2 s of the captioned cut — driven by an optional hook text the admin sets in the Content Studio drawer.

**Architecture:** Thread an optional `hook` string end-to-end: panel text input → `POST /api/admin/content-studio/captioned-cut` → `createAiJob` input (Firestore `ai_jobs` doc) → the render worker reads `input.hook` off the doc (`jobRef.get()`) → passes it as a `hook?: { text }` render `inputProp` → a new `HookCard` Remotion layer renders it inside a 2-second `<Sequence>`. The hook is optional everywhere (absent → no hook card), so existing renders are unaffected.

**Tech Stack:** Zod (validator, TDD'd), Next.js route + React client panel, firebase-admin (worker reads the job doc), Remotion (`Sequence`, `spring`, `interpolate`), the Cloud Run job `captioned-cut-render`. No new npm deps.

**Scope:** This is **M4b** — the cross-stack half of Tier 2 (see `docs/superpowers/specs/2026-05-31-captioned-cut-pro-upgrade-design.md` §5 M4). It pairs with **M4a** (zoom + progress bar + brand bug, already shipped). **Caption SFX is explicitly DEFERRED** out of M4b: it needs a user-supplied `pop.mp3` (and the `public/` + Dockerfile + `publicDir` asset wiring), which isn't available. SFX gets its own follow-up once the asset exists. So M4b = the hook card only.

---

## Environment gotchas (carried from M3/M4a — read before working)

1. **Grep/Glob misfire** here (space in path). Use `git grep` via Bash. Read works with absolute paths and renders PNGs.
2. **gcloud default project is wrong** → ALWAYS `--project darrenjpaulcom`.
3. **Worker bundles the COMPILED `dist/` entry.** Always `cd render-worker && npm run build` before `remotion still`.
4. **Local `remotion still` needs a reachable test video** — use `https://www.w3schools.com/html/mov_bbb.mp4` (in `_still-props.json`).
5. **Brand accent `#c4936b`.**
6. **The render-worker builds independently** (`cd render-worker && npm run build` must exit 0). The app repo has ~150 pre-existing unrelated `tsc` errors — for the APP changes (validator/route/panel), verify your touched files don't ADD errors (run `npx tsc --noEmit` and confirm none of the new errors reference your files) and run the scoped validator test. Do not try to fix the pre-existing red.
7. **APP changes (validator, route, panel) trigger a Vercel prod deploy on push to `main`; `render-worker/` changes deploy via `gcloud`.** Both happen in Task 6. The user has authorized these deploys for this run.
8. **Commit with EXPLICIT `git add` paths** (never `git add -A`) so scratch `_still*.png`/`_still-props.json` are never staged. Solo-dev: commit **directly to `main`**. `C:/Users/tayaw` is itself a git repo — never `cd ..` past project root in git chains. Bash + heredoc for commit messages. `remotion still` ~1-3 min (use ~300000 ms timeout).
9. End every commit message with a blank line then `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `lib/validators/captioned-cut.ts` | request schema gains optional `hook` (trimmed, ≤80) | Modify |
| `__tests__/lib/validators/captioned-cut.test.ts` | validator tests incl. `hook` | Create |
| `app/api/admin/content-studio/captioned-cut/route.ts` | pass `hook` into the `createAiJob` input | Modify |
| `render-worker/src/index.ts` | read `input.hook` off the job doc; add to render `inputProps` | Modify |
| `render-worker/src/remotion/HookCard.tsx` | 2-second animated hook title | Create |
| `render-worker/src/remotion/CaptionedCut.tsx` | optional `hook` prop; compose `<HookCard>` | Modify |
| `components/admin/content-studio/drawer/CaptionedCutPanel.tsx` | optional "Hook" text input wired into the POST | Modify |

> Decomposition note: M4b adds **`HookCard`** only. `AudioLayer` (SFX) is deferred. `SourceLayer`/`ProgressBar`/`BrandBug` (M4a) and `CaptionLayer` (M3) are untouched.

---

## Task 1: Add optional `hook` to the request validator (TDD)

**Files:**
- Modify: `lib/validators/captioned-cut.ts`
- Test: `__tests__/lib/validators/captioned-cut.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/validators/captioned-cut.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { captionedCutRequestSchema } from "@/lib/validators/captioned-cut"

const VID = "396afdd4-4ebc-4eaa-b39a-da074bca0285"

describe("captionedCutRequestSchema", () => {
  it("accepts a videoUploadId with no hook", () => {
    const r = captionedCutRequestSchema.safeParse({ videoUploadId: VID })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.hook).toBeUndefined()
  })

  it("accepts and trims a hook", () => {
    const r = captionedCutRequestSchema.safeParse({ videoUploadId: VID, hook: "  5 mistakes athletes make  " })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.hook).toBe("5 mistakes athletes make")
  })

  it("rejects a hook longer than 80 chars", () => {
    const r = captionedCutRequestSchema.safeParse({ videoUploadId: VID, hook: "x".repeat(81) })
    expect(r.success).toBe(false)
  })

  it("still requires exactly one of videoUploadId / submissionId", () => {
    expect(captionedCutRequestSchema.safeParse({ hook: "hi" }).success).toBe(false)
    expect(captionedCutRequestSchema.safeParse({ videoUploadId: VID, submissionId: VID }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run __tests__/lib/validators/captioned-cut.test.ts`
Expected: FAIL — `hook` is not in the schema (the trim test gets `undefined`; the >80 test passes through).

- [ ] **Step 3: Implement**

In `lib/validators/captioned-cut.ts`, add the `hook` field to the object (before the `.refine`):

```typescript
export const captionedCutRequestSchema = z
  .object({
    videoUploadId: uuidLike.optional(),
    submissionId: uuidLike.optional(),
    // Optional hook title for the opening 2s card. Trimmed; capped so it fits the
    // card. Empty/whitespace-only is treated as "no hook" by the route.
    hook: z.string().trim().max(80, "Hook must be 80 characters or fewer").optional(),
  })
  .refine((d) => Boolean(d.videoUploadId) !== Boolean(d.submissionId), {
    message: "Provide exactly one of videoUploadId or submissionId",
  })
```

- [ ] **Step 4: Run — verify it passes**

Run: `npx vitest run __tests__/lib/validators/captioned-cut.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add lib/validators/captioned-cut.ts __tests__/lib/validators/captioned-cut.test.ts
git commit -m "feat(captioned-cut): optional hook field on the request validator"
```

---

## Task 2: Pass `hook` into the job input (route)

**Files:**
- Modify: `app/api/admin/content-studio/captioned-cut/route.ts`

- [ ] **Step 1: Thread `hook` into `createAiJob`**

In `app/api/admin/content-studio/captioned-cut/route.ts`, the POST handler currently calls:

```typescript
  const { jobId } = await createAiJob({
    type: "video_caption_render",
    userId: session.user.id,
    input: { videoUploadId },
  })
```

Replace the `input` with one that includes the hook **only when non-empty** (the validator already trimmed it):

```typescript
  const hook = parsed.data.hook && parsed.data.hook.length > 0 ? parsed.data.hook : undefined
  const { jobId } = await createAiJob({
    type: "video_caption_render",
    userId: session.user.id,
    input: hook ? { videoUploadId, hook } : { videoUploadId },
  })
```

(`parsed.data.hook` is available because Task 1 added it to the schema.)

- [ ] **Step 2: Type-check the touched file**

Run: `npx tsc --noEmit 2>&1 | grep "content-studio/captioned-cut/route" || echo "no new errors in route"`
Expected: `no new errors in route` (the route file introduces no new type errors — pre-existing unrelated errors elsewhere are fine).

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/content-studio/captioned-cut/route.ts
git commit -m "feat(captioned-cut): forward hook into the render job input"
```

---

## Task 3: Worker reads `input.hook` and passes it to the render

**Files:**
- Modify: `render-worker/src/index.ts`

- [ ] **Step 1: Read the hook off the job doc and add it to `inputProps`**

In `render-worker/src/index.ts`, the worker already has `const jobRef = firestore.collection("ai_jobs").doc(aiJobId)`. Read the doc's `input.hook` near the top of the `try` (after `jobRef` is defined, before the render). Add, just before the `// 5. Render` block where `inputProps` is built:

Find:
```typescript
    const inputProps = { videoSrc: videoSrcUrl, pages, accentHex: BRAND_ACCENT_HEX }
```

Replace with:
```typescript
    // Optional hook title (set by the panel → route → ai_jobs.input.hook). Absent
    // for older/other jobs → no hook card. Trim + cap defensively (mirror the
    // validator) so a bad value can never blow up the render.
    const jobSnap = await jobRef.get()
    const rawHook = jobSnap.data()?.input?.hook
    const hookText = typeof rawHook === "string" ? rawHook.trim().slice(0, 80) : ""
    const inputProps = {
      videoSrc: videoSrcUrl,
      pages,
      accentHex: BRAND_ACCENT_HEX,
      ...(hookText ? { hook: { text: hookText } } : {}),
    }
    console.log(`[render-worker] step=hook ${hookText ? `text="${hookText}"` : "none"}`)
```

- [ ] **Step 2: Build the worker**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0. (Note: this build will FAIL to type-check the `inputProps` shape against `CaptionedCutProps` until Task 4 adds the optional `hook` prop — that's expected if `selectComposition`/`renderMedia` are generically typed. If `tsc` errors here on the `hook` property, proceed to Task 4 and re-run the build there; if `tsc` is green because the calls aren't generically constrained, even better. Either way, do NOT cast — Task 4 makes the type honest.)

- [ ] **Step 3: Commit**

```bash
git add render-worker/src/index.ts
git commit -m "feat(captioned-cut): worker reads input.hook and passes it to the render"
```

---

## Task 4: `HookCard` layer + compose it

**Files:**
- Create: `render-worker/src/remotion/HookCard.tsx`
- Modify: `render-worker/src/remotion/CaptionedCut.tsx`

- [ ] **Step 1: Create `HookCard.tsx`**

A bold, outlined title centered on screen for the first ~2 s: it springs up in, holds, then fades out over the last ~0.3 s, with a brand-accent underline. Create `render-worker/src/remotion/HookCard.tsx`:

```tsx
// render-worker/src/remotion/HookCard.tsx
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"
import { loadFont } from "@remotion/google-fonts/LexendExa"

const { fontFamily } = loadFont("normal", { weights: ["800"], subsets: ["latin"] })

const HOOK_SECONDS = 2

export type HookCardProps = {
  text: string
  accentHex: string
}

export function HookCard({ text, accentHex }: HookCardProps) {
  const { fps } = useVideoConfig()
  return (
    <Sequence durationInFrames={Math.round(HOOK_SECONDS * fps)}>
      <HookCardInner text={text} accentHex={accentHex} />
    </Sequence>
  )
}

// Inner so useCurrentFrame() is measured RELATIVE to the Sequence start.
function HookCardInner({ text, accentHex }: HookCardProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const total = Math.round(HOOK_SECONDS * fps)
  // Spring up in, then fade out over the last ~0.3s.
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 160, mass: 0.6 } })
  const exit = interpolate(frame, [total - Math.round(0.3 * fps), total], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const opacity = Math.min(enter, exit)
  const scale = 0.8 + 0.2 * enter
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 80px" }}>
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 96,
          lineHeight: 1.1,
          textAlign: "center",
          color: "white",
          opacity,
          transform: `scale(${scale})`,
          transformOrigin: "center",
          WebkitTextStroke: "4px rgba(0,0,0,0.92)",
          paintOrder: "stroke fill",
          textShadow: "0 6px 30px rgba(0,0,0,0.85)",
          borderBottom: `8px solid ${accentHex}`,
          paddingBottom: 18,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  )
}
```

- [ ] **Step 2: Add the optional `hook` prop to `CaptionedCut` and compose `<HookCard>`**

In `render-worker/src/remotion/CaptionedCut.tsx`, add `hook?: { text: string }` to `CaptionedCutProps` and render `<HookCard>` (conditionally) right after the captions. The file becomes:

```tsx
// render-worker/src/remotion/CaptionedCut.tsx
import { AbsoluteFill } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"
import { CaptionLayer } from "./CaptionLayer.js"
import { SourceLayer } from "./SourceLayer.js"
import { ProgressBar } from "./ProgressBar.js"
import { BrandBug } from "./BrandBug.js"
import { HookCard } from "./HookCard.js"

// A `type` (not `interface`) so it satisfies Remotion's
// `Props extends Record<string, unknown>` constraint on <Composition>.
export type CaptionedCutProps = {
  videoSrc: string
  pages: CaptionPage[]
  accentHex: string
  hook?: { text: string }
}

export function CaptionedCut({ videoSrc, pages, accentHex, hook }: CaptionedCutProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <SourceLayer videoSrc={videoSrc} />
      <CaptionLayer pages={pages} accentHex={accentHex} />
      {hook?.text ? <HookCard text={hook.text} accentHex={accentHex} /> : null}
      <ProgressBar accentHex={accentHex} />
      <BrandBug accentHex={accentHex} />
    </AbsoluteFill>
  )
}
```

- [ ] **Step 3: Build the worker**

Run: `cd render-worker && npm run build`
Expected: `tsc` exits 0 (the `inputProps` `hook` from Task 3 now matches `CaptionedCutProps`).

- [ ] **Step 4: Add a hook to the scratch still props**

Overwrite `render-worker/_still-props.json` (gitignored; do NOT commit) so the still exercises the hook:

```json
{
  "videoSrc": "https://www.w3schools.com/html/mov_bbb.mp4",
  "accentHex": "#c4936b",
  "hook": { "text": "5 Mistakes Athletes Make" },
  "pages": [
    {
      "text": "5 mistakes athletes make",
      "words": [
        { "text": "5", "startMs": 0, "endMs": 350, "emphasis": true },
        { "text": "mistakes", "startMs": 350, "endMs": 800, "emphasis": true },
        { "text": "athletes", "startMs": 800, "endMs": 1300, "emphasis": true },
        { "text": "make", "startMs": 1300, "endMs": 1700, "emphasis": false }
      ],
      "startMs": 0,
      "endMs": 1700
    }
  ]
}
```

- [ ] **Step 5: Render stills during and after the hook; verify**

```bash
cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still-hook-f30.png --frame=30 --scale=0.5 --props=./_still-props.json
cd render-worker && npx remotion still dist/remotion/index.js CaptionedCut _still-hook-f90.png --frame=90 --scale=0.5 --props=./_still-props.json
```
- frame 30 (1 s → within the 2 s hook): the title "5 Mistakes Athletes Make" is centered, bold, outlined, with the accent underline, fully in.
- frame 90 (3 s → past the 2 s hook): the hook card is GONE; only the normal captions/bar/bug remain.
Read both. Confirm the hook shows then disappears. Leave PNGs on disk; describe what you saw.

- [ ] **Step 6: Commit**

```bash
git add render-worker/src/remotion/HookCard.tsx render-worker/src/remotion/CaptionedCut.tsx
git commit -m "feat(captioned-cut): animated 2s hook card"
```

---

## Task 5: Hook text input in the Content Studio panel

**Files:**
- Modify: `components/admin/content-studio/drawer/CaptionedCutPanel.tsx`

- [ ] **Step 1: Add hook state + input + wire it into the POST**

In `components/admin/content-studio/drawer/CaptionedCutPanel.tsx`:

1. Add hook state next to the others (after `const [submitting, setSubmitting] = useState(false)`):
```tsx
  const [hook, setHook] = useState("")
```

2. In `generate()`, include the hook in the POST body. Change:
```tsx
        body: JSON.stringify({ videoUploadId }),
```
to:
```tsx
        body: JSON.stringify({ videoUploadId, hook: hook.trim() || undefined }),
```

3. Add a reusable hook input above the Generate / Re-render buttons. Add this small component at the bottom of the file (next to `PanelShell`):
```tsx
function HookInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

4. Render `<HookInput value={hook} onChange={setHook} />` in BOTH the idle state and the done/re-render state, immediately before the Generate / Re-render button. In the **idle** branch (the final `return`), put it directly above the `<button … Generate Captioned Cut>`:
```tsx
    <PanelShell>
      <HookInput value={hook} onChange={setHook} />
      <button
        type="button"
        onClick={generate}
        disabled={!hasTranscript}
        ...
```
In the **done** branch, put it directly above the `<button … Re-render>` (inside the `min-w-0 flex-1` div, before the Re-render button):
```tsx
            <HookInput value={hook} onChange={setHook} />
            <button
              type="button"
              onClick={generate}
              disabled={!hasTranscript}
              ...
            >
              <RefreshCw className="size-3" /> Re-render
            </button>
```

- [ ] **Step 2: Type-check the touched file**

Run: `npx tsc --noEmit 2>&1 | grep "CaptionedCutPanel" || echo "no new errors in panel"`
Expected: `no new errors in panel`.

- [ ] **Step 3: Commit**

```bash
git add components/admin/content-studio/drawer/CaptionedCutPanel.tsx
git commit -m "feat(captioned-cut): hook title input in the Content Studio panel"
```

---

## Task 6: Deploy + push + render acceptance

**Files:** none (deploy + verify). The user has authorized the worker (`gcloud`) deploy AND the app push (Vercel) for this run.

- [ ] **Step 1: Final builds + tests green**

Run:
- `cd render-worker && npm run build` → tsc 0.
- `npx vitest run __tests__/lib/validators/captioned-cut.test.ts` → pass.
- `npx tsc --noEmit 2>&1 | grep -E "captioned-cut/route|CaptionedCutPanel|validators/captioned-cut" || echo "touched app files clean"` → clean.

- [ ] **Step 2: Deploy the worker** (same prod config)

```bash
gcloud run jobs deploy captioned-cut-render --source render-worker \
  --region us-central1 --project darrenjpaulcom \
  --service-account captioned-cut-render@darrenjpaulcom.iam.gserviceaccount.com \
  --memory 16Gi --cpu 4 --task-timeout 1800s --max-retries 1 \
  --set-secrets "SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,ASSEMBLYAI_API_KEY=ASSEMBLYAI_API_KEY:latest" \
  --set-env-vars "FIREBASE_STORAGE_BUCKET=darrenjpaulcom.firebasestorage.app"
```
Expected: "Job [captioned-cut-render] has successfully been deployed."

- [ ] **Step 3: Push the app** (triggers Vercel prod deploy of the validator/route/panel changes)

```bash
git push origin main
```
Expected: push succeeds; Vercel builds the app. (The new hook input + route + validator are additive; existing flows unaffected.)

- [ ] **Step 4: Cloud render acceptance**

The standing test doc `23Ll7ee0ZWX1qp9Vh423` has **no** `input.hook`, so this render verifies the worker reads `input.hook` **gracefully (absent → no hook card)** and does not regress M4a/M3:

```bash
gcloud run jobs execute captioned-cut-render --region us-central1 --project darrenjpaulcom \
  --update-env-vars AI_JOB_ID=23Ll7ee0ZWX1qp9Vh423,VIDEO_UPLOAD_ID=396afdd4-4ebc-4eaa-b39a-da074bca0285 --wait
```
Expected: exit 0; logs show `step=hook none` then `step=render ok`; the rendered cut has the M4a visuals + M3 captions, **no hook card** (correct — the doc has no hook). Download + frame-grid to confirm non-regression (same approach as M4a Task 5). **The hook card's visual is proven by the local still in Task 4 Step 5** (the live end-to-end hook — panel→route→doc→worker→card — is covered link-by-link: validator test + route change + worker read + local still). After deploy, a real hook entered in the panel will flow through and render the card.

- [ ] **Step 5: Clean scratch**

```bash
rm -f _m4b.mp4 _m4bgrid.png render-worker/_still*.png render-worker/_still-props.json
```

M4b is complete when: the validator test passes; the worker deploys and renders the test video green (`step=hook none`, no regression); the app is pushed (Vercel) with the hook input live; and the Task 4 still confirms the HookCard renders + disappears correctly.

---

## Self-Review

**Spec coverage (M4 §5 hook-card item):** hook card (first ~2 s animated title from panel hook text, auto/edited/off) → Tasks 1–5 ✓. "Auto-filled from the first transcript sentence" is simplified to an **admin-typed optional input** (empty = off); auto-suggest-from-transcript is a later refinement (noted), not required for a working hook card. **Caption SFX (the other M4 item) is deferred** (needs `pop.mp3`) — called out in Scope.

**Optionality / no regression:** `hook` is optional at every layer (validator `.optional()`, route conditional input, worker `hookText ? … : {}`, `CaptionedCutProps.hook?`, `CaptionedCut` conditional render). Absent hook → byte-identical to the M4a render. Verified by Task 6 Step 4 (the hook-less test doc renders with no card).

**Type flow:** `hook?: { text: string }` on `CaptionedCutProps` matches the worker's `inputProps` (`{ hook: { text: hookText } }`) and the still-props `hook` object; `HookCardProps { text, accentHex }` matches what `CaptionedCut` passes. The validator's `hook` is `string | undefined`; the route narrows to non-empty; the worker re-trims defensively.

**Placeholders:** none — every step shows real code/diffs and exact commands with expected output.

**Risk note:** Task 3's worker build may not fully type-check until Task 4 adds the optional prop (called out in Task 3 Step 2). The two are committed separately but both land before the Task 6 deploy, so the deployed `dist/` is always consistent.
