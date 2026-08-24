// __tests__/lib/funnels/sections/leadgen.test.ts
//
// The page-quality work: a styled form, the split capture layout, the proof
// strip, and the composition rules that stop the model shipping a structurally
// valid page that cannot convert.
//
// THE FIRST SUITE IS THE IMPORTANT ONE. The defect it pins is not a typo, it is
// a CLASS of bug this subsystem has now produced three times: a component
// renders markup into a styled section using class names the stylesheet has
// never heard of, so it silently falls back to browser defaults on a live page.
// It happened to the form, to the live testimonial island and to the live FAQ
// island simultaneously, and nothing anywhere went red — every existing test
// asserted the markup was CORRECT, and it was. It just had no styling.

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { SECTION_CSS, THEME_CSS } from "@/lib/funnels/sections/styles"
import { CANVAS_EDIT_CSS } from "@/lib/funnels/sections/edit-css"
import { renderSection } from "@/lib/funnels/sections/render"
import { SECTION_BUILDER_BLOCK_A, LEADGEN_RULES } from "@/lib/funnels/sections/prompt"
import { SECTION_KINDS, SECTION_REGISTRY, type Section } from "@/lib/funnels/sections/registry"

const ALL_CSS = [THEME_CSS, ...Object.values(SECTION_CSS)].join("\n")

/** Every island that renders inside a compiled funnel page. */
const ISLAND_FILES = ["FunnelForm.tsx", "TestimonialsIsland.tsx", "FaqIsland.tsx"]

function islandSource(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), "components", "funnels", "islands", file), "utf8")
}

/** The `djp-*` classes a component's JSX actually emits. */
function emittedClasses(source: string): string[] {
  const out = new Set<string>()
  for (const match of source.matchAll(/className="([^"]+)"/g)) {
    for (const cls of match[1].split(/\s+/)) {
      if (cls.startsWith("djp-")) out.add(cls)
    }
  }
  return [...out]
}

describe("every class an island emits is a class the stylesheet defines", () => {
  it.each(ISLAND_FILES)("%s", (file) => {
    // MUTANT: renaming a class in the island, or adding a new element with a
    // new class and forgetting the CSS. Both render perfectly valid markup that
    // is completely unstyled — which is precisely how a live campaign page
    // shipped with browser-default form controls, a crammed testimonial band
    // and a raw UA disclosure triangle, with a green suite.
    const classes = emittedClasses(islandSource(file))
    expect(classes.length, `${file} emits no djp- classes at all`).toBeGreaterThan(0)

    // TWO stylesheets, because an island now emits into two worlds. The
    // published page gets THEME_CSS + SECTION_CSS; the builder canvas
    // additionally gets CANVAS_EDIT_CSS, which the editable preview route
    // injects and no visitor ever receives. A class defined only there is
    // correct AS LONG AS it is only emitted while editing — asserted for real,
    // by rendering, in funnel-form-editable.test.tsx, because a source scan
    // cannot tell a gated class from an ungated one.
    const undefined_ = classes.filter(
      (cls) => !ALL_CSS.includes(`.${cls}`) && !CANVAS_EDIT_CSS.includes(`.${cls}`),
    )
    expect(undefined_, `${file} emits classes neither stylesheet targets`).toEqual([])
  })
})

