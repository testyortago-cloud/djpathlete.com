// @vitest-environment jsdom
// Every buy button on every published funnel page rendered as PLAIN LINK TEXT.
//
// A `url` / `anchor` / `step` CTA is an `<a class="djp-btn djp-btn-primary">`
// written by `render.ts`. A `program` / `session_pack` / `event` / `booking`
// CTA is an ISLAND — a React component rendered at request time — and it
// carried no class at all. Two CTAs in the same hero, one a button and one a
// hyperlink, decided by which KIND of row it pointed at.
//
// Nothing could have gone red: the markup was correct, the compiler was happy,
// the island's own tests asserted its href. This is the
// island-class-stylesheet family of defect again, from the other end — there
// the class had no rule, here the rule had no class.

import { describe, expect, it } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { afterEach } from "vitest"
import { CheckoutIsland } from "@/components/funnels/islands/CheckoutIsland"
import { BookingIsland } from "@/components/funnels/islands/BookingIsland"
import { CTA_CLASS, CTA_VARIANTS, ctaClassFor } from "@/lib/funnels/cta-class"
import { SECTION_CSS, THEME_CSS } from "@/lib/funnels/sections/styles"
import { renderSection } from "@/lib/funnels/sections/render"
import type { Section } from "@/lib/funnels/sections/registry"

const ALL_CSS = [THEME_CSS, ...Object.values(SECTION_CSS)].join("\n")

afterEach(cleanup)

describe("the CTA vocabulary is defined once", () => {
  it("styles every variant it offers", () => {
    // MUTANT KILLED: adding a variant with no rule behind it — a CTA that is
    // valid, renders, and is invisible.
    for (const variant of CTA_VARIANTS) {
      for (const cls of CTA_CLASS[variant].split(" ")) {
        expect(ALL_CSS, `${variant} emits .${cls}, which no stylesheet targets`).toContain(`.${cls}`)
      }
    }
  })

  it("gives the island the SAME classes the renderer writes for a plain link", () => {
    // The property that makes this a fix rather than a second implementation:
    // an island button and an `<a>` button are the same button. If these ever
    // diverge, the tone-contrast repaint, the hover, the focus ring and the
    // pricing card's full-width rule apply to one and not the other.
    const section: Section = {
      id: "c1",
      kind: "cta",
      variant: "band",
      style: {},
      props: { headline: "Ready?", cta: { label: "Start", target: { kind: "url", href: "/signup" } } },
    }
    const html = renderSection(section, {})
    expect(html).toContain(`class="${CTA_CLASS.primary}"`)
    expect(ctaClassFor("primary")).toBe(CTA_CLASS.primary)
  })
})

describe("an island CTA wears the treatment its call site chose", () => {
  it("renders a checkout island as a real button", () => {
    render(
      <CheckoutIsland
        props={{ productKind: "program", productId: "11111111-2222-4333-8444-555555555555", label: "Reserve a spot", variant: "primary" }}
      />,
    )
    const link = document.querySelector("a[data-djp-island='checkout']")
    expect(link).toHaveClass("djp-btn", "djp-btn-primary")
  })

  it("leaves a footer booking CTA as a link, not a button", () => {
    // MUTANT KILLED: defaulting every island to `primary`. A footer's
    // "Book a call" sits in a row of text links beside "Sign up" and
    // "Contact" — buttoning it turns that row into a wall of buttons.
    render(<BookingIsland props={{ label: "Book a call", href: "/contact", variant: "link" }} />)
    const link = document.querySelector("a[data-djp-island='booking']")
    expect(link).toHaveClass("djp-footer-link")
    expect(link).not.toHaveClass("djp-btn")
  })

  it("renders exactly as it does today when the page predates the variant", () => {
    // THE BACKWARD-COMPATIBILITY RULE, AND IT IS NOT COSMETIC. A published page
    // is frozen: `funnel_step_versions` stores the compiled HTML *and* the
    // stylesheet, and its `data-djp-props` was written before `variant`
    // existed. A default here would repaint every live page the moment this
    // deploys — including turning that footer link row into buttons — with no
    // author action and nothing to preview it against. Pages take the fix up
    // when they are next published.
    render(<BookingIsland props={{ label: "Book a call", href: "/contact" }} />)
    const link = document.querySelector("a[data-djp-island='booking']")
    expect(link).not.toHaveAttribute("class")
    expect(ctaClassFor(undefined)).toBe("")
    expect(ctaClassFor("nonsense")).toBe("")
  })
})
