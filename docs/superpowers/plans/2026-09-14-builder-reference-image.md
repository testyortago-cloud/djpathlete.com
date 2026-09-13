# Builder Reference Image (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner paste a reference design image into the builder chat, have the model read it for design direction, and record what it took in a durable `theme.designNote` so the direction survives later turns.

**Architecture:** The image rides in the AI SDK **user message** (Block C) only — `callAgent`/`streamAgent` gain an optional `images` option and switch from `prompt: <string>` to `messages: [...]` when one is present, leaving the cached system prefix byte-identical. The client downscales to ≤1568px in the browser before upload. The image is transient: it is never written to the turn log, storage, or the document. What persists instead is `theme.designNote`, a new OPTIONAL ≤400-char string that `buildTurnMessage` already puts in front of the model on every turn because the whole document is the per-turn context.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod 4, ai@6.0.97 + @ai-sdk/anthropic@3.0.46, React 19, Vitest + Testing Library, Tailwind v4.

**Spec:** [`docs/superpowers/specs/2026-09-14-builder-reference-image-design.md`](../specs/2026-09-14-builder-reference-image-design.md)

## Global Constraints

- **Node 24 or the runner lies.** Every command in this plan is preceded by `export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"`.
- **NEVER run the full test suite.** Targeted `npx vitest run <path>` only, plus `npx tsc --noEmit` as a separate gate.
- **Measured baselines** (re-measured on this worktree at `a8021067`, do not re-derive): `tsc --noEmit` = **238 errors**; targeted suites `__tests__/lib/funnels __tests__/app/api/admin/funnels __tests__/components/admin __tests__/lib/db` = **261 files / 3301 tests, all passing**. Compare the per-file error SET, not the count — a falling count hides new errors too.
- **`SECTION_BUILDER_BLOCK_A` is 20,638 / 20,700 — 62 chars headroom. DO NOT GROW IT.** All prompt work goes in `SECTION_BUILDER_BLOCK_DESIGN` (3,202 / 3,400 — 198 chars headroom, which will not be enough; Task 7 raises that one ceiling by a measured amount).
- **Every new theme key is OPTIONAL.** `SectionDoc` is stored JSON in `funnel_steps.project_data` and `reassemble()` parses it on every render. A required key breaks every existing stored draft permanently, on both boards.
- **The cached prefix stays byte-stable.** `buildSystemPrompt(...)` must be identical with and without an image.
- **The image is never stored.** Not in `funnel_step_turns`, not in Firebase Storage, not in the document, not in a log.
- **One image per turn.** Multiple references are out of scope.
- **Admin UI is light-only.** Do not build against a `.dark` variant.
- **No Claude attribution in commits.** Commit as: `git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "..."`. No `Co-Authored-By`, no "Generated with".
- **JOURNAL.md is gitignored and must never be staged.**
- **Fixture shapes, verified against the real schema** (do not improvise): a theme is `{ tone: "light", accent: "accent", radius: "soft" }`; `hero` props take `headline` (NOT `heading`), `sub`, `primaryCta: { label, target: { kind, ref } }`; a bullet item takes `title` (NOT `text`). A minimal valid doc is `{ v: 1, engine: "sections", theme, sections: [...] }` with 1..24 sections.
- **`html.includes(text)` false-negatives on apostrophes** — `escapeHtml` encodes them. Never assert a rendered string containing `'`.

---

## File Structure

**Create:**
- `lib/funnels/reference-image.ts` — the browser-side downscale + encode helper, and the shared `ReferenceImage` type. Client-only logic, kept out of `ChatPane.tsx` so it is unit-testable without mounting React.
- `__tests__/lib/funnels/reference-image.test.ts` — downscale/encode unit tests.
- `__tests__/lib/ai/anthropic-images.test.ts` — transport shape tests.
- `__tests__/components/admin/builder/reference-image-chat.test.tsx` — ChatPane attach/send/clear tests.

**Modify:**
- `lib/funnels/sections/builder-config.ts` — three new named constants (two caps, one media-type allowlist) + the Block DESIGN ceiling raise.
- `lib/ai/anthropic.ts` — `images` option on `callAgent` and `streamAgent`.
- `lib/validators/funnel.ts` — `image` on `buildMessageRequestSchema`.
- `lib/funnels/sections/registry.ts` — `designNote` on `sectionDocThemeSchema`.
- `lib/funnels/sections/prompt.ts` — Block DESIGN: compaction + the reference-image instructions.
- `app/api/admin/funnels/steps/[stepId]/build/route.ts` — thread the image to `streamAgent`, never to `appendTurn`.
- `components/admin/funnels/builder/ChatPane.tsx` — paste handler, file picker, chip, `onSend` signature.
- `components/admin/funnels/builder/types.ts` — `hadReferenceImage` on the owner message.
- `components/admin/funnels/FunnelBuilder.tsx` — `send(text, image)` and the POST body.
- `components/admin/funnels/builder/ThemePanel.tsx` — the "Design direction" textarea.
- `docs/builder-gaps.md` — flip C3 to `closed`.

**Test files modified:** `__tests__/lib/funnels/sections/registry.test.ts`, `__tests__/lib/funnels/sections/prompt.test.ts`, `__tests__/lib/funnels/sections/apply.test.ts`, `__tests__/app/api/admin/funnels/build-route.test.ts`, `__tests__/components/admin/funnels/ThemePanel.test.tsx`.

**Task order rationale:** Tasks 1-2 are leaf changes with no dependents (constants, transport). Task 3 (`designNote`) is the schema change everything downstream reads. Tasks 4-6 build outward from the server to the client. Task 7 (the prompt) is last of the code tasks because its ceiling raise must be measured against the final text. Tasks 8-9 are verification and docs.

---

## Task 1: Named constants for the reference image

**Files:**
- Modify: `lib/funnels/sections/builder-config.ts`
- Test: `__tests__/lib/funnels/sections/builder-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BUILDER_REFERENCE_IMAGE_MEDIA_TYPES: readonly ["image/jpeg","image/png","image/webp","image/gif"]`, `BUILDER_REFERENCE_IMAGE_MAX_BASE64: 2_000_000`, `BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES: 10_485_760`, `BUILDER_REFERENCE_IMAGE_MAX_EDGE: 1568`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/funnels/sections/builder-config.test.ts`:

```ts
import {
  BUILDER_REFERENCE_IMAGE_MEDIA_TYPES,
  BUILDER_REFERENCE_IMAGE_MAX_BASE64,
  BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES,
  BUILDER_REFERENCE_IMAGE_MAX_EDGE,
} from "@/lib/funnels/sections/builder-config"

