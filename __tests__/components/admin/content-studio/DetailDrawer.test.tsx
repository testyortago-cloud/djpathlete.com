import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"

const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
  usePathname: () => "/admin/content/abc-123",
  useSearchParams: () => new URLSearchParams(""),
}))

describe("<DetailDrawer>", () => {
  it("renders the videoId in the header", () => {
    render(<DetailDrawer videoId="abc-123" />)
    expect(screen.getByText(/abc-123/)).toBeInTheDocument()
  })

  it("renders a close button labelled for accessibility", () => {
    render(<DetailDrawer videoId="abc-123" />)
    expect(screen.getByRole("button", { name: /close drawer/i })).toBeInTheDocument()
  })

  it("navigates to /admin/content when close is clicked", () => {
    pushMock.mockClear()
    render(<DetailDrawer videoId="abc-123" />)
    fireEvent.click(screen.getByRole("button", { name: /close drawer/i }))
    expect(pushMock).toHaveBeenCalledWith("/admin/content")
  })

  it("renders a placeholder indicating Phase 2 content is coming", () => {
    render(<DetailDrawer videoId="abc-123" />)
    expect(screen.getByText(/video player \+ transcript \+ posts/i)).toBeInTheDocument()
  })
})