describe("the form is actually styled", () => {
  const css = SECTION_CSS.form

  it("styles the label, the control and the submit button, not just the section box", () => {
    // MUTANT: reverting FORM_CSS to its original four rules (max-width, boxed
    // background, band, align). Every one of those would still pass a test that
    // only checked the section renders — this checks the CONTROLS are reached.
    expect(css).toContain(".djp-field-label")
    expect(css).toContain(".djp-control")
    expect(css).toContain(".djp-form-submit")
    expect(css).toContain(".djp-consent")
    expect(css).toContain(".djp-form-error")
    expect(css).toContain(".djp-form-success")
  })

  it("gives controls a focus ring", () => {
    // MUTANT: dropping :focus-visible. `appearance: none` plus a custom border
    // removes the UA focus ring on several engines, so styling the control
    // WITHOUT restoring a focus indicator is worse for a keyboard user than
    // leaving it unstyled.
    expect(css).toMatch(/\.djp-control:focus-visible\s*\{/)
  })

  it("lays a checkbox out from the field type, never from :has()", () => {
    // MUTANT: `.djp-field:has(input[type="checkbox"])`. It works where :has()
    // is supported and silently renders a full-width checkbox where it is not,
    // which is the kind of degradation nobody notices until a screenshot.
    //
    // Comments are stripped first: this file explains in prose WHY it does not
    // use `:has()`, and an assertion that cannot tell a rule from a comment
    // about that rule fails on the explanation.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "")
    expect(rules).toContain('[data-djp-field-type="checkbox"]')
    expect(rules).not.toContain(":has(")
  })

  it("leaves the checkbox its native widget, so a tick is actually drawn", () => {
    // THE REGRESSION, and the reason this is asserted on the RULE rather than on
    // a rendering: `.djp-control` sets `appearance: none`, which on a checkbox
    // removes the tick along with the box. Measured in Chromium against this
    // stylesheet before the fix — clicking set `checked` to true and the two
    // screenshots of the control were byte-identical, so the visitor had no way
    // to tell a checked box from an unchecked one. On the live register page that
    // made a REQUIRED consent box unpassable: no feedback, click the label as
    // well, toggle it back off, submit fails "... is required".
    //
    // MUTANT: deleting `appearance: auto` from the checkbox rule. Every other
    // assertion in this file still passes — the layout, the focus ring and the
    // class coverage are all unaffected by whether the tick is visible.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "")
    const checkboxRule = rules.match(
      /\.djp-field\[data-djp-field-type="checkbox"\]\s+\.djp-control\s*\{([^}]*)\}/,
    )?.[1]
    expect(checkboxRule, "the checkbox control rule is gone").toBeDefined()
    // Anchored so `-webkit-appearance` cannot satisfy it. It did on the first
    // run of this test: deleting the standard property left the prefixed one and
    // the assertion still passed, which in Chromium is a checkbox that paints
    // nothing again.
    expect(checkboxRule).toMatch(/(^|[\s;{])appearance:\s*auto/)
    // `.djp-control` pads every control under box-sizing:border-box, which ate
    // the whole 1.15rem square and left a 29x22 pill with no content area.
    expect(checkboxRule).toMatch(/padding:\s*0/)
  })

  it("does not restate the button's colours", () => {
    // MUTANT: giving .djp-form-submit its own `background: var(--accent)`. It
    // would look right on a light page and become invisible on an accent
    // section, because it would no longer inherit the tone pass's repaint of
    // .djp-btn-primary. The submit button must stay a .djp-btn.
    expect(islandSource("FunnelForm.tsx")).toContain("djp-btn djp-btn-primary")
    const submitRules = css.split("\n").filter((line) => line.includes(".djp-form-submit"))
    expect(submitRules.join("\n")).not.toContain("background:")
  })
})

function section(kind: string, variant: string, props: Record<string, unknown>): Section {
  return { id: "s1", kind, variant, style: {}, props } as Section
}

describe("proof — the credential strip", () => {
  it("renders value/label pairs and no image, ever", () => {
    // MUTANT: adding a logo/image field. `heroMediaSchema.src` has no URL-shape
    // constraint, a fabricated src is dropped by the sanitiser with NO warning,
    // and the page ships a broken image. Text-only is the whole design.
    const html = renderSection(
      section("proof", "stats", {
        items: [
          { value: "12 years", label: "coaching" },
          { value: "500+", label: "athletes trained" },
        ],
      }),
    )
    expect(html).toContain("12 years")
    expect(html).toContain("athletes trained")
    expect(html).not.toContain("<img")

    // An image url has nowhere to live in the shape: the schema strips it and
    // the renderer never sees it, so there is no path from a hallucinated src
    // to a broken <img>.
    const withSrc = SECTION_REGISTRY.proof.propsSchema.safeParse({
      items: [
        { value: "x", label: "y", src: "/logo.png" },
        { value: "a", label: "b" },
      ],
    })
    expect(withSrc.success).toBe(true)
    expect(JSON.stringify(withSrc.success && withSrc.data)).not.toContain("logo.png")
  })
})

describe("form/split — capture above the fold", () => {
  const props = {
    formKey: "waitlist",
    heading: "Join the waitlist",
    sub: "Doors open soon.",
    proofPoints: ["No payment now", "Coached in person"],
    fields: [{ name: "email", label: "Email", type: "email" }],
  }

  it("renders the pitch, the proof points and the form in a card", () => {
    const html = renderSection(section("form", "split", props))
    expect(html).toContain("djp-form-split")
    expect(html).toContain("djp-form-pitch")
    expect(html).toContain("djp-form-card")
    expect(html).toContain("No payment now")
    expect(html).toContain("Join the waitlist")
  })

  it("renders proofPoints ONLY in split", () => {
    // MUTANT: rendering them in every variant. On `boxed` and `band` there is
    // no column beside the form for them to sit in, so they would stack above
    // the fields and push the first input further down the page — the exact
    // problem this variant exists to solve, reintroduced one layout over.
    for (const variant of ["boxed", "band"]) {
      expect(renderSection(section("form", variant, props))).not.toContain("No payment now")
    }
  })

  it("is a declared variant of the form kind", () => {
    expect(SECTION_REGISTRY.form.variants).toContain("split")
  })
})

describe("the prompt teaches page craft, not just the schema", () => {
  it("carries every lead-gen rule", () => {
    // MUTANT: exporting the rules and never interpolating them into Block A —
    // the rules would be unit-tested, shipped, and never seen by the model.
    for (const rule of LEADGEN_RULES) {
      expect(SECTION_BUILDER_BLOCK_A).toContain(rule)
    }
  })

  it("tells the model not to put the site FAQ on a campaign page", () => {
    // MUTANT: dropping this rule. It is the one that produced a waitlist page
    // for a strength class whose FAQ opened with "What is DJP Athlete and what
    // services do you offer?" — pulled live from the site-wide table.
    expect(SECTION_BUILDER_BLOCK_A).toMatch(/NEVER USE `faq` WITH `source: "live"` ON A CAMPAIGN PAGE/)
  })

  it("advertises proof and the split form to the model", () => {
    // MUTANT: adding a kind or a variant to the registry and it never reaching
    // Block A. The generated blocks are derived, so this is really a check that
    // the derivation still covers everything.
    expect(SECTION_BUILDER_BLOCK_A).toContain("proof")
    expect(SECTION_BUILDER_BLOCK_A).toContain("split")
  })

  it("states the section count from the registry rather than a stale number", () => {
    // MUTANT: the hardcoded "nine" that was there before `proof` was added. A
    // prompt that announces nine kinds and then lists ten contradicts itself
    // inside a frozen, cached prefix — and the count was hand-typed in three
    // places, so it could disagree with the registry in three ways.
    //
    // Scoped to the two places the count was actually written. A blanket
    // `not.toContain("nine")` also matches "six to nine sections", which is
    // page-craft copy about page LENGTH and has nothing to do with the
    // registry — an assertion that broad fails on prose it was never about.
    //
    // DERIVED, not hand-typed. This assertion previously pinned the literal
    // "10" — which made the test itself the stale hardcoded number it exists
    // to prevent, and it went red the moment `quiz` became the 11th kind.
    // Deriving keeps the real property: a count HARDCODED IN THE PROMPT still
    // fails here, which is the only thing this was ever guarding.
    const n = SECTION_KINDS.length
    expect(SECTION_BUILDER_BLOCK_A).toContain(`## The ${n} section kinds`)
    expect(SECTION_BUILDER_BLOCK_A).toContain(`kind: one of the ${n} below`)
    expect(SECTION_BUILDER_BLOCK_A).not.toContain("nine section kinds")
    expect(SECTION_BUILDER_BLOCK_A).not.toContain("one of the nine")
  })
})
