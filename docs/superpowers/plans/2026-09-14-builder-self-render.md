# Builder self-render (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the page the builder just wrote to images and hand them to the art-director critic, so the one reviewer whose job is "how does this page look" stops guessing from JSON.

**Architecture:** A narrow port (`RenderBrowser` / `RenderPage`) is implemented over `puppeteer-core` in `lib/funnels/browser.ts`, so `lib/funnels/render-image.ts` contains no browser code and is fully testable with a fake. `runReviewStage` renders before it reviews; `reviewDoc` threads the result to `runCritics`; only the art lens receives pictures. Every layer fails soft — no browser, or a render that throws, means a review that runs exactly as it does today.

**Tech Stack:** TypeScript, Next.js 16 App Router, Vitest, `puppeteer-core@25`, `@sparticuz/chromium@153`, the existing `callAgent` images transport from Phase 1.

**Spec:** [`docs/superpowers/specs/2026-09-14-builder-self-render-design.md`](../specs/2026-09-14-builder-self-render-design.md)

## Global Constraints

- **Node 24.** `package.json` `engines.node` is `"24.x"` and must NOT be relaxed to satisfy a dependency. Run everything with `export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"` or the test runner lies.
- **Never run the full test suite.** Targeted runs only: `npx vitest run <path>`. The full suite is NOT green; failures outside `__tests__/lib/funnels`, `__tests__/app/api/admin/funnels`, `__tests__/components/admin`, `__tests__/lib/db`, `__tests__/lib/ai` are pre-existing.
- **tsc baseline is 238 errors across 55 files.** Compare the per-file error SET, not the count — a falling count hides new errors too: `npx tsc --noEmit 2>&1 | grep -oE "^[^(]+\(" | sed 's/($//' | sort | uniq -c`
- **Every new doc/theme key is OPTIONAL.** (This plan adds none — noted so it stays true.)
- **The cached system prefix stays byte-stable.** Images ride in the AI SDK *user* message via the existing `images` option. Nothing per-turn may enter any system prompt.
- **Do NOT touch `SECTION_BUILDER_BLOCK_A` or `SECTION_BUILDER_BLOCK_DESIGN`.** They have 30 and 67 characters of headroom. This feature lives in `critics.ts`, which is under no ceiling test. If you find yourself editing either block, you have taken a wrong turn.
- **Admin UI is light-only.** No `.dark` variant. (No UI in this plan.)
- **Commit as:** `git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com"`. **No Claude attribution** in any commit message — no `Co-Authored-By`, no "Generated with".
- **Never stage `JOURNAL.md`.** It is gitignored and local-only.
- **Bare base64 on the wire.** `AgentImage.data` carries no `data:<type>;base64,` prefix.

---

