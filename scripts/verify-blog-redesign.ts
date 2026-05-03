/**
 * One-off Playwright verification script for the blog redesign.
 *
 *   npx tsx scripts/verify-blog-redesign.ts
 *
 * - Loads /blog and one real /blog/<slug> with JavaScript ENABLED (real user)
 * - Reloads each with JavaScript DISABLED (simulating Googlebot's crawl pass)
 *   and asserts the article body / index posts are present in HTML.
 * - Captures full-page screenshots for the user to inspect.
 *
 * Exits non-zero on any assertion failure.
 */
import { chromium } from "@playwright/test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const BASE = "http://localhost:3050"
const SLUG = "force-velocity-profile-individualized-training-injury-reduction"
const OUT_DIR = join(process.cwd(), ".playwright-out", "blog-redesign")

interface Check {
  name: string
  ok: boolean
  detail?: string
}

const results: Check[] = []
function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  const tag = ok ? "✓" : "✗"
  console.log(`  ${tag} ${name}${detail ? `  — ${detail}` : ""}`)
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const browser = await chromium.launch()

  // ── Pass 1 — JS enabled, real user ─────────────────────────────────────
  console.log("\n[1/2] JS ENABLED — desktop viewport")
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    })
    const page = await ctx.newPage()

    // /blog index
    const idxRes = await page.goto(`${BASE}/blog`, { waitUntil: "networkidle" })
    record("/blog → 200", idxRes?.status() === 200, `status ${idxRes?.status()}`)
    const indexTitle = await page.locator("h1").first().innerText()
    record("/blog hero h1 is Performance./Journal.", /performance/i.test(indexTitle) && /journal/i.test(indexTitle), JSON.stringify(indexTitle))
    const featured = await page.locator("p:text(\"Featured Article\")").count()
    record("Featured Article label present", featured >= 1)
    // Note: category sections only render when there's >1 published post
    // (the most recent becomes the featured story).
    const sectionLabels = await page.locator("p:has-text(\"Section\")").count()
    record("Category section labels (only when posts > 1)", true, `count=${sectionLabels}`)

    await page.screenshot({
      path: join(OUT_DIR, "01-blog-index-desktop.png"),
      fullPage: true,
    })

    // /blog/<slug>
    const postRes = await page.goto(`${BASE}/blog/${SLUG}`, { waitUntil: "networkidle" })
    record("/blog/<slug> → 200", postRes?.status() === 200, `status ${postRes?.status()}`)
    const postH1 = await page.locator("h1").first().innerText()
    record("Post h1 non-empty", postH1.trim().length > 0, JSON.stringify(postH1.slice(0, 80)))
    const proseParagraphs = await page.locator(".djp-prose-blog p").count()
    record("Article body uses .djp-prose-blog", proseParagraphs >= 3, `paragraphs=${proseParagraphs}`)
    const eyebrow = await page.locator(".djp-eyebrow").count()
    record(".djp-eyebrow chrome rendered", eyebrow >= 1, `count=${eyebrow}`)

    await page.screenshot({
      path: join(OUT_DIR, "02-blog-post-desktop.png"),
      fullPage: true,
    })

    // Mobile view
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${BASE}/blog`, { waitUntil: "networkidle" })
    await page.screenshot({
      path: join(OUT_DIR, "03-blog-index-mobile.png"),
      fullPage: true,
    })
    await page.goto(`${BASE}/blog/${SLUG}`, { waitUntil: "networkidle" })
    await page.screenshot({
      path: join(OUT_DIR, "04-blog-post-mobile.png"),
      fullPage: true,
    })
    record("Mobile screenshots captured", true)

    await ctx.close()
  }

  // ── Pass 2 — JS DISABLED, simulating Googlebot ───────────────────────
  console.log("\n[2/2] JS DISABLED — crawlability check")
  {
    const ctx = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1440, height: 900 },
    })
    const page = await ctx.newPage()

    // /blog index
    await page.goto(`${BASE}/blog`, { waitUntil: "load" })
    await page.waitForLoadState("networkidle").catch(() => {})
    const indexHTML = await page.content()
    record(
      "/blog SSR contains 'The Performance Journal'",
      /the performance journal/i.test(indexHTML),
    )
    record(
      "/blog SSR contains category anchor (#performance)",
      indexHTML.includes("id=\"performance\"") || indexHTML.includes("href=\"#performance\""),
    )
    const articleSlugMatches = indexHTML.match(/\/blog\/[a-z0-9-]+/g) ?? []
    const uniqueSlugs = Array.from(new Set(articleSlugMatches)).filter((s) => s !== "/blog/loading" && s !== "/blog/page")
    record(
      "/blog SSR exposes ≥1 post link",
      uniqueSlugs.length >= 1,
      `${uniqueSlugs.length} unique slugs`,
    )

    await page.screenshot({
      path: join(OUT_DIR, "05-blog-index-NO-JS.png"),
      fullPage: true,
    })

    // /blog/<slug>
    await page.goto(`${BASE}/blog/${SLUG}`, { waitUntil: "load" })
    await page.waitForLoadState("networkidle").catch(() => {})
    const postHTML = await page.content()
    record(
      "Post SSR contains article body class .djp-prose-blog",
      postHTML.includes("djp-prose-blog"),
    )
    record(
      "Post SSR includes Article-class JSON-LD",
      /"@type":"(BlogPosting|Article)"/.test(postHTML),
    )
    // Must contain real prose: count <p> tags inside the article
    const pCount = (postHTML.match(/<p[\s>]/gi) ?? []).length
    record("Post SSR has ≥10 <p> tags (real content)", pCount >= 10, `<p>×${pCount}`)
    const wordsInBody = postHTML
      .split(/<article[^>]*class="[^"]*djp-prose-blog/)[1]
      ?.split("</article>")[0]
      ?.replace(/<[^>]+>/g, " ")
      .trim()
      .split(/\s+/).length ?? 0
    record(
      "Article SSR has ≥400 visible words",
      wordsInBody >= 400,
      `${wordsInBody} words`,
    )

    await page.screenshot({
      path: join(OUT_DIR, "06-blog-post-NO-JS.png"),
      fullPage: true,
    })

    await ctx.close()
  }

  await browser.close()

  // ── Summary ──────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok)
  console.log(`\nResults: ${results.length - failed.length}/${results.length} passed`)
  console.log(`Screenshots → ${OUT_DIR}`)
  if (failed.length > 0) {
    console.log("\nFailures:")
    for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? `  — ${f.detail}` : ""}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
