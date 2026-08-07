import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The colours live in globals.css, not in the component — so the component's
// rendered HTML can never carry a hex and asserting on it proves nothing.
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8")

/** The `.score-track*` rules so far, stopping before the next feature. */
function scoreTrackRules(): string {
  const start = css.indexOf(".test-report .score-track")
  expect(start, ".score-track rules are not in globals.css").toBeGreaterThan(-1)
  const end = css.indexOf(".test-report .report-band", start)
  return css.slice(start, end === -1 ? undefined : end)
}

describe("ScoreTrack styles", () => {
  it("uses design tokens, never a hex literal", () => {
    expect(scoreTrackRules()).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })

  it("draws every colour from a token defined in BOTH theme scopes", () => {
    // .report-light and .athlete-arena define the same token NAMES — that is the
    // whole reason the theme toggle needs no component changes. A token defined
    // in only one scope renders invisible or mis-coloured after the toggle.
    const used = [...scoreTrackRules().matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1])
    expect(used.length, "no tokens found — did the selector move?").toBeGreaterThan(0)
    const scope = (name: string) => css.slice(css.indexOf(name), css.indexOf("}", css.indexOf(name)))
    const light = scope(".report-light")
    const dark = scope(".athlete-arena")
    for (const token of new Set(used)) {
      expect(light.includes(token) || css.includes(`  ${token}:`), `${token} missing from :root/.report-light`).toBe(true)
      expect(dark.includes(token) || css.includes(`  ${token}:`), `${token} missing from .athlete-arena`).toBe(true)
    }
  })
})
