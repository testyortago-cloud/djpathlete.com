// __tests__/components/admin/preview-entry-points.test.tsx
//
// The feature is unreachable without these. Every assertion here is one surface
// that used to answer "No preview yet" on a page the owner had already written —
// which was the complaint that started this work.

import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { PreviewCard } from "@/components/admin/funnels/PreviewCard"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const BASE = {
  title: "Summer camp",
  href: "/admin/funnels/x/edit/y",
  badgeLabel: "never published",
  badgeTone: "neutral" as const,
}

describe("PreviewCard — the draft thumbnail", () => {
  it("renders the draft instead of 'No preview yet'", () => {
    // MUTANT KILLED: keeping `previewUrl={published ? … : null}`. An
    // unpublished page showed a grey box on every card in the admin, while the
    // draft it was hiding rendered perfectly one route away.
    render(<PreviewCard {...BASE} previewUrl="/preview/summer-camp" previewIsDraft />)
    expect(screen.queryByText(/no preview yet/i)).toBeNull()
    expect(document.querySelector("iframe")).toHaveAttribute("src", "/preview/summer-camp")
  })

  it("offers to open the draft full screen, in a new tab", () => {
    render(<PreviewCard {...BASE} previewUrl="/preview/summer-camp" previewIsDraft />)
    const link = screen.getByRole("link", { name: /preview/i })
    expect(link).toHaveAttribute("href", "/preview/summer-camp")
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("does NOT offer the draft link for an already-published page", () => {
    // MUTANT KILLED: showing "Preview" unconditionally. On a published page the
    // thumbnail is the live route, and a second button pointing somewhere else
    // makes the owner wonder which one is real.
    render(<PreviewCard {...BASE} previewUrl="/go/summer-camp?preview=1" />)
    expect(screen.queryByRole("link", { name: /^preview$/i })).toBeNull()
  })

  it("still says 'No preview yet' when there is genuinely nothing", () => {
    render(<PreviewCard {...BASE} previewUrl={null} />)
    expect(screen.getByText(/no preview yet/i)).toBeInTheDocument()
  })
})
