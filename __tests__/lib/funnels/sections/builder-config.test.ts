// __tests__/lib/funnels/sections/builder-config.test.ts
//
// `builder-config.ts` calls itself a leaf "the UI can read". For three stages
// that was false: it imported `@/lib/ai/anthropic`, which imports
// `@anthropic-ai/sdk` and `ai` and constructs an Anthropic provider AT MODULE
// SCOPE. Anything reaching it inherited the SDK — including
// `lib/validators/funnel.ts`, and through it `lib/funnels/sections/doc.ts`,
// which is why `reassemble` could not be imported in a browser and Stage 1.9
// had to route the publish click through a server action.
//
// A UNIT TEST CANNOT SEE THIS. Importing the module under vitest succeeds
// whether or not it drags an SDK behind it; so does `tsc`, and so does
// `next build`. The only observable is the IMPORT GRAPH, so that is what this
// walks — over the real files on disk, from the real entry points.

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as anthropic from "@/lib/ai/anthropic"
import * as models from "@/lib/ai/models"
import * as config from "@/lib/funnels/sections/builder-config"
// The REAL ceiling the render and the review share, imported rather than
// copied: `SECTION_RENDER_TIMEOUT_MS` is not inside the review stage, so this
// is the only number that actually bounds the two of them together.
import { maxDuration as BUILD_ROUTE_MAX_DURATION } from "@/app/api/admin/funnels/steps/[stepId]/build/route"

const ROOT = process.cwd()

/** `from "..."` in an import, an `export ... from`, or a dynamic `import()`. */
const SPECIFIER = /(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g

/**
 * Comments, removed before the scan — WITHOUT THIS THE WALK IS PROSE-SENSITIVE
 * AND THIS FILE'S CENTRAL ASSERTION IS UNFALSIFIABLE. Found the hard way: the
 * fix that made these tests pass also wrote a header comment on
 * `builder-config.ts` explaining that the import USED to read
 * `from "@/lib/ai/anthropic"`, and the walker counted that sentence as an
 * import. A file would then fail this test for describing its own history, and
 * — far worse — a file could PASS it by importing the SDK while never
 * mentioning the name in prose.
 *
 * `(^|[^:])` on the line-comment rule so a `https://` inside a string literal
 * is not mistaken for the start of a comment and does not eat the rest of the
 * line (a real `from "@/..."` after it would vanish, and this walk's only
 * failure mode that matters is a false NEGATIVE).
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/** `@/x/y` -> the file on disk, or null for a bare package specifier. */
function resolveAlias(specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null
  const base = join(ROOT, specifier.slice(2))
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    try {
      readFileSync(candidate, "utf8")
      return candidate
    } catch {
      /* try the next extension */
    }
  }
  return null
}

/**
 * Every `@/`-aliased module reachable from `entry`, as repo-relative POSIX
 * paths without an extension — the form the assertions below read in.
 *
 * Bare specifiers (`zod`, `parse5`, `@anthropic-ai/sdk`) are not followed:
 * this walk is about which of OUR modules pull which, and a package's own
 * internals cannot be changed by a commit here.
 */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [join(ROOT, entry)]
  while (queue.length > 0) {
    const file = queue.pop() as string
    const key = file.slice(ROOT.length + 1).replace(/\\/g, "/").replace(/\.tsx?$/, "")
    if (seen.has(key)) continue
    seen.add(key)
    const source = stripComments(readFileSync(file, "utf8"))
    for (const match of source.matchAll(SPECIFIER)) {
      const resolved = resolveAlias(match[1])
      if (resolved) queue.push(resolved)
    }
  }
  seen.delete(entry.replace(/\.tsx?$/, ""))
  return seen
}

