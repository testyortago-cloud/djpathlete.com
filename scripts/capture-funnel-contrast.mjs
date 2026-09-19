// Drives the REAL funnel preview route on a local dev server and photographs
// the contrast pass, with the callouts burned into each PNG.
//
//   node scripts/capture-funnel-contrast.mjs --port=3061 --phase=after
//
// EVERY SHOT IS THE REAL SCREEN ON THE REAL ROUTE. `/preview/<slug>` is the
// admin/staff full-screen draft preview — the same `renderDraftPreview` path
// publish itself runs (lib/funnels/preview-render.ts). Nothing here is rendered
// in a harness, a storybook or a scratch page, and the A/B harness's render
// tiles are deliberately NOT used as the deliverable: they come out of
// `renderDocToImages`, which is a harness, not the product.
//
// TWO DOCUMENTS, NOT ONE, because the two halves of this fix appear on
// different palettes and neither page shows both:
//
//   - `sales-k9m0w` carries the `ink` preset on a DARK page. This is the only
//     one that can show G16 at all: `--muted-foreground` scored 3.26:1 here and
//     5.98:1 on any light palette, so a light page proves nothing about it.
//   - `test` carries a light custom palette (#a8563a / #c99a6b) and is where the
//     pricing card's missing boundary reads most clearly.
//
// DEV CLONE ONLY. It refuses any other Supabase project ref outright, and it
// only ever READS — no publish, no save, no funnel is switched live.
//
// THE PREVIEW ROUTE IS GATED and fails CLOSED with a 404 (middleware covers
// only /admin/* and /client/*, so these routes gate themselves). So the session
// is asserted FIRST: an unauthenticated run would photograph a 404 page and
// report it as a contrast failure, which mimics the very fault being measured.

import { mkdirSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"

const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const PORT = argOf("port", "3061")
const PHASE = argOf("phase", "after")
const APP = `http://localhost:${PORT}`
const OUT = join("screenshots", "funnel-contrast-g16", PHASE)
const WIDTH = 1200 // RENDER_IMAGE_WIDTH — the width the critic sees the page at
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels

if (!["before", "after"].includes(PHASE)) throw new Error(`--phase must be before|after, got ${PHASE}`)

const SUBJECTS = [
  {
    slug: "sales-k9m0w",
    name: "01-dark-ink-preset",
    title: "Dark palette (ink preset) — secondary copy and the CTA button",
  },
  {
    slug: "test",
    name: "02-light-custom-palette",
    title: "Light palette (#a8563a / #c99a6b) — the pricing card's boundary",
  },
  // G21. A quiz card on an accent-toned section: the card paints itself white
  // whatever the section does, but its text was inheriting the SECTION's
  // foreground. On a palette whose accent pairs with white, that is white text
  // on a white card — 1.00:1, gone rather than dim.
  //
  // NEEDS A PALETTE AND AN ACCENT TONE, which no dev page carries by default.
  // Set them on the dev clone before running and restore them after; the script
  // refuses rather than photographing the wrong configuration.
  {
    slug: "athlete-quiz",
    name: "03-quiz-card-accent-tone",
    title: "Quiz card on an accent band — text that belonged to the wrong pair",
    quiz: true,
    requireTone: "accent",
  },
]

async function launchChromium() {
  try {
    return await chromium.launch()
  } catch (err) {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
    const shells = existsSync(cache)
      ? readdirSync(cache)
          .filter((d) => d.startsWith("chromium_headless_shell-"))
          .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      : []
    for (const shell of shells) {
      const exe = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
      if (!existsSync(exe)) continue
      console.log(`  playwright's own build is missing; falling back to ${shell}`)
      return await chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

/**
 * An element's position in RAW pixels of the FULL-PAGE screenshot.
 *
 * NOT `boundingBox()`. That returns VIEWPORT-relative CSS pixels, so once the
 * page has been scrolled every marker lands short by exactly the scroll offset
 * — which is how the first run of this script put all three markers in the
 * top-left corner, on top of a heading, instead of on the things they describe.
 * A `fullPage` screenshot is the whole document, so the marker has to be in
 * DOCUMENT coordinates: `getBoundingClientRect()` plus the scroll offset, then
 * multiplied by the device scale factor because annotate() places in raw pixels.
 */
async function rawBox(page, selector) {
  const box = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height }
  })()`)
  if (!box) {
    console.warn(`  !! MARKER TARGET MISSING: ${selector} — the shot will be unannotated there`)
    return null
  }
  return { x: box.x * DSF, y: box.y * DSF, width: box.width * DSF, height: box.height * DSF }
}

/**
 * Hide the preview route's own "Preview — not published" toast.
 *
 * It is dev/admin chrome, not the page a visitor sees, and it floats over the
 * top-right of every shot. Hidden from the RECORDER rather than by editing app
 * code — the toast is a real and useful feature, it just is not the subject.
 */
async function hidePreviewChrome(page) {
  const hidden = await page.evaluate(`(() => {
    let n = 0
    for (const el of document.querySelectorAll('body *')) {
      const text = el.textContent || ''
      if (text.indexOf('Preview') !== -1 && text.indexOf('not published') !== -1 && el.children.length < 6) {
        const pos = getComputedStyle(el).position
        if (pos === 'fixed' || pos === 'absolute') { el.style.display = 'none'; n++ }
      }
    }
    return n
  })()`)
  if (hidden === 0) console.warn("  !! preview toast NOT hidden — it may have changed shape; check the shot")
  else console.log(`  hid ${hidden} preview-chrome element(s)`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })

  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://unset.supabase.co").host.split(".")[0]
  if (ref !== DEV_REF && process.env.SKIP_REF_CHECK !== "1") {
    throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
  }

  const browser = await launchChromium()
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: 1000 },
    deviceScaleFactor: DSF,
    colorScheme: "light",
  })
  const page = await ctx.newPage()

  // ── Session assertion FIRST. The preview route 404s when it is not satisfied,
  //    and a 404 page photographs exactly like a broken render. ──
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "networkidle" })
  if (!page.url().includes("/admin")) {
    throw new Error(`dev login did not land on /admin — now at ${page.url()}. Refusing to photograph anything.`)
  }
  const sessionResponse = await page.goto(`${APP}/api/auth/session`, { waitUntil: "domcontentloaded" })
  const session = JSON.parse(await page.locator("body").innerText())
  if (session?.user?.role !== "admin") {
    throw new Error(`SESSION NOT ADMIN (${sessionResponse?.status()}) — refusing. Body: ${JSON.stringify(session)}`)
  }
  console.log(`  session OK: ${session.user.email} / role=${session.user.role}`)

  for (const subject of SUBJECTS) {
    const url = `${APP}/preview/${subject.slug}`
    await page.goto(url, { waitUntil: "networkidle" })
    if (page.url().includes("/login") || (await page.title()).match(/404|not found/i)) {
      throw new Error(`/preview/${subject.slug} did not render a page — now at ${page.url()}`)
    }

    // WHAT THE SERVER IS SERVING, RECORDED IN THE LOG.
    //
    // A dev server can hold a stale compile of a deeply-imported module, and a
    // `git checkout` of lib/ mid-session (which is how the BEFORE phase is
    // produced) is exactly the way to cause one. A screenshot taken then is a
    // picture of code that is not the code under test, and NOTHING about the
    // image says so. During this build the light page was briefly observed
    // serving a --muted-foreground that matched neither the before nor the
    // after value, purely because the tree was mid-checkout.
    //
    // So the token is read off the page and printed next to the phase. It is
    // not asserted against a fixed value — BEFORE and AFTER legitimately differ,
    // which is the whole point — but it is on the record, so a shot can be
    // matched to the code that produced it after the fact.
    const servedTokens = await page.evaluate(
      "(() => { const r = document.getElementById('djp-funnel-root'); if (!r) return null; const s = getComputedStyle(r); return s.getPropertyValue('--muted-foreground').trim() + ' / bg ' + s.getPropertyValue('--background').trim(); })()",
    )
    if (!servedTokens) throw new Error(`no #djp-funnel-root on /preview/${subject.slug} — the render failed`)
    console.log(`  [${PHASE}] ${subject.slug} serving --muted-foreground: ${servedTokens}`)

    if (subject.quiz) {
      // REFUSE rather than photograph the wrong configuration. A quiz on a
      // `muted` tone cannot show G21 at all — muted's pair IS the neutral one,
      // so the card and the section agree and there is nothing to see. A shot
      // of that would look like a clean result.
      const tone = await page.locator(".djp-s-quiz").first().getAttribute("data-tone")
      const cardCount = await page.locator(".djp-quiz").count()
      console.log(`  ${subject.slug}: quiz tone="${tone}", ${cardCount} card(s)`)
      if (cardCount === 0) throw new Error(`${subject.slug} rendered no .djp-quiz — wrong subject`)
      if (subject.requireTone && tone !== subject.requireTone) {
        throw new Error(
          `${subject.slug}'s quiz is tone="${tone}", not "${subject.requireTone}" — ` +
            `that tone cannot show this defect, so the shot would be misleading. Set the tone on the dev clone first.`,
        )
      }
    } else {
      // The page must actually have a pricing section, or the two shapes this
      // pass is about are not on screen and the shot proves nothing.
      const planCount = await page.locator(".djp-plan").count()
      const btnCount = await page.locator(".djp-btn-primary").count()
      console.log(`  ${subject.slug}: ${planCount} plan card(s), ${btnCount} primary button(s)`)
      if (planCount === 0 || btnCount === 0) {
        throw new Error(`${subject.slug} has no plan card or no primary button — wrong subject for this pass`)
      }
    }

    // Park the pointer away from everything: Playwright's mouse stays where it
    // last was, and a hover state on a button would change the very colours
    // being photographed.
    await page.mouse.move(2, 2)
    await hidePreviewChrome(page)

    await page.locator(subject.quiz ? ".djp-quiz" : ".djp-plan").first().scrollIntoViewIfNeeded()
    await page.waitForTimeout(600)

    const markers = []

    if (subject.quiz) {
      const prompt = await rawBox(page, ".djp-quiz-prompt, .djp-quiz")
      if (prompt) {
        markers.push({
          x: prompt.x + Math.min(prompt.width / 2, 400),
          y: prompt.y + 20,
          caption:
            PHASE === "before"
              ? "The question is written in white, on a white card. It is not faint — it is not there. The card always paints itself white, but its words were taking their colour from the coloured band around it."
              : "The question now takes its colour from the card it is printed on, not from the band behind the card. Black on white, on every colour scheme a coach can pick.",
        })
      }
      const file = join(OUT, `${subject.name}.png`)
      const shot = await page.screenshot({ fullPage: true })
      await annotate(shot, file, {
        title: `${subject.title} — ${PHASE.toUpperCase()}`,
        subtitle: `/preview/${subject.slug} — the real route, ${WIDTH}px, DSF ${DSF}`,
        markers,
        scale: (WIDTH * DSF) / 1440,
      })
      console.log(`  wrote ${file} (${markers.length} markers)`)
      continue
    }
    const plan = await rawBox(page, ".djp-plan")
    if (plan) {
      markers.push({
        x: plan.x + plan.width / 2,
        y: plan.y + 8,

        caption:
          PHASE === "before"
            ? "The price card has no edge. Its fill is the only thing separating it from the band behind it — measured 1.01-1.42:1 across every preset, where 3:1 is the floor."
            : "The price card now has an edge, drawn in the same colour the page already guarantees is readable on this band. Worst case across all 12 presets is 3.75:1.",
      })
    }
    const btn = await rawBox(page, ".djp-plan .djp-btn-primary")
    if (btn) {
      markers.push({
        x: btn.x + btn.width / 2,
        y: btn.y + btn.height / 2,

        caption:
          PHASE === "before"
            ? "The button is filled in a colour nothing checked against the card under it. On this palette that is 1.08:1 — the art critic called it 'almost invisible'."
            : "The button now carries a hairline ring, so its shape is findable whatever palette the coach picks.",
      })
    }
    const sub = await rawBox(page, ".djp-sub, .djp-bullet-text, .djp-plan-blurb")
    if (sub) {
      markers.push({
        x: sub.x + Math.min(sub.width / 2, 300),
        y: sub.y + sub.height / 2,

        caption:
          PHASE === "before"
            ? "Secondary copy is painted a fixed grey the palette never touched. On a dark page that is 3.26:1, against a 4.5:1 floor for body text."
            : "Secondary copy is now derived from this page's own ink, so it clears 4.5:1 — and stays dimmer than the headings, which is the point of it.",
      })
    }

    const file = join(OUT, `${subject.name}.png`)
    const shot = await page.screenshot({ fullPage: true })
    // annotate(src, out, opts) is POSITIONAL, and its markers are
    // {x, y, caption} — the number is assigned by array index, not passed in.
    // `scale` is pinned to the real capture width rather than left to default:
    // the helper assumes 1440 CSS px authoring, and these are captured at 1200
    // (RENDER_IMAGE_WIDTH) x2, so letting it infer would size the caption band
    // for the wrong page.
    await annotate(shot, file, {
      title: `${subject.title} — ${PHASE.toUpperCase()}`,
      subtitle: `/preview/${subject.slug} — the real route, ${WIDTH}px, DSF ${DSF}`,
      markers,
      scale: (WIDTH * DSF) / 1440,
    })
    console.log(`  wrote ${file} (${markers.length} markers)`)
  }

  await browser.close()
  console.log("\nNOTHING WAS SAVED, PUBLISHED OR CHANGED. Read-only throughout.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
