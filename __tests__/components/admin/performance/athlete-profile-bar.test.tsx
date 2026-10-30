// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { AthleteProfileBar } from "@/components/admin/performance/athlete-profile-bar"

// The Arena card, the report's share link and the standards moved from the client page to
// Performance (2026-10-30), next to the results they are built from.
const share = {
  qrDataUrl: "data:image/png;base64,AAAA",
  profileUrl: "https://www.darrenjpaul.com/athlete/tok123",
  reportPhotoUrl: null,
  testCount: 8,
}

describe("AthleteProfileBar", () => {
  it("links to this client's Arena card and to the Trained & Elite standards", () => {
    render(<AthleteProfileBar clientUserId="c1" clientName="Marcus Johnson" share={share} />)
    expect(screen.getByRole("link", { name: /Arena card/ })).toHaveAttribute("href", "/admin/clients/c1/arena")
    expect(screen.getByRole("link", { name: /Trained & Elite standards/ })).toHaveAttribute(
      "href",
      "/admin/settings/performance-standards",
    )
  })
  it("offers the test report's share link when there is one", () => {
    render(<AthleteProfileBar clientUserId="c1" clientName="Marcus Johnson" share={share} />)
    expect(screen.getByRole("button", { name: /share test report/i })).toBeInTheDocument()
  })
  it("leaves the share link out for a client with no public report, keeping the other two", () => {
    render(<AthleteProfileBar clientUserId="c1" clientName="Marcus Johnson" share={null} />)
    expect(screen.queryByRole("button", { name: /share test report/i })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Arena card/ })).toBeInTheDocument()
  })
})
