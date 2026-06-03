# Reel Phase 2 — Auto-Generated Hook in the Reel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During the b-roll job, auto-write a short opening hook from the transcript and store it on `video_uploads.hook_text`; the Split Reel render reads it and burns it onto the first frame (the composition already supports a hook card — it just isn't fed one today).

**Architecture:** The hook generator already exists at `lib/ai/hook-suggestion.ts` (`suggestHookFromTranscript` → Claude Haiku → ≤80-char plain-text hook, returns null on empty/error). Because `functions/` cannot import from `lib/` (the `rootDir: src` boundary), we add a **twin copy** at `functions/src/lib/hook-suggestion.ts` (the project's documented twin pattern). The `broll_generation` Firebase function calls it after fetching the transcript and stores the hook on the video row (best-effort — a hook failure never fails the b-roll job). The Cloud Run render worker's `runSplitReel` reads `video.hook_text` and passes `hook:{text}` into the `SplitReel` composition, which renders `HookCard` for the first ~2s.

**Tech Stack:** Supabase Postgres (migration via the Supabase MCP `apply_migration`), Firebase Functions (TS ESM, `.js` import suffixes, Anthropic SDK, Vitest), the Remotion render-worker (TS ESM), shared app types in `types/database.ts`.

**Spec:** `docs/superpowers/specs/2026-06-03-one-click-reel-design.md` (§3). This is Phase 2 of 3. The **editable-hook UI** and the one-click trigger are Phase 3 — out of scope here. After Phase 2, a hook is auto-generated whenever b-roll is generated, and the existing manual "Render reel" flow shows it.

**Environment notes (verified):**
- `functions/` typecheck: `cd functions && npx tsc --noEmit -p tsconfig.json` (currently clean).
- `functions/` tests: `cd functions && npm test` (Vitest).
- `render-worker/` build gate: `cd render-worker && npm run build 2>&1 | grep "error TS" | grep -v "detect-face.ts"` → **no output** (5 pre-existing `detect-face.ts` missing-ML-dep errors are unrelated; they build in Docker).
- The render worker already loads the video via `supabase.from("video_uploads").select("*")`, so `video.hook_text` is available once the column exists; its `video` object is untyped (no `types/database` import), so no render-worker type change is needed.
- `functions/src/broll-generation.ts` runs in a runtime that has `ANTHROPIC_API_KEY` (same env the other functions agents use).

---

## File Structure

- Create: `supabase/migrations/00165_video_uploads_hook_text.sql` — add nullable `hook_text` column.
- Modify: `types/database.ts` — add `hook_text?: string | null` to the `VideoUpload` interface (app-side type; additive).
- Create: `functions/src/lib/hook-suggestion.ts` — twin of `lib/ai/hook-suggestion.ts`.
- Create: `functions/src/lib/__tests__/hook-suggestion.test.ts` — twin unit test (mirrors `__tests__/lib/ai/hook-suggestion.test.ts`).
- Modify: `functions/src/broll-generation.ts` — generate the hook after fetching transcript words and store it on the video row (best-effort).
- Modify: `render-worker/src/index.ts` — `runSplitReel` reads `video.hook_text` and adds `hook:{text}` to the composition `inputProps`.

---

## Task 1: DB column + app type

**Files:**
- Create: `supabase/migrations/00165_video_uploads_hook_text.sql`
- Modify: `types/database.ts` (the `VideoUpload` interface, around line 1593, before `created_at`)

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/00165_video_uploads_hook_text.sql` with:

```sql
-- supabase/migrations/00165_video_uploads_hook_text.sql
-- Stores the auto-generated (and later editable) opening hook title for a video's
-- reel. Written by the broll_generation job; read by the Split Reel render to burn
-- the hook card onto the first frame. Nullable, no default (null until generated).
alter table public.video_uploads
  add column if not exists hook_text text;
```

- [ ] **Step 2: Apply the migration to the live DB**

This repo's Supabase CLI is not linked — the migration is applied via the Supabase MCP tool, not `db push`. Apply it (controller runs the MCP `apply_migration` with name `00165_video_uploads_hook_text` and the SQL above).

Verify the column exists by running this SQL via the MCP `execute_sql`:
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'video_uploads' and column_name = 'hook_text';
```
Expected: one row — `hook_text | text | YES`.

- [ ] **Step 3: Add `hook_text` to the `VideoUpload` type**

In `types/database.ts`, in the `VideoUpload` interface, add this field immediately before `created_at: string`:

```ts
  /**
   * Auto-generated opening hook title for the reel's first-frame card. Written
   * from the transcript by the broll_generation job and (later) editable. Null
   * until generated. Optional on insert — nullable column, no default.
   */
  hook_text?: string | null
```

- [ ] **Step 4: Confirm the type change introduces no new errors**

Run: `npx tsc --noEmit 2>&1 | grep -E "database\.ts|video-uploads" || echo "no errors in changed type or its DAL"`
Expected: `no errors in changed type or its DAL`. (The repo's `tsc --noEmit` has unrelated pre-existing `NextRequest` errors in `__tests__/api/**`; this grep confirms the additive field adds none in the type file or the `video-uploads` DAL.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00165_video_uploads_hook_text.sql types/database.ts
git commit -m "feat(reel): add video_uploads.hook_text for the reel hook"
```

---

## Task 2: `functions/` twin of the hook generator (TDD)

**Files:**
- Create: `functions/src/lib/hook-suggestion.ts`
- Create: `functions/src/lib/__tests__/hook-suggestion.test.ts`

- [ ] **Step 1: Write the failing twin test**

Create `functions/src/lib/__tests__/hook-suggestion.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockCreate = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate }
  },
}))

