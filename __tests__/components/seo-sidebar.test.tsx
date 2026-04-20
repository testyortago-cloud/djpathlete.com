import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { SeoSidebar } from "@/components/admin/blog/SeoSidebar"
import type { SeoMetadata } from "@/types/database"

describe("SeoSidebar", () => {
  it("renders empty state when no seoMetadata", () => {
    render(<SeoSidebar seoMetadata={null} onClose={vi.fn()} />)
    expect(screen.getByText(/no link suggestions yet/i)).toBeInTheDocument()
  })

  it("renders empty state when internal_link_suggestions is empty", () => {
    const meta: SeoMetadata = { internal_link_suggestions: [] }
    render(<SeoSidebar seoMetadata={meta} onClose={vi.fn()} />)
    expect(screen.getByText(/no link suggestions yet/i)).toBeInTheDocument()
  })

  it("renders each suggestion with title + score + reason + open link", () => {
    const meta: SeoMetadata = {
      internal_link_suggestions: [
        {
          blog_post_id: "bp-a",
          title: "Rotator cuff drills",
          slug: "rotator-cuff",
          overlap_score: 5,
          reason: "Shares tags: shoulder, rehab · same category",
        },
        {
          blog_post_id: "bp-b",
          title: "Return to throwing",
          slug: "return-throw",
          overlap_score: 2,
          reason: "Shares tags: throwing",
        },
      ],
    }
    render(<SeoSidebar seoMetadata={meta} onClose={vi.fn()} />)
    expect(screen.getByText(/rotator cuff drills/i)).toBeInTheDocument()
    expect(screen.getByText("5")).toBeInTheDocument()
    expect(screen.getByText(/shares tags: shoulder, rehab/i)).toBeInTheDocument()
    expect(screen.getByText(/return to throwing/i)).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
  })
})
