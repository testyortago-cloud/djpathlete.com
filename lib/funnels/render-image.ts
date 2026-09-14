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
import { launchRenderBrowser, type LaunchRenderBrowser } from "@/lib/funnels/browser"
import { FUNNEL_ROOT_ID } from "@/lib/funnels/compile"
import { ISLAND_ATTR, isIslandName, type IslandName } from "@/lib/funnels/islands"
import {
  SECTION_RENDER_MAX_TILES,
  SECTION_RENDER_TILE_HEIGHT,
  SECTION_RENDER_VIEWPORT_WIDTH,
} from "@/lib/funnels/sections/builder-config"
import { reassemble } from "@/lib/funnels/sections/doc"
import type { BrandKit } from "@/lib/funnels/sections/render"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

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

// ---------------------------------------------------------------------------
// ISLANDS — THE PARTS OF THE PAGE THAT ARE NOT IN THE PICTURE.
// ---------------------------------------------------------------------------
// `reassemble()` emits every interactive region as an EMPTY placeholder div
// (`renderIsland`, render.ts) that only the real page ever fills, and this
// module screenshots with `setContent` and no scripts. So a form, a live
// testimonial feed, a live FAQ, a checkout button, an event or booking button
// and a quiz are all blank rectangles in the picture and full of content on the
// page a visitor sees.
//
// Handed to a critic with no warning, that is not a harmless omission. Observed
// end to end on 2026-09-14: the art director filed the unhydrated testimonial
// band as a high-severity empty band, and the reviser then replaced a working
// live feed carrying a real athlete's quote with a testimonial it INVENTED,
// attributed to a named person with an invented 40-yard-dash time, and told the
// owner the band now "carries an authored quote with a real 40-time result".
// A fabricated endorsement heading for a live coaching page.
//
// THE LIST IS READ OUT OF THE EMITTED HTML, NEVER RE-DERIVED FROM THE DOCUMENT.
// Which sections hold an island depends on a `source: "live"` discriminant on
// two kinds, on a CTA's target kind on several more, and on validation passing
// inside `renderIslandIfValid`. A second implementation of those rules here
// would be right on the day it was written and silently wrong afterwards —
// which is the whole bug class this guard exists to close. The html `reassemble`
// returned is the same html that was screenshotted, so it cannot drift.

/**
 * What each island is, in words a critic (and the owner reading the finding it
 * does not write) can act on.
 *
 * A `Record<IslandName, …>` on purpose: a new island in `ISLAND_NAMES` fails to
 * compile until somebody says what it looks like to a visitor.
 */
const ISLAND_LABELS: Record<IslandName, string> = {
  form: "a form",
  checkout: "a checkout button",
  event: "an event sign-up button",
  booking: "a booking widget",
  testimonials: "a live testimonial feed",
  faq: "a live FAQ list",
  quiz: "a quiz",
}

// One pass, in document order, matching EITHER a section open tag or an island
// attribute — so each island is attributed to the section it sits inside
// without parsing the html. Sections are top-level and never nested
// (`renderSection` emits exactly one `<section>` per section), and every
// authored string reaches the markup through `escapeHtml`, which turns `<`,
// `>`, `"` and `'` into entities — so no copy an owner can type forges either
// half of this pattern.
const SECTION_OR_ISLAND = new RegExp(`<section\\b[^>]*?\\sid="([^"]*)"|\\b${ISLAND_ATTR}="([^"]*)"`, "g")

/**
 * Every island in `html`, keyed by the section it sits inside, in document
 * order. Sections holding none are absent; an island outside every section —
 * which the renderers cannot currently produce — lands under `""` rather than
 * being dropped, because a region nobody is warned about is the whole failure.
 *
 * `scripts/_render-islands.ts` reads this too, so the verification tooling and
 * the prompt can never disagree about which bands are blank.
 */
export function islandsBySection(html: string): Record<string, string[]> {
  const found: Record<string, string[]> = {}
  let current = ""

  for (const [, sectionId, island] of html.matchAll(SECTION_OR_ISLAND)) {
    if (sectionId !== undefined) {
      current = sectionId
      continue
    }
    if (island === undefined) continue
    const bucket = (found[current] ??= [])
    if (!bucket.includes(island)) bucket.push(island)
  }
  return found
}

/**
 * The regions of `html` that are interactive — blank in a scripts-off
 * screenshot, filled in on the real page — as `section-id (what it is)`.
 *
 * Empty for a page with no islands at all. That direction matters as much as
 * the other: a note telling the critic to ignore regions that do not exist
 * would teach it to ignore genuine empty bands.
 */
export function dynamicRegionsIn(html: string): string[] {
  return Object.entries(islandsBySection(html)).map(([sectionId, islands]) => {
    const labels = islands.map((island) => (isIslandName(island) ? ISLAND_LABELS[island] : island))
    return sectionId ? `${sectionId} (${labels.join(", ")})` : labels.join(", ")
  })
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
  /**
   * Regions that are interactive on the real page and therefore BLANK in
   * `images`, as `section-id (what it is)`. See the islands block above — this
   * is the difference between the page and the picture, and a critic not told
   * about it reports the difference as a defect and invents content to fill it.
   *
   * Empty whenever `images` is: it describes the pictures, and there are none.
   */
  dynamicRegions: string[]
  /** Set when `images` is empty. NEVER thrown. */
  error: string | null
}

function failed(message: string): RenderedPage {
  return {
    images: [],
    width: 0,
    height: 0,
    truncated: false,
    typographyFaithful: false,
    dynamicRegions: [],
    error: message,
  }
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

    const typographyFaithful = await page.fontsInUseLoaded(RENDER_FONT_FAMILIES)
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
      // From the html that was just screenshotted, not from `doc`.
      dynamicRegions: dynamicRegionsIn(html),
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
