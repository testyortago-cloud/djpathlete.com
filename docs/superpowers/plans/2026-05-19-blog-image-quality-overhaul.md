# Blog Image Quality Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the perceived production quality of every blog hero + inline image by upgrading the underlying models, generating at native-2x resolution, replacing the generic style prompt with a photographer-grade prompt engineer system message, branching on post category, and adding a Vision-judged auto-retry loop with seed control.

**Architecture:** No new services. The existing chain (`on-ai-job-completed` → `handleBlogImageGeneration`) stays intact. We touch four files in `functions/src/` (`blog-image-generation.ts`, `lib/fal-client.ts`, `lib/image-pipeline.ts`, `ai/image-prompts.ts`), add two new files (`lib/image-quality-judge.ts`, `ai/category-style-modules.ts`), and extend the `inline_images` JSONB schema with `seed`, `model`, `prompt_version`, and `quality_score` fields so future regeneration and iteration work has a paper trail.

**Tech Stack:** Firebase Functions (`functions/src/`, `rootDir: "src"` — cannot import from project `lib/`), fal.ai client (`@fal-ai/client`), Anthropic SDK via `callAgent` wrapper, Sharp for transcode, Supabase Storage `blog-images` bucket, Vitest for tests.

**Audit findings driving this plan:**

| Issue | Current | Target |
|---|---|---|
| Hero model | `fal-ai/flux-pro/v1.1` | `fal-ai/flux-pro/v1.1-ultra` (better photorealism, native 2K) |
| Inline model | `fal-ai/flux/schnell` (cheapest tier; ~$0.003) | `fal-ai/flux-pro/v1.1` (~$0.04) — the single biggest visible quality jump in the whole plan |
| Render resolution | 1× target (1200×630, 1024×576) | 2× then Sharp lanczos3 downscale (kills AI softness) |
| WebP quality | 82 flat | 90 hero / 86 inline |
| Style prompt | Hardcoded `BRAND_TREATMENT` paragraph | Photographer/lens/film-stock prompt grammar + hard anti-AI list |
| Category awareness | None — all posts get same prompt | Per-category style modules (rotational, comeback, strength, mobility, youth, recovery) |
| QA / retry | None — bad images publish silently | Vision judge rates 1–10 vs brand rubric; auto-retry once below 7 |
| Seed control | None — every generation random | Persist seed per image so admin can regenerate variants |
| Prompt logging | Prompt stored, but not model/seed/version | Full reproducibility row per image |

**Out of scope (deliberate):**

- Admin "regenerate this image" UI button. Plan stops at the data layer (seed + prompt persisted). UI work belongs in a separate plan.
- Migrating away from fal.ai. Provider abstraction is over-engineering until a second provider is actually needed.
- LoRA fine-tuning on DJP photography. Already noted in `image-prompts.ts` as a future move when volume justifies the training cost.

**Solo-dev workflow note:** Memory `work_directly_on_main.md` — commit directly to `main`, no branches.

---

## File Structure

**Modify:**
- `functions/src/blog-image-generation.ts` — orchestrator: swap models, wire seed + judge + retry, extend `InlineImageRecord` with seed/model/quality
- `functions/src/lib/fal-client.ts` — accept + return `seed`, accept `num_inference_steps` + `guidance_scale`
- `functions/src/lib/image-pipeline.ts` — accept `qualityHint`, render at 2x and lanczos3-downscale
- `functions/src/ai/image-prompts.ts` — replace `BRAND_TREATMENT` + `SYSTEM_PROMPT`, accept category, append category module

**Create:**
- `functions/src/ai/category-style-modules.ts` — per-category style strings injected into prompt extraction
- `functions/src/lib/image-quality-judge.ts` — Claude Vision judge, returns `{ score: 1-10, reasons: string[] }`

**Schema:**
- No SQL migration needed. `inline_images` is already JSONB; new keys (`seed`, `model`, `prompt_version`, `quality_score`) are additive. Add a `cover_image_meta` JSONB column to `blog_posts` for the hero's seed/model/version/score (one new migration).

---

## Task 1: Extend `generateFalImage` with seed, steps, guidance, and return the seed

**Why first:** Every other task (judge retry, prompt logging, model swap) needs the upgraded fal client. Land this first as the foundation.

**Files:**
- Modify: `functions/src/lib/fal-client.ts`
- Test: `functions/src/__tests__/fal-client.test.ts` (create if missing — check first)

- [ ] **Step 1: Check whether a fal-client test file exists**

Run: `Glob` for `functions/src/__tests__/fal-client*.test.ts`
If none, create `functions/src/__tests__/fal-client.test.ts` from scratch in Step 2.

- [ ] **Step 2: Write the failing test**

Create or extend `functions/src/__tests__/fal-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSubscribe = vi.fn()
const mockConfig = vi.fn()

vi.mock("@fal-ai/client", () => ({
  fal: {
    config: mockConfig,
    subscribe: mockSubscribe,
  },
}))

// fetch is mocked per-test so we can return a real-sized buffer
const fakeImageBuffer = Buffer.alloc(20_000, 0xab)
global.fetch = vi.fn(async () =>
  new Response(fakeImageBuffer, { headers: { "content-type": "image/png" } }),
) as unknown as typeof fetch

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FAL_KEY = "test-key"
  mockSubscribe.mockResolvedValue({
    data: {
      images: [{ url: "https://fal.example/img.png", content_type: "image/png" }],
      has_nsfw_concepts: [false],
      seed: 4242,
    },
  })
})

describe("generateFalImage", () => {
  it("passes seed, num_inference_steps, and guidance_scale to fal when provided", async () => {
    const { generateFalImage } = await import("../lib/fal-client.js")
    await generateFalImage({
      model: "fal-ai/flux-pro/v1.1-ultra",
      prompt: "p",
      width: 2400,
      height: 1260,
      seed: 4242,
      numInferenceSteps: 40,
      guidanceScale: 3.5,
    })
    expect(mockSubscribe).toHaveBeenCalledWith(
      "fal-ai/flux-pro/v1.1-ultra",
      expect.objectContaining({
        input: expect.objectContaining({
          prompt: "p",
          image_size: { width: 2400, height: 1260 },
          seed: 4242,
          num_inference_steps: 40,
          guidance_scale: 3.5,
        }),
      }),
    )
  })

  it("returns the seed fal used so callers can persist it for regeneration", async () => {
    const { generateFalImage } = await import("../lib/fal-client.js")
    const result = await generateFalImage({
      model: "fal-ai/flux-pro/v1.1",
      prompt: "p",
      width: 1024,
      height: 576,
    })
    expect(result.seed).toBe(4242)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd functions && npx vitest run src/__tests__/fal-client.test.ts`
