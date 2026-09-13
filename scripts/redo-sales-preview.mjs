// One-off follow-up to capture-builder-design-variety.mjs: the sales page's
// review/self-critique pass kept revising the document for longer than the
// main script's 20s settle window, so its "as-built dark" and "toggled light"
// screenshots were taken against a stale pre-review draft (confirmed by
// diffing stored `project_data` against the two PNGs after the fact — see
// task-12-report.md). This re-shoots both against the now-genuinely-settled
// document, using the exact same technique as the main script.
import { mkdirSync, readFileSync } from "node:fs"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3061"
const OUT = "screenshots/builder-design-variety"
const PRIMARY_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"
const STEP = "5ac26645-ab35-4035-b917-fba1dd6f6f66"
const SLUG = "sales-k9m0w"
const DSF = 2

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
const rest = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }

async function readDoc() {
  const rows = await (
    await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/funnel_steps?select=project_data&id=eq.${STEP}`, { headers: rest })
  ).json()
  return rows[0].project_data
}

async function hideFloatingChrome(page) {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"],
              [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })
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

  const before = await readDoc()
  const asBuiltTone = before.theme.tone
  console.log(`  current stored tone: "${asBuiltTone}" — ${before.sections.length} sections`)
  console.log(`  pricing heading: "${before.sections.find((s) => s.kind === "pricing")?.props?.heading}"`)

  const builder = await ctx.newPage()
  await builder.setViewportSize({ width: 1680, height: 1000 })
  await builder.goto(`${APP}/admin/funnels/a2f55365-ef3b-4bb1-8c76-2123575b3ac4/edit/${STEP}`, { waitUntil: "load" })
  await builder.waitForTimeout(3000)

  const preview = await ctx.newPage()
  await preview.goto(`${APP}/preview/${SLUG}`, { waitUntil: "domcontentloaded" })
  await preview.waitForTimeout(2000)
  await hideFloatingChrome(preview)
  await preview.mouse.move(4, 4)
  await preview.waitForTimeout(200)

  const rawDark = `${OUT}/.raw-preview-dark-final.png`
  await preview.screenshot({ path: rawDark, fullPage: true })
  await annotate(rawDark, `${OUT}/05-sales-preview-${asBuiltTone}.png`, {
    title: `"Forged Strength Program k9m0w"`,
    subtitle: `The real page, on its real address /preview/${SLUG}, after its review pass finished settling. The AI chose a "${asBuiltTone}" look and a ${before.sections.length}-section layout for this brief, on its own.`,
    markers: [],
  })
  console.log(`  rewrote ${OUT}/05-sales-preview-${asBuiltTone}.png (final, settled document)`)

  const otherTone = asBuiltTone === "dark" ? "light" : "dark"
  await builder.getByRole("button", { name: "Page design" }).click()
  await builder.waitForTimeout(300)
  await builder.locator("#theme-tone").selectOption(otherTone)
  await builder.waitForTimeout(2500)
  const after = await readDoc()
  if (after.theme.tone !== otherTone) throw new Error(`tone toggle did not save: got "${after.theme.tone}"`)

  await preview.reload({ waitUntil: "domcontentloaded" })
  await preview.waitForTimeout(2000)
  await hideFloatingChrome(preview)
  await preview.mouse.move(4, 4)
  await preview.waitForTimeout(200)

  const rawOther = `${OUT}/.raw-preview-other-final.png`
  await preview.screenshot({ path: rawOther, fullPage: true })
  await annotate(rawOther, `${OUT}/06-sales-preview-${otherTone}.png`, {
    title: `Same page, repainted "${otherTone}" by hand`,
    subtitle: `No AI call for this — an owner switched "Tone" from "${asBuiltTone}" to "${otherTone}" in the Page design panel. NOTE: the pricing section (style.tone "muted") loses contrast here — see task-12-report.md.`,
    markers: [],
  })
  console.log(`  rewrote ${OUT}/06-sales-preview-${otherTone}.png (final, settled document)`)

  await builder.locator("#theme-tone").selectOption(asBuiltTone)
  await builder.waitForTimeout(1500)
} finally {
  await browser.close()
}