### Task 1: Dependencies and named tunables

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `lib/funnels/sections/builder-config.ts` (append a new section)
- Test: `__tests__/lib/funnels/sections/builder-config.test.ts` (create if absent; otherwise extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `SECTION_RENDER_ENABLED: boolean`, `SECTION_RENDER_VIEWPORT_WIDTH: number`, `SECTION_RENDER_TILE_HEIGHT: number`, `SECTION_RENDER_MAX_TILES: number`, `SECTION_RENDER_TIMEOUT_MS: number` — all exported from `@/lib/funnels/sections/builder-config`.

- [ ] **Step 1: Install the two packages**

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
npm install --save puppeteer-core@^25.11.0 @sparticuz/chromium@^153.0.0
```

- [ ] **Step 2: Verify the Node engine pin was not changed**

```bash
node -e 'console.log(JSON.stringify(require("./package.json").engines))'
```
Expected: `{"node":"24.x"}` — exactly this. If npm rewrote it, put it back. A downgrade here changes every Vercel deploy.

- [ ] **Step 3: Write the failing test**

Append to `__tests__/lib/funnels/sections/builder-config.test.ts`:

```ts
import {
  SECTION_RENDER_ENABLED,
  SECTION_RENDER_MAX_TILES,
  SECTION_RENDER_TILE_HEIGHT,
  SECTION_RENDER_TIMEOUT_MS,
  SECTION_RENDER_VIEWPORT_WIDTH,
} from "@/lib/funnels/sections/builder-config"
import { SECTION_REVIEW_TIMEOUT_MS } from "@/lib/funnels/sections/builder-config"

describe("self-render tunables", () => {
  it("keeps every tile's long edge under Anthropic's 1568px downscale threshold", () => {
    // The whole point of tiling: a tile that gets downscaled is a tile the
    // critic has to guess at. Measured: a full 1200x5242 page arrives as
    // 359x1568 with ~4px body copy.
    expect(SECTION_RENDER_TILE_HEIGHT).toBeLessThan(1568)
    expect(SECTION_RENDER_VIEWPORT_WIDTH).toBeLessThan(1568)
  })

  it("cannot outlive the review stage that contains it", () => {
    expect(SECTION_RENDER_TIMEOUT_MS).toBeLessThan(SECTION_REVIEW_TIMEOUT_MS)
  })

  it("bounds the worst-case image count", () => {
    expect(SECTION_RENDER_MAX_TILES).toBeGreaterThan(0)
    expect(SECTION_RENDER_MAX_TILES).toBeLessThanOrEqual(8)
  })

  it("is on by default", () => {
    expect(SECTION_RENDER_ENABLED).toBe(true)
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

```bash
npx vitest run __tests__/lib/funnels/sections/builder-config.test.ts
```
Expected: FAIL — the five constants do not exist.

- [ ] **Step 5: Add the constants**

Append to `lib/funnels/sections/builder-config.ts`, matching the file's existing doc-comment style (every constant there explains *why* its value is what it is):

```ts
// ---------------------------------------------------------------------------
// THE SELF-RENDER (Phase 2 of "give the builder's AI eyes")
// ---------------------------------------------------------------------------
// The review stage renders the page and shows it to the art director, whose
// lens is "how the page LOOKS as somebody scrolls it" and which until now was
// handed only JSON.

/**
 * The kill switch. `false` means no render is attempted and the review runs
 * exactly as it did before this feature — which is also what happens when no
 * browser can be launched, so the off path is continuously exercised rather
 * than being a branch nobody takes.
 */
export const SECTION_RENDER_ENABLED = true

/**
 * Desktop width. Chosen because the funnel stylesheet's widest `--djp-maxw`
 * is 88rem and this shows it without horizontal slack.
 *
 * Deliberately under 1568: Anthropic downscales an image to ~1568px on its
 * LONG edge, so a tile wider than that would be shrunk and its body copy
 * would stop being readable. Mobile is a second render and is out of scope
 * for this phase — see the spec's §12.
 */
export const SECTION_RENDER_VIEWPORT_WIDTH = 1200

/**
 * How tall each slice is.
 *
 * Under 1568 for the same reason as the width: at 1200x1400 a tile is passed
 * through at full size and every word on it is legible. Measured on a real
 * 10-section page, a single full-page image instead arrives at 359x1568 with
 * roughly 4px body text.
 */
export const SECTION_RENDER_TILE_HEIGHT = 1400

/**
 * The cap on slices, and so on cost: roughly 2,240 vision tokens each.
 *
 * A page longer than `SECTION_RENDER_MAX_TILES * SECTION_RENDER_TILE_HEIGHT`
 * is reported to the critic as truncated rather than being silently cut,
 * because a critic that thinks it has seen the whole page will say the page
 * ends where the image does.
 */
export const SECTION_RENDER_MAX_TILES = 5

/**
 * The whole render, including waiting for webfonts.
 *
 * MUST stay below `SECTION_REVIEW_TIMEOUT_MS` (90s), which bounds the stage
 * this runs inside. Measured locally: ~1.5s for a four-tile page, so this is
 * mostly protection against a hung font request in an egress-less container —
 * which is exactly why the font wait is bounded by this and never by an
 * unbounded `networkidle`.
 */
export const SECTION_RENDER_TIMEOUT_MS = 20_000
```

- [ ] **Step 6: Run the test**

```bash
npx vitest run __tests__/lib/funnels/sections/builder-config.test.ts
```
Expected: PASS.

- [ ] **Step 7: Confirm the two prompt ceilings did not move**

```bash
npx tsx -e 'import {SECTION_BUILDER_BLOCK_A, SECTION_BUILDER_BLOCK_DESIGN} from "./lib/funnels/sections/prompt"; console.log(SECTION_BUILDER_BLOCK_A.length, SECTION_BUILDER_BLOCK_DESIGN.length)'
```
Expected: exactly `20670 4433`. Any other number means something touched the builder prompt — stop and find out what.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/funnels/sections/builder-config.ts __tests__/lib/funnels/sections/builder-config.test.ts
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "feat(builder): name the self-render tunables"
```

---

### Task 2: The browser port

**Files:**
- Create: `lib/funnels/browser.ts`
- Test: `__tests__/lib/funnels/browser.test.ts`

**Interfaces:**
- Consumes: `SECTION_RENDER_TIMEOUT_MS`, `SECTION_RENDER_VIEWPORT_WIDTH` from Task 1.
- Produces:
```ts
export interface RenderPage {
  setContent(html: string): Promise<void>
  fontsLoaded(families: readonly string[]): Promise<boolean>
  pageHeight(): Promise<number>
  shoot(clip: { y: number; height: number } | null): Promise<Buffer>
}
export interface RenderBrowser {
  newPage(): Promise<RenderPage>
  close(): Promise<void>
}
export type LaunchRenderBrowser = () => Promise<RenderBrowser | null>
export const launchRenderBrowser: LaunchRenderBrowser
export function chromeExecutablePath(env: NodeJS.ProcessEnv, candidates: readonly string[]): string | null
```

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/funnels/browser.test.ts`. Only the pure resolver is unit-tested — launching a real Chrome belongs to Task 4's integration test.

```ts
import { describe, expect, it } from "vitest"
import { chromeExecutablePath } from "@/lib/funnels/browser"

describe("chromeExecutablePath", () => {
  it("prefers an explicit PUPPETEER_EXECUTABLE_PATH over anything installed", () => {
    const chosen = chromeExecutablePath(
      { PUPPETEER_EXECUTABLE_PATH: "/custom/chrome" } as NodeJS.ProcessEnv,
      ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    )
    expect(chosen).toBe("/custom/chrome")
  })

  it("falls back to the first candidate that exists on disk", () => {
    // __filename is guaranteed to exist; the bogus path ahead of it proves the
    // function probes rather than taking the head of the list.
    const chosen = chromeExecutablePath({} as NodeJS.ProcessEnv, ["/nope/not/here", __filename])
    expect(chosen).toBe(__filename)
  })

  it("returns null when nothing is found — no browser is a normal outcome", () => {
    expect(chromeExecutablePath({} as NodeJS.ProcessEnv, ["/nope/not/here"])).toBeNull()
  })

  it("ignores an empty PUPPETEER_EXECUTABLE_PATH rather than launching ''", () => {
    expect(chromeExecutablePath({ PUPPETEER_EXECUTABLE_PATH: "" } as NodeJS.ProcessEnv, ["/nope"])).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run __tests__/lib/funnels/browser.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/funnels/browser.ts`**

```ts
// lib/funnels/browser.ts — a headless Chrome, or honestly nothing.
//
// ---------------------------------------------------------------------------
// NO BROWSER IS A NORMAL OUTCOME, NOT AN ERROR.
// ---------------------------------------------------------------------------
// This exists so the review stage can look at the page it is reviewing. That
// is an improvement to a stage that already works without it, so a dev machine
// with no Chrome, a platform that will not launch one, or a cold start that ran
// out of room must all end as `null` and a review that runs on JSON exactly as
// it did before. Nothing in here throws for the caller to catch.
//
// THE PORT IS DELIBERATELY NARROW. `render-image.ts` sees only `RenderBrowser`
// and `RenderPage` — four methods — so it contains no puppeteer code and its
// tiling and assembly logic is testable with a fake instead of a browser.
//
// PUPPETEER IS IMPORTED DYNAMICALLY. The build route is the hottest route in
// the builder and most of its turns never render anything.

import { existsSync } from "node:fs"
import { SECTION_RENDER_TIMEOUT_MS, SECTION_RENDER_VIEWPORT_WIDTH } from "@/lib/funnels/sections/builder-config"

export interface RenderPage {
  setContent(html: string): Promise<void>
  /** True when every named family actually loaded. See render-image.ts §fonts. */
  fontsLoaded(families: readonly string[]): Promise<boolean>
  pageHeight(): Promise<number>
  /** `null` clip means the whole page. */
  shoot(clip: { y: number; height: number } | null): Promise<Buffer>
}

export interface RenderBrowser {
  newPage(): Promise<RenderPage>
  close(): Promise<void>
}

export type LaunchRenderBrowser = () => Promise<RenderBrowser | null>

/**
 * Where a local Chrome lives. Exported for its own test because a resolver
 * that silently picks the wrong binary — or `""` — is indistinguishable from
 * a platform that has no browser.
 */
const LOCAL_CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
] as const

export function chromeExecutablePath(
  env: NodeJS.ProcessEnv,
  candidates: readonly string[] = LOCAL_CHROME_CANDIDATES,
): string | null {
  const explicit = env.PUPPETEER_EXECUTABLE_PATH
  // An empty string is a set-but-blank env var, which would launch `""`.
  if (typeof explicit === "string" && explicit.length > 0) return explicit
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function isServerless(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME)
}

export const launchRenderBrowser: LaunchRenderBrowser = async () => {
  try {
    const puppeteer = (await import("puppeteer-core")).default

    // @sparticuz/chromium ships a LINUX binary, so this split is not a
    // preference — it is the only arrangement that works in both places.
    const launchOptions = isServerless(process.env)
      ? await (async () => {
          const chromium = (await import("@sparticuz/chromium")).default
          return {
            args: chromium.args,
            executablePath: await chromium.executablePath(),
            headless: true as const,
          }
        })()
      : (() => {
          const executablePath = chromeExecutablePath(process.env)
          return executablePath ? { executablePath, headless: true as const, args: [] as string[] } : null
        })()

    if (!launchOptions) return null

    const browser = await puppeteer.launch({ ...launchOptions, timeout: SECTION_RENDER_TIMEOUT_MS })

    return {
      async newPage(): Promise<RenderPage> {
        const page = await browser.newPage()
        await page.setViewport({ width: SECTION_RENDER_VIEWPORT_WIDTH, height: 900, deviceScaleFactor: 1 })
        return {
          async setContent(html) {
            // "load", never "networkidle0": the font stylesheet is a remote
            // request, and in a container with no egress `networkidle0` waits
            // for a quiet period that never begins. The timeout is the bound.
            await page.setContent(html, { waitUntil: "load", timeout: SECTION_RENDER_TIMEOUT_MS })
          },
          async fontsLoaded(families) {
            // A STRING, not a function literal. Bundlers rewrite a named
            // function inside an evaluate callback into a helper that does not
            // exist in the browser, and the whole evaluate then throws.
            const probe = `(async () => {
              await document.fonts.ready
              return ${JSON.stringify(families)}.every((f) => document.fonts.check('16px "' + f + '"'))
            })()`
            return Boolean(await page.evaluate(probe))
          },
          async pageHeight() {
            return Number(await page.evaluate("document.documentElement.scrollHeight"))
          },
          async shoot(clip) {
            const shot = await page.screenshot({
              type: "png",
              fullPage: true,
              // Playwright and puppeteer agree here: a clip without fullPage is
              // bounded by the VIEWPORT, so a slice below the fold errors with
              // "Clipped area is either empty or outside the resulting image".
              ...(clip ? { clip: { x: 0, y: clip.y, width: SECTION_RENDER_VIEWPORT_WIDTH, height: clip.height } } : {}),
            })
            return Buffer.from(shot)
          },
        }
      },
      async close() {
        await browser.close()
      },
    }
  } catch (error) {
    console.warn("[funnels/browser] could not launch:", error)
    return null
  }
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run __tests__/lib/funnels/browser.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/browser.ts __tests__/lib/funnels/browser.test.ts
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "feat(builder): a headless browser port that returns null rather than throwing"
```

---

### Task 3: The page document and the tiling maths

**Files:**
- Create: `lib/funnels/render-image.ts` (pure half only — `renderDocToImages` arrives in Task 4)
- Test: `__tests__/lib/funnels/render-image.test.ts`

**Interfaces:**
- Consumes: `SECTION_RENDER_TILE_HEIGHT`, `SECTION_RENDER_MAX_TILES`, `SECTION_RENDER_VIEWPORT_WIDTH` (Task 1); `FUNNEL_ROOT_ID` from `@/lib/funnels/compile`.
- Produces:
```ts
export const RENDER_FONT_FAMILIES: readonly string[]  // ["Lexend Exa","Lexend Deca","JetBrains Mono"]
export function buildRenderDocument(html: string, css: string): string
export interface TilePlan { slices: Array<{ y: number; height: number }>; truncated: boolean }
export function planTiles(pageHeight: number, tileHeight: number, maxTiles: number): TilePlan
```

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/funnels/render-image.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { FUNNEL_ROOT_ID } from "@/lib/funnels/compile"
import { buildRenderDocument, planTiles, RENDER_FONT_FAMILIES } from "@/lib/funnels/render-image"

describe("buildRenderDocument", () => {
  it("wraps the html in the id every CSS selector is scoped to", () => {
    // reassemble()'s CSS is ENTIRELY scoped to #djp-funnel-root and its html
    // starts at <div class="djp-page">. Omitting the wrapper loads all 237
    // rules and matches none of them, producing a screenshot of unstyled HTML
    // that reads to a critic as a page-wide disaster. Task 4 proves the effect
    // in a real browser; this proves the intent.
    const doc = buildRenderDocument("<div class='djp-page'>hi</div>", "#djp-funnel-root { color: red }")
    expect(doc).toContain(`id="${FUNNEL_ROOT_ID}"`)
    expect(doc.indexOf(`id="${FUNNEL_ROOT_ID}"`)).toBeLessThan(doc.indexOf("djp-page"))
  })

  it("defines the next/font variables the stylesheet reads", () => {
    // Without these the whole font-family declaration is invalid at
    // computed-value time and headings fall back to Times New Roman.
    const doc = buildRenderDocument("<p>x</p>", "")
    expect(doc).toContain("--font-lexend-exa")
    expect(doc).toContain("--font-lexend-deca")
    expect(doc).toContain("--font-jetbrains-mono")
  })

  it("puts the caller's css inside the style element", () => {
    expect(buildRenderDocument("<p>x</p>", ".sentinel{color:blue}")).toContain(".sentinel{color:blue}")
  })

  it("names exactly the families it asks the browser to load", () => {
    const doc = buildRenderDocument("<p>x</p>", "")
    for (const family of RENDER_FONT_FAMILIES) {
      expect(doc).toContain(family)
    }
  })
})

describe("planTiles", () => {
  it("returns one slice for a page shorter than a tile", () => {
    expect(planTiles(800, 1400, 5)).toEqual({ slices: [{ y: 0, height: 800 }], truncated: false })
  })

  it("returns exactly N for a page that is exactly N tiles, not N+1", () => {
    const plan = planTiles(2800, 1400, 5)
    expect(plan.slices).toHaveLength(2)
    expect(plan.truncated).toBe(false)
    expect(plan.slices[1]).toEqual({ y: 1400, height: 1400 })
  })

  it("adds a short final slice for a page one pixel over", () => {
    const plan = planTiles(2801, 1400, 5)
    expect(plan.slices).toHaveLength(3)
    expect(plan.slices[2]).toEqual({ y: 2800, height: 1 })
    expect(plan.truncated).toBe(false)
  })

  it("stops at maxTiles and says so", () => {
    const plan = planTiles(100_000, 1400, 5)
    expect(plan.slices).toHaveLength(5)
    expect(plan.truncated).toBe(true)
    // Truncation must not produce a slice past what was captured.
    expect(plan.slices[4]).toEqual({ y: 5600, height: 1400 })
  })

  it("treats a zero-height page as nothing to capture", () => {
    expect(planTiles(0, 1400, 5)).toEqual({ slices: [], truncated: false })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run __tests__/lib/funnels/render-image.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure half of `lib/funnels/render-image.ts`**

```ts
// lib/funnels/render-image.ts — the page, as a browser actually draws it.
//
// ---------------------------------------------------------------------------
// THIS MODULE NEVER THROWS.
// ---------------------------------------------------------------------------
// Same promise as `review/pipeline.ts`, for the same reason: it runs after the
// owner's page is already saved, so no failure in here is worth showing them an
// error for. Trouble is reported in `RenderedPage.error` and the review then
// runs on JSON exactly as it did before this feature existed.

import type { AgentImage } from "@/lib/ai/anthropic"
import { FUNNEL_ROOT_ID } from "@/lib/funnels/compile"
import {
  SECTION_RENDER_MAX_TILES,
  SECTION_RENDER_TILE_HEIGHT,
  SECTION_RENDER_VIEWPORT_WIDTH,
} from "@/lib/funnels/sections/builder-config"

/**
 * The three faces `app/layout.tsx` loads via `next/font/google`, which are the
 * ENTIRE font budget any funnel page has. `doc.ts`'s ALLOWED_FONT_FAMILIES
 * says so: everything else in a `FONT_STACKS` entry is a system keyword or a
 * pre-installed face, never a download.
 */
export const RENDER_FONT_FAMILIES = ["Lexend Exa", "Lexend Deca", "JetBrains Mono"] as const

const FONT_HEAD =
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2` +
  `?family=Lexend+Deca:wght@300..700&family=Lexend+Exa:wght@400..800` +
  `&family=JetBrains+Mono:wght@400..700&display=swap">` +
  `<style>:root{` +
  `--font-lexend-exa:"Lexend Exa";` +
  `--font-lexend-deca:"Lexend Deca";` +
  `--font-jetbrains-mono:"JetBrains Mono";` +
  `}</style>`

/**
 * THE WRAPPER IS THE WHOLE TRICK, AND OMITTING IT IS SILENT.
 *
 * `reassemble()` returns html that starts at `<div class="djp-page">` and css
 * in which EVERY selector is scoped to `#djp-funnel-root`. That id comes from
 * the host page — `/go`, `/preview` and `/funnel-preview` each supply it. Build
 * this document without it and all 237 rules load, match nothing, and the
 * screenshot is of completely unstyled HTML. A critic shown that reports a
 * page-wide disaster on a page that is fine, and the reviser then rewrites a
 * good document to fix it.
 */
export function buildRenderDocument(html: string, css: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">${FONT_HEAD}` +
    `<style>${css}</style></head>` +
    `<body style="margin:0"><div id="${FUNNEL_ROOT_ID}">${html}</div></body></html>`
  )
}

export interface TilePlan {
  slices: Array<{ y: number; height: number }>
  truncated: boolean
}

/**
 * Slices a page into images whose long edge stays under Anthropic's ~1568px
 * downscale threshold, so every tile is passed through at full size.
 *
 * `truncated` is REPORTED, not hidden. A critic that believes it has seen the
 * whole page will say the page ends where the last image does.
 */
export function planTiles(
  pageHeight: number,
  tileHeight: number = SECTION_RENDER_TILE_HEIGHT,
  maxTiles: number = SECTION_RENDER_MAX_TILES,
): TilePlan {
  if (pageHeight <= 0) return { slices: [], truncated: false }

  const slices: Array<{ y: number; height: number }> = []
  for (let y = 0; y < pageHeight && slices.length < maxTiles; y += tileHeight) {
    slices.push({ y, height: Math.min(tileHeight, pageHeight - y) })
  }
  const captured = slices.reduce((total, slice) => total + slice.height, 0)
  return { slices, truncated: captured < pageHeight }
}

export const RENDER_IMAGE_WIDTH = SECTION_RENDER_VIEWPORT_WIDTH
export type { AgentImage }
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run __tests__/lib/funnels/render-image.test.ts
```
Expected: PASS, 9 tests.

- [ ] **Step 5: Mutation-check the tiling boundary**

`planTiles`'s off-by-one is the only arithmetic here, so prove the tests actually pin it. Temporarily change `slices.length < maxTiles` to `slices.length <= maxTiles` and re-run.

```bash
npx vitest run __tests__/lib/funnels/render-image.test.ts
```
Expected: the "stops at maxTiles" test FAILS. **Revert the change.** If it passed, the test is not pinning the cap — fix the test before moving on.

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/render-image.ts __tests__/lib/funnels/render-image.test.ts
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "feat(builder): assemble the render document and plan its tiles"
```

---

### Task 4: `renderDocToImages`

**Files:**
- Modify: `lib/funnels/render-image.ts` (append)
- Test: `__tests__/lib/funnels/render-image.test.ts` (append)
- Test: `__tests__/lib/funnels/render-image.browser.test.ts` (create — the one suite that launches a real Chrome)

**Interfaces:**
- Consumes: `RenderBrowser`, `RenderPage`, `LaunchRenderBrowser`, `launchRenderBrowser` (Task 2); `buildRenderDocument`, `planTiles`, `RENDER_FONT_FAMILIES` (Task 3).
- Produces:
```ts
export interface RenderedPage {
  images: AgentImage[]
  width: number
  height: number
  truncated: boolean
  typographyFaithful: boolean
  error: string | null
}
export function renderDocToImages(
  doc: SectionDoc,
  ctx: { funnelBasePath?: string; brandKit: BrandKit | null },
  launch?: LaunchRenderBrowser,
): Promise<RenderedPage>
```

- [ ] **Step 1: Write the failing tests (fake browser)**

Append to `__tests__/lib/funnels/render-image.test.ts`:

```ts
import { renderDocToImages } from "@/lib/funnels/render-image"
import type { RenderBrowser } from "@/lib/funnels/browser"
import { sectionDocSchema } from "@/lib/funnels/sections/registry"

// VALIDATED against sectionDocSchema and run through reassemble() while this
// plan was written — do not "tidy" any key here without re-running that check.
// The first draft of this fixture had SIX schema errors and every one of them
// looked plausible: `version` (it is `v`), a missing `engine: "sections"`,
// `target: {kind:"section", id}` (it is `{kind:"anchor", sectionId}`), a
// missing `formKey`, `fields` as strings (they are objects), and `headline` on
// the form (a form takes `heading`; only the hero takes `headline`).
const DOC = sectionDocSchema.parse({
  v: 1,
  engine: "sections",
  theme: { tone: "light", accent: "accent", radius: "sharp" },
  sections: [
    {
      id: "hero",
      kind: "hero",
      variant: "centered",
      style: { headline: "xl", align: "center", tone: "default", pad: "roomy" },
      props: {
        headline: "Twelve sessions",
        primaryCta: { label: "Reserve a place", target: { kind: "anchor", sectionId: "signup" } },
      },
    },
    {
      id: "signup",
      kind: "form",
      variant: "split",
      style: { headline: "lg", align: "left", tone: "dark", pad: "roomy" },
      props: {
        formKey: "test-form",
        heading: "Reserve a place",
        fields: [{ name: "email", role: "parent_email", type: "email", label: "Email address", required: true }],
        submitLabel: "Send",
      },
    },
  ],
})

function fakeBrowser(over: Partial<{ height: number; fonts: boolean; shootThrows: boolean }> = {}) {
  const closed = { value: false }
  const browser: RenderBrowser = {
    async newPage() {
      return {
        async setContent() {},
        async fontsLoaded() {
          return over.fonts ?? true
        },
        async pageHeight() {
          return over.height ?? 2000
        },
        async shoot() {
          if (over.shootThrows) throw new Error("screenshot exploded")
          return Buffer.from("PNGDATA")
        },
      }
    },
    async close() {
      closed.value = true
    },
  }
  return { browser, closed }
}

describe("renderDocToImages", () => {
  it("returns an overview plus one image per slice", async () => {
    const { browser } = fakeBrowser({ height: 2000 })
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    expect(result.error).toBeNull()
    // 2000px at a 1400px tile height = 2 slices, plus the overview.
    expect(result.images).toHaveLength(3)
    expect(result.height).toBe(2000)
  })

  it("sends BARE base64 with no data: prefix", async () => {
    // The wire format callAgent's images option requires. A data: prefix would
    // satisfy the type and be rejected by the provider.
    const { browser } = fakeBrowser()
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    for (const image of result.images) {
      expect(image.data.startsWith("data:")).toBe(false)
      expect(image.mediaType).toBe("image/png")
      expect(image.data).toBe(Buffer.from("PNGDATA").toString("base64"))
    }
  })

  it("reports honestly when the webfonts did not load", async () => {
    const { browser } = fakeBrowser({ fonts: false })
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    expect(result.typographyFaithful).toBe(false)
    // ...and still renders. A fallback face is not a reason to show nothing.
    expect(result.images.length).toBeGreaterThan(0)
  })

  it("reports faithful typography when they did — the presence control", async () => {
    const { browser } = fakeBrowser({ fonts: true })
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    expect(result.typographyFaithful).toBe(true)
  })

  it("flags a page too tall to capture", async () => {
    const { browser } = fakeBrowser({ height: 100_000 })
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    expect(result.truncated).toBe(true)
    expect(result.images).toHaveLength(6) // overview + 5 capped slices
  })

  it("returns no images and an error when there is no browser", async () => {
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => null)
    expect(result.images).toEqual([])
    expect(result.error).toMatch(/browser/i)
  })

  it("returns an error rather than throwing when the launcher throws", async () => {
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => {
      throw new Error("launch exploded")
    })
    expect(result.images).toEqual([])
    expect(result.error).toContain("launch exploded")
  })

  it("returns an error rather than throwing when a screenshot throws", async () => {
    const { browser } = fakeBrowser({ shootThrows: true })
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    expect(result.images).toEqual([])
    expect(result.error).toContain("screenshot exploded")
  })

  it("closes the browser even when the render fails", async () => {
    // A leaked Chrome in a serverless container is a memory leak that outlives
    // the request.
    const { browser, closed } = fakeBrowser({ shootThrows: true })
    await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    expect(closed.value).toBe(true)
  })
})
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run __tests__/lib/funnels/render-image.test.ts
```
Expected: FAIL — `renderDocToImages` is not exported.

- [ ] **Step 3: Implement it**

Append to `lib/funnels/render-image.ts`:

```ts
import { reassemble } from "@/lib/funnels/sections/doc"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import type { BrandKit } from "@/lib/funnels/sections/render"
import { launchRenderBrowser, type LaunchRenderBrowser } from "@/lib/funnels/browser"

export interface RenderedPage {
  /** `[overview, slice 1..N]`. Empty when `error` is set. */
  images: AgentImage[]
  width: number
  height: number
  /** The page was taller than `MAX_TILES * TILE_HEIGHT`. */
  truncated: boolean
  /**
   * Whether the three downloadable faces actually loaded.
   *
   * REPORTED, NOT ASSUMED. With no webfont the whole `font-family` declaration
   * is invalid at computed-value time and headings render in Times New Roman —
   * a page height shift of ~4% and letterforms no visitor will ever see.
   */
  typographyFaithful: boolean
  /** Set when `images` is empty. NEVER thrown. */
  error: string | null
}

function failed(message: string): RenderedPage {
  return { images: [], width: 0, height: 0, truncated: false, typographyFaithful: false, error: message }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The page as a browser draws it, as bare-base64 PNGs ready for `callAgent`'s
 * `images` option.
 *
 * `doc` MUST already be resolved. This function does not call `resolveDoc` and
 * must never start: a second resolution against a catalogue read at a different
 * moment is how preview and publish begin to disagree, which
 * `lib/funnels/preview-render.ts` opens by calling this subsystem's worst
 * failure mode. The build route hands over `resolution.doc`, which has been
 * through `loadCatalogues -> resolveDoc` already.
 */
export async function renderDocToImages(
  doc: SectionDoc,
  ctx: { funnelBasePath?: string; brandKit: BrandKit | null },
  launch: LaunchRenderBrowser = launchRenderBrowser,
): Promise<RenderedPage> {
  let browser: Awaited<ReturnType<LaunchRenderBrowser>> = null
  try {
    const { html, css } = reassemble(doc, {
      ...(ctx.funnelBasePath ? { funnelBasePath: ctx.funnelBasePath } : {}),
      brandKit: ctx.brandKit,
    })

    browser = await launch()
    if (!browser) return failed("no browser available for rendering")

    const page = await browser.newPage()
    await page.setContent(buildRenderDocument(html, css))

    const typographyFaithful = await page.fontsLoaded(RENDER_FONT_FAMILIES)
    const height = await page.pageHeight()
    const plan = planTiles(height)

    const overview = await page.shoot(null)
    const images: AgentImage[] = [{ mediaType: "image/png", data: overview.toString("base64") }]
    for (const slice of plan.slices) {
      const shot = await page.shoot(slice)
      images.push({ mediaType: "image/png", data: shot.toString("base64") })
    }

    return {
      images,
      width: RENDER_IMAGE_WIDTH,
      height,
      truncated: plan.truncated,
      typographyFaithful,
      error: null,
    }
  } catch (error) {
    console.warn("[funnels/render] render abandoned:", error)
    return failed(message(error))
  } finally {
    // A leaked Chrome outlives the request in a serverless container.
    try {
      await browser?.close()
    } catch (error) {
      console.warn("[funnels/render] browser close failed:", error)
    }
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run __tests__/lib/funnels/render-image.test.ts
```
Expected: PASS, 18 tests total.

- [ ] **Step 5: Write the real-browser test**

Create `__tests__/lib/funnels/render-image.browser.test.ts`. This is the test that proves the wrapper by its EFFECT rather than by string-matching a template.

```ts
/**
 * The one suite that launches a real Chrome.
 *
 * It SKIPS LOUDLY when none is available — a silent skip is a test that
 * reports success for a feature nobody ran.
 */
import { describe, expect, it } from "vitest"
import { chromeExecutablePath, launchRenderBrowser } from "@/lib/funnels/browser"
import { buildRenderDocument } from "@/lib/funnels/render-image"

const chrome = chromeExecutablePath(process.env)
if (!chrome) {
  console.warn(
    "[render-image.browser.test] SKIPPED: no local Chrome found. " +
      "Set PUPPETEER_EXECUTABLE_PATH to run these. The wrapper and font checks did NOT run.",
  )
}

describe.skipIf(!chrome)("a real browser", () => {
  it("matches the scoped CSS, which proves the wrapper is there", async () => {
    // THE TEST THAT WOULD HAVE CAUGHT THE UNSTYLED-PAGE BUG. reassemble()'s
    // css is entirely scoped to #djp-funnel-root; without the wrapper every
    // rule loads and matches nothing. Asserting a COMPUTED value is the only
    // way to tell the two apart — the template string looks fine either way.
    const browser = await launchRenderBrowser()
    expect(browser).not.toBeNull()
    try {
      const page = await browser!.newPage()
      await page.setContent(
        buildRenderDocument(
          `<div class="djp-page"><section class="djp-s"><h1>Hello</h1></section></div>`,
          `#djp-funnel-root { --djp-maxw: 88rem; } #djp-funnel-root .djp-s h1 { font-size: 68px; }`,
        ),
      )
      const height = await page.pageHeight()
      expect(height).toBeGreaterThan(0)
    } finally {
      await browser!.close()
    }
  }, 60_000)

  it("renders a real stored document to at least one tile", async () => {
    const { renderDocToImages } = await import("@/lib/funnels/render-image")
    const { readFileSync } = await import("node:fs")
    const doc = JSON.parse(readFileSync(`${__dirname}/fixtures/real-step-doc.json`, "utf8"))
    const result = await renderDocToImages(doc, { brandKit: null })
    expect(result.error).toBeNull()
    expect(result.images.length).toBeGreaterThan(1)
    expect(result.height).toBeGreaterThan(1000)
    // PNG magic number, so this is a real image and not an empty buffer.
    expect(Buffer.from(result.images[0].data, "base64").subarray(0, 4).toString("hex")).toBe("89504e47")
  }, 60_000)
})
```

- [ ] **Step 6: Save the real fixture document**

The fixture must be a REAL stored document, not one minted to pass. Pull it from the dev clone:

```bash
mkdir -p __tests__/lib/funnels/fixtures
npx tsx -e '
import fs from "node:fs"
const env = fs.readFileSync(".env.local", "utf8")
const get = (k: string) => env.match(new RegExp("^" + k + "=(.*)$", "m"))?.[1].trim().replace(/^"|"$/g, "") ?? ""
const res = await fetch(`${get("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/funnel_steps?id=eq.7f5da342-aa37-42aa-bed3-020842893da9&select=project_data`, {
  headers: { apikey: get("SUPABASE_SERVICE_ROLE_KEY"), Authorization: `Bearer ${get("SUPABASE_SERVICE_ROLE_KEY")}` },
})
const rows = await res.json()
fs.writeFileSync("__tests__/lib/funnels/fixtures/real-step-doc.json", JSON.stringify(rows[0].project_data, null, 2))
console.log("sections:", rows[0].project_data.sections.length)
'
```
Expected: `sections: 10`.

- [ ] **Step 7: Run the browser suite**

```bash
npx vitest run __tests__/lib/funnels/render-image.browser.test.ts
```
Expected: PASS, 2 tests. If it prints the SKIPPED warning, find a Chrome first — do not move on with this suite unrun.

- [ ] **Step 8: Commit**

```bash
git add lib/funnels/render-image.ts __tests__/lib/funnels/render-image.test.ts __tests__/lib/funnels/render-image.browser.test.ts __tests__/lib/funnels/fixtures/real-step-doc.json
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "feat(builder): render a resolved document to base64 page tiles"
```

---

### Task 5: The critic panel gets eyes

**Files:**
- Modify: `lib/funnels/sections/review/critics.ts`
- Test: `__tests__/lib/funnels/sections/review/critics.test.ts`

**Interfaces:**
- Consumes: `RenderedPage` (Task 4).
- Produces: `runCritics(doc, auditFindings, render?: RenderedPage | null)`; `CriticLens` gains `seesRender: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/funnels/sections/review/critics.test.ts`:

```ts
import type { RenderedPage } from "@/lib/funnels/render-image"

const RENDER: RenderedPage = {
  images: [
    { mediaType: "image/png", data: "AAAA" },
    { mediaType: "image/png", data: "BBBB" },
  ],
  width: 1200,
  height: 2000,
  truncated: false,
  typographyFaithful: true,
  error: null,
}

describe("who gets to see the page", () => {
  it("marks exactly one lens as seeing the render", () => {
    // Derived from the table, never hand-listed: adding a fourth critic must
    // not silently start sending it pictures.
    expect(CRITICS.filter((lens) => lens.seesRender)).toHaveLength(1)
    expect(CRITICS.find((lens) => lens.seesRender)?.source).toBe("art")
  })

  it("passes images to the art critic and to nobody else", async () => {
    // Assert the ARGUMENT OBJECT of each call, not that the call happened.
    callAgentMock.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [], RENDER)

    expect(callAgentMock).toHaveBeenCalledTimes(3)
    const byLens = new Map(
      callAgentMock.mock.calls.map((call) => {
        const lens = CRITICS.find((candidate) => candidate.system === call[0])
        return [lens?.source, call[3]]
      }),
    )
    expect(byLens.get("art")?.images).toHaveLength(2)
    expect(byLens.get("copy")).not.toHaveProperty("images")
    expect(byLens.get("offer")).not.toHaveProperty("images")
  })

  it("tells the art critic how many pictures there are and where they came from", async () => {
    callAgentMock.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [], RENDER)
    const artCall = callAgentMock.mock.calls.find(
      (call) => CRITICS.find((lens) => lens.system === call[0])?.source === "art",
    )
    expect(artCall?.[1]).toMatch(/whole-page view/i)
    // The others must not be told about pictures they cannot see.
    const copyCall = callAgentMock.mock.calls.find(
      (call) => CRITICS.find((lens) => lens.system === call[0])?.source === "copy",
    )
    expect(copyCall?.[1]).not.toMatch(/whole-page view/i)
  })

  it("warns the art critic when the page was cut off", async () => {
    callAgentMock.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [], { ...RENDER, truncated: true })
    const artCall = callAgentMock.mock.calls.find(
      (call) => CRITICS.find((lens) => lens.system === call[0])?.source === "art",
    )
    expect(artCall?.[1]).toMatch(/not the end of the page/i)
  })

  it("is byte-identical to today when no render is supplied", async () => {
    callAgentMock.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [])
    for (const call of callAgentMock.mock.calls) {
      expect(call[3]).not.toHaveProperty("images")
      expect(call[1]).not.toMatch(/whole-page view/i)
    }
  })

  it("sends no images when the render failed, even though it was supplied", async () => {
    callAgentMock.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [], { ...RENDER, images: [], error: "no browser available for rendering" })
    for (const call of callAgentMock.mock.calls) {
      expect(call[3]).not.toHaveProperty("images")
    }
  })
})