describe("the import graph the AI page builder's config sits in", () => {
  it("proves the walker actually follows imports (it would otherwise pass on anything)", () => {
    // MUTANT: a `reachableFrom` that returns an empty set — every assertion
    // below would go green while the graph got arbitrarily worse. This is the
    // guard on the guard: `lib/ai/anthropic` DOES reach `lib/ai/models` and
    // `lib/admin-ai-config`, and it must be seen doing so.
    const reached = reachableFrom("lib/ai/anthropic.ts")
    expect(reached).toContain("lib/ai/models")
    expect(reached).toContain("lib/admin-ai-config")
  })

  it("builder-config reaches the Anthropic SDK through nothing at all", () => {
    // MUTANT: the one this file exists for — repoint builder-config's import
    // back to `@/lib/ai/anthropic` (where it pointed for three stages). Nothing
    // else in the suite, in `tsc`, or in `next build` goes red when it does.
    const reached = reachableFrom("lib/funnels/sections/builder-config.ts")
    expect(reached).not.toContain("lib/ai/anthropic")
    expect(reached).toContain("lib/ai/models")
  })

  it("keeps the ids module a true leaf — it must import nothing of ours", () => {
    // MUTANT: adding any `@/` import to `lib/ai/models.ts`. The moment it grows
    // one, the guarantee above stops being about "a file of string constants"
    // and starts depending on whatever that import drags in — silently, with a
    // green build.
    expect(reachableFrom("lib/ai/models.ts").size).toBe(0)
  })

  it("keeps the funnel validators — and so the doc renderer — off the SDK", () => {
    // MUTANT: the same repoint, observed at the chain that actually hurt:
    // doc.ts -> validators/funnel -> builder-config -> the SDK, which is what
    // made `reassemble` un-importable in the browser.
    expect(reachableFrom("lib/validators/funnel.ts")).not.toContain("lib/ai/anthropic")
    expect(reachableFrom("lib/funnels/sections/doc.ts")).not.toContain("lib/ai/anthropic")
  })
})

describe("the model ids were MOVED, not repointed", () => {
  it("re-exports every id from @/lib/ai/anthropic, so no existing importer broke", () => {
    // MUTANT: moving the constants without the re-export. Every call site in
    // the 4-agent pipeline, the strategy agents and the bookkeeper imports them
    // from `@/lib/ai/anthropic`; dropping that line is a compile error there,
    // which this states as a runtime fact so the split is self-documenting.
    expect(anthropic.MODEL_OPUS).toBe(models.MODEL_OPUS)
    expect(anthropic.MODEL_SONNET).toBe(models.MODEL_SONNET)
    expect(anthropic.MODEL_HAIKU).toBe(models.MODEL_HAIKU)
    expect(anthropic.MODEL_OPUS_5).toBe(models.MODEL_OPUS_5)
  })

  it("carries the exact ids the existing pipelines are tuned against", () => {
    // MUTANT: repointing one while moving it — e.g. MODEL_SONNET -> the
    // builder's model. The equality test above would still pass (both sides
    // read the same constant); only the literals catch it, and getting this
    // wrong silently changes behaviour for every AI feature in the app.
    expect(models.MODEL_OPUS).toBe("claude-opus-4-6")
    expect(models.MODEL_SONNET).toBe("claude-sonnet-4-6")
    expect(models.MODEL_HAIKU).toBe("claude-haiku-4-5-20251001")
    expect(models.MODEL_OPUS_5).toBe("claude-opus-5")
  })
})

// ---------------------------------------------------------------------------
// The review stage's tunables.
//
// These are numbers, so the only tests worth writing are the RELATIONSHIPS
// between them — a test asserting `SECTION_REVIEW_CRITIC_MAX_TOKENS === 2000`
// restates the constant and fails the moment someone deliberately tunes it,
// which is a test that costs more than it protects.
// ---------------------------------------------------------------------------

