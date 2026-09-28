// Drives the REAL "Generate with AI" dialog on /admin/blog/new and photographs
// the fix for the owner's 2026-09-29 recordings: four attached PDFs, where the
// scanned ones used to show "0.0KB" and the fourth turned every attempt into
// "Invalid request."
//
//   npx next dev --webpack -p 3050
//   node scripts/capture-blog-generator-fixes.mjs
//
// Uploads two image-only PDFs (so the route really calls GPT-6 Astra, ~$0.02
// each) and two with a text layer. It NEVER clicks Generate: that starts a real
// generation job, and the route is covered by
// __tests__/app/api/admin/blog/generate-references.test.ts instead.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.

import { mkdirSync, readFileSync } from "node:fs"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/blog-generator-fixes"
const WIDTH = 1440
const HEIGHT = 1100
const DSF = 2

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)

const scan = readFileSync("__tests__/fixtures/pdf/article-scan.pdf")
const text = readFileSync("__tests__/fixtures/pdf/article-text.pdf")
// Named like the owner's own attachments.
const FILES = [
  { name: "1.pdf", mimeType: "application/pdf", buffer: scan },
  { name: "2.pdf", mimeType: "application/pdf", buffer: text },
  { name: "3.pdf", mimeType: "application/pdf", buffer: scan },
  { name: "4.pdf", mimeType: "application/pdf", buffer: text },
]

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })

async function markerFor(locator, caption, place = "before") {
  const box = await locator.boundingBox()
  if (!box) {
    console.warn(`WARN: no box for marker "${caption}" — it will be missing`)
    return null
  }
  const x = place === "after" ? box.x + box.width + 22 : box.x - 22
  return { x: Math.round(x * DSF), y: Math.round((box.y + box.height / 2) * DSF), caption }
}

try {
  const page = await ctx.newPage()
  // Sign in off camera, then assert the session before anything else.
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/blog/new`)
  const session = await (await ctx.request.get(`${APP}/api/auth/session`)).json()
  if (session?.user?.role !== "admin") throw new Error(`no admin session: ${JSON.stringify(session)}`)

  await page.goto(`${APP}/admin/blog/new`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  if (!page.url().includes("/admin/blog/new")) throw new Error(`did not reach the editor (at ${page.url()})`)
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }`,
  })

  // Wait for hydration: a click before it is swallowed.
  const open = page.getByRole("button", { name: "Generate with AI" }).first()
  await open.waitFor()
  await page.waitForTimeout(1500)
  await open.click()
  const dialog = page.getByRole("dialog")
  await dialog.waitFor()

  await dialog
    .getByPlaceholder("e.g., Recovery strategies for youth athletes after competition season")
    .fill(
      "Redo this article in more basic layman terminology. Use the document attachments as examples of what I am looking for in terms of readership: light, concise, informative without being overwhelming.",
    )
  await dialog.getByText("Add research & references").click()

  const t0 = Date.now()
  await dialog.locator('input[type="file"]').setInputFiles(FILES)
  // All four rows present, and the spinner gone.
  await dialog.getByText("4.pdf", { exact: true }).waitFor({ timeout: 120_000 })
  await dialog.getByText("Reading document...").waitFor({ state: "detached", timeout: 120_000 })
  console.log(`4 documents read in ${Date.now() - t0}ms`)

  const sizes = await dialog.locator("span", { hasText: /KB$/ }).allTextContents()
  console.log("sizes shown:", sizes)
  if (sizes.length !== 4 || sizes.some((s) => s === "0.0KB")) throw new Error(`bad sizes: ${sizes.join(", ")}`)

  const row1 = dialog.getByText("1.pdf", { exact: true })
  await row1.scrollIntoViewIfNeeded()
  await page.mouse.move(5, 5)
  await page.waitForTimeout(400)

  const markers = (
    await Promise.all([
      markerFor(
        row1,
        "1.pdf is a scan (a picture of a page, no text layer). It used to show 0.0KB. AI now reads it, so it shows its real size.",
      ),
      markerFor(
        dialog.getByText("2.pdf", { exact: true }),
        "2.pdf has normal text, so it is read the ordinary way. No AI cost.",
      ),
      markerFor(
        dialog.getByText("4.pdf", { exact: true }),
        "A 4th document is accepted now. Up to 5 are allowed, the same number the box lets you add.",
      ),
      markerFor(
        page.locator("[data-sonner-toast]").first(),
        "A note says when a document was a scan and AI read it.",
        "before",
      ),
    ])
  ).filter(Boolean)

  const raw = `${OUT}/01-four-documents-raw.png`
  await page.screenshot({ path: raw })
  await annotate(raw, `${OUT}/01-four-documents.png`, {
    title: "Four documents attached, including two scans",
    subtitle: "Generate with AI → Add research & references. Real dialog, dev database. Generate was not clicked.",
    markers,
  })
  console.log("wrote", `${OUT}/01-four-documents.png`)
} finally {
  await browser.close()
}