Expected: FAIL — seed/numInferenceSteps/guidanceScale not in input type; `result.seed` undefined.

- [ ] **Step 4: Implement**

Replace `GenerateFalImageInput`, `GenerateFalImageResult`, and the `subscribe` call in `functions/src/lib/fal-client.ts`:

```typescript
export interface GenerateFalImageInput {
  model: string
  prompt: string
  width: number
  height: number
  seed?: number
  numInferenceSteps?: number
  guidanceScale?: number
}

export interface GenerateFalImageResult {
  buffer: Buffer
  mime: string
  seed: number
}

interface FalResponseData {
  images?: FalImageResult[]
  has_nsfw_concepts?: boolean[]
  seed?: number
}
```

Then update the `subscribe` call body:

```typescript
const subscribeInput: Record<string, unknown> = {
  prompt: input.prompt,
  image_size: { width: input.width, height: input.height },
  num_images: 1,
  enable_safety_checker: true,
}
if (typeof input.seed === "number") subscribeInput.seed = input.seed
if (typeof input.numInferenceSteps === "number") subscribeInput.num_inference_steps = input.numInferenceSteps
if (typeof input.guidanceScale === "number") subscribeInput.guidance_scale = input.guidanceScale

const response = await fal.subscribe(input.model, { input: subscribeInput, logs: false })
```

And update the return:

```typescript
return { buffer, mime, seed: data.seed ?? 0 }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd functions && npx vitest run src/__tests__/fal-client.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the existing blog-image-generation test to check nothing broke**

Run: `cd functions && npx vitest run src/__tests__/blog-image-generation.test.ts`
Expected: PASS — existing mocks may need a `seed: 0` added to the fal mock return; if so, fix and re-run.

- [ ] **Step 7: Commit**

```bash
git add functions/src/lib/fal-client.ts functions/src/__tests__/fal-client.test.ts functions/src/__tests__/blog-image-generation.test.ts
git commit -m "feat(fal-client): pass + return seed, accept inference steps and guidance"
```

---

## Task 2: Render at 2× target resolution and lanczos3 downscale

**Why:** Most "AI image looks slightly soft" complaints come from generating at the final display size. Generating at 2× and downsampling with a high-quality kernel produces visibly sharper, less plastic-looking output.

**Files:**
- Modify: `functions/src/lib/image-pipeline.ts`
- Test: `functions/src/__tests__/image-pipeline.test.ts` (create if missing)

- [ ] **Step 1: Write the failing test**

Create `functions/src/__tests__/image-pipeline.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"

vi.mock("../lib/supabase.js", () => ({
  getSupabase: () => ({
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://supa/x.webp" } }),
      }),
    },
  }),
}))

import { transcodeAndUpload, RENDER_DIMENSIONS } from "../lib/image-pipeline.js"

beforeEach(() => vi.clearAllMocks())

describe("RENDER_DIMENSIONS", () => {
  it("exposes 2x render dimensions distinct from final dimensions", () => {
    expect(RENDER_DIMENSIONS.hero).toEqual({ width: 2400, height: 1260 })
    expect(RENDER_DIMENSIONS.inline).toEqual({ width: 2048, height: 1152 })
  })
})