describe("suggestHookFromTranscript (functions twin)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = "test-key"
  })

  it("returns a cleaned hook when Claude returns one line", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "5 Mistakes Killing Your Change-of-Direction Speed" }],
    })
    const { suggestHookFromTranscript } = await import("../hook-suggestion.js")
    const hook = await suggestHookFromTranscript("A long transcript about agility and cutting mechanics.")
    expect(hook).toBe("5 Mistakes Killing Your Change-of-Direction Speed")
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it("strips surrounding quotes and a markdown fence", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '```\n"Why your agility drills aren\'t working"\n```' }],
    })
    const { suggestHookFromTranscript } = await import("../hook-suggestion.js")
    expect(await suggestHookFromTranscript("transcript")).toBe("Why your agility drills aren't working")
  })

  it("caps the hook at 80 characters", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "a".repeat(200) }] })
    const { suggestHookFromTranscript } = await import("../hook-suggestion.js")
    const hook = await suggestHookFromTranscript("transcript")
    expect(hook).not.toBeNull()
    expect(hook!.length).toBeLessThanOrEqual(80)
  })

  it("returns null for an empty/whitespace transcript without calling the API", async () => {
    const { suggestHookFromTranscript } = await import("../hook-suggestion.js")
    expect(await suggestHookFromTranscript("")).toBeNull()
    expect(await suggestHookFromTranscript("   \n ")).toBeNull()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("returns null when the API call throws", async () => {
    mockCreate.mockRejectedValue(new Error("network"))
    const { suggestHookFromTranscript } = await import("../hook-suggestion.js")
    expect(await suggestHookFromTranscript("transcript")).toBeNull()
  })

  it("returns null when the model returns empty text", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "   " }] })
    const { suggestHookFromTranscript } = await import("../hook-suggestion.js")
    expect(await suggestHookFromTranscript("transcript")).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test — verify it fails (module missing)**

