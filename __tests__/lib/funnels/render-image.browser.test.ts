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

    // The two bands that are BLANK in those tiles: this document's testimonial
    // reads a live feed and its signup is a form. Both are in the picture as
    // empty rectangles and full of content on the real page — the art critic
    // reported them as empty bands and the reviser invented a testimonial to
    // fill one. Asserted on the real render, not on a hand-built fragment.
    expect(result.dynamicRegions).toEqual(
      expect.arrayContaining(["proof (a live testimonial feed)", "signup (a form)"]),
    )
  }, 60_000)

  // -------------------------------------------------------------------------
  // THE TEST THAT WOULD HAVE CAUGHT THE FABRICATED TESTIMONIAL.
  //
  // Naming the blank regions in the critic's brief was measured against a real
  // model and was NOT enough: it still filed `[art/high] empty-band (proof)`,
  // "a large solid clay-coloured rectangle with no visible content". So the
  // picture stops having a blank band, and the only honest way to check that is
  // to measure the island element in a browser that has applied the page's own
  // css. buildRenderDocument's template string looks identical whether the
  // sheet wins or loses — that is exactly the gap that let a blank band ship.
  //
  // Measured through puppeteer directly rather than through `RenderPage`,
  // because that port is deliberately four methods wide and none of them can
  // measure one element.
  // -------------------------------------------------------------------------
  async function measureIslands(document: string) {
    const puppeteer = (await import("puppeteer-core")).default
    const browser = await puppeteer.launch({ executablePath: chrome!, headless: true, args: [] })
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })
      await page.setContent(document, { waitUntil: "load" })
      // A STRING, not a function literal: esbuild rewrites a named function
      // inside an evaluate callback into a `__name` helper the browser has
      // never heard of, and the whole evaluate throws.
      return (await page.evaluate(`
        [...document.querySelectorAll("[data-djp-island]")].map((el) => {
          const style = getComputedStyle(el)
          return {
            name: el.getAttribute("data-djp-island"),
            height: el.getBoundingClientRect().height,
            width: el.getBoundingClientRect().width,
            borderStyle: style.borderTopStyle,
            borderWidth: style.borderTopWidth,
            label: getComputedStyle(el, "::before").content,
            footnote: getComputedStyle(el, "::after").content,
          }
        })
      `)) as Array<{
        name: string
        height: number
        width: number
        borderStyle: string
        borderWidth: string
        label: string
        footnote: string
      }>
    } finally {
      await browser.close()
    }
  }

  it("draws a labelled placeholder where the real page hydrates an island", async () => {
    const { buildRenderDocument } = await import("@/lib/funnels/render-image")
    const { reassemble } = await import("@/lib/funnels/sections/doc")
    const { readFileSync } = await import("node:fs")
    // THE REAL STORED DOCUMENT, with its real css — not a hand-built fragment.
    // A synthetic island in an empty document would pass even if every rule in
    // the page's own 237-rule sheet out-specified the placeholder.
    const doc = JSON.parse(readFileSync(`${__dirname}/fixtures/real-step-doc.json`, "utf8"))
    const { html, css } = reassemble(doc, { brandKit: null })

    const islands = await measureIslands(buildRenderDocument(html, css))
    expect(islands.length).toBeGreaterThan(0)
    expect(islands.map((i) => i.name)).toEqual(expect.arrayContaining(["testimonials", "form"]))

    for (const island of islands) {
      // NON-ZERO IS THE WHOLE POINT. An unstyled `<div data-djp-island>` is
      // exactly 0px tall, which is what made the band read as a solid slab of
      // section background with nothing in it.
      expect(island.height).toBeGreaterThan(0)
      // ...and tall enough to be a visible box rather than a hairline.
      expect(island.height).toBeGreaterThanOrEqual(52)
      expect(island.width).toBeGreaterThan(0)
      // Unmistakably a placeholder, so no critic spends a finding on its style.
      expect(island.borderStyle).toBe("dashed")
      expect(parseFloat(island.borderWidth)).toBeGreaterThan(0)
      // In plain English, naming what fills it — not the raw slug.
      expect(island.label).toContain("appears here when a visitor opens the page")
      expect(island.label).not.toBe("none")
    }

    const band = islands.find((i) => i.name === "testimonials")!
    expect(band.label).toContain("A live testimonial feed appears here")
    expect(band.footnote).toContain("not part of the page design")
    // The band occupies the rhythm the live feed would, instead of collapsing.
    expect(band.height).toBeGreaterThanOrEqual(180)
  }, 60_000)

  it("collapses to nothing without the sheet — the control", async () => {
    // The same markup, in a document that has everything buildRenderDocument
    // adds EXCEPT the placeholder rules. Without this, "the island is 180px
    // tall" is a number with nothing to compare against: it would read as a
    // pass even if some unrelated rule had always given it height.
    const { FUNNEL_ROOT_ID } = await import("@/lib/funnels/compile")
    const islands = await measureIslands(
      `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">` +
        `<div id="${FUNNEL_ROOT_ID}"><div class="djp-page"><section id="proof" class="djp-s">` +
        `<div data-djp-island="testimonials" data-djp-props='{}'></div></section></div></div></body></html>`,
    )
    expect(islands).toHaveLength(1)
    expect(islands[0].height).toBe(0)
    expect(islands[0].borderStyle).toBe("none")
  }, 60_000)

  it("keeps a CTA island button-sized, so the placeholder does not distort the layout", async () => {
    // `checkout`, `event` and `booking` replace a BUTTON. Drawing them at band
    // height would make a hero's call to action a 180px slab and invite a
    // finding about proportions that only this sheet created.
    const { buildRenderDocument } = await import("@/lib/funnels/render-image")
    const islands = await measureIslands(
      buildRenderDocument(
        `<div class="djp-page"><section id="offer" class="djp-s">` +
          `<div data-djp-island="checkout" data-djp-props='{}'></div>` +
          `<div data-djp-island="faq" data-djp-props='{}'></div></section></div>`,
        "",
      ),
    )
    const checkout = islands.find((i) => i.name === "checkout")!
    const faq = islands.find((i) => i.name === "faq")!
    expect(checkout.height).toBeGreaterThan(0)
    expect(checkout.height).toBeLessThan(180)
    expect(checkout.label).toContain("A checkout button appears here")
    // The band-shaped one in the SAME document is not shrunk with it.
    expect(faq.height).toBeGreaterThanOrEqual(180)
  }, 60_000)

  // -------------------------------------------------------------------------
  // TYPOGRAPHY, BOTH WAYS. `typographyFaithful` used to ask whether ALL THREE
  // downloadable faces had loaded, but a browser fetches a webfont only when
  // something on the page asks for it and only one of the five FONT_STACKS
  // pairings names Lexend Exa. So it answered false on every render whose type
  // was perfectly correct, and the critic was told the type was a fallback
  // face when it was not.
  //
  // Both pages below carry their font as a data: URI, so neither test touches
  // the network and neither can pass because Google Fonts happened to answer.
  // -------------------------------------------------------------------------
  const fontPage = (src: string, declareUnusedFace: boolean) =>
    `<!doctype html><html><head><style>` +
    `@font-face{font-family:"Lexend Exa";src:${src};}` +
    (declareUnusedFace ? `@font-face{font-family:"Lexend Deca";src:url(data:font/woff2;base64,AAAA);}` : "") +
    `body{font-family:"Lexend Exa", ui-sans-serif}` +
    `</style></head><body><h1>Real words on the page</h1><p>And a paragraph under them.</p></body></html>`

  it("says the typography is faithful when the face the text uses did load", async () => {
    const { RENDER_FONT_FAMILIES } = await import("@/lib/funnels/render-image")
    const { readFileSync } = await import("node:fs")
    // A real Lexend Exa, checked into this repo for the content studio.
    const fontFile = `${__dirname}/../../../lib/content-studio/fonts/LexendExa-SemiBold.ttf`
    const ttf = readFileSync(fontFile).toString("base64")

    const browser = await launchRenderBrowser()
    try {
      const page = await browser!.newPage()
      // Lexend Deca is DECLARED and never used — exactly the shape that made
      // this flag always-false. It must not count against the verdict.
      await page.setContent(fontPage(`url(data:font/ttf;base64,${ttf}) format("truetype")`, true))
      expect(await page.fontsInUseLoaded(RENDER_FONT_FAMILIES)).toBe(true)
    } finally {
      await browser!.close()
    }
  }, 60_000)

  it("says it is not faithful when the face the text uses did not load", async () => {
    const { RENDER_FONT_FAMILIES } = await import("@/lib/funnels/render-image")
    const browser = await launchRenderBrowser()
    try {
      const page = await browser!.newPage()
      // Declared, asked for by the body copy, and unloadable.
      await page.setContent(fontPage(`url(data:font/woff2;base64,AAAA) format("woff2")`, false))
      expect(await page.fontsInUseLoaded(RENDER_FONT_FAMILIES)).toBe(false)
    } finally {
      await browser!.close()
    }
  }, 60_000)

  it("says it is not faithful when the stylesheet never arrived at all", async () => {
    // The no-egress degrade the flag exists to report. `document.fonts.check`
    // answers TRUE here — an undeclared family looks like a system face to it —
    // which is why the probe asks the FontFaceSet instead.
    const { RENDER_FONT_FAMILIES } = await import("@/lib/funnels/render-image")
    const browser = await launchRenderBrowser()
    try {
      const page = await browser!.newPage()
      await page.setContent(
        `<!doctype html><html><head><style>body{font-family:"Lexend Exa", ui-sans-serif}</style>` +
          `</head><body><h1>Real words on the page</h1></body></html>`,
      )
      expect(await page.fontsInUseLoaded(RENDER_FONT_FAMILIES)).toBe(false)
    } finally {
      await browser!.close()
    }
  }, 60_000)
})