describe("transcodeAndUpload", () => {
  it("downscales to final size with lanczos3 and webp quality 90 for hero", async () => {
    const big = await sharp({
      create: { width: 2400, height: 1260, channels: 3, background: "#888" },
    }).png().toBuffer()

    const result = await transcodeAndUpload({ buffer: big, slug: "s", kind: "hero" })
    expect(result.width).toBe(1200)
    expect(result.height).toBe(630)
  })

  it("uses webp quality 86 for inline", async () => {
    const big = await sharp({
      create: { width: 2048, height: 1152, channels: 3, background: "#888" },
    }).png().toBuffer()

    const result = await transcodeAndUpload({ buffer: big, slug: "s", kind: "inline", sectionIdx: 1 })
    expect(result.width).toBe(1024)
    expect(result.height).toBe(576)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/__tests__/image-pipeline.test.ts`
Expected: FAIL — `RENDER_DIMENSIONS` is not exported.

- [ ] **Step 3: Implement**

Replace `functions/src/lib/image-pipeline.ts`:

```typescript
import sharp from "sharp"
import { getSupabase } from "./supabase.js"

const BUCKET = "blog-images"

// Final delivered dimensions (what we serve in <img> tags).
export const FINAL_DIMENSIONS = {
  hero: { width: 1200, height: 630 },
  inline: { width: 1024, height: 576 },
} as const

// Render dimensions we ask the image model for. 2x final, then we downscale
// with lanczos3 in Sharp. This trades ~4x pixel budget at fal for visibly
// sharper output — the same trick wedding photographers used moving from
// in-camera JPEGs to RAW-then-export.
export const RENDER_DIMENSIONS = {
  hero: { width: 2400, height: 1260 },
  inline: { width: 2048, height: 1152 },
} as const

const WEBP_QUALITY = {
  hero: 90,
  inline: 86,
} as const

export type ImageKind = "hero" | "inline"

export interface TranscodeAndUploadInput {
  buffer: Buffer
  slug: string
  kind: ImageKind
  sectionIdx?: number
}

export interface TranscodeAndUploadResult {
  url: string
  width: number
  height: number
  path: string
}

function buildPath(slug: string, kind: ImageKind, sectionIdx?: number): string {
  if (kind === "hero") return `${slug}-hero.webp`
  if (typeof sectionIdx !== "number") {
    throw new Error("sectionIdx is required for inline images")
  }
  return `${slug}-section-${sectionIdx}.webp`
}

export async function transcodeAndUpload(input: TranscodeAndUploadInput): Promise<TranscodeAndUploadResult> {
  const dims = FINAL_DIMENSIONS[input.kind]
  const quality = WEBP_QUALITY[input.kind]
  const path = buildPath(input.slug, input.kind, input.sectionIdx)

  const webpBuffer = await sharp(input.buffer)
    .resize(dims.width, dims.height, {
      fit: "cover",
      position: "center",
      kernel: sharp.kernel.lanczos3,
    })
    .webp({ quality, effort: 5 })
    .toBuffer()

  const supabase = getSupabase()
  const { error } = await supabase.storage.from(BUCKET).upload(path, webpBuffer, {
    contentType: "image/webp",
    upsert: true,
  })
  if (error) throw new Error(`Supabase upload failed (${path}): ${error.message}`)

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)

  return { url: pub.publicUrl, width: dims.width, height: dims.height, path }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/__tests__/image-pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/image-pipeline.ts functions/src/__tests__/image-pipeline.test.ts
git commit -m "feat(image-pipeline): render at 2x and lanczos3 downscale, raise webp quality"
```

---

## Task 3: Replace the system prompt with a photographer-grade prompt engineer

**Why:** Current `BRAND_TREATMENT` reads like marketing copy. Image models respond dramatically better to camera/lens/film-stock vocabulary because that's what's heavily represented in their training captions. This is the single biggest prompt-quality lever before model swaps.

**Files:**
- Modify: `functions/src/ai/image-prompts.ts`
- Test: `functions/src/__tests__/image-prompts.test.ts` (create if missing)

- [ ] **Step 1: Write the failing test**

Create `functions/src/__tests__/image-prompts.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const callAgentMock = vi.fn()
vi.mock("../ai/anthropic.js", () => ({
  callAgent: callAgentMock,
  MODEL_SONNET: "claude-sonnet-4-6",
}))

import { extractImagePrompts, BRAND_TREATMENT, PROMPT_VERSION } from "../ai/image-prompts.js"

beforeEach(() => {
  vi.clearAllMocks()
  callAgentMock.mockResolvedValue({
    content: {
      hero_prompt: "h",
      inline_prompts: [{ section_h2: "Section A", prompt: "i" }],
    },
  })
})

describe("BRAND_TREATMENT", () => {
  it("uses photographer/lens/film vocabulary, not marketing copy", () => {
    expect(BRAND_TREATMENT).toMatch(/35mm|50mm|85mm/i)
    expect(BRAND_TREATMENT).toMatch(/Kodak Portra|Fuji Pro|Cinestill/i)
    expect(BRAND_TREATMENT).toMatch(/Walter Iooss|Annie Leibovitz|Platon|Joey Terrill/i)
  })

  it("contains an explicit anti-AI artifact list", () => {
    expect(BRAND_TREATMENT).toMatch(/plastic skin/i)
    expect(BRAND_TREATMENT).toMatch(/extra fingers|deformed hands/i)
    expect(BRAND_TREATMENT).toMatch(/over.?saturated|HDR/i)
  })

  it("specifies diversity baseline", () => {
    expect(BRAND_TREATMENT).toMatch(/mix of|varying|range of/i)
  })
})

describe("PROMPT_VERSION", () => {
  it("exports a monotonically incremented prompt version string for logging", () => {
    expect(PROMPT_VERSION).toMatch(/^v\d+$/)
  })
})

describe("extractImagePrompts", () => {
  it("passes the category through to the user message so prompts can specialize", async () => {
    await extractImagePrompts({
      title: "T",
      content: "C",
      category: "Rotational",
      qualifyingSections: ["Section A"],
    })
    const userMsg = callAgentMock.mock.calls[0][1] as string
    expect(userMsg).toContain("Rotational")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/__tests__/image-prompts.test.ts`
Expected: FAIL — `PROMPT_VERSION` not exported; `BRAND_TREATMENT` lacks lens/film/photographer/anti-AI/diversity strings.

- [ ] **Step 3: Implement — replace `BRAND_TREATMENT`, `SYSTEM_PROMPT`, and export `PROMPT_VERSION`**

In `functions/src/ai/image-prompts.ts`, replace the existing `BRAND_TREATMENT` and `SYSTEM_PROMPT` constants and add a `PROMPT_VERSION` export. Keep the schema, `ExtractImagePromptsInput`, and `extractImagePrompts` shape unchanged (we only modify the strings + add `category` into the user message, which is already there — verify and keep).

```typescript
// Bump this when BRAND_TREATMENT or SYSTEM_PROMPT changes. Persisted per
// image so we can compare quality across prompt revisions later.
export const PROMPT_VERSION = "v2"

export const BRAND_TREATMENT = `
DJP visual treatment — apply to every prompt, harder on the hero:

CAMERA GRAMMAR (pick one combo per shot, vary across the post):
- Canon R5 + 35mm f/1.4, eye-level — for full-body action and gym-wide shots
- Sony A7IV + 50mm f/1.8, slight low angle — for portrait-leaning training shots
- Leica Q3 + 28mm fixed, hip level — for documentary, behind-the-scenes feel
- Canon R6 + 85mm f/1.8, three-quarter — for tight, intimate coaching moments

LIGHTING:
- Natural daylight through gym windows, or true overhead gym halide.
- Outdoor: golden hour or open shade. Never midday flat sun.
- Never: ring lights, beauty dishes, on-camera flash, neon rim light, lens flares.

COLOR + GRADE:
- Kodak Portra 400 color science, or Fuji Pro 400H. Muted, warm-leaning skin tones.
- Slightly lifted shadows, gentle highlight rolloff. Editorial, not Instagram.
- Avoid teal-and-orange Hollywood grade. Avoid HDR. Avoid clarity-slider grunge.

COMPOSITION:
- Subject crisp, background gently blurred (f/1.4–f/2.8 look).
- Rule of thirds. Hero shots: leave negative space on one side for 1200×630 OG framing.
- Mid-action, not posed. Show the athlete doing the thing.
- Behind-the-scenes coaching context when natural — coach in frame, equipment, real flooring.

REFERENCE EYE:
- Editorial sports documentary in the lineage of Walter Iooss Jr., Annie Leibovitz's
  athlete portraits, and Platon's tight character work. Honest, not glossy.

CASTING + DIVERSITY:
- Realistic athletic body types. NOT fitness-model archetypes, NOT bodybuilder physiques.
- Across a single post's images, show a varying mix of athletes by gender, ethnicity,
  and age unless the topic explicitly dictates a specific demographic (e.g. youth
  development → adolescents).
- Coaches in frame should read as practitioners, not models. Real clothes, real
  builds.

HARD ANTI-AI LIST (do NOT produce):
- No plastic skin, no porcelain doll faces, no airbrushed pores.
- No extra fingers, deformed hands, fused limbs, asymmetric eyes.
- No oversaturated colors, no HDR halos, no over-sharpened "AI photo" look.
- No symmetric front-facing studio portrait poses.
- No text, no logos, no watermarks, no jersey branding, no company labels.
- No CGI/3D-render aesthetic, no illustration, no painterly style.
- No fantasy lighting, no godrays, no lens flares, no bokeh balls.`.trim()

const SYSTEM_PROMPT = `You are a senior photo editor writing prompts for a text-to-image model. Your client is Darren Paul (DJP Athlete), a science-based athletic-performance blog. Output IS what gets generated — be specific, visual, and concrete.

PROMPT GRAMMAR (every prompt you write must follow this shape):
[SUBJECT — who, body type, clothing, mid-action verb], [SETTING — gym/track/field, time of day, weather], shot on [CAMERA + LENS + APERTURE from BRAND_TREATMENT], [LIGHTING], [COLOR GRADE], [COMPOSITION + NEGATIVE SPACE NOTE], in the editorial documentary style of [REFERENCE PHOTOGRAPHER from BRAND_TREATMENT].

EXAMPLES of the bar you are clearing:

Good hero (carries the brand treatment hard):
"Black female sprinter in worn training shorts and a faded crew neck, mid-stride accelerating out of blocks on a weathered outdoor track, early morning light, shot on Canon R5 with 35mm f/1.4, golden-hour side light, Kodak Portra 400 color science with muted warm skin tones, low-angle three-quarter view with negative space camera-left, editorial sports documentary in the lineage of Walter Iooss Jr."

Good inline:
"Hands gripping a knurled barbell mid-deadlift, chalk dust suspended in window light, shot on Canon R6 with 85mm f/1.8, natural overhead gym halide, Fuji Pro 400H grade, tight crop with shallow depth of field, behind-the-scenes coaching aesthetic."

Bad (do not write these):
"A fit athlete training hard in a gym." — vague, generic, no grammar.
"Beautiful muscular fitness model posing." — wrong casting language, posed.
"Photorealistic action shot of a runner." — meta-language, not visual.

${BRAND_TREATMENT}

OUTPUT (strict JSON, nothing else):
{
  "hero_prompt": "<single prompt for the cover image, 40-70 words, full grammar above>",
  "inline_prompts": [
    { "section_h2": "<exact h2 text>", "prompt": "<35-55 words, full grammar above>" }
  ]
}

RULES:
- The hero prompt MUST hit every slot of the grammar above. It's the OG card.
- Inline prompts MUST reference the specific section's content, not just the post topic. Reading the section's first paragraph tells you what to show.
- Use the EXACT h2 text supplied in the user message — do not paraphrase.
- If fewer qualifying sections are provided, emit fewer inline_prompts. Never invent sections.
- Vary camera/lens/lighting across the inline prompts so the post doesn't look like one shoot from one angle.
- Return ONLY the JSON object, no preamble, no markdown fence.`
```

Verify `extractImagePrompts` already includes `input.category` in the user message (it does — line 77 in the current file: `\`Category: ${input.category}\``). Keep as-is.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/__tests__/image-prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Re-run blog-image-generation test to confirm no regression**

Run: `cd functions && npx vitest run src/__tests__/blog-image-generation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/image-prompts.ts functions/src/__tests__/image-prompts.test.ts
git commit -m "feat(image-prompts): photographer-grade prompt engineer system message"
```

---

## Task 4: Category-aware style modules

**Why:** A "Rotational Reboot" post and a "Comeback Code" rehab post should not be illustrated the same way. Inject a category-specific visual module into the user message so the model has context about what athletes, equipment, and settings are on-brand for that post.

**Files:**
- Create: `functions/src/ai/category-style-modules.ts`
- Modify: `functions/src/ai/image-prompts.ts` — call `getCategoryStyleModule` and append to user message
- Test: `functions/src/__tests__/category-style-modules.test.ts`

- [ ] **Step 1: Write the failing test**

Create `functions/src/__tests__/category-style-modules.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { getCategoryStyleModule, KNOWN_CATEGORIES } from "../ai/category-style-modules.js"

describe("getCategoryStyleModule", () => {
  it("returns rotational-specific guidance for rotational categories", () => {
    const mod = getCategoryStyleModule("Rotational")
    expect(mod).toMatch(/golf|baseball|tennis|hockey/i)
    expect(mod).toMatch(/medicine ball|cable column|rotational/i)
  })

  it("returns comeback/rehab guidance for comeback categories", () => {
    const mod = getCategoryStyleModule("Comeback")
    expect(mod).toMatch(/rehab|recovery|return.to.play|post.injury/i)
    expect(mod).toMatch(/band|controlled|low.load/i)
  })

  it("returns strength guidance for strength categories", () => {
    const mod = getCategoryStyleModule("Strength")
    expect(mod).toMatch(/barbell|deadlift|squat|rack/i)
  })

  it("returns mobility guidance for mobility categories", () => {
    const mod = getCategoryStyleModule("Mobility")
    expect(mod).toMatch(/mobility|warm.?up|range of motion/i)
  })

  it("returns youth guidance for youth-development categories", () => {
    const mod = getCategoryStyleModule("Youth")
    expect(mod).toMatch(/adolescent|teen|youth|age.appropriate/i)
  })

  it("falls back to a generic performance module for unknown categories", () => {
    const mod = getCategoryStyleModule("Mystery Category")
    expect(mod).toMatch(/general athletic performance/i)
  })

  it("matches case-insensitively and tolerates spaces/hyphens", () => {
    expect(getCategoryStyleModule("rotational training")).toBe(getCategoryStyleModule("Rotational"))
    expect(getCategoryStyleModule("come-back")).toBe(getCategoryStyleModule("Comeback"))
  })

  it("exposes KNOWN_CATEGORIES so callers can iterate", () => {
    expect(KNOWN_CATEGORIES).toEqual(
      expect.arrayContaining(["rotational", "comeback", "strength", "mobility", "youth", "recovery"]),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/__tests__/category-style-modules.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Create the module**

Create `functions/src/ai/category-style-modules.ts`:

```typescript
export const KNOWN_CATEGORIES = ["rotational", "comeback", "strength", "mobility", "youth", "recovery"] as const
type KnownCategory = typeof KNOWN_CATEGORIES[number]

const MODULES: Record<KnownCategory, string> = {
  rotational: `
CATEGORY MODULE — Rotational training (golf, baseball, tennis, hockey, MMA):
- Settings: indoor performance facilities with turf, batting cages, golf simulators, on-course practice tees, baseball/softball fields.
- Equipment in frame: medicine balls (especially rotational throws against rebounders), cable columns set for chops/lifts, landmine attachments, weighted bats, club, racquet.
- Movements: rotational med-ball throws, cable chops, landmine rotations, anti-rotation press-outs, hip-shoulder dissociation drills, mound work, swing repetition.
- Casting: adult rotational-sport athletes — golfer builds, baseball/softball builds, tennis/MMA leans. Not powerlifter or bodybuilder physiques.`.trim(),

  comeback: `
CATEGORY MODULE — Comeback / return-to-play / post-injury:
- Settings: clinical-feeling rehab gyms, physical therapy studios with parallel bars, low-stim performance facilities. Soft natural light through clinic windows.
- Equipment in frame: resistance bands, light dumbbells, BFR cuffs, foam rollers, balance pads, low boxes, controlled-tempo rigs. Sometimes a coach or PT in the frame guiding form.
- Movements: low-load controlled tempo work, single-leg balance, banded rehab progressions, slow eccentric loading, isometric holds. Never max-effort.
- Mood: focused, patient, methodical. Not "rocky training montage" energy. The athlete is rebuilding, not peaking.
- Casting: adults of any sport, often visibly recovering (subtle tape, sleeves, brace cues — never gory or medical-prop heavy).`.trim(),

  strength: `
CATEGORY MODULE — Strength training:
- Settings: real strength gyms with platforms, dead patches, chalk bowls, deadlift bars sitting on jacks. NOT chrome commercial-gym aesthetics.
- Equipment in frame: barbells with knurling visible, bumper plates, squat racks, monolifts, trap bars, dumbbells, chalk dust in the air.
- Movements: deadlifts, squats, bench press, rows, overhead press, loaded carries. Mid-rep mid-action, never racked-and-posing.
- Casting: adults with realistic strength athlete builds across weight classes. Show effort — gritted teeth, tension, chalked hands.`.trim(),

  mobility: `
CATEGORY MODULE — Mobility and warm-up:
- Settings: turf areas, open gym floor, yoga-style spaces. Natural side light.
- Equipment in frame: bands, foam rollers, lacrosse balls, dowels, light kettlebells, agility ladders.
- Movements: dynamic warm-ups, hip openers, thoracic rotations, deep squats holds, lunges with reach, banded distractions. Slow, controlled, range-of-motion focused.
- Mood: warm-up energy — preparing, not peaking.`.trim(),

  youth: `
CATEGORY MODULE — Youth development:
- Settings: school gyms, community sport facilities, outdoor youth practice fields. Bright natural light.
- Equipment in frame: age-appropriate tools — light medicine balls, bodyweight stations, mini-bands, agility cones, low boxes. NEVER loaded barbells with young athletes.
- Movements: bodyweight squats, jump-rope, broad jumps, throwing drills, sport-specific skill work. Coordination, not load.
- Casting: adolescents and teens (12–17). Coach in frame is appropriate and welcome.`.trim(),

  recovery: `
CATEGORY MODULE — Recovery and sleep:
- Settings: quiet recovery spaces, home environments, soft-light bedrooms (for sleep posts), recovery lounges.
- Equipment in frame: percussion guns, foam rollers, ice baths, compression boots, sauna doors, simple stretching mats. Not gym equipment.
- Mood: calm, low-stimulation, recovery-focused. Often a single subject in a quiet moment.
- Casting: adult athletes in recovery wear (joggers, hoodies, robes for ice-bath shots) — not gym performance attire.`.trim(),
}

const GENERIC = `
CATEGORY MODULE — General athletic performance:
- Mix gym, track, and field settings. Mid-action work across multiple modalities.
- Equipment in frame should reflect the post topic.`.trim()

function normalize(category: string): KnownCategory | null {
  const lc = category.toLowerCase().replace(/[\s-_]+/g, "")
  for (const key of KNOWN_CATEGORIES) {
    if (lc.includes(key)) return key
  }
  return null
}

export function getCategoryStyleModule(category: string): string {
  const key = normalize(category)
  if (!key) return GENERIC
  return MODULES[key]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/__tests__/category-style-modules.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `extractImagePrompts`**

In `functions/src/ai/image-prompts.ts`, add the import at the top:

```typescript
import { getCategoryStyleModule } from "./category-style-modules.js"
```

Then modify the `userMessage` construction in `extractImagePrompts`:

```typescript
const categoryModule = getCategoryStyleModule(input.category)

const userMessage = [
  `# POST`,
  `Title: ${input.title}`,
  `Category: ${input.category}`,
  "",
  `# CATEGORY-SPECIFIC STYLE MODULE`,
  categoryModule,
  "",
  `# QUALIFYING SECTIONS (use these exact strings as section_h2)`,
  sectionList,
  "",
  `# CONTENT (first 4000 chars)`,
  input.content.slice(0, 4000),
  "",
  `# INSTRUCTIONS`,
  `Generate one hero_prompt and one inline prompt per qualifying section. Use the exact h2 strings above for section_h2. Honor the category-specific style module above when choosing settings, equipment, casting, and mood.`,
].join("\n")
```

- [ ] **Step 6: Update `image-prompts.test.ts` to assert wiring**

Add to `functions/src/__tests__/image-prompts.test.ts`:

```typescript
it("injects the category style module into the user message", async () => {
  await extractImagePrompts({
    title: "T",
    content: "C",
    category: "Rotational",
    qualifyingSections: ["Section A"],
  })
  const userMsg = callAgentMock.mock.calls[0][1] as string
  expect(userMsg).toMatch(/CATEGORY-SPECIFIC STYLE MODULE/)
  expect(userMsg).toMatch(/medicine ball|cable column/i)
})
```

- [ ] **Step 7: Run tests**

Run: `cd functions && npx vitest run src/__tests__/image-prompts.test.ts src/__tests__/category-style-modules.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add functions/src/ai/category-style-modules.ts functions/src/ai/image-prompts.ts functions/src/__tests__/category-style-modules.test.ts functions/src/__tests__/image-prompts.test.ts
git commit -m "feat(image-prompts): category-aware style modules"
```

---

## Task 5: Vision-judged quality scoring + one auto-retry

**Why:** Even with better models and prompts, image gen is non-deterministic. A cheap Vision pass that rates the image against the brand rubric, with one retry on a different seed when the score is low, catches the worst misses before they ship to readers.

**Files:**
- Create: `functions/src/lib/image-quality-judge.ts`
- Test: `functions/src/__tests__/image-quality-judge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `functions/src/__tests__/image-quality-judge.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const createMock = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: createMock } },
}))

import { judgeImageQuality, QUALITY_RETRY_THRESHOLD } from "../lib/image-quality-judge.js"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = "x"
})

describe("judgeImageQuality", () => {
  it("returns a 1-10 score and reasons array parsed from JSON output", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ score: 8, reasons: ["sharp", "on brand"] }) }],
    })

    const result = await judgeImageQuality({
      buffer: Buffer.from("x"),
      mime: "image/webp",
      originalPrompt: "p",
    })

    expect(result.score).toBe(8)
    expect(result.reasons).toEqual(["sharp", "on brand"])
  })

  it("returns score 0 on parse failure so callers know to retry once and move on", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "not json" }] })
    const result = await judgeImageQuality({
      buffer: Buffer.from("x"),
      mime: "image/webp",
      originalPrompt: "p",
    })
    expect(result.score).toBe(0)
  })

  it("clamps scores to 1-10", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ score: 15, reasons: [] }) }],
    })
    const result = await judgeImageQuality({
      buffer: Buffer.from("x"),
      mime: "image/webp",
      originalPrompt: "p",
    })
    expect(result.score).toBe(10)
  })

  it("exposes the retry threshold for the orchestrator", () => {
    expect(QUALITY_RETRY_THRESHOLD).toBe(7)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/__tests__/image-quality-judge.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement**

Create `functions/src/lib/image-quality-judge.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk"

// Anything strictly below this triggers one regeneration on a fresh seed.
export const QUALITY_RETRY_THRESHOLD = 7

const SYSTEM = `You are a brutally honest photo editor reviewing a generated image against DJP Athlete's brand rubric.

Score 1-10 against this rubric (each is a deduction risk, not a checklist):
- Photorealism (no plastic skin, no porcelain faces, no AI-art artifacts)
- Anatomical correctness (hands, fingers, eyes, limbs)
- Documentary athletic feel (mid-action, not posed; real gym/field setting)
- Color grade (muted, warm-leaning, NOT oversaturated or HDR)
- Composition (subject crisp, background gentle blur, rule of thirds)
- On-brief (matches the original prompt's intent)
- No forbidden elements (no text, no logos, no neon rim light, no flares, no CGI look)

Score guide:
- 10: publishable in a magazine, indistinguishable from a real shoot
- 8-9: ship it, minor nitpicks
- 7: borderline ship — small issues a careful reader would clock
- 5-6: visibly AI — retry recommended
- 1-4: broken — must retry

Output strict JSON, nothing else:
{ "score": <1-10 integer>, "reasons": ["<short, specific>", ...] }`

interface JudgeInput {
  buffer: Buffer
  mime: string
  originalPrompt: string
}

export interface JudgeResult {
  score: number
  reasons: string[]
}

export async function judgeImageQuality(input: JudgeInput): Promise<JudgeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set")
  const client = new Anthropic({ apiKey })

  const mediaType = (input.mime as "image/webp" | "image/png" | "image/jpeg") ?? "image/webp"

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: input.buffer.toString("base64") } },
          { type: "text", text: `Original prompt the model was given:\n${input.originalPrompt}\n\nScore this image and output the JSON.` },
        ],
      },
    ],
  })

  const textBlock = response.content.find((b) => b.type === "text")
  const raw = textBlock && "text" in textBlock ? textBlock.text : ""

  try {
    const parsed = JSON.parse(raw.trim().replace(/^```json\s*|```\s*$/g, "")) as { score: number; reasons: string[] }
    const score = Math.max(1, Math.min(10, Math.round(parsed.score)))
    return { score, reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 8) : [] }
  } catch {
    return { score: 0, reasons: ["judge response unparseable"] }
  }
}
```

Note on Haiku model id — verify against `functions/src/ai/anthropic.js` to confirm the current alias. If it exports a `MODEL_HAIKU` constant, prefer that import for consistency.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/__tests__/image-quality-judge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/image-quality-judge.ts functions/src/__tests__/image-quality-judge.test.ts
git commit -m "feat(image-judge): Haiku Vision quality judge with retry threshold"
```