Run: `cd functions && npx vitest run src/lib/__tests__/hook-suggestion.test.ts`
Expected: FAIL — cannot resolve `../hook-suggestion.js` (the twin doesn't exist yet).

- [ ] **Step 3: Create the twin module**

Create `functions/src/lib/hook-suggestion.ts`:

```ts
// functions/src/lib/hook-suggestion.ts
// TWIN COPY of lib/ai/hook-suggestion.ts. functions/ cannot import lib/; keep the
// two in sync. Suggests a single short, punchy hook title from a video transcript
// for the reel's opening card. Uses Claude Haiku and returns plain text capped at
// 80 chars; returns null on an empty transcript or any parsing/connectivity issue
// so the caller degrades gracefully (the render just omits the hook card).
import Anthropic from "@anthropic-ai/sdk"

const MODEL = "claude-haiku-4-5-20251001"
// Mirror the render-worker's hook cap (slice(0, 80)).
const MAX_HOOK_LENGTH = 80

const SYSTEM_PROMPT = `You write the opening hook title that gets burned onto the first frame of a short vertical fitness/athletic coaching reel. Given a video transcript, return ONE hook — and nothing else.

The hook:
- Is ≤ 80 characters (counting spaces)
- Is a scroll-stopping promise, bold claim, or curiosity gap drawn from the transcript's core idea
- Uses concrete, punchy language — no filler, no hedging
- Is Title Case or a short sentence; NO hashtags, NO emoji, NO surrounding quotes, NO markdown
- Reads as a headline a viewer would stop scrolling for

Return only the hook text on a single line — no preamble, no alternatives, no explanation.`

/**
 * Strip a model's reply down to a single clean hook line: drop any markdown
 * fence, surrounding quotes, and trailing whitespace; take the first line; cap
 * at 80 chars. Exported for unit testing.
 */
export function sanitizeHook(raw: string): string {
  const firstLine = raw
    .trim()
    .replace(/^```(?:\w+)?/i, "")
    .replace(/```$/, "")
    .trim()
    .split(/\r?\n/)[0]
    .trim()
    // Strip a single pair of surrounding quotes (straight or curly).
    .replace(/^["'“”‘’]+/, "")
    .replace(/["'“”‘’]+$/, "")
    .trim()
  return firstLine.slice(0, MAX_HOOK_LENGTH).trim()
}

export async function suggestHookFromTranscript(transcript: string): Promise<string | null> {
  if (!transcript || transcript.trim().length === 0) return null

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
  const client = new Anthropic({ apiKey })

  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Write the single best opening hook for a reel based on this transcript.\n\nTranscript:\n${transcript}`,
            },
          ],
        },
      ],
    })
  } catch {
    return null
  }

  const textBlock = response.content.find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") return null

  const hook = sanitizeHook(textBlock.text)
  return hook.length > 0 ? hook : null
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `cd functions && npx vitest run src/lib/__tests__/hook-suggestion.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck functions**

Run: `cd functions && npx tsc --noEmit -p tsconfig.json`
Expected: exits 0 (clean).

- [ ] **Step 6: Commit**

```bash
git add functions/src/lib/hook-suggestion.ts functions/src/lib/__tests__/hook-suggestion.test.ts
git commit -m "feat(reel): functions twin of the hook suggester"
```

---

## Task 3: Generate + store the hook in `broll_generation`

**Files:**
- Modify: `functions/src/broll-generation.ts`

- [ ] **Step 1: Import the twin**

In `functions/src/broll-generation.ts`, add this import alongside the other `./lib/...` imports near the top (after the existing `import { postProcessWindows, brollCacheKey } from "./lib/broll-selection.js"` line):

```ts
import { suggestHookFromTranscript } from "./lib/hook-suggestion.js"
```

- [ ] **Step 2: Generate + store the hook right after the transcript words are loaded**

Find this block (it computes `totalMs` right after fetching words):

```ts
    const words = await fetchTranscriptWords(tx.assemblyai_job_id)
    if (words.length === 0) throw new Error("transcript has no words")
    const totalMs = words[words.length - 1].end
```

Insert the following immediately after that block (before the `// AI selection → post-process` comment):

```ts
    // Auto-write the opening hook from the transcript and stash it on the video
    // row so the Split Reel render can burn it onto the first frame. Best-effort:
    // a hook failure must NEVER fail the b-roll job — the render just omits the card.
    try {
      const transcriptText = words.map((w) => w.text).join(" ")
      const hook = await suggestHookFromTranscript(transcriptText)
      if (hook) {
        await supabase.from("video_uploads").update({ hook_text: hook }).eq("id", videoUploadId)
      }
    } catch (e) {
      console.warn("[broll_generation] hook suggestion failed (non-fatal):", (e as Error).message)
    }
```

- [ ] **Step 3: Typecheck functions**

Run: `cd functions && npx tsc --noEmit -p tsconfig.json`
Expected: exits 0.

- [ ] **Step 4: Run the functions test suite (regression)**

Run: `cd functions && npm test`
Expected: PASS — all existing tests plus the new `hook-suggestion` twin test.

- [ ] **Step 5: Commit**

```bash
git add functions/src/broll-generation.ts
git commit -m "feat(reel): broll_generation auto-writes the hook to video_uploads.hook_text"
```

---

## Task 4: Render the hook in `runSplitReel`

**Files:**
- Modify: `render-worker/src/index.ts` (the `runSplitReel` function, the `inputProps` object around lines 425–431)

- [ ] **Step 1: Read the hook from the video row and pass it into the composition**