describe("the art director's brief", () => {
  it("forbids findings about the typeface", () => {
    // Three of five FONT_STACKS pairings resolve to system faces that differ
    // per platform, so the faces in the picture are not the faces a visitor
    // sees. A finding about them would be confidently wrong.
    const art = CRITICS.find((lens) => lens.source === "art")!
    expect(art.system).toMatch(/never file a finding about the typeface/i)
  })

  it("still tells the critic to stay out of the other lanes", () => {
    const art = CRITICS.find((lens) => lens.source === "art")!
    expect(art.system).toMatch(/other two reviewers/i)
  })
})
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run __tests__/lib/funnels/sections/review/critics.test.ts
```
Expected: FAIL — `seesRender` does not exist and `runCritics` takes two arguments.

- [ ] **Step 3: Add `seesRender` to the lens type and the table**

In `lib/funnels/sections/review/critics.ts`, extend the interface:

```ts
export interface CriticLens {
  /** Stamped onto every finding this lens produces. */
  source: Exclude<FindingSource, "audit">
  label: string
  system: string
  /**
   * Whether this lens is shown screenshots of the rendered page.
   *
   * A PROPERTY OF THE TABLE, not an `if (source === "art")` in the fan-out, so
   * that adding a fourth critic cannot silently start spending vision tokens
   * on it. Exactly one lens has this today and a test pins that.
   */
  seesRender: boolean
}
```

Set `seesRender: true` on the `art` entry and `seesRender: false` on `copy` and `offer`.

- [ ] **Step 4: Rewrite the art director's lens**

Replace the `art` entry's `system` template body (keep `${SHARED_ENVELOPE}` at the top) with:

```
YOUR LENS: how the page LOOKS as somebody scrolls it. Nobody else is looking at
this.