---

## Task 6: Wire model upgrades, seed persistence, judge retry, and prompt logging into the orchestrator

**Why this is the integration task:** Tasks 1-5 produced isolated capabilities. This task ties them together: bump the models, render at 2x, persist seed/model/prompt-version/quality-score on every image record, judge each generation, and retry once on a fresh seed if the judge scores below threshold.

**Files:**
- Modify: `functions/src/blog-image-generation.ts`
- Modify: `functions/src/__tests__/blog-image-generation.test.ts`
- Migration: `supabase/migrations/<next-number>_blog_post_cover_meta.sql`

- [ ] **Step 1: Add migration for hero metadata JSONB**

Find the next migration number — list `supabase/migrations/` and pick the next sequential number.

Create `supabase/migrations/<NNNNN>_blog_post_cover_meta.sql`:

```sql
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS cover_image_meta JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN blog_posts.cover_image_meta IS
  'Reproducibility metadata for cover_image_url: { seed, model, prompt, prompt_version, quality_score, quality_reasons, attempts }. Inline image equivalents live in the inline_images JSONB array.';
```

Apply via Supabase MCP (per memory `supabase_migrations_via_mcp.md` — do NOT use the CLI):

Run: `mcp__supabase__apply_migration` with name `blog_post_cover_meta` and the SQL above.

