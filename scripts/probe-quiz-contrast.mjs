// Reads the COMPUTED colours off a real rendered QUIZ page and measures them.
//
//   node --env-file=.env.local scripts/probe-quiz-contrast.mjs --port=3061 --slug=athlete-quiz
//
// ---------------------------------------------------------------------------
// WHY A SECOND PROBE, AND NOT AN ARGUMENT TO THE FIRST
// ---------------------------------------------------------------------------
// `probe-rendered-contrast.mjs` asks "is this text readable on what is behind
// it". This one asks a different question that the other cannot: "is this
// element in the pair it THINKS it is in".
//
// Gap G21 is not a low-contrast pair, it is a MISATTRIBUTED one. The quiz card
// paints itself `var(--background)` on every tone, so its children belong to the
// neutral pair — but nothing set `color` on the card, so on an accent or dark
// section they inherited the SECTION's foreground instead. Measured over 12
// presets x 4 tones that reached 1.00:1 in the worst case (slate on a dark
// section: the identical colour), failing in 13 of 48 cells.
//
// The `band` variant then needs the OPPOSITE answer — it makes the quiz
// transparent, so the section's pair is correct there and the neutral one is
// not. A fix that gets one right gets the other wrong, which is exactly why
// this is checked against a browser rather than reasoned about.
//
// READ-ONLY. It navigates and reads; it clicks nothing and saves nothing.

import { chromium } from "playwright"

const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const PORT = argOf("port", "3061")
const SLUG = argOf("slug", "athlete-quiz")
const APP = `http://localhost:${PORT}`

function luminance([r, g, b]) {
  const lin = (c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
const ratio = (a, b) => {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
const parseRgb = (s) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number)

async function main() {
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 1000 } })).newPage()

  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "networkidle" })
  if (!page.url().includes("/admin")) throw new Error(`dev login failed — at ${page.url()}`)

  await page.goto(`${APP}/preview/${SLUG}`, { waitUntil: "networkidle" })

  // COLOURS COME BACK IN WHATEVER SPACE THEY WERE AUTHORED IN.
  //
  // On a page with a palette these are hex, so `rgb(...)` comes out and naive
  // number-scraping works. On a page with NO palette — which is every production
  // page today — the tokens come from app/globals.css's `oklch(...)`, and Chrome
  // returns computed values as `lab(...)`. Scraping the first three numbers out
  // of `lab(100 0 0)` yields [100, 0, 0] and calls white a dark red: the first
  // run of this probe reported 1.53 FAIL for near-black text on a white card.
  //
  // So the conversion happens in the BROWSER, by painting each colour onto a 1x1
  // canvas and reading the pixel back. That is exact for every CSS colour syntax
  // there is, present and future, and needs no colour-space maths here.
  const facts = await page.evaluate(`(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const toRgb = (value) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000000'
      ctx.fillStyle = value
      ctx.fillRect(0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      return [d[0], d[1], d[2], d[3] / 255]
    }
    const section = document.querySelector('.djp-s-quiz')
    if (!section) return null
    const card = section.querySelector('.djp-quiz')
    const sectionStyle = getComputedStyle(section)
    const cardStyle = getComputedStyle(card)
    const kids = {}
    for (const sel of ['.djp-quiz-prompt', '.djp-quiz-label', '.djp-quiz-option', '.djp-quiz-profile-name', '.djp-quiz-step']) {
      const el = card.querySelector(sel)
      if (el) kids[sel] = { raw: getComputedStyle(el).color, rgb: toRgb(getComputedStyle(el).color) }
    }
    return {
      tone: section.getAttribute('data-tone'),
      variant: section.className.match(/djp-v-[a-z0-9-]+/)?.[0] ?? '?',
      sectionBg: sectionStyle.backgroundColor,
      sectionBgRgb: toRgb(sectionStyle.backgroundColor),
      sectionColor: sectionStyle.color,
      sectionColorRgb: toRgb(sectionStyle.color),
      sectionPair: sectionStyle.getPropertyValue('--djp-pair-fg').trim(),
      cardBg: cardStyle.backgroundColor,
      cardBgRgb: toRgb(cardStyle.backgroundColor),
      cardColor: cardStyle.color,
      cardColorRgb: toRgb(cardStyle.color),
      cardPair: cardStyle.getPropertyValue('--djp-pair-fg').trim(),
      kids,
    }
  })()`)

  if (!facts) throw new Error(`no .djp-s-quiz on /preview/${SLUG} — wrong page or the render failed`)

  console.log(`/preview/${SLUG}  —  tone="${facts.tone}"  variant=${facts.variant}\n`)
  console.log(`  section  bg ${facts.sectionBg}   color ${facts.sectionColor}`)
  console.log(`           --djp-pair-fg ${facts.sectionPair || "(unset)"}`)
  console.log(`  card     bg ${facts.cardBg}   color ${facts.cardColor}`)
  console.log(`           --djp-pair-fg ${facts.cardPair || "(unset)"}`)

  const isTransparent = facts.cardBgRgb[3] < 0.5
  const ground = isTransparent ? facts.sectionBgRgb : facts.cardBgRgb
  console.log(`\n  the card ${isTransparent ? "IS TRANSPARENT, so the ground is the SECTION band" : "paints its own background"}`)

  // THE ACTUAL QUESTION: is the card's text in the pair of the ground it sits
  // on, or did it inherit the other one?
  const cardVsGround = ratio(facts.cardColorRgb, ground)
  const inheritedSection = facts.cardColor === facts.sectionColor
  console.log(`\n  card text vs its ground: ${cardVsGround.toFixed(2)} ${cardVsGround >= 4.5 ? "ok" : "FAIL"}`)
  console.log(
    `  card text === section text? ${inheritedSection ? "YES" : "no"}` +
      `${inheritedSection && !isTransparent ? "   <-- G21: inherited the WRONG pair" : ""}` +
      `${!inheritedSection && isTransparent ? "   <-- band variant did NOT give the pair back" : ""}`,
  )

  console.log("\n  children (each must read on the card's ground):")
  for (const [sel, info] of Object.entries(facts.kids)) {
    const r = ratio(info.rgb, ground)
    console.log(`    ${sel.padEnd(26)} rgb(${info.rgb.slice(0, 3).join(",")}) ${r.toFixed(2)} ${r >= 4.5 ? "ok" : "FAIL"}`)
  }
  if (Object.keys(facts.kids).length === 0) {
    console.log("    !! NO CHILDREN MATCHED — the quiz may not have rendered its island; check the page")
  }

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