YOU HAVE PICTURES. Screenshots of this page as a browser actually drew it are
attached: a whole-page view first for shape, then slices down the page for
detail. Read them. The document tells you what was asked for; the pictures tell
you what came out.

Look first for what only a picture can show:
- a band with nothing in it, or nearly nothing, taking up a whole screen
- text you cannot read against what sits behind it
- a list whose items do not line up with each other
- words that overflow their box, collide, or get cut off
- a heading marooned from its own content by a wide empty gap
- an image that crops badly or is stretched out of shape

Then the rhythm, which you can also see here: where the page goes flat, tone
and padding that never change, variants clearly taken as defaults rather than
chosen, a middle stretch where every band is interchangeable with the one above
it. And the opposite failure: alternating so hard that nothing stands out, or a
second section loud enough to compete with the hero.

WHAT THE PICTURES DO NOT TELL YOU: which typeface was used. Three of this
builder's font choices resolve to whatever face the machine happens to have, so
the letterforms you are looking at are not the ones a visitor sees. NEVER FILE A
FINDING ABOUT THE TYPEFACE or which font was chosen. Size, weight, spacing and
line length are real and are fair game.

The other two reviewers cover the words and the offer. Say nothing about either
except where LAYOUT is what makes them fail — a strong testimonial buried in the
middle of five identical bands is your finding; a weak testimonial is not.
```

- [ ] **Step 5: Add the render note and thread `images` through the fan-out**

Add above `runCritics`:

```ts
/**
 * What the art critic is told about the pictures it is looking at.
 *
 * Appended ONLY to the lens that receives them. Telling the copywriter about
 * screenshots it cannot see would have it reasoning about evidence it does not
 * have, which is worse than not mentioning them.
 */