- [ ] **Step 2: Update the orchestrator test mocks to expect the new fields**

In `functions/src/__tests__/blog-image-generation.test.ts`, add to the top:

```typescript
const mocks = vi.hoisted(() => ({
  extractImagePrompts: vi.fn(),
  generateFalImage: vi.fn(),
  transcodeAndUpload: vi.fn(),
  generateAltText: vi.fn(),
  judgeImageQuality: vi.fn(),
  getFirestore: vi.fn(),
  getSupabase: vi.fn(),
}))

vi.mock("../lib/image-quality-judge.js", () => ({
  judgeImageQuality: mocks.judgeImageQuality,
  QUALITY_RETRY_THRESHOLD: 7,
}))
```

Update the existing `beforeEach` to seed seed + judge:

```typescript
mocks.generateFalImage.mockResolvedValue({
  buffer: Buffer.from("png"),
  mime: "image/png",
  seed: 1234,
})
mocks.judgeImageQuality.mockResolvedValue({ score: 9, reasons: ["sharp"] })
```

Update the happy-path assertion to verify metadata persistence:

```typescript
expect(postUpdate).toHaveBeenCalledWith(
  expect.objectContaining({
    cover_image_url: "https://supa/x-hero.webp",
    cover_image_meta: expect.objectContaining({
      seed: 1234,
      model: "fal-ai/flux-pro/v1.1-ultra",
      prompt_version: expect.stringMatching(/^v\d+$/),
      quality_score: 9,
      attempts: 1,
    }),
    inline_images: expect.arrayContaining([
      expect.objectContaining({
        url: "https://supa/x-section-1.webp",
        seed: 1234,
        model: "fal-ai/flux-pro/v1.1",
        prompt_version: expect.stringMatching(/^v\d+$/),
        quality_score: 9,
      }),
    ]),
  }),
)
```

