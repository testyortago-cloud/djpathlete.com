import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { TabSwitcher } from "@/components/admin/content-studio/TabSwitcher"

// Mock next/navigation for client components
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=calendar"),
  usePathname: () => "/admin/content",
}))

describe("<TabSwitcher>", () => {
  it("renders all four tab labels", () => {
    render(<TabSwitcher />)
    expect(screen.getByRole("link", { name: /Pipeline/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Calendar/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Videos/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Posts/i })).toBeInTheDocument()
  })

  it("marks the tab matching the ?tab= search param as active", () => {
    render(<TabSwitcher />)
    const calendarLink = screen.getByRole("link", { name: /Calendar/i })
    expect(calendarLink).toHaveAttribute("aria-current", "page")
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
