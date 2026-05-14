import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ImageSetViewer } from "@/components/admin/team-videos/ImageSetViewer"

const images = [
  { id: "i1", position: 0, signedUrl: "https://a", originalFilename: "a.jpg" },
  { id: "i2", position: 1, signedUrl: "https://b", originalFilename: "b.jpg" },
  { id: "i3", position: 2, signedUrl: "https://c", originalFilename: "c.jpg" },
]

describe("ImageSetViewer", () => {
  it("renders the first image by default", () => {
    render(<ImageSetViewer images={images} activeIndex={0} onActiveIndexChange={() => {}} />)
    expect(screen.getByRole("img", { name: /a.jpg/i })).toHaveAttribute("src", "https://a")
    expect(screen.getByText(/1 of 3/i)).toBeInTheDocument()
  })

  it("calls onActiveIndexChange when arrow keys are pressed", () => {
    const handler = vi.fn()
    render(<ImageSetViewer images={images} activeIndex={0} onActiveIndexChange={handler} />)
    fireEvent.keyDown(window, { key: "ArrowRight" })
    expect(handler).toHaveBeenCalledWith(1)
  })

  it("clicking a thumbnail jumps to that image", () => {
    const handler = vi.fn()
    render(<ImageSetViewer images={images} activeIndex={0} onActiveIndexChange={handler} />)
    fireEvent.click(screen.getByRole("button", { name: /Go to image 3/i }))
    expect(handler).toHaveBeenCalledWith(2)
  })
})
