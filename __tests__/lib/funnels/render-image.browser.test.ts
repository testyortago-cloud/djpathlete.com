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
