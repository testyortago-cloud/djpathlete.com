// @vitest-environment jsdom
// __tests__/components/admin/board-switcher.test.tsx
//
// components/admin/pipeline/BoardSwitcher.tsx — the row of pills above the
// Lead Engine board (Task 8, audit §4 #7). The page decides WHICH board is
// active; this component only has to name the others and link to them.
//
// It is deliberately not a tabs library and not a client component: every pill
// is an ordinary link to the same route with a different `?board`, so the
// server component re-reads and re-renders. Nothing here holds state.

import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// Spreads EVERY prop onto the anchor, not just href — `aria-current` and
// `className` are the two things this suite asserts, and the usual
// `({ href, children })` stub in this repo silently drops both, which would
// make the active-pill assertions unfalsifiable.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { BoardSwitcher } from "@/components/admin/pipeline/BoardSwitcher"

const BOARDS = [
  { key: "coaching", name: "Coaching" },
  { key: "camps_clinics", name: "Camps & Clinics" },
  { key: "assessment", name: "Assessment" },
]

describe("<BoardSwitcher>", () => {
  it("renders one link per board, labelled with the configured name", () => {
    // MUTANT: label the pill with `board.key` — the coach reads
    // "camps_clinics" instead of the name they chose, and a renamed board
    // never shows its new name. The fixture's names and keys deliberately
    // differ (`camps_clinics` vs "Camps & Clinics") so key-derivation cannot
    // coincidentally match.
    render(<BoardSwitcher boards={BOARDS} activeKey="coaching" />)

    const links = screen.getAllByRole("link")
    expect(links.map((a) => a.textContent)).toEqual(["Coaching", "Camps & Clinics", "Assessment"])
  })

  it("links each pill to this page with that board's key", () => {
    // MUTANT: build the href from the board's NAME, or from a hardcoded
    // "coaching" — the pill navigates somewhere that resolves to the default
    // board, so clicking Assessment shows Coaching.
    render(<BoardSwitcher boards={BOARDS} activeKey="coaching" />)

    expect(screen.getByRole("link", { name: "Camps & Clinics" })).toHaveAttribute(
      "href",
      "/admin/pipeline?board=camps_clinics",
    )
    expect(screen.getByRole("link", { name: "Assessment" })).toHaveAttribute("href", "/admin/pipeline?board=assessment")
  })

  it("marks the active board, and only the active board, with aria-current", () => {
    // MUTANT: drop the comparison and mark every pill current (or none of
    // them). The second expectation is the presence control for the first:
    // "no other pill is current" is equally true when nothing rendered.
    render(<BoardSwitcher boards={BOARDS} activeKey="assessment" />)

    expect(screen.getByRole("link", { name: "Assessment" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Coaching" })).not.toHaveAttribute("aria-current")
    expect(screen.getByRole("link", { name: "Camps & Clinics" })).not.toHaveAttribute("aria-current")
  })

  it("styles the active pill differently from the inactive ones", () => {
    // MUTANT: give every pill the same class — `aria-current` still passes
    // the test above while the screen shows no visible selection at all.
    render(<BoardSwitcher boards={BOARDS} activeKey="assessment" />)

    const active = screen.getByRole("link", { name: "Assessment" })
    const inactive = screen.getByRole("link", { name: "Coaching" })
    expect(active.className).not.toEqual(inactive.className)
    expect(active.className).toContain("bg-primary")
  })
})