describe("reference-image tunables", () => {
  // The allowlist is what ANTHROPIC'S VISION ENDPOINT accepts, which is NOT the
  // same list as `app/api/upload/funnel-image/route.ts` (that one also takes
  // image/avif, which Anthropic does not). Two lists that look alike and differ
  // in one member is this repo's divergent-regex bug class; this test states
  // which list this one IS.
  it("allows exactly the four types Anthropic's vision endpoint takes", () => {
    expect([...BUILDER_REFERENCE_IMAGE_MEDIA_TYPES].sort()).toEqual([
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ])
  })

  it("does NOT allow avif, which the funnel-image upload route does", () => {
    expect(BUILDER_REFERENCE_IMAGE_MEDIA_TYPES).not.toContain("image/avif")
  })

  // 1568px is what Claude downscales to anyway. A larger number would upload
  // pixels the model discards; a smaller one throws away fidelity for free.
  it("targets the long edge Claude itself downscales to", () => {
    expect(BUILDER_REFERENCE_IMAGE_MAX_EDGE).toBe(1568)
  })

  // The base64 cap must sit ABOVE a realistic worst case for a 1568px JPEG
  // (~540 KB base64) — a cap below that would reject ordinary screenshots — and
  // the source bound must be looser still, since it is checked BEFORE downscale.
  it("caps base64 above a realistic post-downscale worst case", () => {
    expect(BUILDER_REFERENCE_IMAGE_MAX_BASE64).toBeGreaterThan(540_000)
    expect(BUILDER_REFERENCE_IMAGE_MAX_BASE64).toBe(2_000_000)
  })

  it("bounds the source file more loosely than the encoded payload", () => {
    expect(BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES).toBeGreaterThan(BUILDER_REFERENCE_IMAGE_MAX_BASE64 * 0.75)
    expect(BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES).toBe(10 * 1024 * 1024)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
npx vitest run __tests__/lib/funnels/sections/builder-config.test.ts
```
Expected: FAIL — the four names do not exist (import errors / `undefined`).

- [ ] **Step 3: Write minimal implementation**

Append to `lib/funnels/sections/builder-config.ts`:

```ts
// ---------------------------------------------------------------------------
// THE PASTED REFERENCE IMAGE (2026-09-14 spec §4, §5).
//
// A reference image is TRANSIENT: it rides in one request body, is handed to
// the model, and is never written to `funnel_step_turns`, to storage, or to the
// document. These four numbers are the whole of its budget.
// ---------------------------------------------------------------------------

/**
 * What ANTHROPIC'S VISION ENDPOINT accepts. This is deliberately NOT the same
 * list as `app/api/upload/funnel-image/route.ts`'s `ALLOWED_TYPES`, which also
 * takes `image/avif` — that route uploads to storage for a page to display,
 * this one hands bytes to a model that does not read AVIF. Neither list imports
 * the other, because they are lists of different things; each says which.
 */
export const BUILDER_REFERENCE_IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const

export type BuilderReferenceImageMediaType = (typeof BUILDER_REFERENCE_IMAGE_MEDIA_TYPES)[number]

/**
 * The long edge the CLIENT downscales to before upload.
 *
 * Claude downscales every image to ~1568px on the long edge before the model
 * sees it, so sending more costs upload time and request size and buys nothing.
 * Doing it in the browser rather than the route follows the same reasoning
 * `app/api/upload/funnel-image/route.ts` already states for width/height: the
 * browser has the decoded image, and the alternative is a `sharp`-class
 * dependency in a route to redo work the picker already did.
 */
export const BUILDER_REFERENCE_IMAGE_MAX_EDGE = 1568

/**
 * Cap on the base64 `data` string the route accepts, in characters.
 *
 * A 1568px JPEG at q0.85 is typically 150-400 KB binary (~200-540 KB base64),
 * so 2,000,000 (~1.5 MB binary) sits well above the realistic worst case and
 * well below any platform body limit.
 */
export const BUILDER_REFERENCE_IMAGE_MAX_BASE64 = 2_000_000

/**
 * Cap on the ORIGINAL file, checked in the browser BEFORE decoding.
 *
 * A separate, looser bound with a different purpose from the one above: it
 * exists so dropping a 200 MB TIFF in fails immediately with a sentence,
 * instead of hanging the tab on a canvas draw that was always going to be
 * rejected.
 */
export const BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES = 10 * 1024 * 1024
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run __tests__/lib/funnels/sections/builder-config.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/builder-config.ts __tests__/lib/funnels/sections/builder-config.test.ts
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "feat(builder): name the reference-image tunables"
```

---

## Task 2: Transport — an optional image in the user message

**Files:**
- Modify: `lib/ai/anthropic.ts` (`callAgent` ~line 76, `streamAgent` ~line 243)
- Create: `__tests__/lib/ai/anthropic-images.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `AgentImage = { mediaType: string; data: string }` exported from `lib/ai/anthropic`, and an `images?: readonly AgentImage[]` option on both `callAgent` and `streamAgent`.

**CRITICAL TRAP — read before writing code.** The AI SDK's `Prompt` type (`node_modules/ai/dist/index.d.ts:677`) is a union whose branches carry `messages?: never` and `prompt?: never`. A conditional spread does **not** compile:

```ts
// WRONG — widens both keys to `X | undefined`, matching neither branch.
streamObject({ ...common, ...(images ? { messages } : { prompt: userMessage }) })
```

Branch into two complete call expressions instead, hoisting the shared options into a `const`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/ai/anthropic-images.test.ts`:

```ts
// The reference-image transport (2026-09-14 spec §3).
//
// THE CLAIM UNDER TEST IS THE ARGUMENT OBJECT, not that a call happened. The
// mutant this kills is an `images` option that is accepted and then dropped —
// which would leave the feature silently text-only with a green suite and a
// working UI.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"

const generateObjectMock = vi.fn()
const streamObjectMock = vi.fn()

vi.mock("ai", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
    streamObject: (...args: unknown[]) => streamObjectMock(...args),
  }
})

import { callAgent, streamAgent } from "@/lib/ai/anthropic"

const schema = z.object({ answer: z.string() })
const IMAGE = { mediaType: "image/jpeg", data: "QUJD" }

beforeEach(() => {
  generateObjectMock.mockReset()
  streamObjectMock.mockReset()
  generateObjectMock.mockResolvedValue({
    object: { answer: "ok" },
    usage: { inputTokens: 10, outputTokens: 5 },
    providerMetadata: {},
  })
  streamObjectMock.mockReturnValue({ object: Promise.resolve({ answer: "ok" }), fullStream: (async function* () {})() })
})

describe("callAgent with an image", () => {
  it("sends a messages array with the text part and the image part, and NO prompt", async () => {
    await callAgent("system", "the owner's words", schema, { images: [IMAGE] })
    const params = generateObjectMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.prompt).toBeUndefined()
    expect(params.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "the owner's words" },
          { type: "image", image: "QUJD", mediaType: "image/jpeg" },
        ],
      },
    ])
  })

  it("is byte-identical to today's call when no image is passed", async () => {
    await callAgent("system", "the owner's words", schema)
    const params = generateObjectMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.prompt).toBe("the owner's words")
    expect(params.messages).toBeUndefined()
  })

  it("an EMPTY images array is treated as no image, not as an empty content list", async () => {
    // The mutant: `if (options?.images)` instead of a length check. An empty
    // array is truthy, and would send a user message with one text part in
    // `messages` form — a silent, permanent change of shape for every caller
    // that defaults the option to [].
    await callAgent("system", "hi", schema, { images: [] })
    const params = generateObjectMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.prompt).toBe("hi")
    expect(params.messages).toBeUndefined()
  })

  it("keeps jsonTool and the cached system block when an image rides along", async () => {
    await callAgent("system", "hi", schema, { images: [IMAGE], cacheSystemPrompt: true })
    const params = generateObjectMock.mock.calls[0][0] as {
      providerOptions?: { anthropic?: { structuredOutputMode?: string } }
      system?: unknown
    }
    expect(params.providerOptions?.anthropic?.structuredOutputMode).toBe("jsonTool")
    expect(Array.isArray(params.system)).toBe(true)
  })

  it("puts the text part BEFORE the image part", async () => {
    // Deliberate (spec §3.2): the text part is the whole turn context and the
    // instruction "read the attached reference" must be in front of the model
    // before the attachment is.
    await callAgent("system", "hi", schema, { images: [IMAGE] })
    const params = generateObjectMock.mock.calls[0][0] as { messages: { content: { type: string }[] }[] }
    expect(params.messages[0].content.map((part) => part.type)).toEqual(["text", "image"])
  })
})

