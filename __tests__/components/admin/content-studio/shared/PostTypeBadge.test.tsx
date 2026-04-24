import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { PostTypeBadge } from "@/components/admin/content-studio/shared/PostTypeBadge"

describe("PostTypeBadge", () => {
  it("renders 'Video' for video", () => {
    render(<PostTypeBadge postType="video" />)
    expect(screen.getByText(/video/i)).toBeInTheDocument()
  })

  it("renders 'Photo' for image", () => {
    render(<PostTypeBadge postType="image" />)
    expect(screen.getByText(/photo/i)).toBeInTheDocument()
  })

  it("renders 'Carousel' for carousel", () => {
    render(<PostTypeBadge postType="carousel" />)
    expect(screen.getByText(/carousel/i)).toBeInTheDocument()
  })

  it("renders 'Story' for story", () => {
    render(<PostTypeBadge postType="story" />)
    expect(screen.getByText(/story/i)).toBeInTheDocument()
  })

  it("renders nothing for unsupported post_type (graceful fallback)", () => {
    // @ts-expect-error intentional bad input
    const { container } = render(<PostTypeBadge postType="alien" />)
    expect(container).toBeEmptyDOMElement()
  })
})
