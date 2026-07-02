import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { BlogPostList } from "@/components/admin/blog/BlogPostList"
import type { BlogPost } from "@/types/database"

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

function post(overrides: Partial<BlogPost>): BlogPost {
  return {
    id: "p1",
    title: "Test post",
    slug: "test-post",
    excerpt: "An excerpt",
    content: "Body",
    category: "Training",
    status: "draft",
    published_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  } as BlogPost
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("<BlogPostList> publish quick action", () => {
  it("shows a Publish action for drafts only", () => {
    render(<BlogPostList posts={[post({ id: "d1", status: "draft" }), post({ id: "pub1", status: "published" })]} />)
    expect(screen.getAllByTitle("Publish")).toHaveLength(1)
  })

  it("publishes after inline confirm and refreshes", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "d1" }), { status: 200 }))
    render(<BlogPostList posts={[post({ id: "d1", status: "draft" })]} />)

    fireEvent.click(screen.getByTitle("Publish"))
    fireEvent.click(screen.getByRole("button", { name: "Publish" }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Post published"))
    expect(global.fetch).toHaveBeenCalledWith("/api/admin/blog/d1/publish", expect.objectContaining({ method: "POST" }))
  })

  it("cancel dismisses the confirm without calling the API", () => {
    const fetchSpy = vi.spyOn(global, "fetch")
    render(<BlogPostList posts={[post({ id: "d1", status: "draft" })]} />)

    fireEvent.click(screen.getByTitle("Publish"))
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument()
    expect(screen.getByTitle("Publish")).toBeInTheDocument()
  })

  it("surfaces a failed publish as an error toast", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "boom" }), { status: 500 }))
    render(<BlogPostList posts={[post({ id: "d1", status: "draft" })]} />)

    fireEvent.click(screen.getByTitle("Publish"))
    fireEvent.click(screen.getByRole("button", { name: "Publish" }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
  })
})
