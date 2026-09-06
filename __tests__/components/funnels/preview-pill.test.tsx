// @vitest-environment jsdom
// __tests__/components/funnels/preview-pill.test.tsx
//
// The one piece of chrome the full-screen preview adds. Its whole job is that
// a draft in its own browser tab is never mistaken for the live site.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { PreviewPill } from "@/components/funnels/PreviewPill"

const PROPS = { funnelName: "Summer camp", stepName: "Start", isLive: false, livePath: "/go/summer-camp" }

beforeEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe("PreviewPill", () => {
  it("says this is not the live page", () => {
    render(<PreviewPill {...PROPS} />)
    expect(screen.getByText(/not published/i)).toBeInTheDocument()
  })

  it("speaks to a coach, not a developer", () => {
    render(<PreviewPill {...PROPS} />)
    // MUTANT KILLED: jargon. "draft state", "unpublished route", "version row"
    // are all things the audience has never been taught.
    expect(document.body.textContent).not.toMatch(/route|version row|draft state|endpoint|render/i)
  })

  it("names the page being previewed", () => {
    render(<PreviewPill {...PROPS} />)
    expect(screen.getByText(/Start/)).toBeInTheDocument()
  })

  it("offers the live page only when there IS one", () => {
    const { rerender } = render(<PreviewPill {...PROPS} />)
    // MUTANT KILLED: always rendering the link. On a never-published funnel it
    // points at a 404, which is the exact confusion this feature removes.
    expect(screen.queryByRole("link", { name: /live page/i })).toBeNull()
    rerender(<PreviewPill {...PROPS} isLive />)
    expect(screen.getByRole("link", { name: /live page/i })).toHaveAttribute("href", "/go/summer-camp")
  })

  it("hides when dismissed, and stays hidden for the session", () => {
    const { unmount } = render(<PreviewPill {...PROPS} />)
    fireEvent.click(screen.getByRole("button", { name: /hide/i }))
    expect(screen.queryByText(/not published/i)).toBeNull()
    unmount()
    render(<PreviewPill {...PROPS} />)
    expect(screen.queryByText(/not published/i)).toBeNull()
  })

  it("renders even when sessionStorage throws", () => {
    // MUTANT KILLED: an unguarded read. A private window throws on access, and
    // the pill is the one thing telling the owner this page is not live —
    // failing closed here would be failing to the DANGEROUS side.
    vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    render(<PreviewPill {...PROPS} />)
    expect(screen.getByText(/not published/i)).toBeInTheDocument()
  })

  it("does not throw when dismissal cannot be stored", () => {
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    render(<PreviewPill {...PROPS} />)
    fireEvent.click(screen.getByRole("button", { name: /hide/i }))
    expect(screen.queryByText(/not published/i)).toBeNull()
  })
})