describe("streamAgent with an image", () => {
  it("sends a messages array with the text part and the image part, and NO prompt", () => {
    streamAgent("system", "the owner's words", schema, { images: [IMAGE] })
    const params = streamObjectMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.prompt).toBeUndefined()
    expect(params.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "the owner's words" },
          { type: "image", image: "QUJD", mediaType: "image/jpeg" },
        ],
      },
    ])
  })

  it("is byte-identical to today's call when no image is passed", () => {
    streamAgent("system", "the owner's words", schema)
    const params = streamObjectMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.prompt).toBe("the owner's words")
    expect(params.messages).toBeUndefined()
  })

  it("keeps jsonTool when an image rides along", () => {
    streamAgent("system", "hi", schema, { images: [IMAGE] })
    const params = streamObjectMock.mock.calls[0][0] as {
      providerOptions?: { anthropic?: { structuredOutputMode?: string } }
    }
    expect(params.providerOptions?.anthropic?.structuredOutputMode).toBe("jsonTool")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
npx vitest run __tests__/lib/ai/anthropic-images.test.ts
```
Expected: FAIL — `params.messages` is `undefined` when an image is passed (the option is ignored).

- [ ] **Step 3: Write minimal implementation**

In `lib/ai/anthropic.ts`, add above `callAgent`:

```ts
/**
 * One image attached to a single model call (2026-09-14 spec §3).
 *
 * `data` is bare base64 — no `data:<type>;base64,` prefix. `{type:"image",
 * image, mediaType}` is the AI SDK v6 `ImagePart` shape (verified against
 * `node_modules/@ai-sdk/provider-utils/dist/index.d.ts:568`); the provider
 * converts it to Anthropic's `{type:"image", source:{type:"base64", ...}}`.
 */
export interface AgentImage {
  mediaType: string
  data: string
}

/**
 * Builds the `prompt`-or-`messages` half of an AI SDK call.
 *
 * TWO COMPLETE OBJECTS, NOT A CONDITIONAL SPREAD. The SDK's `Prompt` type is a
 * union whose branches carry `messages?: never` / `prompt?: never`, so a
 * spread like `{...(images ? {messages} : {prompt})}` widens BOTH keys to
 * `X | undefined` and matches neither branch. The type error it produces points
 * at the call site rather than at the spread, which costs a confusing half-hour.
 *
 * A zero-length array is "no image": `if (images)` alone would be true for `[]`
 * and would silently switch every caller that defaults the option to a
 * one-text-part `messages` list, changing the request shape forever for no
 * reason.
 *
 * THE IMAGE RIDES HERE, IN THE USER MESSAGE, AND NOWHERE ELSE. The system
 * prompt is a cached prefix and Anthropic's cache is a strict prefix match —
 * anything per-turn in it is a silent cache invalidator on every turn of every
 * page.
 */
function promptOrMessages(userMessage: string, images?: readonly AgentImage[]) {
  if (!images || images.length === 0) return { prompt: userMessage } as const
  return {
    messages: [
      {
        role: "user" as const,
        content: [
          // Text FIRST: it is the whole turn context, and the instruction to
          // read the attachment belongs in front of the attachment.
          { type: "text" as const, text: userMessage },
          ...images.map((image) => ({
            type: "image" as const,
            image: image.data,
            mediaType: image.mediaType,
          })),
        ],
      },
    ],
  } as const
}
```

Then in `callAgent`, add `images?: readonly AgentImage[]` to the `options` type and replace the `prompt: userMessage,` line inside `generateObject({...})` with `...promptOrMessages(userMessage, options?.images),`.

Do the same in `streamAgent`: add `images?: readonly AgentImage[]` to its `options` type and replace `prompt: userMessage,` with `...promptOrMessages(userMessage, options?.images),`.

If TypeScript rejects the spread inside the call (it may, for the same union reason), hoist instead — in each function:

```ts
const common = { /* every option except prompt/messages */ }
const source = promptOrMessages(userMessage, options?.images)
return "messages" in source
  ? streamObject({ ...common, messages: source.messages, schema })
  : streamObject({ ...common, prompt: source.prompt, schema })
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run __tests__/lib/ai/anthropic-images.test.ts __tests__/lib/ai/anthropic-schema.test.ts
npx tsc --noEmit 2>&1 | grep -E "lib/ai/anthropic" || echo "no new errors in lib/ai/anthropic.ts"
```
Expected: PASS, and no tsc errors naming `lib/ai/anthropic.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/anthropic.ts __tests__/lib/ai/anthropic-images.test.ts
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "feat(ai): let callAgent and streamAgent carry an image in the user message"
```

---

## Task 3: `theme.designNote` — the durable note

**Files:**
- Modify: `lib/funnels/sections/registry.ts:286-301` (`sectionDocThemeSchema`)
- Test: `__tests__/lib/funnels/sections/registry.test.ts`, `__tests__/lib/funnels/sections/apply.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SectionDocTheme.designNote?: string` (≤400 chars); `SectionDocThemePatch.designNote?: string | null` — the nullable form is **derived automatically** by the existing `sectionDocThemePatchSchema`, which maps every already-optional key to `.nullable()`. Task 6's `ThemePanel` and Task 7's prompt both depend on that derivation actually having covered the new key, which is why it is pinned below rather than assumed.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/funnels/sections/registry.test.ts`:

```ts
describe("theme.designNote (2026-09-14 reference-image spec §6)", () => {
  const baseTheme = { tone: "light", accent: "primary", radius: "soft" } as const
  const heroSection = {
    id: "h1",
    kind: "hero" as const,
    variant: "centered",
    style: {},
    props: { headline: "Rotational power in eight weeks" },
  }
  const docWith = (theme: unknown) =>
    sectionDocSchema.safeParse({ v: 1, engine: "sections", theme, sections: [heroSection] })

  // THE STORED-DRAFT INVARIANT. `SectionDoc` is JSON in
  // `funnel_steps.project_data` and `reassemble()` parses it on EVERY render,
  // on both boards. A required new key does not fail a migration — it fails
  // every page that already exists, forever. This is the shape every draft
  // written before today actually holds.
  it("a document with NO designNote still parses", () => {
    const result = docWith(baseTheme)
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("accepts a note", () => {
    const result = docWith({ ...baseTheme, designNote: "Warm sand palette, editorial serif, airy spacing." })
    expect(result.success).toBe(true)
    expect(result.success && result.data.theme.designNote).toBe(
      "Warm sand palette, editorial serif, airy spacing.",
    )
  })

  // The bound is probed AT ITS EDGE, both sides. "a long string fails" would
  // pass for a cap of 40 as readily as 400.
  it("accepts exactly 400 characters and rejects 401", () => {
    expect(docWith({ ...baseTheme, designNote: "x".repeat(400) }).success).toBe(true)
    expect(docWith({ ...baseTheme, designNote: "x".repeat(401) }).success).toBe(false)
  })

  it("rejects a non-string note", () => {
    expect(docWith({ ...baseTheme, designNote: 12 }).success).toBe(false)
  })
})

describe("sectionDocThemePatchSchema covers designNote", () => {
  // The delete sentinel is DERIVED, not hand-listed: the patch schema maps
  // every key already optional on the stored schema to `.nullable()`. This
  // pins that the derivation actually reached the new key — the mutant is
  // someone adding `designNote` to a hand-written patch type instead, which
  // would leave `{designNote: null}` rejected and the note un-clearable, the
  // exact bug `palette` had before the 2026-09-13 whole-branch review.
  it("accepts an explicit null as the delete sentinel", () => {
    expect(sectionDocThemePatchSchema.safeParse({ designNote: null }).success).toBe(true)
  })

  it("accepts a note", () => {
    expect(sectionDocThemePatchSchema.safeParse({ designNote: "Serif, airy." }).success).toBe(true)
  })

  it("still refuses a null for a REQUIRED key", () => {
    expect(sectionDocThemePatchSchema.safeParse({ tone: null }).success).toBe(false)
  })

  it("enforces the same 400-char bound on a patch as on the stored shape", () => {
    expect(sectionDocThemePatchSchema.safeParse({ designNote: "x".repeat(400) }).success).toBe(true)
    expect(sectionDocThemePatchSchema.safeParse({ designNote: "x".repeat(401) }).success).toBe(false)
  })
})
```

Ensure `sectionDocSchema` and `sectionDocThemePatchSchema` are in that file's import list.

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
npx vitest run __tests__/lib/funnels/sections/registry.test.ts
```
Expected: FAIL — `designNote` is stripped by Zod, so `result.data.theme.designNote` is `undefined` and the 401-char case succeeds.

- [ ] **Step 3: Write minimal implementation**

In `lib/funnels/sections/registry.ts`, inside `sectionDocThemeSchema`, after the `rhythm` line:

```ts
  /**
   * WHAT THIS PAGE'S LOOK IS BASED ON, in the owner's or the model's words
   * (2026-09-14 reference-image spec §6).
   *
   * WHY IT EXISTS. A pasted reference image is transient — it rides in one
   * request body and is never stored. Without a durable record the reference
   * would influence exactly one turn, and the owner's fifth follow-up ("make
   * the headline bolder") would be answered by a model with no idea a brand
   * board was ever involved. `buildTurnMessage` already sends the WHOLE
   * document every turn, so a note written here is in front of the model
   * forever at no extra plumbing cost. The document is the per-turn context.
   *
   * PURELY ADVISORY. No renderer reads it: `styles.ts`, `render.ts`,
   * `resolve.ts` and the publish gate are all untouched. It changes what the
   * MODEL does, never what the page emits — and `/go/<slug>` renders
   * `funnel_step_versions.nodes`/`.css`, never `project_data`, so it is not
   * visitor-visible. (It IS copied into the version row by `publishStep`,
   * like the rest of the document.)
   *
   * 400 characters: a paragraph. Enough for "Warm sand palette, editorial
   * serif headings, generous spacing, photography-led" plus a line of intent;
   * short enough that it cannot become a second document smuggled into the
   * theme. It is a note, not a brief — and it costs context on EVERY future
   * turn, so the cost is permanent.
   *
   * OPTIONAL, like every key above it, for the reason their shared comment
   * gives: a required key fails every existing stored draft, not a migration.
   */
  designNote: z.string().max(400).optional(),
```

No change is needed to `sectionDocThemePatchSchema` — it derives from this shape.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run __tests__/lib/funnels/sections/registry.test.ts __tests__/lib/funnels/sections/apply.test.ts __tests__/lib/funnels/sections/doc.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/registry.ts __tests__/lib/funnels/sections/registry.test.ts
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "feat(builder): add an optional theme.designNote the model can write"
```

---

## Task 4: The request schema — an optional image, never stored

**Files:**
- Modify: `lib/validators/funnel.ts:372-381` (`buildMessageRequestSchema`)
- Modify: `app/api/admin/funnels/steps/[stepId]/build/route.ts` (~line 645-650, ~line 1218, `runBuildTurn` / `runTurn` / `streamOneAttempt`)
- Test: `__tests__/app/api/admin/funnels/build-route.test.ts`

**Interfaces:**
- Consumes: `BUILDER_REFERENCE_IMAGE_MEDIA_TYPES`, `BUILDER_REFERENCE_IMAGE_MAX_BASE64` (Task 1); `AgentImage` (Task 2).
- Produces: request body field `image?: { mediaType: BuilderReferenceImageMediaType; data: string }`; the route passes `images: [image]` to `streamAgent` and passes **only** `message` to `appendTurn`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/app/api/admin/funnels/build-route.test.ts` (inside the existing top-level `describe`, reusing the file's `runTurn`, `req`, `ctx`, `mock`, `doc`, `POST` helpers):

```ts
describe("a pasted reference image (2026-09-14 spec §4)", () => {
  const IMAGE = { mediaType: "image/jpeg", data: "QUJDREVG" }

  it("reaches streamAgent as an images option", async () => {
    await runTurn({ message: "match this look", revision: 4, image: IMAGE })
    // The claim is the ARGUMENT, not that the call happened. The mutant is a
    // route that validates the image and then forgets to forward it — the
    // feature would be silently text-only with a working UI.
    const options = mock(streamAgent).mock.calls[0][3] as { images?: unknown }
    expect(options.images).toEqual([{ mediaType: "image/jpeg", data: "QUJDREVG" }])
  })

  it("passes NO images option when the body carries no image", async () => {
    await runTurn({ message: "make it shorter", revision: 4 })
    const options = mock(streamAgent).mock.calls[0][3] as { images?: unknown }
    expect(options.images).toBeUndefined()
  })

  // THE PRIVACY CLAIM, asserted against every argument rather than one field.
  // A brand board is private commercial material and a competitor screenshot
  // is someone else's copyright; neither becomes a row.
  it("never writes the image to the turn log", async () => {
    await runTurn({ message: "match this look", revision: 4, image: IMAGE })
    expect(mock(appendTurn)).toHaveBeenCalled()
    for (const call of mock(appendTurn).mock.calls) {
      expect(JSON.stringify(call)).not.toContain("QUJDREVG")
    }
    // ...and the control: the owner's own words DO reach it, so the assertion
    // above is not passing because appendTurn was called with nothing useful.
    const userCall = mock(appendTurn).mock.calls.find(
      (call) => (call[0] as { role?: string }).role === "user",
    )
    expect((userCall?.[0] as { message?: string })?.message).toBe("match this look")
  })

  it("rejects a media type Anthropic cannot read", async () => {
    const res = await POST(req({ message: "hi", revision: 4, image: { mediaType: "image/avif", data: "QQ" } }), ctx)
    expect(res.status).toBe(400)
    expect(mock(streamAgent)).not.toHaveBeenCalled()
  })

  it("rejects a non-image media type outright", async () => {
    const res = await POST(req({ message: "hi", revision: 4, image: { mediaType: "text/html", data: "QQ" } }), ctx)
    expect(res.status).toBe(400)
  })

  it("accepts each of the four allowed media types", async () => {
    // Derived from the allowlist constant, NOT a hand-listed table — a
    // hand-maintained "known-good pairs" table is where four bugs hid last
    // session.
    for (const mediaType of BUILDER_REFERENCE_IMAGE_MEDIA_TYPES) {
      vi.clearAllMocks()
      mock(auth).mockResolvedValue(freshAdmin())
      mock(canAccessAdminPath).mockResolvedValue(true)
      const res = await POST(req({ message: "hi", revision: 4, image: { mediaType, data: "QQ" } }), ctx)
      expect(res.status, `${mediaType} should be accepted`).not.toBe(400)
    }
  })

  it("rejects a payload one character over the cap", async () => {
    const res = await POST(
      req({
        message: "hi",
        revision: 4,
        image: { mediaType: "image/png", data: "A".repeat(BUILDER_REFERENCE_IMAGE_MAX_BASE64 + 1) },
      }),
      ctx,
    )
    expect(res.status).toBe(400)
  })
})
```

Add to that file's imports: `BUILDER_REFERENCE_IMAGE_MEDIA_TYPES, BUILDER_REFERENCE_IMAGE_MAX_BASE64` from `@/lib/funnels/sections/builder-config`.

**Note for the implementer:** the `beforeEach` in this file re-seeds every mock. The loop test above re-seeds only `auth`/`canAccessAdminPath` after `clearAllMocks`, so it asserts only "not 400" — a later mock being empty is fine for a validation-layer claim. Do not widen it to assert a 200.

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
npx vitest run __tests__/app/api/admin/funnels/build-route.test.ts -t "reference image"
```
Expected: FAIL — the schema strips `image`, so `options.images` is `undefined` and the avif/oversize bodies return 200 rather than 400.

- [ ] **Step 3: Write minimal implementation**

In `lib/validators/funnel.ts`, import the two constants and add to `buildMessageRequestSchema`, after `revision`:

```ts
  /**
   * A PASTED REFERENCE DESIGN, for this turn only (2026-09-14 spec §4).
   *
   * TRANSIENT MEANS TRANSIENT. This never becomes a stored object: not a row
   * in `funnel_step_turns` (the route passes only `message` to `appendTurn`),
   * not a file in Firebase Storage (which exists to make funnel media PUBLICLY
   * READABLE FOREVER — precisely the wrong property for a private brand board
   * or someone else's copyrighted page), and not a document field (which would
   * be published to anonymous visitors). It lives in one request body, is
   * handed to the model, and is garbage after the response.
   *
   * `data` is bare base64 with no `data:` prefix. The media-type allowlist and
   * the cap are IMPORTED, never restated — see `builder-config.ts` for which
   * list this is and why it is NOT the funnel-image upload route's list.
   *
   * Optional, so the documented `{message, revision}` body keeps working
   * verbatim; it appears on exactly one member of `buildRequestSchema` and
   * carries no `action` literal, so it cannot make a body match two members.
   */
  image: z
    .object({
      mediaType: z.enum(BUILDER_REFERENCE_IMAGE_MEDIA_TYPES),
      data: z.string().min(1).max(BUILDER_REFERENCE_IMAGE_MAX_BASE64),
    })
    .optional(),
```

In the build route:

1. At the `buildMessageRequestSchema` branch (~line 645), pass the image through:
```ts
        message: parsed.data.message,
        expectedRevision: parsed.data.revision,
        referenceImage: parsed.data.image,
```
2. Add `referenceImage?: { mediaType: string; data: string }` to `runBuildTurn`'s options type, and thread it — **unchanged** — through `runTurn` and into `streamOneAttempt`'s options.
3. In `streamOneAttempt`, pass it to `streamAgent`:
```ts
  const stream = streamAgent(opts.systemPrompt, opts.turnMessage, buildResultSchema, {
    model: SECTION_BUILDER_MODEL,
    maxTokens: opts.maxTokens,
    cacheSystemPrompt: true,
    // ONE image, this turn only. Absent when the owner attached nothing, so
    // the request shape is unchanged for the overwhelming majority of turns.
    ...(opts.referenceImage ? { images: [opts.referenceImage] } : {}),
  })
```
4. **Do not touch the `appendTurn` call.** It already receives `message` only; that is the privacy guarantee and it is enforced by leaving it alone.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run __tests__/app/api/admin/funnels/build-route.test.ts
npx tsc --noEmit 2>&1 | grep -E "validators/funnel|funnels/steps" || echo "no new errors"
```
Expected: PASS (all pre-existing tests in that file still green).

- [ ] **Step 5: Commit**

```bash
git add lib/validators/funnel.ts "app/api/admin/funnels/steps/[stepId]/build/route.ts" __tests__/app/api/admin/funnels/build-route.test.ts
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "feat(builder): accept a transient reference image on the build route"
```

---

## Task 5: The browser-side downscale

**Files:**
- Create: `lib/funnels/reference-image.ts`
- Create: `__tests__/lib/funnels/reference-image.test.ts`

**Interfaces:**
- Consumes: `BUILDER_REFERENCE_IMAGE_MAX_EDGE`, `BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES`, `BUILDER_REFERENCE_IMAGE_MEDIA_TYPES` (Task 1).
- Produces:
  - `export interface ReferenceImage { mediaType: BuilderReferenceImageMediaType; data: string; name: string; bytes: number }`
  - `export function scaledDimensions(w: number, h: number, maxEdge?: number): { width: number; height: number }`
  - `export function referenceImageRejection(file: { type: string; size: number }): string | null`
  - `export async function prepareReferenceImage(file: File): Promise<ReferenceImage>` (throws `Error` with the sentence from `referenceImageRejection`)

Task 6's `ChatPane` calls `referenceImageRejection` and `prepareReferenceImage`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/funnels/reference-image.test.ts`:

```ts
// The browser-side downscale (2026-09-14 spec §5).
//
// `scaledDimensions` and `referenceImageRejection` are split out as pure
// functions precisely so the ARITHMETIC and the GATE can be tested without a
// canvas — jsdom has no real 2D context, so a test that went through
// `prepareReferenceImage` could only ever assert that a stub was called.
import { describe, it, expect } from "vitest"
import { scaledDimensions, referenceImageRejection } from "@/lib/funnels/reference-image"
import {
  BUILDER_REFERENCE_IMAGE_MAX_EDGE,
  BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES,
} from "@/lib/funnels/sections/builder-config"

describe("scaledDimensions", () => {
  it("leaves an image already inside the bound completely alone", () => {
    // Not merely "small enough" — the EXACT same numbers back. Re-encoding a
    // small PNG costs quality for nothing.
    expect(scaledDimensions(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it("leaves an image sitting exactly on the bound alone", () => {
    const e = BUILDER_REFERENCE_IMAGE_MAX_EDGE
    expect(scaledDimensions(e, 400)).toEqual({ width: e, height: 400 })
  })

  it("scales a landscape image by its WIDTH and keeps the aspect ratio", () => {
    // 3840x2160 -> 1568 wide. 2160 * (1568/3840) = 882.
    expect(scaledDimensions(3840, 2160)).toEqual({ width: 1568, height: 882 })
  })

  it("scales a PORTRAIT image by its HEIGHT, not its width", () => {
    // The mutant: scaling on `width` unconditionally, which leaves a tall
    // screenshot far over the bound on its long edge — the exact case a phone
    // screenshot or a full-page capture produces.
    expect(scaledDimensions(1080, 3840)).toEqual({ width: 441, height: 1568 })
  })

  it("never produces a zero dimension for an extreme aspect ratio", () => {
    // 20000x3 would round to height 0 and `drawImage` would throw.
    const { width, height } = scaledDimensions(20000, 3)
    expect(width).toBe(1568)
    expect(height).toBeGreaterThanOrEqual(1)
  })
})

describe("referenceImageRejection", () => {
  it("passes a normal screenshot", () => {
    expect(referenceImageRejection({ type: "image/png", size: 400_000 })).toBeNull()
  })

  it("rejects a type the model cannot read, naming what IS accepted", () => {
    const message = referenceImageRejection({ type: "image/avif", size: 1000 })
    expect(message).toBeTruthy()
    // The owner must be told what to do, not merely that they were wrong.
    expect(message).toMatch(/JPEG|PNG/i)
  })

  it("rejects a non-image outright", () => {
    expect(referenceImageRejection({ type: "application/pdf", size: 1000 })).toBeTruthy()
  })

  it("rejects a file over the source bound BEFORE any decoding", () => {
    const message = referenceImageRejection({
      type: "image/png",
      size: BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES + 1,
    })
    expect(message).toBeTruthy()
  })

  it("accepts a file sitting exactly on the source bound", () => {
    // The bound is probed at its edge in both directions, so an off-by-one
    // that rejects a legal file is visible.
    expect(
      referenceImageRejection({ type: "image/png", size: BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES }),
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
npx vitest run __tests__/lib/funnels/reference-image.test.ts
```
Expected: FAIL — module `@/lib/funnels/reference-image` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `lib/funnels/reference-image.ts`:

```ts
// lib/funnels/reference-image.ts — preparing a pasted reference design for the
// builder chat (2026-09-14 spec §5).
//
// WHY THE BROWSER DOES THE RESIZING. Claude downscales every image to ~1568px
// on the long edge before the model sees it, so sending more pixels costs
// upload time and request size and buys nothing — the extra pixels are
// discarded server-side. `app/api/upload/funnel-image/route.ts` already reasons
// this way for width/height: "The browser already has the decoded image, so it
// is the cheapest correct place to measure; the alternative is an
// image-processing dependency on the server to re-derive what the picker
// already knew." That argument applies with more force to resizing — the
// server alternative is a `sharp`-class dependency in a Next.js route.
//
// Typical saving on a 4K screenshot: ~10x.
//
// `scaledDimensions` and `referenceImageRejection` are pure and exported
// SEPARATELY from `prepareReferenceImage` on purpose: jsdom has no real 2D
// canvas context, so a test driven through the async path could only assert
// that a stub was called. The arithmetic and the gate are where the bugs are,
// and they are testable on their own.

import {
  BUILDER_REFERENCE_IMAGE_MAX_EDGE,
  BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES,
  BUILDER_REFERENCE_IMAGE_MEDIA_TYPES,
  type BuilderReferenceImageMediaType,
} from "@/lib/funnels/sections/builder-config"

/** One prepared reference image, ready for the build route's request body. */
export interface ReferenceImage {
  mediaType: BuilderReferenceImageMediaType
  /** Bare base64 — no `data:<type>;base64,` prefix. */
  data: string
  /** For the chip in the composer, so the owner can see what they attached. */
  name: string
  /** Decoded byte length AFTER downscale, for the chip's size label. */
  bytes: number
}

/**
 * The target box, preserving the aspect ratio.
 *
 * Scales on the LONG edge, whichever it is. Scaling on `width` unconditionally
 * would leave a tall screenshot — a phone capture, a full-page grab, exactly
 * what an owner pastes — far over the bound on the edge that matters.
 *
 * `Math.max(1, ...)` because an extreme aspect ratio (20000x3) rounds the short
 * edge to 0, and `drawImage` throws on a zero-sized canvas.
 */
export function scaledDimensions(
  width: number,
  height: number,
  maxEdge: number = BUILDER_REFERENCE_IMAGE_MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Why this file cannot be used, in a sentence an owner can act on — or `null`.
 *
 * Checked BEFORE decoding, which is the whole point of the source bound: a
 * 200 MB TIFF should fail immediately with a sentence rather than hang the tab
 * on a canvas draw that was always going to be rejected.
 */
export function referenceImageRejection(file: { type: string; size: number }): string | null {
  if (!(BUILDER_REFERENCE_IMAGE_MEDIA_TYPES as readonly string[]).includes(file.type)) {
    return "That file can't be read as a reference. Use a JPEG, PNG, WebP or GIF."
  }
  if (file.size > BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES) {
    return "That image is too large. Try one under 10 MB."
  }
  return null
}

/** `Blob` -> bare base64, with the `data:<type>;base64,` prefix stripped. */
async function toBareBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("That image could not be read."))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
  const comma = dataUrl.indexOf(",")
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
}

/**
 * Decode, downscale if needed, and encode for the wire.
 *
 * An image already inside the bound keeps its ORIGINAL BYTES and media type —
 * re-encoding a small PNG costs quality for nothing.
 *
 * The canvas is filled WHITE before `drawImage`. A PNG with an alpha channel
 * flattens onto black otherwise, and a brand board with a transparent
 * background should read as ink-on-white, not ink-on-black.
 */
export async function prepareReferenceImage(file: File): Promise<ReferenceImage> {
  const rejection = referenceImageRejection(file)
  if (rejection) throw new Error(rejection)

  const bitmap = await createImageBitmap(file)
  try {
    const target = scaledDimensions(bitmap.width, bitmap.height)
    if (target.width === bitmap.width && target.height === bitmap.height) {
      return {
        mediaType: file.type as BuilderReferenceImageMediaType,
        data: await toBareBase64(file),
        name: file.name || "reference",
        bytes: file.size,
      }
    }

    const canvas = document.createElement("canvas")
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("That image could not be prepared in this browser.")
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, target.width, target.height)
    context.drawImage(bitmap, 0, 0, target.width, target.height)

    const blob = await new Promise<Blob | null>((resolve) =>
      // JPEG: a photographed or screenshotted reference is continuous-tone, and
      // the vision endpoint takes it everywhere. The media type is jpeg
      // regardless of what went in.
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.85),
    )
    if (!blob) throw new Error("That image could not be prepared in this browser.")

    return {
      mediaType: "image/jpeg",
      data: await toBareBase64(blob),
      name: file.name || "reference",
      bytes: blob.size,
    }
  } finally {
    bitmap.close()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run __tests__/lib/funnels/reference-image.test.ts
npx tsc --noEmit 2>&1 | grep -E "reference-image" || echo "no new errors"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/reference-image.ts __tests__/lib/funnels/reference-image.test.ts
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "feat(builder): downscale a pasted reference image in the browser"
```

---

## Task 6: The chat UI and the theme panel field

**Files:**
- Modify: `components/admin/funnels/builder/ChatPane.tsx`
- Modify: `components/admin/funnels/builder/types.ts:131` (the `owner` message member)
- Modify: `components/admin/funnels/FunnelBuilder.tsx:785` (`send`), `:2252` (`onSend={send}`)
- Modify: `components/admin/funnels/builder/ThemePanel.tsx`
- Create: `__tests__/components/admin/builder/reference-image-chat.test.tsx`
- Test: `__tests__/components/admin/funnels/ThemePanel.test.tsx`

**Interfaces:**
- Consumes: `ReferenceImage`, `prepareReferenceImage`, `referenceImageRejection` (Task 5); `SectionDocThemePatch.designNote` (Task 3).
- Produces: `ChatPane`'s `onSend: (text: string, image?: ReferenceImage) => void`; `BuilderMessage`'s owner member gains `hadReferenceImage?: boolean`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/builder/reference-image-chat.test.tsx`:

```tsx
// @vitest-environment jsdom
// Pasting a reference design into the builder chat (2026-09-14 spec §5.4).
//
// `prepareReferenceImage` is mocked because jsdom has no real 2D canvas
// context — its own arithmetic is tested directly in
// `__tests__/lib/funnels/reference-image.test.ts`. What is under test HERE is
// the composer's state machine: stage, show, replace, clear, and hand to
// `onSend`. Each assertion names the mutant it kills.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ChatPane } from "@/components/admin/funnels/builder/ChatPane"

const prepareReferenceImage = vi.fn()
vi.mock("@/lib/funnels/reference-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/funnels/reference-image")>()),
  prepareReferenceImage: (...args: unknown[]) => prepareReferenceImage(...args),
}))