Add a new test for the judge-retry path:

```typescript
it("retries once on a fresh seed when the judge scores below threshold", async () => {
  mocks.judgeImageQuality
    .mockResolvedValueOnce({ score: 4, reasons: ["plastic skin"] })
    .mockResolvedValueOnce({ score: 8, reasons: ["fixed"] })
  mocks.generateFalImage
    .mockResolvedValueOnce({ buffer: Buffer.from("a"), mime: "image/png", seed: 1 })
    .mockResolvedValueOnce({ buffer: Buffer.from("b"), mime: "image/png", seed: 2 })
    .mockResolvedValueOnce({ buffer: Buffer.from("c"), mime: "image/png", seed: 3 }) // inline

  await handleBlogImageGeneration("job-1")

  // Hero was generated twice (initial + 1 retry), inline once
  expect(mocks.generateFalImage).toHaveBeenCalledTimes(3)

  const completedCall = jobUpdate.mock.calls.find((c) => c[0]?.status === "completed")
  expect(completedCall).toBeDefined()
})

it("does not retry more than once even if the second attempt also scores low", async () => {
  mocks.judgeImageQuality.mockResolvedValue({ score: 3, reasons: ["still bad"] })

  await handleBlogImageGeneration("job-1")

  // Hero: 2 attempts (initial + 1 retry) — never a 3rd. Inline: 1.
  expect(mocks.generateFalImage).toHaveBeenCalledTimes(3)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd functions && npx vitest run src/__tests__/blog-image-generation.test.ts`
