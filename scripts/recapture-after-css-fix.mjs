// Follow-up to capture-builder-design-variety.mjs after two CSS fixes landed
// on top of it (54ed0449 — paint .djp-page with the active palette's
// paper/ink; 3954dde7 — repaint a muted pricing plan's price with the tone's
// own foreground). NEITHER the funnels' stored documents nor their themes
// changed — only the stylesheet did — so this re-shoots existing routes
// against the running dev server. It does NOT touch the builder chat.
//
// It also PROBES computed styles directly (color/background of a landmark
// element per page), the same way the bug was originally diagnosed, so the
// "which pages actually changed" claim is measured, not assumed from reading
// the source diff alone.
import { mkdirSync, readFileSync } from "node:fs"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3061"
const OUT = "screenshots/builder-design-variety"
const PRIMARY_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"
const DSF = 2

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)

async function hideFloatingChrome(page) {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"],
              [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })
}

async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND: "${caption.slice(0, 70)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n}, using the first: "${caption.slice(0, 70)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX: "${caption.slice(0, 70)}…"`)
    return { x: 100, y: 100, caption }
  }
  const cx = place === "center" ? box.x + box.width / 2 : place === "after" ? box.x + box.width + 22 : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

async function probe(page, label, locator) {
  const el = locator.first()
  if ((await el.count()) === 0) {
    console.log(`    probe "${label}": TARGET NOT FOUND`)
    return null
  }
  const styles = await el.evaluate((node) => {
    const cs = getComputedStyle(node)
    return { color: cs.color, background: cs.backgroundColor }
  })
  console.log(`    probe "${label}": color=${styles.color} background=${styles.background}`)
  return styles
}

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DSF })

try {
  const p0 = await ctx.newPage()
  await p0.goto(`${APP}/api/dev/login?callbackUrl=/admin/funnels`, { waitUntil: "domcontentloaded" })
  await p0.waitForTimeout(2000)
  if (!p0.url().includes("/admin")) throw new Error(`dev-login did not reach /admin (at ${p0.url()})`)
  await p0.close()
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])

  // ---- Verification probes on all three, against the live fixed CSS. ----
  console.log("\n=== verification probes (no screenshots yet) ===")

  const waitlistPreview = await ctx.newPage()
  await waitlistPreview.goto(`${APP}/preview/waitlist-k9m0w`, { waitUntil: "domcontentloaded" })
  await waitlistPreview.waitForTimeout(1500)
  console.log("  waitlist:")
  await probe(waitlistPreview, "hero heading", waitlistPreview.locator(".djp-hd").first())
  await probe(waitlistPreview, "page wrapper", waitlistPreview.locator(".djp-page"))
  await waitlistPreview.close()

  const salesPreview = await ctx.newPage()
  await salesPreview.goto(`${APP}/preview/sales-k9m0w`, { waitUntil: "domcontentloaded" })
  await salesPreview.waitForTimeout(1500)
  console.log("  sales:")
  await probe(salesPreview, "pricing price", salesPreview.locator(".djp-plan-price").first())
  await probe(salesPreview, "page wrapper", salesPreview.locator(".djp-page"))
  await salesPreview.close()

  const campPreview = await ctx.newPage()
  await campPreview.goto(`${APP}/preview/camp-kfcsg`, { waitUntil: "domcontentloaded" })
  await campPreview.waitForTimeout(1500)
  console.log("  camp:")
  await probe(campPreview, "page wrapper", campPreview.locator(".djp-page"))
  await probe(campPreview, "FAQ question", campPreview.locator(".djp-faq-item").first())
  await campPreview.close()

  console.log("\n=== re-capturing camp (mandatory) ===")

  const builder = await ctx.newPage()
  await builder.setViewportSize({ width: 1680, height: 1000 })
  await builder.goto(`${APP}/admin/funnels/15dafa11-5d79-4d6a-91ad-8d0ad57f64ef/edit/2416d255-aa8d-4cc0-a177-dfef1d653534`, {
    waitUntil: "load",
  })
  await builder.waitForTimeout(3000)
  await hideFloatingChrome(builder)
  await builder.getByRole("button", { name: "Page design" }).click()
  await builder.waitForTimeout(500)
  await builder.mouse.move(4, 4)

  const rawBuilder = `${OUT}/.raw-camp-builder.png`
  await builder.screenshot({ path: rawBuilder })
  await annotate(rawBuilder, `${OUT}/07-camp-builder-theme-panel.png`, {
    title: `"Summer Sports Camp kfcsg" — same page, now correctly painted`,
    subtitle: `A stylesheet bug meant the "Ember" palette's white text sat on the host's own unpainted white background in sections with no band colour of their own. Fixed (commit 54ed0449) — nothing about the page's content or its Page design settings changed.`,
    markers: [
      await markerOn(
        builder,
        builder.locator('iframe[src*="funnel-preview"]:visible').first(),
        `The live preview inside the builder — the FAQ section (previously invisible white-on-white) is now readable.`,
        { place: "center", dy: -250 },
      ),
      await markerOn(
        builder,
        builder.locator("text=Palette").first(),
        `"Page design" panel, unchanged: still "Ember", "Bold" font, "Tight" density, "Round" corners, "Light" tone.`,
        { place: "left", dx: -10 },
      ),
    ],
  })
  console.log(`  wrote ${OUT}/07-camp-builder-theme-panel.png`)

  const preview = await ctx.newPage()
  await preview.goto(`${APP}/preview/camp-kfcsg`, { waitUntil: "domcontentloaded" })
  await preview.waitForTimeout(2000)
  await hideFloatingChrome(preview)
  await preview.mouse.move(4, 4)
  await preview.waitForTimeout(200)

  const rawLight = `${OUT}/.raw-camp-light-fixed.png`
  await preview.screenshot({ path: rawLight, fullPage: true })
  await annotate(rawLight, `${OUT}/08-camp-preview-light.png`, {
    title: `"Summer Sports Camp kfcsg" — fixed`,
    subtitle: `Its stored "Tone" is still "Light", but "Ember" is a dark-seeded palette (near-black paper, white ink) — so with the page wrapper now correctly painted, the sections that take the page's own colour (not a banded colour of their own) render dark, not white. Read every FAQ question here to confirm: they are now visible.`,
    markers: [],
  })
  console.log(`  wrote ${OUT}/08-camp-preview-light.png`)

  await builder.bringToFront()
  await builder.locator("#theme-tone").selectOption("dark")
  await builder.waitForTimeout(2500)

  await preview.reload({ waitUntil: "domcontentloaded" })
  await preview.waitForTimeout(2000)
  await hideFloatingChrome(preview)
  await preview.mouse.move(4, 4)
  await preview.waitForTimeout(200)

  const rawDark = `${OUT}/.raw-camp-dark-fixed.png`
  await preview.screenshot({ path: rawDark, fullPage: true })
  await annotate(rawDark, `${OUT}/09-camp-preview-dark.png`, {
    title: `Same page, "Tone" switched to "Dark" by hand`,
    subtitle: `No AI call for this. Switching "Tone" to "Dark" makes the page paint the palette's BRAND colour (Ember's red/orange) on those same sections instead of its near-black paper — the opposite of the naive "dark tone = darker page" expectation on a dark-seeded palette like this one.`,
    markers: [],
  })
  console.log(`  wrote ${OUT}/09-camp-preview-dark.png`)

  await builder.locator("#theme-tone").selectOption("light")
  await builder.waitForTimeout(1500)
  await builder.close()
  await preview.close()
} finally {
  await browser.close()
}