const onSend = vi.fn()
const onChange = vi.fn()

const PREPARED = { mediaType: "image/jpeg", data: "QUJD", name: "brand-board.png", bytes: 120_000 }
const SECOND = { mediaType: "image/jpeg", data: "WFla", name: "competitor.png", bytes: 90_000 }

function mount(value = "match this look") {
  return render(
    <ChatPane
      messages={[]}
      maxMessageLength={2000}
      value={value}
      onChange={onChange}
      onSend={onSend}
      busy={false}
      currentRevision={1}
      funnelKind="funnel"
      funnelId="funnel-1"
    />,
  )
}

/** A paste carrying one image file, shaped the way a real clipboard is. */
function pasteImage(name = "brand-board.png") {
  const file = new File(["bytes"], name, { type: "image/png" })
  fireEvent.paste(screen.getByLabelText(/describe the change/i), {
    clipboardData: { files: [file], items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  prepareReferenceImage.mockResolvedValue(PREPARED)
})

describe("attaching a reference image", () => {
  it("a pasted image is staged and shown by name", async () => {
    mount()
    pasteImage()
    // The mutant: preparing the image and never rendering it. The owner would
    // have no way to see what they attached or take it back before spending a
    // turn on it.
    expect(await screen.findByText(/brand-board\.png/)).toBeTruthy()
  })

  it("sending hands the prepared image to onSend alongside the text", async () => {
    mount("match this look")
    pasteImage()
    await screen.findByText(/brand-board\.png/)
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }))
    // Asserts WHICH value, not that a second argument exists.
    expect(onSend).toHaveBeenCalledWith("match this look", PREPARED)
  })

  it("sending with NO image passes text only", async () => {
    mount("make it shorter")
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }))
    expect(onSend).toHaveBeenCalledWith("make it shorter", undefined)
  })

  it("the chip clears after send", async () => {
    mount()
    pasteImage()
    await screen.findByText(/brand-board\.png/)
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }))
    // An image is attached to a TURN, not to the session. Leaving it pinned
    // would silently re-send it on every later turn, spending vision tokens
    // the owner did not ask for.
    await waitFor(() => expect(screen.queryByText(/brand-board\.png/)).toBeNull())
  })

  it("a second attachment REPLACES the first rather than accumulating", async () => {
    mount()
    pasteImage("brand-board.png")
    await screen.findByText(/brand-board\.png/)
    prepareReferenceImage.mockResolvedValue(SECOND)
    pasteImage("competitor.png")
    await screen.findByText(/competitor\.png/)
    // The route takes ONE image. A UI that let a second accumulate would
    // silently drop one.
    expect(screen.queryByText(/brand-board\.png/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }))
    expect(onSend).toHaveBeenCalledWith("match this look", SECOND)
  })

  it("the remove control takes the image back off the turn", async () => {
    mount()
    pasteImage()
    await screen.findByText(/brand-board\.png/)
    fireEvent.click(screen.getByRole("button", { name: /remove reference image/i }))
    expect(screen.queryByText(/brand-board\.png/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }))
    expect(onSend).toHaveBeenCalledWith("match this look", undefined)
  })

  it("a rejected file is explained and nothing is staged", async () => {
    mount()
    const file = new File(["x"], "sheet.pdf", { type: "application/pdf" })
    fireEvent.paste(screen.getByLabelText(/describe the change/i), {
      clipboardData: { files: [file], items: [{ kind: "file", type: "application/pdf", getAsFile: () => file }] },
    })
    expect(await screen.findByText(/JPEG|PNG/i)).toBeTruthy()
    // A degrading helper turning a rejection into a silent no-op is the trap
    // this repo has already paid for in the recorder library.
    expect(prepareReferenceImage).not.toHaveBeenCalled()
  })

  it("a plain text paste is left completely alone", async () => {
    mount()
    fireEvent.paste(screen.getByLabelText(/describe the change/i), {
      clipboardData: { files: [], items: [{ kind: "string", type: "text/plain" }] },
    })
    // The mutant: a handler that calls preventDefault unconditionally, which
    // would break ordinary copy-paste into the composer.
    expect(prepareReferenceImage).not.toHaveBeenCalled()
  })

  it("offers a file picker as well as paste", () => {
    mount()
    // Paste does not exist on a tablet and is not discoverable on a desktop.
    expect(screen.getByLabelText(/attach a reference image/i)).toBeTruthy()
  })
})
```

Append to `__tests__/components/admin/funnels/ThemePanel.test.tsx`:

```tsx
describe("the design-direction note", () => {
  it("shows the note the document is carrying", () => {
    render(
      <ThemePanel
        theme={{ ...theme, designNote: "Warm sand palette, editorial serif." }}
        onChange={noop}
        brandKit={null}
      />,
    )
    expect((screen.getByLabelText(/design direction/i) as HTMLTextAreaElement).value).toBe(
      "Warm sand palette, editorial serif.",
    )
  })

  it("commits ONE patch on blur, not one per keystroke", async () => {
    const onChange = vi.fn()
    render(<ThemePanel theme={theme} onChange={onChange} brandKit={null} />)
    const field = screen.getByLabelText(/design direction/i)
    await userEvent.type(field, "Serif")
    // The mutant: a controlled textarea firing `onChange` per character. Every
    // one is a `set_theme` op — one turn, one revision, one row in
    // `funnel_step_turns` — PER LETTER.
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.tab()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ designNote: "Serif" })
  })

  it("an emptied box clears the note with null, not an empty string", async () => {
    const onChange = vi.fn()
    render(<ThemePanel theme={{ ...theme, designNote: "Serif" }} onChange={onChange} brandKit={null} />)
    await userEvent.clear(screen.getByLabelText(/design direction/i))
    await userEvent.tab()
    // `""` is a field the model reads as "the direction is: nothing", which is
    // not what an owner who cleared the box meant. `null` is the delete
    // sentinel `sectionDocThemePatchSchema` derives for every optional key.
    expect(onChange).toHaveBeenCalledWith({ designNote: null })
  })

  it("sends nothing when the note was not actually changed", async () => {
    const onChange = vi.fn()
    render(<ThemePanel theme={{ ...theme, designNote: "Serif" }} onChange={onChange} brandKit={null} />)
    await userEvent.click(screen.getByLabelText(/design direction/i))
    await userEvent.tab()
    // A blur that always patches would burn a revision for a stray click.
    expect(onChange).not.toHaveBeenCalled()
  })

  it("stops the owner at the schema's own bound rather than after the fact", () => {
    render(<ThemePanel theme={theme} onChange={noop} brandKit={null} />)
    expect(screen.getByLabelText(/design direction/i).getAttribute("maxlength")).toBe("400")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
npx vitest run __tests__/components/admin/builder/reference-image-chat.test.tsx __tests__/components/admin/funnels/ThemePanel.test.tsx
```
Expected: FAIL — no paste handler, no picker, no chip, no "Design direction" field.

- [ ] **Step 3: Write minimal implementation**

**`components/admin/funnels/builder/types.ts`** — add to the `owner` member:
```ts
  | ({ id: string; role: "owner"; text: string; hadReferenceImage?: boolean } & Restorable)
```

**`components/admin/funnels/builder/ChatPane.tsx`:**
- Import `useState`, `Paperclip`/`X` from lucide-react, and `prepareReferenceImage`, `referenceImageRejection`, `type ReferenceImage` from `@/lib/funnels/reference-image`.
- Change the prop to `onSend: (text: string, image?: ReferenceImage) => void`.
- Add state: `const [image, setImage] = useState<ReferenceImage | null>(null)` and `const [imageError, setImageError] = useState<string | null>(null)`.
- Add an `attach` helper:
```ts
  // ONE image per turn. A second attachment REPLACES the first rather than
  // accumulating: the route takes one, so a UI that let two pile up would
  // silently drop one.
  const attach = async (file: File) => {
    const rejection = referenceImageRejection(file)
    if (rejection) {
      setImageError(rejection)
      setImage(null)
      return
    }
    setImageError(null)
    try {
      setImage(await prepareReferenceImage(file))
    } catch (error) {
      // LOUD, not a silent no-op. A helper that degrades politely turns a
      // broken effect into nothing happening, which is indistinguishable from
      // the owner mis-clicking.
      setImageError(error instanceof Error ? error.message : "That image could not be attached.")
      setImage(null)
    }
  }
```
- On the textarea, add:
```tsx
          onPaste={(event) => {
            // Only intervene for an image. A handler that called
            // preventDefault unconditionally would break ordinary text paste
            // into the composer.
            const file = Array.from(event.clipboardData?.files ?? []).find((candidate) =>
              candidate.type.startsWith("image/"),
            )
            if (!file) return
            event.preventDefault()
            void attach(file)
          }}
```
- Above the textarea, render the chip when `image` is set — the file name, `Math.round(image.bytes / 1024)} KB`, and a remove button with `aria-label="Remove reference image"` calling `setImage(null)`. Render `imageError` as a `text-[var(--error)]` line when set.
- Beside Send, a paperclip button over a visually-hidden input:
```tsx
            <label className="inline-flex cursor-pointer items-center" aria-label="Attach a reference image">
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={busy || composerDisabled}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void attach(file)
                  // Cleared so re-picking the SAME file fires a change event.
                  event.target.value = ""
                }}
              />
              <span className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-accent">
                <Paperclip className="size-4" aria-hidden />
              </span>
            </label>