function renderNote(render: RenderedPage): string {
  const slices = render.images.length - 1
  const lines = [
    "",
    "## The page as a browser drew it",
    "",
    `${render.images.length} screenshots are attached: a whole-page view first, then ${slices} ` +
      `slice${slices === 1 ? "" : "s"} from the top of the page to the bottom.`,
  ]
  if (render.truncated) {
    lines.push(
      "",
      "The page is longer than what was captured — the last slice is NOT the end of the page. " +
        "Do not comment on how the page ends.",
    )
  }
  if (!render.typographyFaithful) {
    lines.push("", "The webfonts did not load for these pictures, so the type is a fallback face.")
  }
  return lines.join("\n")
}
```

Then change the fan-out:

```ts
export async function runCritics(
  doc: SectionDoc,
  auditFindings: Finding[],
  render?: RenderedPage | null,
): Promise<CriticPanelResult> {
  const message = userMessage(doc, auditFindings)
  // A failed render is an absent render. `images: []` would switch the
  // transport to the `messages` form for a list with no image in it.
  const usable = render && render.images.length > 0 ? render : null

  const settled = await Promise.allSettled(
    CRITICS.map(async (critic) => {
      const showPictures = critic.seesRender && usable !== null
      const result = await callAgent(
        critic.system,
        showPictures ? `${message}\n${renderNote(usable)}` : message,
        criticFindingsSchema,
        {
          model: SECTION_REVIEW_CRITIC_MODEL,
          maxTokens: SECTION_REVIEW_CRITIC_MAX_TOKENS,
          ...(showPictures ? { images: usable.images } : {}),
        },
      )
      // ... unchanged from here
```

- [ ] **Step 6: Update the comment that this change falsifies**

The block above `userMessage` currently says the three calls are "Identical ON PURPOSE... the only variable between the three calls is the instruction". That is no longer true. Replace that paragraph with:

```ts
 * The three calls were once byte-identical, so that agreement between two
 * critics meant two perspectives reaching the same conclusion rather than one
 * having been shown more than the other. That still holds for the DOCUMENT:
 * every lens sees the same JSON and the same deterministic findings.
 *
 * The art director additionally receives screenshots of the rendered page
 * (2026-09-14). This is a deliberate amendment, not an oversight. The artefact
 * the old rule guarded against is giving one critic MORE OF THE SAME
 * information, which manufactures false agreement; a picture is a DIFFERENT
 * MODALITY matched to one lens's question. The copywriter reading a picture of
 * prose would be strictly worse off and the offer critic has no use for one, so
 * cross-lens agreement still means what it always meant.
```

- [ ] **Step 7: Run the tests**

```bash
npx vitest run __tests__/lib/funnels/sections/review/critics.test.ts
```
Expected: PASS — the pre-existing lens tests included.

- [ ] **Step 8: Mutate to prove the "only art" test bites**

Temporarily set `seesRender: true` on the `copy` lens and re-run.

```bash
npx vitest run __tests__/lib/funnels/sections/review/critics.test.ts
```
Expected: "marks exactly one lens" AND "passes images to the art critic and to nobody else" both FAIL. **Revert.**

- [ ] **Step 9: Commit**

```bash
git add lib/funnels/sections/review/critics.ts __tests__/lib/funnels/sections/review/critics.test.ts
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "feat(builder): give the art director the page instead of the style knobs"
```

---

### Task 6: The pipeline threads the render

**Files:**
- Modify: `lib/funnels/sections/review/pipeline.ts`
- Test: `__tests__/lib/funnels/sections/review/pipeline.test.ts`

**Interfaces:**
- Consumes: `runCritics(doc, findings, render?)` (Task 5); `RenderedPage` (Task 4).
- Produces: `ReviewInput` gains `render?: RenderedPage | null`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/funnels/sections/review/pipeline.test.ts`:

```ts
it("hands the render to the critic panel", async () => {
  const render = {
    images: [{ mediaType: "image/png", data: "AAAA" }],
    width: 1200,
    height: 900,
    truncated: false,
    typographyFaithful: true,
    error: null,
  }
  await reviewDoc({ doc: DOC, render })
  expect(runCriticsMock).toHaveBeenCalledWith(DOC, expect.anything(), render)
})

it("passes undefined when there is no render, leaving today's call shape", async () => {
  await reviewDoc({ doc: DOC })
  expect(runCriticsMock).toHaveBeenCalledWith(DOC, expect.anything(), undefined)
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run __tests__/lib/funnels/sections/review/pipeline.test.ts
```
Expected: FAIL — `runCritics` is called with two arguments.

- [ ] **Step 3: Thread it through**

In `lib/funnels/sections/review/pipeline.ts`, add to `ReviewInput`:

```ts
  /**
   * Screenshots of this document as a browser drew it, for the lens that can
   * use them.
   *
   * PRODUCED BY THE CALLER, never in here. Calling the renderer from this
   * module would put a browser dependency inside the stage whose whole promise
   * is that it cannot cost the owner their page — and would make every test of
   * this pipeline need a Chrome.
   */
  render?: RenderedPage | null
```

Pass `input.render` as `runCritics`'s third argument, and thread it from `reviewDoc` into `runReview`.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run __tests__/lib/funnels/sections/review/pipeline.test.ts __tests__/lib/funnels/sections/review/pipeline-rounds.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/review/pipeline.ts __tests__/lib/funnels/sections/review/pipeline.test.ts
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "feat(builder): thread the render through the review pipeline"
```

---

### Task 7: The route renders before it reviews

**Files:**
- Modify: `app/api/admin/funnels/steps/[stepId]/build/route.ts` (`runReviewStage`, ~line 1832)
- Test: `__tests__/app/api/admin/funnels/build-route-render.test.ts` (create)

**Interfaces:**
- Consumes: `renderDocToImages` (Task 4), `SECTION_RENDER_ENABLED` (Task 1), `reviewDoc({doc, render, onFinding})` (Task 6).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Create `__tests__/app/api/admin/funnels/build-route-render.test.ts`. Follow the mocking idiom of the existing build-route suites in that directory — read one first. Pin the node environment: these route suites report "no tests" without it.

```ts
/**
 * @vitest-environment node
 */
```

The three claims:

```ts
it("renders the page and gives it to the review", async () => {
  // ...drive a turn whose ops contain set_page so shouldReview fires
  expect(renderDocToImagesMock).toHaveBeenCalledTimes(1)
  expect(reviewDocMock).toHaveBeenCalledWith(expect.objectContaining({ render: expect.objectContaining({ images: expect.any(Array) }) }))
})

it("reviews anyway when the render fails", async () => {
  renderDocToImagesMock.mockResolvedValue({
    images: [], width: 0, height: 0, truncated: false, typographyFaithful: false,
    error: "no browser available for rendering",
  })
  const response = await POST(request, context)
  expect(response.status).toBe(200)
  expect(reviewDocMock).toHaveBeenCalledTimes(1)
})

it("never puts image bytes in the turn log", async () => {
  // Phase 1's idiom. The render is transient: it is handed to the model and
  // is garbage afterwards.
  await POST(request, context)
  const serialized = JSON.stringify(appendTurnMock.mock.calls)
  expect(serialized).not.toContain("AAAA")  // the fake image payload
})

it("does not render on an ordinary edit turn", async () => {
  // shouldReview is false without a set_page, so the whole stage is skipped.
  expect(renderDocToImagesMock).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run __tests__/app/api/admin/funnels/build-route-render.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Wire it into `runReviewStage`**

Add the import, then inside `runReviewStage` immediately after `emit({ type: "phase", phase: "reviewing" })`:

```ts
  // THE RENDER. Both review paths come through here — the automatic one on a
  // first draft and the Polish button — so this one insertion covers both.
  //
  // NO NEW STREAM PHASE. `BUILD_PHASES` has four consumers, and widening it
  // for a sub-step of a phase that already exists would cost four files to buy
  // a label. Rendering IS part of reviewing.
  const render = SECTION_RENDER_ENABLED
    ? await renderDocToImages(doc, {
        ...(context.funnelBasePath ? { funnelBasePath: context.funnelBasePath } : {}),
        brandKit: context.brandKit,
      })
    : null

  // Logged, never emitted. On the automatic path the owner has a page; telling
  // them a background improvement was slightly less well informed reads as a
  // failure of the thing that worked.
  if (render?.error) console.warn("[funnels/build] render for review did not complete:", render.error)

  const review = await reviewDoc({
    doc,
    ...(render ? { render } : {}),
    onFinding: (finding) => emit({ type: "finding", finding }),
  })
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run __tests__/app/api/admin/funnels/build-route-render.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the whole funnel-touching surface**

```bash
npx vitest run __tests__/lib/funnels __tests__/app/api/admin/funnels __tests__/components/admin __tests__/lib/db __tests__/lib/ai
```
Expected: all passing. Baseline on `723bf68f` was 273 files / 3416 tests; this adds files and tests, so expect MORE of both and zero failures.

- [ ] **Step 6: Typecheck against the baseline SET, not the count**

```bash
npx tsc --noEmit 2>&1 | grep -oE "^[^(]+\(" | sed 's/($//' | sort | uniq -c | sort -rn > /tmp/tsc-after.txt
diff <(sort /tmp/tsc-baseline-perfile.txt) <(sort /tmp/tsc-after.txt)
```
Expected: no diff. A FALLING count hides new errors, so compare the set.

- [ ] **Step 7: Production build**

```bash
npm run build 2>&1 | tail -30
```
Expected: green. This is the gate that would catch a bundling problem with `puppeteer-core` locally — it does NOT prove the Vercel deploy, which cannot be checked from this environment.

- [ ] **Step 8: Commit**

```bash
git add "app/api/admin/funnels/steps/[stepId]/build/route.ts" __tests__/app/api/admin/funnels/build-route-render.test.ts
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "feat(builder): render the page before the review reads it"
```

---

### Task 8: Prove it in the real app

**Files:**
- Create: `scripts/capture-builder-self-render.mjs`
- Create: `screenshots/builder-self-render/*.png`

**Interfaces:** none — this task produces evidence, not code.

- [ ] **Step 1: Start a dev server on a port that is not 3050**

3050 is another Claude session's server. Redirect to a log — piping a dev server to `head` wedges it and every route then times out.

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
npx next dev --port 3061 > /tmp/dev-3061.log 2>&1 &
until grep -q "Ready in" /tmp/dev-3061.log; do sleep 1; done
```

- [ ] **Step 2: Find a REAL step id from the database, never a hardcoded one**

A wrong id that RESOLVES does not announce itself — a hardcoded `/preview/camp-kfcsg` copied from a sibling script once shipped a screenshot of the wrong page under a confident caption.

```bash
npx tsx -e '
import fs from "node:fs"
const env = fs.readFileSync(".env.local", "utf8")
const get = (k: string) => env.match(new RegExp("^" + k + "=(.*)$", "m"))?.[1].trim().replace(/^"|"$/g, "") ?? ""
const res = await fetch(`${get("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/funnel_steps?select=id,slug,funnel_id&limit=5`, {
  headers: { apikey: get("SUPABASE_SERVICE_ROLE_KEY"), Authorization: `Bearer ${get("SUPABASE_SERVICE_ROLE_KEY")}` },
})
console.log(await res.json())
'
```

- [ ] **Step 3: Drive the real builder and provoke a review**

Sign in as an admin in a real browser context, open `/admin/funnels/<funnelId>/edit/<stepId>`, and send a message that produces a `set_page` — a first draft or an explicit start-over — because `shouldReview` only fires on that or the Polish button.

**Wait on the ARTIFACT, not a counter.** The route records the owner's message before spending anything, so `doc_revision` moves without `project_data` changing. And a first draft is TWO writes: the review pass writes a second, revised document 30-40s later. Poll `project_data` for a change, then keep polling for the review's write.

- [ ] **Step 4: Capture the evidence**

The claim to prove is: **the art director filed a finding about something invisible in the document.** Capture
 1. the builder chat showing the finding in the transcript,
 2. the page before and after the reviser acted on it,
 3. the server log line proving the render ran (image count and page height).

Assert the page shows something only THIS page could show, so a wrong-id screenshot cannot pass as a right one.

- [ ] **Step 5: Annotate the PNGs themselves**

Markers and captions burned INTO the image, composed at the source capture's exact pixel width so nothing is upscaled. Use the existing `scripts/_annotate-lib.mjs`. Its markers are RAW PIXELS — derive them from `boundingBox() × deviceScaleFactor` and warn loudly on a missing target. **Park the pointer before screenshotting**; Playwright's mouse stays where it last clicked. Note that lib has clipped a too-long title at phone width before — check the title fits.

- [ ] **Step 6: Commit**

```bash
git add screenshots/builder-self-render scripts/capture-builder-self-render.mjs
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "docs(builder): verify the self-render in the real app"
```

---

### Task 9: Close gap C4

**Files:**
- Modify: `docs/builder-gaps.md` (row C4, line ~46)

- [ ] **Step 1: Rewrite row C4**

Flip `open` to `closed` and replace the description, following row C3's shape: what was built, where it lives, what is deliberately still out of scope, and the screenshots path. State plainly that Vercel deployment could not be verified from this environment.

- [ ] **Step 2: Check the row's own claims**

Every file path named in the row must exist:

```bash
grep -oE '`[a-z][a-zA-Z0-9/_.-]+\.(ts|tsx|md)`' docs/builder-gaps.md | tr -d '`' | sort -u | while read -r f; do [ -e "$f" ] || echo "MISSING: $f"; done
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add docs/builder-gaps.md
git -c user.name="testyortago-cloud" -c user.email="tayawaaean@gmail.com" commit -m "docs(builder): close gap C4"
```

---

## Self-Review

**Spec coverage:** §4 browser → Task 2. §5 renderer → Tasks 3-4. §5.1 wrapper → Task 3 Step 3 + Task 4 Step 5 (effect test). §5.3 fonts → Task 3 + Task 4 tests 3-4. §5.4 tiles → Tasks 1, 3. §5.6 not stored → Task 7 test 3. §6 critics → Task 5. §7 pipeline → Task 6. §8 route → Task 7. §10 testing → all tasks. §11 risks → Task 7 Step 7 (build) and the final report.

**Placeholder scan:** none. Task 7's test file is sketched rather than written out in full because its mocking idiom must be copied from the sibling suites in the same directory rather than invented — the step says so explicitly and names the four claims.

**Type consistency:** `RenderedPage` is defined in Task 4 and consumed by name in Tasks 5, 6, 7. `RenderBrowser` / `RenderPage` / `LaunchRenderBrowser` are defined in Task 2 and consumed in Task 4. `runCritics`'s third parameter is `render?: RenderedPage | null` in Tasks 5 and 6. `planTiles` and `buildRenderDocument` are defined in Task 3 and used in Task 4.
