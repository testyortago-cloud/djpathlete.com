import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PipelineFilters } from "@/components/admin/content-studio/pipeline/PipelineFilters"

const replaceMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/content",
  useSearchParams: () => new URLSearchParams("platform=instagram"),
}))

describe("<PipelineFilters>", () => {
  it("renders all platform and status pills", () => {
    render(<PipelineFilters videos={[]} />)
    expect(screen.getByRole("button", { name: /Instagram/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Facebook/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Approved/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Needs Review/i })).toBeInTheDocument()
  })

  it("toggles the initial 'instagram' platform chip as active", () => {
    render(<PipelineFilters videos={[]} />)
    expect(screen.getByRole("button", { name: /Instagram/i })).toHaveAttribute("aria-pressed", "true")
  })

  it("clicking a platform pill updates the URL", () => {
    replaceMock.mockClear()
    render(<PipelineFilters videos={[]} />)
    fireEvent.click(screen.getByRole("button", { name: /Facebook/i }))
    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /platform=(instagram%2Cfacebook|facebook%2Cinstagram|instagram,facebook|facebook,instagram)/,
      ),
      { scroll: false },
    )
  })

  it("Clear all resets filters", () => {
    replaceMock.mockClear()
    render(<PipelineFilters videos={[]} />)
    fireEvent.click(screen.getByRole("button", { name: /Clear all/i }))
    expect(replaceMock).toHaveBeenCalledWith("/admin/content", { scroll: false })
  })
})