```
- Route every send through one helper that clears the chip:
```ts
  // The chip clears on send, like the composer text. An image is attached to a
  // TURN, not to the session — leaving it pinned would silently re-send it on
  // every later turn, spending vision tokens the owner did not ask for and
  // confusing "make the headline bolder" with a fresh brief.
  const submit = (text: string) => {
    onSend(text, image ?? undefined)
    setImage(null)
    setImageError(null)
  }
```
Use `submit(value)` for the Send button and the `Enter` key. **Leave the starter chips and `MessageCard`'s `onSend` on the raw `onSend`** — the chips are complete first messages and should not silently consume a staged image.
- In `MessageCard`'s `owner` branch, under the text:
```tsx
        {message.hadReferenceImage ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Paperclip className="size-3 shrink-0" aria-hidden />
            Reference image attached
          </p>
        ) : null}
```

**`components/admin/funnels/FunnelBuilder.tsx`:**
- `const send = useCallback(async (text: string, image?: ReferenceImage) => {`
- In the optimistic message: `{ id: optimisticId, role: "owner", text: trimmed, hadReferenceImage: image !== undefined }`
- In the POST body: `body: JSON.stringify({ message: trimmed, revision, ...(image ? { image: { mediaType: image.mediaType, data: image.data } } : {}) })` — **only `mediaType` and `data`; `name` and `bytes` are chip-only and the schema does not accept them.**
- Add `image` to nothing in the dependency array (it is an argument, not state).

**`components/admin/funnels/builder/ThemePanel.tsx`** — add, inside the grid after the "Section rhythm" select:
```tsx
        <DesignNoteField value={theme.designNote} disabled={busy} onChange={onChange} />
```
and the component:
```tsx
/**
 * "Design direction" — the page's own note about what its look is based on.
 *
 * COMMITTED ON BLUR, NOT PER KEYSTROKE, and this is the whole reason it is a
 * component rather than three inline lines. Every other control in this panel
 * is a `<select>` that fires once; a controlled textarea calling `onChange` per
 * character would emit one `set_theme` op — one turn, one revision, one row in
 * `funnel_step_turns` — PER LETTER.
 *
 * An emptied box sends `null`, the delete sentinel
 * `sectionDocThemePatchSchema` derives for every optional key — not `""`,
 * which the model would read as "the direction is: nothing".
 */
function DesignNoteField({
  value,
  disabled,
  onChange,
}: {
  value: string | undefined
  disabled: boolean
  onChange: (patch: SectionDocThemePatch) => void
}) {
  const [draft, setDraft] = useState(value ?? "")

  // Re-sync when the document changes underneath (an AI turn wrote a note).
  useEffect(() => {
    setDraft(value ?? "")
  }, [value])

  return (
    <div className="col-span-2 space-y-1.5">
      <Label htmlFor="theme-design-note" className="text-xs uppercase tracking-wide text-muted-foreground">
        Design direction
      </Label>
      <textarea
        id="theme-design-note"
        value={draft}
        maxLength={400}
        rows={3}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = draft.trim()
          const current = value ?? ""
          if (next === current) return
          onChange({ designNote: next === "" ? null : next })
        }}
        className="w-full resize-none rounded-xl border border-border bg-white p-2 text-sm shadow-sm outline-none focus-visible:border-accent disabled:opacity-50"
      />
      <p className="text-xs text-muted-foreground">
        What this page&rsquo;s look is based on. The AI reads this on every change.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run __tests__/components/admin/builder/ __tests__/components/admin/funnels/ __tests__/components/admin/funnel-builder.test.tsx
npx tsc --noEmit 2>&1 | grep -E "ChatPane|ThemePanel|FunnelBuilder" || echo "no new errors"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/admin/funnels/ __tests__/components/admin/builder/reference-image-chat.test.tsx __tests__/components/admin/funnels/ThemePanel.test.tsx
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "feat(builder): paste a reference image into chat and read the design note"
```

---

## Task 7: The prompt — compact, then raise by the measured remainder

**Files:**
- Modify: `lib/funnels/sections/prompt.ts:877-937` (`SECTION_BUILDER_BLOCK_DESIGN`)
- Modify: `lib/funnels/sections/builder-config.ts` (`SECTION_BUILDER_BLOCK_DESIGN_MAX`)
- Test: `__tests__/lib/funnels/sections/prompt.test.ts`

**Interfaces:**
- Consumes: `theme.designNote` (Task 3).
- Produces: no new exports. Block DESIGN gains reference-image instructions; `SECTION_BUILDER_BLOCK_DESIGN_MAX` is raised by a **measured** amount.

**Procedure — follow in this order, it is the house procedure:**
1. Measure Block DESIGN as it stands.
2. **Compact the existing prose first.** Record the saving.
3. Write the new instructions.
4. Measure again. Raise the ceiling by the measured remainder — **never a round number chosen in advance**.
5. Write the reason into the test beside the existing raise notes, in Block A's raise-history style.
6. Report before/after numbers.

`SECTION_BUILDER_BLOCK_A_MAX` is **not** touched.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/funnels/sections/prompt.test.ts`:

```ts
describe("the reference-image instructions (2026-09-14 spec §7)", () => {
  it("tell the model what to read an attached image FOR", () => {
    // The five things the typed vocabulary can actually express, plus the page
    // shape. Asserted as concepts the block must name, not as one exact
    // sentence, so rewording the prose does not go red for no reason.
    expect(SECTION_BUILDER_BLOCK_DESIGN).toMatch(/reference|attach/i)
    for (const knob of ["palette", "font", "density", "width", "rhythm"]) {
      expect(SECTION_BUILDER_BLOCK_DESIGN, `block must name ${knob}`).toContain(knob)
    }
  })

  it("tell the model to record what it took in theme.designNote", () => {
    expect(SECTION_BUILDER_BLOCK_DESIGN).toContain("designNote")
  })

  it("tell the model to say what it could NOT match", () => {
    // The owner explicitly chose this honesty over silently approximating. A
    // page that quietly dropped the thing the owner was pointing at teaches
    // them the AI is bad at its job.
    expect(SECTION_BUILDER_BLOCK_DESIGN).toMatch(/could ?n[o']t|cannot|can't/i)
  })

  it("keeps ALL of it out of Block A, which has no headroom", () => {
    expect(SECTION_BUILDER_BLOCK_A).not.toContain("designNote")
    expect(SECTION_BUILDER_BLOCK_A.length).toBeLessThan(SECTION_BUILDER_BLOCK_A_MAX)
  })

  // THE CACHE CLAIM. The instructions are unconditionally present and
  // conditionally relevant ("when the owner attaches a reference image…"),
  // never conditionally rendered — the system prompt is a cached prefix and
  // Anthropic's cache is a strict prefix match, so anything per-turn in it is
  // a silent invalidator on every turn of every page, including the vast
  // majority that carry no image at all.
  it("does not make the system prompt depend on whether an image is attached", () => {
    const first = buildSystemPrompt(input)
    const second = buildSystemPrompt(input)
    expect(first).toBe(second)
    // There is no image-shaped input to `buildSystemPrompt` AT ALL, which is
    // the structural guarantee behind the byte-stability above.
    expect(Object.keys(input)).not.toContain("image")
    expect(Object.keys(input)).not.toContain("images")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
npx vitest run __tests__/lib/funnels/sections/prompt.test.ts -t "reference-image"
```
Expected: FAIL — Block DESIGN contains no `designNote` and no reference wording.

- [ ] **Step 3: Measure, compact, write, measure**

Measure first:
```bash
npx tsx -e 'import {SECTION_BUILDER_BLOCK_A, SECTION_BUILDER_BLOCK_DESIGN} from "./lib/funnels/sections/prompt"; console.log("A", SECTION_BUILDER_BLOCK_A.length, "DESIGN", SECTION_BUILDER_BLOCK_DESIGN.length)'
```
Expected before any edit: `A 20638 DESIGN 3202`.

Compact the existing Block DESIGN prose — the `theme.palette` paragraph and the font-pairing list carry the most redundancy (each pairing restates "for a …" in a full clause; the palette paragraph explains the twelve presets twice). **Do not delete a rule.** Re-measure and record the saving.

Then append to `SECTION_BUILDER_BLOCK_DESIGN`:

```
## When the owner attaches a reference design

Sometimes the owner pastes an image — a screenshot, a brand board, a page they like. Read it
for the things this document can actually express, and nothing else:
- colour -> \`theme.palette\` (a preset name, or a custom \`{brand, accent, mode}\` from its hex)
- type -> \`theme.font\`; air -> \`theme.density\`; measure -> \`theme.width\`; texture down the
  page -> \`theme.rhythm\`
- what the page is SHAPED like -> which recipe, which sections, in what order

Then write what you took into \`theme.designNote\` (<=400 chars) with \`set_theme\` — one line,
plain words, e.g. "Warm sand palette, editorial serif headings, airy spacing, photo-led hero."
The image is NOT kept after this turn; that note is the only memory of it, and every later turn
reads it, so "make the headline bolder" five turns from now still respects the brief.

In \`reply\`, say BOTH halves plainly: what you matched, and what you could not. "I matched the
colours and the spacing. I couldn't match the overlapping headline — there's no way to express
that here." Never silently approximate something the vocabulary cannot say: an owner who is
told can decide what to do, an owner who is not concludes you are bad at this.

You do not copy a layout pixel for pixel and you never reuse a photograph out of the image.
```

Measure again, and set `SECTION_BUILDER_BLOCK_DESIGN_MAX` in `builder-config.ts` to the new measured length rounded UP to the next 100, updating its doc comment with the raise reason.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx -e 'import {SECTION_BUILDER_BLOCK_A, SECTION_BUILDER_BLOCK_DESIGN} from "./lib/funnels/sections/prompt"; console.log("A", SECTION_BUILDER_BLOCK_A.length, "DESIGN", SECTION_BUILDER_BLOCK_DESIGN.length)'
npx vitest run __tests__/lib/funnels/sections/prompt.test.ts __tests__/lib/funnels/sections/builder-config.test.ts
```
Expected: PASS, Block A **still 20638** (unchanged), DESIGN under its new ceiling.

Add the raise note to the ceiling test in `prompt.test.ts`, beside the existing ones:
```ts
    // RAISED TO <N> on 2026-09-14 (reference-image build). Block DESIGN was
    // compacted first — <X> characters recovered from the palette paragraph
    // and the font-pairing list, neither of which lost a rule — and the
    // ceiling was then raised by the MEASURED remainder, not a round number
    // picked in advance. What it bought is genuinely new content, not
    // duplication: the model now has to know what to read out of an attached
    // reference image, that it must record the direction in
    // `theme.designNote` (because the image itself is never kept), and that
    // it must say out loud what the vocabulary could not express. Block A is
    // untouched at 20638 — the two ceilings stay separate constants for the
    // reason builder-config.ts gives.
```

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/prompt.ts lib/funnels/sections/builder-config.ts __tests__/lib/funnels/sections/prompt.test.ts
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "feat(builder): teach the prompt to read a reference image and record what it took"
```

---

## Task 8: Full targeted verification

**Files:** none modified unless a regression is found.

- [ ] **Step 1: Run the targeted suites**

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
npx vitest run __tests__/lib/funnels __tests__/app/api/admin/funnels __tests__/components/admin __tests__/lib/db __tests__/lib/ai 2>&1 | tail -15
```
Expected: all passing. Baseline was **261 files / 3301 tests** before `__tests__/lib/ai` was added to the set and before this build's new files; the count will be higher. **Zero failures is the gate, not the count.**

- [ ] **Step 2: Compare the tsc error SET, not the count**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx tsc --noEmit 2>&1 | grep -oE "^[^(]+\(" | sed 's/($//' | sort -u > /tmp/tsc-after-files.txt
diff /tmp/tsc-baseline-files.txt /tmp/tsc-after-files.txt && echo "IDENTICAL FILE SET"
```
Expected: **238 errors**, and an identical file set. A FALLING count hides new errors too — the diff is the real gate.

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -25
```
Expected: a clean production build.

- [ ] **Step 4: Commit any fixes**

Only if Steps 1-3 found something. Otherwise no commit.

---

## Task 9: Real-app verification and docs

**Files:**
- Create: `screenshots/builder-reference-image/` (annotated PNGs + the capture script)
- Modify: `docs/builder-gaps.md` (row C3 -> `closed`)
- Modify: `JOURNAL.md` **in the main checkout, NOT here** — it is gitignored, so a JOURNAL.md written inside a worktree does not survive the merge.

- [ ] **Step 1: Start a dev server on a free port**

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
PORT=3061 npm run dev > /tmp/dev-3061.log 2>&1 &
```
**PORT 3050 IS ANOTHER CLAUDE SESSION'S DEV SERVER on a different branch — screenshotting it would photograph the wrong code.** Never pipe a dev server to `head`; it wedges the server and every route then times out.

- [ ] **Step 2: Drive the real builder with Playwright**

Sign in as admin, open a real funnel step at `/admin/funnels/<id>/edit/<stepId>`, paste a real reference image into the real composer, send, and wait on the **document** rather than a spinner — `FunnelBuilder` applies a `result` event and then holds the stream open 30-40s for a review pass that can write a SECOND, revised document. Poll until `project_data` stops changing across consecutive reads, then diff the final artifact against the database before trusting the shot.

A preview harness, a storybook, or an isolated mount **does not count**. It must be the real screen, on the real route.

- [ ] **Step 3: Capture, annotate, verify by looking**

Capture, at minimum:
1. The composer with a reference image staged (the chip).
2. The transcript showing the owner turn with "Reference image attached" and the model's reply naming what it matched and what it could not.
3. The resulting page on `/preview/<slug>`, visibly carrying the reference's direction.
4. The `ThemePanel` showing the `designNote` the model wrote.
5. A later turn ("make the headline bolder") still respecting the note — the durability claim, which is the whole point of `designNote`.

Burn numbered markers and captions **into the PNGs**; do not wrap a clean screenshot in an HTML page that draws callouts around it. Derive marker coordinates from `boundingBox() × deviceScaleFactor` and warn loudly on a missing target. Park the pointer before screenshotting — Playwright's mouse stays where it last clicked. Capture light only: admin UI is light-only. **Extract and actually view the frames before claiming it works.**

- [ ] **Step 4: Flip the gap row**

In `docs/builder-gaps.md`, change row C3's `Status` from `open` to `closed` and rewrite its "What the owner cannot do" cell to state what now exists and what is still out of scope (multiple images, storing the image, pixel-matching). **Leave C4 open** — Phase 2 was split off deliberately.

- [ ] **Step 5: Commit**

```bash
git add screenshots/builder-reference-image docs/builder-gaps.md
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "docs(builder): verify the reference-image build in the real app and close gap C3"
```

Then write the JOURNAL.md entry **in the main checkout** (dated, tagged `[Feature build-out]`, with mistakes-and-lessons), and **do not stage it**.

- [ ] **Step 6: Stop**

Do **not** push, merge, or deploy. Leave the work committed on `worktree-builder-reference-image`, green and reviewed, and report.

---

## Self-Review

**Spec coverage:** §3 transport → Task 2. §4 request + never-stored → Task 4. §5 client downscale → Tasks 5-6. §6 `designNote` schema → Task 3; panel → Task 6. §7 prompt + ceiling raise → Task 7. §9 out-of-scope → nothing builds it; Task 9 Step 4 records it. §10 tests 1-10 → Task 7 (test 1), Task 4 (2, 7, 8), Task 3 (3, 4, 5), Task 2 (6), Task 6 (9, 10), Task 5 (8, client half). §10 real-app verification → Task 9.

**Type consistency checked:** `ReferenceImage` (Task 5) is what `ChatPane` stages and `FunnelBuilder` destructures to `{mediaType, data}` for the wire (Task 6) — `name`/`bytes` are chip-only and deliberately not sent. `AgentImage` (Task 2) is `{mediaType, data}`, matching what the route forwards (Task 4). `SectionDocThemePatch.designNote` is `string | null` in the patch and `string | undefined` on the stored theme (Task 3), which is what `DesignNoteField` emits and reads (Task 6).

**Known non-placeholder gap, stated deliberately:** Task 7 Step 3 says *which* prose to compact and *why*, but the exact compacted wording is left to the implementer and then measured — a plan cannot pre-compute a character count for text it has not written, and inventing one would produce exactly the "round number picked in advance" the house procedure forbids.
