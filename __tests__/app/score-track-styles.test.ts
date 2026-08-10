import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The colours live in globals.css, not in the component — so the component's
// rendered HTML can never carry a hex and asserting on it proves nothing.
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8")

/** The screen-mode `.score-track*` rules, stopping before the next feature. */
function scoreTrackRules(): string {
  const start = css.indexOf(".test-report .score-track")
  expect(start, ".score-track rules are not in globals.css").toBeGreaterThan(-1)
  const end = css.indexOf(".test-report .report-band", start)
  return css.slice(start, end === -1 ? undefined : end)
}

/**
 * EVERY declaration block whose selector mentions `score-track`, screen and print.
 *
 * The screen slice above stops at the first `.report-band` rule, so it cannot see
 * the print rebuild — and the print rebuild is where the tokens that have to exist
 * in both scopes now actually live.
 */
function allScoreTrackBlocks(): string[] {
  return [...css.matchAll(/([^{}]*score-track[^{}]*)\{([^}]*)\}/g)].map((m) => m[0])
}

/** The body of a theme-scope block, e.g. `.report-light { … }`. */
function scopeBlock(name: string): string {
  const i = css.indexOf(`${name} {`)
  expect(i, `${name} is not declared in globals.css`).toBeGreaterThan(-1)
  return css.slice(i, css.indexOf("}", i))
}

/** The one `@media print` block that styles `selector`, brace-matched. */
function printBlockContaining(selector: string): string {
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
  const hit = out.filter((b) => b.includes(selector))
  expect(hit.length, `expected exactly one @media print block styling ${selector}`).toBe(1)
  return hit[0]
}

describe("ScoreTrack styles", () => {
  it("uses design tokens, never a hex literal", () => {
    expect(scoreTrackRules()).not.toMatch(/#[0-9a-fA-F]{3,6}/)
    for (const block of allScoreTrackBlocks()) expect(block).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })

  it("draws every colour from a token DECLARED in both theme scopes", () => {
    // .report-light and .athlete-arena declare the same token NAMES — that is the
    // whole reason the theme toggle needs no component changes. A token declared
    // in only one scope renders invisible or mis-coloured after the toggle.
    //
    // NOTE ON THE ASSERTION SHAPE. The previous version read
    //   expect(light.includes(token) || css.includes(`  ${token}:`)).toBe(true)
    // and could not fail: every token is ALSO declared in `:root` with two-space
    // indentation, so the right-hand arm was unconditionally true and satisfied
    // BOTH assertions no matter what the scope blocks contained. The left arm was
    // a bare substring test, so `--primary` was satisfied by `--primary-foreground`.
    // This version matches a DECLARATION (`^\s*--token\s*:`) inside the scope slice
    // only, with no `:root` escape hatch. Proven by planting a failure: deleting
    // `--accent` from both scope blocks makes it fail, as recorded in the fix report.
    const used = [...allScoreTrackBlocks().join("\n").matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1])
    expect(used.length, "no tokens found — did the selector move?").toBeGreaterThan(0)
    const light = scopeBlock(".report-light")
    const dark = scopeBlock(".athlete-arena")
    for (const token of new Set(used)) {
      const declared = new RegExp("^\\s*" + token + "\\s*:", "m")
      expect(declared.test(light), `${token} is not DECLARED in .report-light`).toBe(true)
      expect(declared.test(dark), `${token} is not DECLARED in .athlete-arena`).toBe(true)
    }
  })

  it("rebuilds the bar from BORDERS for print, because Chrome drops backgrounds", () => {
    // Every part of the track is painted with `background`, and Chrome's
    // Save-as-PDF has Background graphics OFF by default — the same reason the
    // green bands print as rules. Without a border rebuild page 2 prints stray
    // outlined circles and no bar at all, under a caption that says "the bar is
    // the same scale as page 1". Verified in Chromium under emulated print media.
    const print = printBlockContaining(".score-track")
    expect(print).toMatch(/\.score-track\s*{[^}]*border-bottom:\s*8px solid var\(--border\)/)
    expect(print).toMatch(/\.score-track-zone-low\s*{[^}]*border-bottom:\s*8px solid color-mix\(in oklab, var\(--error\)/)
    expect(print).toMatch(/\.score-track-zone-high\s*{[^}]*border-bottom:\s*8px solid color-mix\(in oklab, var\(--success\)/)
    expect(print).toMatch(/\.score-track-tick\s*{[^}]*border-left:\s*1px solid/)
    expect(print).toMatch(/\[data-tone="accent"\]\s+\.score-track-dot\s*{[^}]*border-color:\s*var\(--accent\)/)
  })

  it("has fully removed the fill bar — a stale rule would repaint it in one medium only", () => {
    expect(css).not.toMatch(/score-track-fill/)
  })

  it("keeps the dot centred in print, against the global transform reset", () => {
    // `.print-document * { transform: none !important }` kills the dot's
    // translate(-50%,-50%), so its top-left corner lands where its centre belongs
    // — 5.5px off on an 8px track, on all 13 tracks in the report. The override
    // must be at least (0,2,0) to beat that rule's (0,1,0) !important.
    const print = printBlockContaining(".score-track")
    expect(print).toMatch(
      /\.test-report\s+\.score-track-dot\s*{[^}]*transform:\s*translate\(-50%,\s*-50%\)\s*!important/,
    )
  })
})
