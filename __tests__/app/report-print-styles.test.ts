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

/** CSS with `/* … *​/` comments removed — a `not.toMatch` on a selector must not be
    satisfied (or defeated) by prose in a comment that discusses that selector. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "")
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

  it("green bands in the LIGHT scope do NOT rely on a printed background", () => {
    // Chrome's Save-as-PDF defaults to Background graphics OFF. .report-light's
    // --primary is dark and its --primary-foreground near-white, so a dropped fill
    // leaves white-on-white and the athlete's name vanishes.
    const printBlock = printBlockContaining(".report-band-green")
    expect(printBlock).toMatch(/\.report-light\s+\.report-band-green\s*{[^}]*background:\s*transparent/)
  })

  it("does NOT force the band transparent in the dark scope — that prints the name invisible", () => {
    // The scoping is the fix, not an accident. In .athlete-arena --primary is LIGHT
    // (oklch 0.87) and --primary-foreground DARK (oklch 0.16), so BOTH print paths
    // already work: 13.24:1 on the painted band, 19.35:1 on bare paper. Forcing the
    // band transparent there puts --primary-foreground ink on a --background page,
    // and those two tokens are byte-identical — 1.00:1, measured, not estimated.
    // A scope-blind `.test-report` selector reintroduces exactly that.
    const printBlock = stripComments(printBlockContaining(".report-band-green"))
    expect(printBlock, "the dark scope needs no band print override at all").not.toMatch(/\.athlete-arena/)
    expect(printBlock, "a .test-report selector fires in BOTH scopes").not.toMatch(
      /\.test-report\s+\.report-band-green/,
    )
  })

  it("picks print ink per theme scope, never scope-blind", () => {
    // .report-light and .athlete-arena define the SAME token names with OPPOSITE
    // polarity. A single `color: var(--foreground)` is dark ink in one scope and
    // near-white in the other — and near-white on unpainted paper is invisible.
    const print = printBlockContaining(".report-band-green")
    // Light scope overrides to --foreground (dark ink there) because its band goes unpainted.
    expect(print).toMatch(/\.report-light\s+\.report-band-green\s*{[^}]*color:\s*var\(--foreground\)/)
    expect(print).toMatch(/\.report-light\s+\.report-band-green\s+\.djp-eyebrow[^}]*{[^}]*color:\s*var\(--muted-foreground\)/)
    // The dark scope takes no print override, so its ink has to be right on SCREEN
    // too: --primary-foreground is dark in .athlete-arena and light in .report-light,
    // which is correct on the green band in either scope, painted or not.
    expect(css).toMatch(/\.test-report\s+\.report-band-green\s+\.djp-eyebrow\s*{[^}]*color:\s*var\(--primary-foreground\)/)
  })

  it("re-scopes the eyebrow inside the report, because .djp-eyebrow is UNLAYERED", () => {
    // Tailwind v4 emits utilities into @layer utilities, and an unlayered
    // declaration beats every layer regardless of specificity — so
    // `.djp-eyebrow { color: var(--accent) }` silently voids `text-muted-foreground`
    // on all five report eyebrows, and measures 1.67:1 on .athlete-arena's green band.
    // Fixed with report-scoped rules, NOT by editing the app-wide class.
    expect(css).toMatch(/\.test-report\s+\.djp-eyebrow\.text-muted-foreground\s*{[^}]*color:\s*var\(--muted-foreground\)/)
    expect(screenBlock(".djp-eyebrow"), ".djp-eyebrow itself is app-wide and out of scope").toMatch(
      /color:\s*var\(--accent\)/,
    )
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

  it("also fixes --success in the LIGHT scope, which the dark-scope pass skipped", () => {
    // :root's --success oklch(0.55 0.16 145) measures 4.41:1 on .report-light's
    // --background — under AA for TestRow's 12px delta text, on the scope the
    // report actually defaults to. --error is left alone: it already reads 5.28:1
    // here. Computed OKLCH -> linear sRGB -> WCAG luminance; the chosen value is
    // 5.00:1 on --background, 5.15:1 on --card.
    const light = css.slice(css.indexOf(".report-light {"), css.indexOf("}", css.indexOf(".report-light {")))
    expect(light, "--success not redefined for the light scope").toMatch(/^\s*--success\s*:/m)
    expect(light, "--success must be DARKER than :root's 0.55 to gain contrast on a light ground").toMatch(
      /--success:\s*oklch\(0\.5[0-4]\s/,
    )
  })

  it("gives the band pill a border in print, because its tinted background vanishes", () => {
    const print = printBlockContaining(".band-pill")
    expect(print).toMatch(/\.band-pill\s*{[^}]*border:\s*1px solid currentColor/)
  })
})