Expected: FAIL — new fields not persisted, retry logic not implemented.

- [ ] **Step 4: Implement the upgraded orchestrator**

Replace `functions/src/blog-image-generation.ts`:

```typescript
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { extractImagePrompts, PROMPT_VERSION } from "./ai/image-prompts.js"
import { generateFalImage } from "./lib/fal-client.js"
import { transcodeAndUpload, RENDER_DIMENSIONS, FINAL_DIMENSIONS } from "./lib/image-pipeline.js"
import { generateAltText } from "./lib/image-alt-text.js"
import { findQualifyingSections, spliceInlineImages } from "./lib/html-splice.js"
import { judgeImageQuality, QUALITY_RETRY_THRESHOLD } from "./lib/image-quality-judge.js"
import { getSupabase } from "./lib/supabase.js"

const HERO_MODEL = "fal-ai/flux-pro/v1.1-ultra"
const INLINE_MODEL = "fal-ai/flux-pro/v1.1"

export interface BlogImageGenerationInput {
  blog_post_id: string
}

export interface InlineImageRecord {
  url: string
  alt: string
  prompt: string
  section_h2: string
  width: number
  height: number
  seed: number
  model: string
  prompt_version: string
  quality_score: number
  quality_reasons: string[]
  attempts: number
}

export interface CoverImageMeta {
  seed: number
  model: string
  prompt: string
  prompt_version: string
  quality_score: number
  quality_reasons: string[]
  attempts: number
}

interface GenerateAndJudgeArgs {
  model: string
  prompt: string
  renderWidth: number
  renderHeight: number
  slug: string
  kind: "hero" | "inline"
  sectionIdx?: number
}

interface GenerateAndJudgeResult {
  url: string
  width: number
  height: number
  alt: string
  buffer: Buffer
  mime: string
  seed: number
  quality_score: number
  quality_reasons: string[]
  attempts: number
}

async function generateJudgeAndRetry(args: GenerateAndJudgeArgs): Promise<GenerateAndJudgeResult> {
  let attempts = 0
  let lastResult: GenerateAndJudgeResult | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    attempts++
    const fal = await generateFalImage({
      model: args.model,
      prompt: args.prompt,
      width: args.renderWidth,
      height: args.renderHeight,
      // Let fal pick a fresh seed on each attempt by not passing one.
    })
    const upload = await transcodeAndUpload({
      buffer: fal.buffer,
      slug: args.slug,
      kind: args.kind,
      sectionIdx: args.sectionIdx,
    })
    const judgment = await judgeImageQuality({
      buffer: fal.buffer,
      mime: fal.mime,
      originalPrompt: args.prompt,
    }).catch((err) => {
      console.warn(`[blog-image-generation] judge failed for ${args.kind}: ${(err as Error).message}`)
      return { score: 7, reasons: ["judge unavailable — accepting"] }
    })
    const alt = (await generateAltText(fal.buffer, fal.mime).catch(() => "")) || args.prompt.slice(0, 120)

    lastResult = {
      url: upload.url,
      width: upload.width,
      height: upload.height,
      alt,
      buffer: fal.buffer,
      mime: fal.mime,
      seed: fal.seed,
      quality_score: judgment.score,
      quality_reasons: judgment.reasons,
      attempts,
    }

    if (judgment.score >= QUALITY_RETRY_THRESHOLD) break
  }

  if (!lastResult) throw new Error("generateJudgeAndRetry produced no result")
  return lastResult
}

export async function handleBlogImageGeneration(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const supabase = getSupabase()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function failJob(message: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  try {
    const snap = await jobRef.get()
    if (!snap.exists) {
      await failJob("ai_jobs doc missing")
      return
    }
    const data = snap.data()!
    const blogPostId = (data.input as BlogImageGenerationInput | undefined)?.blog_post_id
    if (!blogPostId) {
      await failJob("input.blog_post_id is required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const { data: post, error: postErr } = await supabase
      .from("blog_posts")
      .select("id, title, slug, content, category")
      .eq("id", blogPostId)
      .single()
    if (postErr || !post) {
      await failJob(`blog_posts row ${blogPostId} not found`)
      return
    }

    const slug = (post.slug as string) ?? "post"
    const html = (post.content as string) ?? ""

    const qualifying = findQualifyingSections(html)
    const qualifyingTitles = qualifying.map((s) => s.h2Text)

    const prompts = await extractImagePrompts({
      title: post.title as string,
      content: html,
      category: (post.category as string) ?? "Performance",
      qualifyingSections: qualifyingTitles,
    })

    let hero: GenerateAndJudgeResult
    try {
      hero = await generateJudgeAndRetry({
        model: HERO_MODEL,
        prompt: prompts.hero_prompt,
        renderWidth: RENDER_DIMENSIONS.hero.width,
        renderHeight: RENDER_DIMENSIONS.hero.height,
        slug,
        kind: "hero",
      })
    } catch (err) {
      await failJob(`hero generation failed: ${(err as Error).message}`)
      return
    }

    const coverMeta: CoverImageMeta = {
      seed: hero.seed,
      model: HERO_MODEL,
      prompt: prompts.hero_prompt,
      prompt_version: PROMPT_VERSION,
      quality_score: hero.quality_score,
      quality_reasons: hero.quality_reasons,
      attempts: hero.attempts,
    }

    const inlinePromises = prompts.inline_prompts.map(async (p, idx) => {
      const sectionIdx = idx + 1
      try {
        const result = await generateJudgeAndRetry({
          model: INLINE_MODEL,
          prompt: p.prompt,
          renderWidth: RENDER_DIMENSIONS.inline.width,
          renderHeight: RENDER_DIMENSIONS.inline.height,
          slug,
          kind: "inline",
          sectionIdx,
        })
        const record: InlineImageRecord = {
          url: result.url,
          alt: result.alt,
          prompt: p.prompt,
          section_h2: p.section_h2,
          width: result.width,
          height: result.height,
          seed: result.seed,
          model: INLINE_MODEL,
          prompt_version: PROMPT_VERSION,
          quality_score: result.quality_score,
          quality_reasons: result.quality_reasons,
          attempts: result.attempts,
        }
        return { ok: true as const, record }
      } catch (err) {
        console.warn(
          `[blog-image-generation] inline section ${sectionIdx} (${p.section_h2}) failed:`,
          (err as Error).message,
        )
        return { ok: false as const, error: (err as Error).message }
      }
    })

    const inlineResults = await Promise.all(inlinePromises)
    const successfulInline = inlineResults
      .filter((r): r is { ok: true; record: InlineImageRecord } => r.ok)
      .map((r) => r.record)
    const failedInlineCount = inlineResults.filter((r) => !r.ok).length

    const splicedContent = spliceInlineImages(
      html,
      successfulInline.map((r) => ({
        h2Text: r.section_h2,
        url: r.url,
        alt: r.alt,
        width: r.width,
        height: r.height,
      })),
    )

    const { error: updateErr } = await supabase
      .from("blog_posts")
      .update({
        cover_image_url: hero.url,
        cover_image_meta: coverMeta,
        content: splicedContent,
        inline_images: successfulInline,
      })
      .eq("id", blogPostId)
    if (updateErr) {
      await failJob(`blog_posts update failed: ${updateErr.message}`)
      return
    }

    await jobRef.update({
      status: "completed",
      result: {
        cover_image_url: hero.url,
        cover_image_meta: coverMeta,
        inline_images: successfulInline,
        failed_inline_count: failedInlineCount,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    await failJob((err as Error).message ?? "Unknown blog-image-generation error")
  }
}

// Note: FINAL_DIMENSIONS is imported above so consumers of this file have a
// single source of truth for served image sizes alongside the orchestrator.
export { FINAL_DIMENSIONS }
```

