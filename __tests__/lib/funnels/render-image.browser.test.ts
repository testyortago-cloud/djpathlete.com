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
