// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MySessionsCard } from "@/components/client/MySessionsCard"

describe("MySessionsCard", () => {
  it("renders the remaining count and links to the sessions page", () => {
    const { container } = render(<MySessionsCard activeRemaining={6} nearestExpiry="2026-07-14T00:00:00Z" />)
    expect(screen.getByText(/6/)).toBeInTheDocument()
    expect(container.querySelector('a[href="/client/sessions"]')).toBeTruthy()
  })

  it("renders nothing when there are no active credits", () => {
    const { container } = render(<MySessionsCard activeRemaining={0} nearestExpiry={null} />)
    expect(container.firstChild).toBeNull()
  })
})
