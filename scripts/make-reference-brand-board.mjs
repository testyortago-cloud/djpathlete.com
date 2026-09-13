// Renders the REFERENCE DESIGN the capture script pastes into the builder chat.
//
// WHY THIS EXISTS AS A SCRIPT rather than a checked-in binary: the whole claim
// of the feature is "the page changed BECAUSE of this image", and that claim is
// only legible if a reader can see what the image asked for. Generating it from
// source means the brand board's palette, type and spacing are readable text
// next to the page they produced, instead of a mystery PNG.
//
// It is deliberately NOT a screenshot of this app. A reference is something
// external the owner was handed — a designer's brand board — and it must ask
// for a look the builder does not default to, or "the page changed" proves
// nothing. So: deep clay + warm cream, a serif display face, and wide airy
// spacing. Today's default is Green Azure / Gray Orange, Lexend, normal
// density. Nothing here can be reached by accident.
//
//   node scripts/make-reference-brand-board.mjs

import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { launchChromium } from "./_launch-chromium.mjs"

const OUT = "screenshots/builder-reference-image"

const HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700&family=Inter:wght@300;400;600&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1400px; height: 760px; background: #FBF6EE; font-family: Inter, sans-serif; color: #2A1D16; padding: 70px 80px; }
  .eyebrow { font-size: 13px; letter-spacing: 0.22em; text-transform: uppercase; color: #A8563A; font-weight: 600; }
  h1 { font-family: "Playfair Display", serif; font-size: 62px; font-weight: 700; line-height: 1.05; margin: 18px 0 10px; letter-spacing: -0.01em; }
  .lede { font-size: 19px; font-weight: 300; line-height: 1.65; max-width: 620px; color: #5C4638; }
  .rule { height: 1px; background: #DCCDBA; margin: 52px 0 44px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; }
  .label { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: #93705C; font-weight: 600; margin-bottom: 18px; }
  .swatches { display: flex; gap: 0; border-radius: 2px; overflow: hidden; }
  .sw { flex: 1; height: 108px; display: flex; align-items: flex-end; padding: 10px; font-size: 10px; letter-spacing: 0.06em; }
  .type-row { margin-bottom: 22px; }
  .type-row .name { font-size: 11px; color: #93705C; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 6px; }
  .serif-xl { font-family: "Playfair Display", serif; font-size: 40px; font-weight: 700; }
  .serif-md { font-family: "Playfair Display", serif; font-size: 23px; font-weight: 500; }
  .body-sm { font-size: 15px; font-weight: 300; line-height: 1.7; color: #5C4638; }
  .principles { display: flex; gap: 54px; margin-top: 46px; }
  .principles div { flex: 1; }
  .principles .n { font-family: "Playfair Display", serif; font-size: 30px; color: #A8563A; }
  .principles .t { font-size: 14px; font-weight: 600; margin: 8px 0 5px; }
  .principles .d { font-size: 13px; font-weight: 300; line-height: 1.6; color: #6E5647; }
</style></head><body>
  <div class="eyebrow">Brand board &nbsp;·&nbsp; 2026</div>
  <h1>Meridian Strength</h1>
  <p class="lede">An unhurried, considered look. Warm paper, deep clay, and a serif that carries weight without shouting. Space is the luxury — nothing is crowded.</p>

  <div class="rule"></div>

  <div class="grid">
    <div>
      <div class="label">Palette</div>
      <div class="swatches">
        <div class="sw" style="background:#A8563A;color:#FBF6EE">#A8563A</div>
        <div class="sw" style="background:#2A1D16;color:#FBF6EE">#2A1D16</div>
        <div class="sw" style="background:#C99A6B;color:#2A1D16">#C99A6B</div>
        <div class="sw" style="background:#FBF6EE;color:#93705C;box-shadow:inset 0 0 0 1px #DCCDBA">#FBF6EE</div>
      </div>
      <div class="principles">
        <div><div class="n">01</div><div class="t">Generous air</div><div class="d">Wide margins. Sections breathe. Never more than one idea in view.</div></div>
        <div><div class="n">02</div><div class="t">Full measure</div><div class="d">Content runs wide and edge to edge, not boxed in a narrow column.</div></div>
      </div>
    </div>
    <div>
      <div class="label">Typography</div>
      <div class="type-row"><div class="name">Display — Playfair Display</div><div class="serif-xl">Built to last.</div></div>
      <div class="type-row"><div class="name">Subhead — Playfair Display</div><div class="serif-md">Twelve weeks, one standard.</div></div>
      <div class="type-row"><div class="name">Body — Inter Light</div><div class="body-sm">Every block is written for the athlete who has already done the easy work and wants the part that actually moves the number.</div></div>
    </div>
  </div>
</body></html>`

const browser = await launchChromium(chromium)
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 760 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.setContent(HTML, { waitUntil: "networkidle" })
  // The webfonts are the whole point of the "Typography" half — a board
  // photographed before they land is a board asking for the default face.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(600)
  mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: `${OUT}/reference-brand-board.png` })
  console.log(`wrote ${OUT}/reference-brand-board.png (2800x1520)`)
} finally {
  await browser.close()
}
