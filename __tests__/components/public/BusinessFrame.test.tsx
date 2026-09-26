// @vitest-environment jsdom
// G49: the frame around the unsubscribe and SMS-consent pages carries the
// token's business and nothing of the platform's.
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { BusinessFrame } from "@/components/public/BusinessFrame"
import type { BusinessPageIdentity } from "@/lib/lead-engine/business-page"

const identity: BusinessPageIdentity = {
  displayName: "Trailhead Strength",
  senderName: "Sam Rivera",
  postalAddress: "12 Ridge Rd, Boulder, CO",
  logoUrl: null,
  palette: { brand: "#2f5d3a", brandInk: "#ffffff", accent: "#a3b18a", strip: "#a3b18a" },
}

describe("BusinessFrame", () => {
  it("heads the page with the business's name and signs it with its sender and address", () => {
    render(<BusinessFrame identity={identity}>body</BusinessFrame>)
    expect(screen.getByRole("banner").textContent).toBe("Trailhead Strength")
    expect(screen.getByText("Sent by Sam Rivera · 12 Ridge Rd, Boulder, CO")).toBeTruthy()
    expect(screen.getByText("body")).toBeTruthy()
  })

  it("shows the logo instead of the name when there is one", () => {
    render(<BusinessFrame identity={{ ...identity, logoUrl: "https://cdn.example.com/l.png" }}>body</BusinessFrame>)
    const logo = screen.getByRole("img", { name: "Trailhead Strength" }) as HTMLImageElement
    expect(logo.src).toBe("https://cdn.example.com/l.png")
  })

  it("leaves the address out when there is none", () => {
    render(<BusinessFrame identity={{ ...identity, postalAddress: null }}>body</BusinessFrame>)
    expect(screen.getByText("Sent by Sam Rivera")).toBeTruthy()
  })

  it("re-themes the page to the business's colours, so its headings and buttons follow", () => {
    const { container } = render(<BusinessFrame identity={identity}>body</BusinessFrame>)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.getPropertyValue("--primary")).toBe("#2f5d3a")
    expect(root.style.getPropertyValue("--primary-foreground")).toBe("#ffffff")
  })

  it("with no identity, shows the content alone: no header, no footer, nobody else's name", () => {
    const { container } = render(<BusinessFrame identity={null}>body</BusinessFrame>)
    expect(screen.queryByRole("banner")).toBeNull()
    expect(screen.queryByRole("contentinfo")).toBeNull()
    expect(container.textContent).toBe("body")
  })
})
