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
    `<style>${css}</style>` +
    // LAST, and ONLY here. See `islandPlaceholderCss` below: this sheet exists
    // so the picture stops containing a blank band the real page does not have.
    // It is built into THIS document only — nothing a visitor loads gets it.
    `<style>${islandPlaceholderCss()}</style></head>` +
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
// TWO THINGS ANSWER THAT, AND BOTH ARE NEEDED. The list below goes into the
// critic's brief as prose, and `islandPlaceholderCss` paints each region in the
// picture as a labelled placeholder so there is no blank band to report in the
// first place. The prose alone was measured and was not enough.
//
// THE LIST IS READ OUT OF THE EMITTED HTML, NEVER RE-DERIVED FROM THE DOCUMENT.
// Which sections hold an island depends on a `source: "live"` discriminant on
// two kinds, on a CTA's target kind on several more, and on validation passing
// inside `renderIslandIfValid`. A second implementation of those rules here
// would be right on the day it was written and silently wrong afterwards —
// which is the whole bug class this guard exists to close. The html `reassemble`
// returned is the same html that was screenshotted, so it cannot drift.

/**
 * How much room an island takes up on the real page.
 *
 * `checkout`, `event` and `booking` are CTA BUTTONS — `renderCtaTarget`
 * (render.ts) reaches all three through `anchoredIsland`, and CLAUDE.md records
 * that they are pure `<Link>` navigation. The rest fill a whole band. Painting
 * a button-sized island at band size would distort the very proportions the art
 * director is judging: the same fault as the blank band, wearing a hat.
 */
type IslandShape = "band" | "button"

/**
 * What each island is, in words a critic (and the owner reading the finding it
 * does not write) can act on, plus how big it is.
 *
 * A `Record<IslandName, …>` on purpose: a new island in `ISLAND_NAMES` fails to
 * compile until somebody says what it looks like to a visitor. `what` reaches
 * the critic twice — as prose in `dynamicRegions`, and burned into the picture
 * itself by `islandPlaceholderCss` — so those two can never disagree.
 */
const ISLAND_LABELS: Record<IslandName, { what: string; shape: IslandShape }> = {
  form: { what: "a form", shape: "band" },
  checkout: { what: "a checkout button", shape: "button" },
  event: { what: "an event sign-up button", shape: "button" },
  booking: { what: "a booking widget", shape: "button" },
  testimonials: { what: "a live testimonial feed", shape: "band" },
  faq: { what: "a live FAQ list", shape: "band" },
  quiz: { what: "a quiz", shape: "band" },
}

// ---------------------------------------------------------------------------
// THE PLACEHOLDER — CHANGE THE EVIDENCE, NOT THE INSTRUCTION.
// ---------------------------------------------------------------------------
// `dynamicRegions` and the note `critics.ts` builds out of it tell the art
// director that these regions are filled in live. That was measured against a
// real model on 2026-09-14 and IT WAS NOT ENOUGH. It did stop the fabrication —
// the suggestion became a padding change — but the critic still filed
// `[art/high] empty-band (proof)`: "a large solid clay-coloured rectangle with
// no visible content, occupying roughly a full viewport height". Telling a
// model to disregard something it can plainly see does not work, and that is
// not really the model's fault: the picture it was handed did contain a blank
// band.
//
// So the picture stops containing one. Every island is painted as a dashed,
// muted, centred box that SAYS what fills it on the real page. There is then
// nothing to report as empty — and nothing that could be mistaken for a design
// element whose styling is worth critiquing.
//
// THE SHEET IS RENDER-ONLY. It is assembled here and injected by
// `buildRenderDocument` into the standalone document THIS MODULE screenshots.
// It is not in `lib/funnels/sections/styles.ts`, it is not in what `reassemble`
// returns, and no published page, `/go` route or preview route can reach it.
// Nothing a visitor loads changes.

/** A CSS string literal. `"` and `\` are the only two characters that can break one. */
function cssString(text: string): string {
  return `"${text.replace(/[\\"]/g, "\\$&")}"`
}

/** "a live testimonial feed" -> "A live testimonial feed appears here when a visitor opens the page." */
function placeholderSentence(what: string): string {
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} appears here when a visitor opens the page.`
}

const SHAPE_CSS: Record<IslandShape, string> = {
  // Tall enough that the band still occupies the rhythm the real content does,
  // and no taller. An invented height would misreport the page's proportions
  // just as badly as an invented emptiness does.
  band: "display:flex;flex-direction:column;gap:10px;min-height:180px;padding:28px 24px;border-radius:14px;font-size:17px;",
  button:
    "display:inline-flex;flex-direction:column;gap:4px;min-height:52px;padding:12px 22px;border-radius:999px;font-size:14px;max-width:34ch;",
}

/**
 * The render-only sheet that paints every `[data-djp-island]` as a labelled
 * placeholder.
 *
 * UNCONDITIONAL, never "only when this html holds an island". A second answer
 * to "does this page hold one" is a second implementation of a rule that lives
 * on a `source:"live"` discriminant, on a CTA's target kind and on a schema
 * parse — the exact drift `islandsBySection` exists to avoid. A sheet that
 * matches nothing costs nothing.
 *
 * `currentColor`, never a fixed grey: a section carries `tone: "light" |
 * "dark"`, so the one colour guaranteed to be legible against the band behind
 * the placeholder is the colour that band's own text is already using.
 */
function islandPlaceholderCss(): string {
  const scope = `#${FUNNEL_ROOT_ID} [${ISLAND_ATTR}]`
  const base =
    `${scope}{${SHAPE_CSS.band}` +
    `align-items:center;justify-content:center;box-sizing:border-box;` +
    `border:2px dashed currentColor;background:none;color:inherit;opacity:.7;` +
    `font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;` +
    `font-weight:600;line-height:1.45;letter-spacing:normal;text-align:center;text-transform:none;` +
    `}` +
    // `attr()`, so an island nobody has written wording for still NAMES ITSELF
    // rather than degrading to a generic string. Every island the product can
    // emit overrides this with a real sentence below — and `ISLAND_LABELS` is a
    // `Record<IslandName, …>`, so that set cannot fall behind `ISLAND_NAMES`.
    `${scope}::before{content:attr(${ISLAND_ATTR}) " appears here when a visitor opens the page.";` +
    `display:block;max-width:44ch;}` +
    `${scope}::after{content:${cssString("This dashed box only marks where that goes. It is not part of the page design.")};` +
    `display:block;max-width:44ch;font-size:14px;font-weight:400;}`

  // Same specificity as `base`, and later in the sheet, so these win the tie.
  const perIsland = Object.entries(ISLAND_LABELS)
    .map(([name, { what, shape }]) => {
      const sel = `#${FUNNEL_ROOT_ID} [${ISLAND_ATTR}="${name}"]`
      return (
        `${sel}{${SHAPE_CSS[shape]}}` +
        `${sel}::before{content:${cssString(placeholderSentence(what))};}` +
        // A second line would double a button's height into a band's.
        (shape === "button" ? `${sel}::after{content:none;}` : "")
      )
    })
    .join("")

  return `/* render-only: island placeholders. Never published. */${base}${perIsland}`
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
    const labels = islands.map((island) => (isIslandName(island) ? ISLAND_LABELS[island].what : island))
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
   * Regions that are interactive on the real page and therefore carry a LABELLED
   * PLACEHOLDER in `images` rather than their real content, as
   * `section-id (what it is)`. See the islands block above — this is the
   * difference between the page and the picture, and a critic not told about it
   * reports the difference as a defect and invents content to fill it.
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
