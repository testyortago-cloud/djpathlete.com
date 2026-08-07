import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// A stylesheet guarantee has no runtime surface a component test can reach, so it
// needs an explicit assertion or nothing catches its removal.
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8")

function block(selector: string): string {
  const i = css.indexOf(selector)
  expect(i, `${selector} is not in globals.css`).toBeGreaterThan(-1)
  return css.slice(i, css.indexOf("}", i))
}

describe("report banding", () => {
  it("defines the three bands from tokens, never a hex literal", () => {
    for (const sel of [".report-band-green", ".report-band-alt"]) {
      expect(block(sel)).not.toMatch(/#[0-9a-fA-F]{3,6}/)
    }
  })

  it("green bands do NOT rely on a printed background for legibility", () => {
    // Chrome's Save-as-PDF defaults to Background graphics OFF. If the green fill
    // is dropped, light-on-green text becomes white-on-white and vanishes.
    const printIdx = css.lastIndexOf("@media print")
    const printSection = css.slice(css.indexOf(".report-band-green", printIdx))
    expect(printSection).toContain("--foreground")
    expect(printSection).toMatch(/background:\s*transparent/)
  })
})
