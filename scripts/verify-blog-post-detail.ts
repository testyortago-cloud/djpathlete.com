/**
 * Detailed Playwright capture of the blog post page — focuses the article
 * shell so reviewer can inspect typography, TOC, drop cap, and headings.
 */
import { chromium } from "@playwright/test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const BASE = "http://localhost:3050"
const SLUG = "force-velocity-profile-individualized-training-injury-reduction"
const OUT = join(process.cwd(), ".playwright-out", "blog-redesign")

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1.5,
  })
  const page = await ctx.newPage()

  await page.goto(`${BASE}/blog/${SLUG}`, { waitUntil: "networkidle" })

  // Confirm TOC is rendered on desktop
  const tocCount = await page.locator("aside[aria-label='Table of contents']").count()
  console.log(`Desktop TOC aside count: ${tocCount}`)
  const tocLinkCount = await page
    .locator("aside[aria-label='Table of contents'] a")
    .count()
  console.log(`Desktop TOC link count: ${tocLinkCount}`)

  // Confirm h2 styling (accent rule)
  const firstH2 = page.locator(".djp-prose-blog h2").first()
  const h2Box = await firstH2.boundingBox()
  console.log(`First h2 bounding box:`, h2Box)
  const h2Color = await firstH2.evaluate((el) => getComputedStyle(el).color)
  const h2Size = await firstH2.evaluate((el) => getComputedStyle(el).fontSize)
  console.log(`First h2 color: ${h2Color}, size: ${h2Size}`)

  // Drop-cap check on first paragraph
  const firstP = page.locator(".djp-prose-blog p").first()
  const firstPInfo = await firstP.evaluate((el) => {
    const cs = getComputedStyle(el, "::first-letter")
    return { fontSize: cs.fontSize, color: cs.color, fontFamily: cs.fontFamily }
  })
  console.log(`First paragraph ::first-letter:`, firstPInfo)

  await page.screenshot({
    path: join(OUT, "10-post-detail-1600.png"),
    fullPage: true,
  })

  // Scroll to first H2 and capture it in viewport
  await firstH2.scrollIntoViewIfNeeded()
  await page.screenshot({
    path: join(OUT, "11-post-section-zoom.png"),
    fullPage: false,
    clip: { x: 0, y: 0, width: 1600, height: 1000 },
  })

  await ctx.close()
  await browser.close()
  console.log("\nScreenshots written to", OUT)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
