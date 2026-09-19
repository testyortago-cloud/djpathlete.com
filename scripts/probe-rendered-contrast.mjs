// Reads the COMPUTED colours off a real rendered funnel page and measures them.
//
//   node --env-file=.env.local scripts/probe-rendered-contrast.mjs --port=3061 --slug=sales-k9m0w
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS ALONGSIDE scripts/measure-funnel-contrast.ts
// ---------------------------------------------------------------------------
// That script measures the DERIVATION — what `palettes.ts` computes. This one
// measures the PAGE — what a browser actually paints after the cascade has had
// its say. They can disagree, and every way they can disagree is a real bug
// this repo could otherwise ship green:
//
//   - the override never reaches the element (a specificity loss to
//     `app/globals.css`'s bare `:root`, or a rule that out-orders it)
//   - the element's real background is not the one the model assumed (a panel
//     nested in another panel, a wash composited twice)
//   - a class is not in the tone override list anybody believed it was in
//
// A derivation that is right about a ground nothing renders on is worth
// nothing, and a table cannot tell you which ground an element is really on.
// `getComputedStyle` can, so this asks the browser instead of reasoning.
//
// It walks UP from each text node to find the first ancestor with a
// non-transparent background, which is what the eye actually sees behind it —
// rather than assuming the parent.
//
// READ-ONLY. It navigates and reads; it clicks nothing and saves nothing.

import { chromium } from "playwright"

const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const PORT = argOf("port", "3061")
const SLUG = argOf("slug", "sales-k9m0w")
const APP = `http://localhost:${PORT}`

// Every class this pass touches, plus controls that should NOT have moved.
const TARGETS = [
  ".djp-plan-blurb",
  ".djp-footnote",
  ".djp-plan-features li",
  ".djp-plan-price",
  ".djp-sub",
  ".djp-bullet-text",
  ".djp-faq-a",
  ".djp-footer-line",
  ".djp-plan",
  ".djp-plan .djp-btn-primary",
]

function luminance([r, g, b]) {
  const lin = (c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function ratio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const parseRgb = (s) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number)

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, colorScheme: "light" })
  const page = await ctx.newPage()

  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "networkidle" })
  if (!page.url().includes("/admin")) throw new Error(`dev login failed — at ${page.url()}`)

  await page.goto(`${APP}/preview/${SLUG}`, { waitUntil: "networkidle" })
  const rootTokens = await page.evaluate(
    "(() => { const r = document.getElementById('djp-funnel-root'); if (!r) return null; const s = getComputedStyle(r); return { muted: s.getPropertyValue('--muted-foreground').trim(), fg: s.getPropertyValue('--foreground').trim(), bg: s.getPropertyValue('--background').trim(), surface: s.getPropertyValue('--surface').trim(), accent: s.getPropertyValue('--accent').trim(), pairFg: s.getPropertyValue('--djp-pair-fg').trim() }; })()",
  )
  if (!rootTokens) throw new Error("no #djp-funnel-root on the page — wrong route or the render failed")

  console.log(`tokens on #djp-funnel-root for /preview/${SLUG}:`)
  for (const [k, v] of Object.entries(rootTokens)) console.log(`  ${k.padEnd(8)} ${v || "(unset)"}`)

  // NO NAMED FUNCTION inside this evaluated source: bundlers rewrite one into a
  // __name() helper that does not exist in the browser and the evaluate throws.
  const rows = await page.evaluate(`(() => {
    const out = []
    for (const sel of ${JSON.stringify(TARGETS)}) {
      const el = document.querySelector(sel)
      if (!el) { out.push({ sel, missing: true }); continue }
      const cs = getComputedStyle(el)
      // Walk up for the first ancestor that actually paints something.
      //
      // TEXT starts the walk at its OWN element (its background is what is
      // behind the glyphs). A SHAPE must start at its PARENT: the thing a
      // card's border or a button's ring has to be distinguishable FROM is what
      // the shape sits on, never the shape's own fill. Measuring a border
      // against the box it encloses answers a question nobody asked, and the
      // first cut of this probe did exactly that — it reported the plan card's
      // edge as 1.00 and the button's ring as 17.48, both meaningless.
      const isShape = sel.indexOf('btn') !== -1 || sel === '.djp-plan'
      let node = isShape ? el.parentElement : el
      let bg = 'rgba(0, 0, 0, 0)'
      while (node) {
        const c = getComputedStyle(node).backgroundColor
        // ALPHA COMES IN TWO SYNTAXES AND ONLY ONE IS A FOURTH NUMBER.
        // rgba(r, g, b, a) puts it last; the modern forms Chrome returns for a
        // color-mix — oklch(0 0 none / 0.12) — put it after a slash, with a
        // COUNT of three numbers. Reading "4 numbers means translucent" calls a
        // 12% wash opaque, which made this probe report a plan card's own
        // near-invisible wash as the ground behind its text and print 1.00 FAIL
        // for black text that is in fact perfectly readable on the tan beneath.
        const slash = c.indexOf('/')
        const alpha = slash !== -1
          ? parseFloat(c.slice(slash + 1))
          : ((c.match(/[\\d.]+/g) || []).length === 4 ? Number((c.match(/[\\d.]+/g) || [])[3]) : 1)
        if (alpha > 0.5) { bg = c; break }
        node = node.parentElement
      }
      out.push({
        sel,
        color: cs.color,
        background: cs.backgroundColor,
        painted: bg,
        paintedBy: node ? (node.className || node.tagName) : 'none',
        opacity: cs.opacity,
        boxShadow: cs.boxShadow,
        borderColor: cs.borderTopColor,
      })
    }
    return out
  })()`)

  console.log(`\n${"selector".padEnd(26)} ${"colour".padEnd(20)} ${"behind it".padEnd(20)} ratio`)
  for (const r of rows) {
    if (r.missing) {
      console.log(`${r.sel.padEnd(26)} -- NOT ON THIS PAGE --`)
      continue
    }
    const fg = parseRgb(r.color)
    const bg = parseRgb(r.painted)
    const value = ratio(fg, bg)
    const isShape = r.sel.includes("btn") || r.sel === ".djp-plan"
    if (!isShape) {
      console.log(
        `${r.sel.padEnd(26)} ${r.color.padEnd(20)} ${r.painted.padEnd(20)} ` +
          `${value.toFixed(2)} ${value >= 4.5 ? "ok" : "FAIL"}   [on ${String(r.paintedBy).slice(0, 28)}]`,
      )
      continue
    }
    // A shape has THREE numbers worth knowing, and reporting only one hides the
    // thing this pass changed:
    //   fill/behind  — does the shape read on its own? (it usually does not,
    //                  which is the defect)
    //   edge/behind  — is its BOUNDARY findable? (what the ring/border buys)
    //   ring         — the box-shadow specifically, which a `border-color`
    //                  override elsewhere cannot take away
    const fill = parseRgb(r.background)
    const border = parseRgb(r.borderColor)
    const ring = parseRgb(r.boxShadow)
    const fmt = (v) => (v === null ? "  --  " : `${v.toFixed(2)} ${v >= 3 ? "ok  " : "FAIL"}`)
    const of = (c) => (c && c.length === 3 ? ratio(c, bg) : null)
    console.log(
      `${r.sel.padEnd(26)} fill ${fmt(of(fill))}  border ${fmt(of(border))}  ring ${fmt(of(ring))}` +
        `   [behind: ${r.painted.slice(0, 22)} via ${String(r.paintedBy).slice(0, 24)}]`,
    )
  }

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
