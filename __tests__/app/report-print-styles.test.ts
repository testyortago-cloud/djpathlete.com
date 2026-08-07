import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// A stylesheet guarantee has no runtime surface a component test can reach, so it
// needs an explicit assertion or nothing catches its removal.
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8")

/** Every `@media print { … }` block in the file, brace-matched.
    Assumes no literal `@media print` string appears inside a comment. */
function printBlocks(): string[] {
  const out: string[] = []
  let i = css.indexOf("@media print")
  while (i !== -1) {
    let depth = 0
    let j = css.indexOf("{", i)
    const start = j
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++
      else if (css[j] === "}" && --depth === 0) break
    }
    out.push(css.slice(start, j))
    i = css.indexOf("@media print", j)
  }
  return out
}

/** The print block that actually styles `selector` — not merely the last one. */
function printBlockContaining(selector: string): string {
  const hit = printBlocks().filter((b) => b.includes(selector))
  expect(hit.length, `expected exactly one @media print block styling ${selector}`).toBe(1)
  return hit[0]
}

/** A screen-mode rule block — located by first occurrence, used for screen-only checks. */
function screenBlock(selector: string): string {
  const i = css.indexOf(selector)
  expect(i, `${selector} is not in globals.css`).toBeGreaterThan(-1)
  const braceStart = css.indexOf("{", i)
  return css.slice(i, css.indexOf("}", braceStart))
}

describe("report banding", () => {
  it("defines the three bands from tokens, never a hex literal", () => {
    for (const sel of [".report-band-green", ".report-band-alt"]) {
      expect(screenBlock(sel)).not.toMatch(/#[0-9a-fA-F]{3,6}/)
    }
    // Only .report-band-green has print rules; check for hex there too.
    expect(printBlockContaining(".report-band-green")).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })

  it("green bands do NOT rely on a printed background for legibility", () => {
    // Chrome's Save-as-PDF defaults to Background graphics OFF. If the green fill
    // is dropped, light-on-green text becomes white-on-white and vanishes.
    const printBlock = printBlockContaining(".report-band-green")
    expect(printBlock).toMatch(/background:\s*transparent/)
  })

  it("picks print ink per theme scope, never scope-blind", () => {
    // .report-light and .athlete-arena define the SAME token names with OPPOSITE
    // polarity. A single `color: var(--foreground)` is dark ink in one scope and
    // near-white in the other — and near-white on unpainted paper is invisible.
    const print = printBlockContaining(".report-band-green")
    // Light scope must use --foreground (dark ink in light scope)
    expect(print).toMatch(/\.report-light\s+\.report-band-green\s*{[^}]*color:\s*var\(--foreground\)/)
    // Dark scope must use --primary-foreground (dark ink in dark scope)
    expect(print).toMatch(/\.athlete-arena\s+\.report-band-green\s*{[^}]*color:\s*var\(--primary-foreground\)/)
    // Same for eyebrows/quiet text — light scope gets muted-foreground, dark scope gets dark ink
    expect(print).toMatch(/\.report-light\s+\.report-band-green\s+\.djp-eyebrow[^}]*{[^}]*color:\s*var\(--muted-foreground\)/)
    expect(print).toMatch(/\.athlete-arena\s+\.report-band-green\s+\.djp-eyebrow[^}]*{[^}]*color:\s*var\(--primary-foreground\)/)
  })

  it("un-suppresses ::details-content so a collapsed disclosure still prints", () => {
    // Overriding `display` on the child does NOT reveal a closed <details> in
    // Chromium — it suppresses the internal ::details-content box instead. This
    // was verified in a real browser; JSDOM cannot reproduce it, so assert on
    // the stylesheet.
    const print = printBlockContaining(".report-earlier")
    expect(print).toContain("::details-content")
    expect(print).toMatch(/content-visibility:\s*visible/)
  })

  it("defines status colours in the dark scope, not just :root", () => {
    // :root values are tuned for a near-white card. Inherited unchanged into
    // .athlete-arena they land near 3.5-4.3:1 on the dark ground — under AA for
    // the 12px delta text in TestRow.
    const arena = css.slice(css.indexOf(".athlete-arena"), css.indexOf("}", css.indexOf(".athlete-arena")))
    expect(arena, "--success not redefined for the dark scope").toContain("--success:")
    expect(arena, "--error not redefined for the dark scope").toContain("--error:")
  })
})
