// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { TabSwitcher } from "@/components/admin/content-studio/TabSwitcher"

// Mock next/navigation for client components
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=calendar"),
  usePathname: () => "/admin/content",
}))

describe("<TabSwitcher>", () => {
  it("renders all six tab labels", () => {
    render(<TabSwitcher />)
    expect(screen.getByRole("link", { name: /Pipeline/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Calendar/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Videos/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Posts/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Assets/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Insights/i })).toBeInTheDocument()
  })

  it("renders the Assets tab link", () => {
    render(<TabSwitcher />)
    expect(screen.getByRole("link", { name: /assets/i })).toBeInTheDocument()
  })

  it("marks the tab matching the ?tab= search param as active", () => {
    render(<TabSwitcher />)
    const calendarLink = screen.getByRole("link", { name: /Calendar/i })
    expect(calendarLink).toHaveAttribute("aria-current", "page")
  })

  // Regression: until this was fixed the tabs computed their href from the
  // CURRENT path, so on a video detail page every tab linked to that same
  // detail page with a new ?tab=. The underline moved and the URL changed
  // while the video stayed on screen -- the tabs looked live but went nowhere.
  it("links to the studio root from a video detail page, not back to itself", async () => {
    vi.doMock("next/navigation", () => ({
      useSearchParams: () => new URLSearchParams(""),
      usePathname: () => "/admin/content/2c9bceb-c40d-43bf-a39f-df494057b4e5",
    }))
    vi.resetModules()
    const { TabSwitcher: Fresh } = await import("@/components/admin/content-studio/TabSwitcher")
    render(<Fresh />)
    expect(screen.getByRole("link", { name: /Insights/i })).toHaveAttribute("href", "/admin/content?tab=insights")
    expect(screen.getByRole("link", { name: /Calendar/i })).toHaveAttribute("href", "/admin/content?tab=calendar")
    expect(screen.getByRole("link", { name: /Pipeline/i })).toHaveAttribute("href", "/admin/content")
  })

  it("defaults to Pipeline when no ?tab= is set", async () => {
    vi.doMock("next/navigation", () => ({
      useSearchParams: () => new URLSearchParams(""),
      usePathname: () => "/admin/content",
    }))
    vi.resetModules()
    const { TabSwitcher: Fresh } = await import("@/components/admin/content-studio/TabSwitcher")
    render(<Fresh />)
    const pipelineLink = screen.getByRole("link", { name: /Pipeline/i })
    expect(pipelineLink).toHaveAttribute("aria-current", "page")
  })
})
