// @vitest-environment jsdom
// A card that shows only a name and a URL cannot tell two similar pages apart.
// The goal and the description are the two things that do.

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PreviewCard } from "@/components/admin/funnels/PreviewCard"

const base = {
  title: "Free Trial Week",
  previewUrl: null,
  href: "/admin/funnels/f1/edit/s1",
  badgeLabel: "live",
  badgeTone: "success" as const,
}

describe("<PreviewCard> goal and description", () => {
  it("shows the goal label when one is given", () => {
    // MUTANT KILLED: accepting goalLabel and never rendering it.
    render(<PreviewCard {...base} goalLabel="Capture leads" />)
    expect(screen.getByText("Capture leads")).toBeInTheDocument()
  })

  it("shows the description when one is given", () => {
    render(<PreviewCard {...base} description="For HS athletes." />)
    expect(screen.getByText("For HS athletes.")).toBeInTheDocument()
  })

  it("renders neither when both are absent", () => {
    // MUTANT KILLED: rendering an empty badge or a blank line for the funnels
    // screen, where goals do not apply.
    const { container } = render(<PreviewCard {...base} />)
    expect(screen.queryByText("Capture leads")).not.toBeInTheDocument()
    expect(container.querySelector("[data-testid='card-description']")).toBeNull()
  })

  it("still shows the live/draft badge alongside a goal", () => {
    // MUTANT KILLED: replacing the status badge with the goal badge rather than
    // showing both — the owner would lose the only signal that says whether the
    // page is reachable.
    render(<PreviewCard {...base} goalLabel="Capture leads" />)
    expect(screen.getByText("live")).toBeInTheDocument()
    expect(screen.getByText("Capture leads")).toBeInTheDocument()
  })
})