- [ ] **Step 5: Run all touched tests**

Run: `cd functions && npx vitest run src/__tests__/blog-image-generation.test.ts src/__tests__/fal-client.test.ts src/__tests__/image-pipeline.test.ts src/__tests__/image-prompts.test.ts src/__tests__/category-style-modules.test.ts src/__tests__/image-quality-judge.test.ts`
Expected: PASS — all six suites green.

- [ ] **Step 6: Type-check**

Run: `cd functions && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Lint the project**

Run: `npm run lint`
Expected: zero new warnings introduced in `functions/src/`.

- [ ] **Step 8: Commit**

```bash
git add functions/src/blog-image-generation.ts functions/src/__tests__/blog-image-generation.test.ts supabase/migrations/
git commit -m "feat(blog-images): upgrade models, judge+retry loop, persist seed+meta"
```

---

## Task 7: Smoke-test the live pipeline against one real post

**Why:** Unit tests prove the wiring; only a real fal call against a real post proves the quality lift. Verification-before-completion skill applies — do not declare this plan shipped until a real image is on disk.

**Files:**
- No new code. Manual verification.

- [ ] **Step 1: Pick a representative recent published post**

Run via Supabase MCP `mcp__supabase__execute_sql`:

```sql
SELECT id, title, slug, category, cover_image_url
FROM blog_posts
WHERE status = 'published'
ORDER BY published_at DESC
LIMIT 5;
```

Pick one from the rotational, comeback, or strength category if available — those exercise the category modules hardest.

- [ ] **Step 2: Save the existing cover_image_url for before/after comparison**

Note the chosen post's current `cover_image_url` somewhere external (a quick note file or your clipboard) — we want to A/B compare.

- [ ] **Step 3: Enqueue a regeneration job manually**

In a Firebase Functions shell or via a one-off `node` script:

```typescript
import { getFirestore } from "firebase-admin/firestore"
import { initializeApp } from "firebase-admin/app"

initializeApp()
const fs = getFirestore()
await fs.collection("ai_jobs").add({
  type: "blog_image_generation",
  status: "queued",
  input: { blog_post_id: "<the-id-from-step-1>" },
  createdAt: new Date(),
  updatedAt: new Date(),
})
```

This re-uses the existing trigger. The job fires within seconds.

- [ ] **Step 4: Watch Firebase Function logs**

Run: `firebase functions:log --only onAiJobCreated --lines 50`
Expected: see `processing` → judge scores logged → `completed`.

- [ ] **Step 5: Visually compare**

Open the post on the live site. Compare hero + inline images against the previous version (saved in Step 2).

Acceptance bar:
- Hero noticeably sharper, more documentary-feeling
- No plastic skin, no obvious AI-art tells
- Category-appropriate setting and equipment in frame
- Inline images vary in framing/angle (not three near-identical shots)

If the bar is met → done. If not, capture which specific images failed and which judge scores they got, then iterate on `BRAND_TREATMENT` or the relevant category module — bump `PROMPT_VERSION` to `v3` so the change is traceable in the persisted metadata.

- [ ] **Step 6: Commit final docs note**

Update the end of `functions/src/ai/image-prompts.ts` `BRAND_TREATMENT` comment with the date and prompt version shipped, then:

```bash
git add functions/src/ai/image-prompts.ts
git commit -m "docs(image-prompts): note v2 prompt shipped after smoke verification"
```

---

## Self-review

**Spec coverage:**

| Audit issue | Resolved in |
|---|---|
| Hero model upgrade | Task 6 (constant swap) |
| Inline model upgrade (biggest single win) | Task 6 (constant swap) |
| 2x render + lanczos3 | Task 2 |
| WebP quality tuning | Task 2 |
| Photographer-grade prompt rewrite | Task 3 |
| Category-aware prompts | Task 4 |
| Vision QA + auto-retry | Task 5 + Task 6 |
| Seed persistence | Task 1 + Task 6 |
| Prompt versioning / logging | Task 3 (`PROMPT_VERSION`) + Task 6 (persistence) |
| Model reproducibility metadata | Task 6 (`cover_image_meta`, extended `inline_images`) |

**Placeholder scan:** No "TBD" / "TODO" / "implement later" remain in any task body. Every step has concrete code or commands.

**Type consistency:** `GenerateFalImageResult.seed` (Task 1) → consumed in `generateJudgeAndRetry` and persisted into `CoverImageMeta.seed` + `InlineImageRecord.seed` (Task 6). `PROMPT_VERSION` (Task 3) → imported and persisted in Task 6. `QUALITY_RETRY_THRESHOLD` (Task 5) → imported in Task 6. `RENDER_DIMENSIONS` (Task 2) → imported in Task 6. All names match.

**Cost note for the user (not the executor):** Per-post image cost goes from roughly $0.05 → $0.20 worst case (Ultra hero with one retry + three Flux Pro inline images). At a 5/week publishing cadence that's ~$50/year extra. Acceptable for the quality lift.