describe("review configuration", () => {
  it("ships with exactly one revise round", () => {
    // Not a taste call: the spec argues a second round oscillates on
    // subjective copy rather than converging, and says to raise this against
    // the surviving-findings evidence rather than on spec.
    expect(config.SECTION_REVIEW_MAX_ROUNDS).toBe(1)
  })

  it("keeps the reviser budget under the non-streaming ceiling", () => {
    // `generateObject` is non-streaming, so a bigger budget is a longer single
    // HTTP request, not just a bigger bill.
    expect(config.SECTION_REVIEW_REVISER_MAX_TOKENS).toBeLessThan(config.SECTION_BUILDER_MAX_TOKENS_CEILING)
  })

  it("gives the reviser the same room as a whole-page edit", () => {
    // A page-wide rhythm finding legitimately produces one op per section.
    expect(config.SECTION_REVIEW_REVISER_MAX_TOKENS).toBe(config.SECTION_BUILDER_EDIT_MAX_TOKENS)
  })

  it("cannot ask for more findings than a batch has ops to fix them with", () => {
    // Otherwise the reviser silently ignores the tail of the list.
    expect(config.SECTION_REVIEW_MAX_FINDINGS).toBeLessThanOrEqual(config.SECTION_BUILDER_MAX_OPS)
  })

  it("gives a critic far less room than the reviser", () => {
    // A critic emitting a document-sized response has misunderstood its job.
    expect(config.SECTION_REVIEW_CRITIC_MAX_TOKENS).toBeLessThan(config.SECTION_REVIEW_REVISER_MAX_TOKENS / 4)
  })

  it("allows the whole stage more wall clock than any single call inside it", () => {
    expect(config.SECTION_REVIEW_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
  })

  it("runs the critics on Sonnet, not on the builder's Opus", () => {
    expect(config.SECTION_REVIEW_CRITIC_MODEL).toBe(models.MODEL_SONNET)
    expect(config.SECTION_REVIEW_CRITIC_MODEL).not.toBe(config.SECTION_BUILDER_MODEL)
  })
})

describe("reference-image tunables", () => {
  // The allowlist is what ANTHROPIC'S VISION ENDPOINT accepts, which is NOT the
  // same list as `app/api/upload/funnel-image/route.ts` (that one also takes
  // image/avif, which Anthropic does not). Two lists that look alike and differ
  // in one member is this repo's divergent-regex bug class; this test states
  // which list this one IS.
  it("allows exactly the four types Anthropic's vision endpoint takes", () => {
    expect([...config.BUILDER_REFERENCE_IMAGE_MEDIA_TYPES].sort()).toEqual([
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ])
  })

  it("does NOT allow avif, which the funnel-image upload route does", () => {
    expect(config.BUILDER_REFERENCE_IMAGE_MEDIA_TYPES).not.toContain("image/avif")
  })

  // 1568px is what Claude downscales to anyway. A larger number would upload
  // pixels the model discards; a smaller one throws away fidelity for free.
  it("targets the long edge Claude itself downscales to", () => {
    expect(config.BUILDER_REFERENCE_IMAGE_MAX_EDGE).toBe(1568)
  })

  // The base64 cap must sit ABOVE a realistic worst case for a 1568px JPEG
  // (~540 KB base64) — a cap below that would reject ordinary screenshots — and
  // the source bound must be looser still, since it is checked BEFORE downscale.
  it("caps base64 above a realistic post-downscale worst case", () => {
    expect(config.BUILDER_REFERENCE_IMAGE_MAX_BASE64).toBeGreaterThan(540_000)
    expect(config.BUILDER_REFERENCE_IMAGE_MAX_BASE64).toBe(2_000_000)
  })

  it("bounds the source file more loosely than the encoded payload", () => {
    expect(config.BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES).toBeGreaterThan(
      config.BUILDER_REFERENCE_IMAGE_MAX_BASE64 * 0.75,
    )
    expect(config.BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES).toBe(10 * 1024 * 1024)
  })
})

// ---------------------------------------------------------------------------
// The self-render tunables (Phase 2, "give the builder's AI eyes").
// ---------------------------------------------------------------------------

describe("self-render tunables", () => {
  it("keeps every tile's long edge under Anthropic's 1568px downscale threshold", () => {
    // The whole point of tiling: a tile that gets downscaled is a tile the
    // critic has to guess at. Measured: a full 1200x5242 page arrives as
    // 359x1568 with ~4px body copy.
    expect(config.SECTION_RENDER_TILE_HEIGHT).toBeLessThan(1568)
    expect(config.SECTION_RENDER_VIEWPORT_WIDTH).toBeLessThan(1568)
  })

  it("leaves the build route headroom for the render AND the review it precedes", () => {
    // THIS USED TO ASSERT `RENDER < REVIEW` UNDER THE NAME "cannot outlive the
    // review stage that contains it". No stage contains it: the route calls
    // `renderDocToImages` in `runReviewStage` BEFORE `reviewDoc`, and
    // SECTION_REVIEW_TIMEOUT_MS wraps `runReview` alone inside pipeline.ts. So
    // the inequality was true, unrelated to its name, and could not fail for
    // the reason it claimed. The two budgets are SEQUENTIAL, and the only
    // thing bounding the pair is the route's own maxDuration — imported here
    // rather than copied, so moving it moves this test with it.
    const budget = config.SECTION_RENDER_TIMEOUT_MS + config.SECTION_REVIEW_TIMEOUT_MS
    expect(budget).toBeLessThan(BUILD_ROUTE_MAX_DURATION * 1000)
    // ...with room left for the rest of the turn — the catalogue reads, the
    // save, and the flush of the terminal event after the review returns.
    // Overrunning maxDuration kills the function mid-stream, and a stream that
    // ends with no terminal event reads to the client as a dropped connection.
    expect(BUILD_ROUTE_MAX_DURATION * 1000 - budget).toBeGreaterThanOrEqual(120_000)
  })

  it("bounds the worst-case image count", () => {
    expect(config.SECTION_RENDER_MAX_TILES).toBeGreaterThan(0)
    expect(config.SECTION_RENDER_MAX_TILES).toBeLessThanOrEqual(8)
  })

  it("is on by default", () => {
    expect(config.SECTION_RENDER_ENABLED).toBe(true)
  })
})