In `render-worker/src/index.ts`, inside `runSplitReel`, find the `inputProps` object:

```ts
    const inputProps = {
      videoSrc: srcServer.url,
      pages,
      accentHex: BRAND_ACCENT_HEX,
      trajectory,
      broll: brollClips.map((c) => ({ startMs: c.startMs, endMs: c.endMs, src: c.url })),
    }
```

Replace it with (adds a trimmed, 80-char-capped hook only when present — mirroring how `main()` handles the captioned-cut hook):

```ts
    // Hook card text comes from video_uploads.hook_text (written by the
    // broll_generation job). Trim + cap defensively (mirror main()); absent → no card.
    const hookText = typeof video.hook_text === "string" ? video.hook_text.trim().slice(0, 80) : ""
    const inputProps = {
      videoSrc: srcServer.url,
      pages,
      accentHex: BRAND_ACCENT_HEX,
      trajectory,
      broll: brollClips.map((c) => ({ startMs: c.startMs, endMs: c.endMs, src: c.url })),
      ...(hookText ? { hook: { text: hookText } } : {}),
    }
```

> Note: `video` is the row from `supabase.from("video_uploads").select("*")` (untyped), so `video.hook_text` reads cleanly. The `SplitReel` composition already renders `<HookCard>` when `hook?.text` is set and `AudioLayer` already keys its whoosh on `hasHook`.

- [ ] **Step 2: Build gate (no new errors)**

Run: `cd render-worker && npm run build 2>&1 | grep "error TS" | grep -v "detect-face.ts"`
Expected: **no output** (only the pre-existing `detect-face.ts` errors remain).

- [ ] **Step 3: Run render-worker tests (regression)**

Run: `cd render-worker && npm test`
Expected: PASS (26 tests; unaffected).

- [ ] **Step 4: Commit**

```bash
git add render-worker/src/index.ts
git commit -m "feat(reel): Split Reel render burns in the auto-generated hook"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Functions — typecheck + tests**

Run: `cd functions && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: typecheck exits 0; all tests pass (including the hook twin test).

- [ ] **Step 2: Render-worker — build gate + tests**

Run: `cd render-worker && (npm run build 2>&1 | grep "error TS" | grep -v "detect-face.ts" || echo "no new build errors") && npm test`
Expected: `no new build errors`; 26 tests pass.

- [ ] **Step 3: DB — confirm the column is live**

Via the Supabase MCP `execute_sql`:
```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='video_uploads' and column_name='hook_text';
```
Expected: one row (`hook_text`).

- [ ] **Step 4: Manual E2E (after deploy of functions + render-worker)**

On a real video with a speech transcript: click **Generate b-roll** → confirm `video_uploads.hook_text` is populated (query it) → click **Render reel** → confirm the rendered reel opens with the hook card. (Deploy is separate: functions via `deploy-functions.yml`, render-worker via `deploy-worker.yml` — both on push to `main`.)

---

## Self-Review (completed during planning)

**Spec coverage (§3 of the one-click spec):**
- "composition already supports a hook (renders HookCard)" → unchanged; fed via Task 4. ✓
- "broll_generation generates the hook via the existing suggest-hook logic and stores it on video_uploads.hook_text" → Tasks 2 (twin) + 3 (generate+store) + 1 (column). ✓
- "runSplitReel reads hook_text and passes hook:{text} into the composition" → Task 4. ✓
- "editable via the panel" → **deferred to Phase 3** (UI overhaul), explicitly out of scope here. ✓

**Placeholder scan:** No TBD/vague steps — every code step shows full content or exact before/after, with exact commands + expected output. ✓

**Type/name consistency:** `suggestHookFromTranscript`/`sanitizeHook` names match between the twin and its test and the `broll-generation` import. `video_uploads.hook_text` column name matches the migration, the `VideoUpload.hook_text` field, the `broll_generation` write, and the render-worker read. The render worker reads `video.hook_text` from an untyped row (no type import needed). ✓

**Best-effort guarantee:** hook generation is wrapped in try/catch in `broll_generation` and `suggestHookFromTranscript` itself returns null on error — a hook failure never fails the b-roll job nor blocks the render. ✓

**Out of scope:** editable-hook UI, one-click trigger, edit-gate selector (all Phase 3); not re-generating/overwriting an edited hook (no edit path exists until Phase 3).
