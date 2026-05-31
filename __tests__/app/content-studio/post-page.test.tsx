import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

const getDrawerDataForPostMock = vi.fn()
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND")
})

vi.mock("@/lib/content-studio/drawer-data", () => ({
  getDrawerDataForPost: (...a: unknown[]) => getDrawerDataForPostMock(...a),
}))
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }))
vi.mock("@/components/admin/content-studio/detail/VideoDetailPage", () => ({
  VideoDetailPage: () => <div data-testid="video-page" />,
}))
vi.mock("@/components/admin/content-studio/detail/PostDetailPage", () => ({
  PostDetailPage: () => <div data-testid="post-page" />,
}))

import Page from "@/app/(admin)/admin/content/post/[postId]/page"

beforeEach(() => vi.clearAllMocks())

describe("post detail route", () => {
  it("calls notFound when the post is missing", async () => {
    getDrawerDataForPostMock.mockResolvedValue(null)
    await expect(
      Page({ params: Promise.resolve({ postId: "x" }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("renders VideoDetailPage when the post has a source video (mode=video)", async () => {
    getDrawerDataForPostMock.mockResolvedValue({ mode: "video", video: { id: "v1" }, posts: [], highlightPostId: "p1" })
    const ui = await Page({ params: Promise.resolve({ postId: "p1" }), searchParams: Promise.resolve({}) })
    render(ui)
    expect(screen.getByTestId("video-page")).toBeInTheDocument()
  })

  it("renders PostDetailPage for a source-less manual post (mode=post-only)", async () => {
    getDrawerDataForPostMock.mockResolvedValue({ mode: "post-only", video: null, posts: [], highlightPostId: "p1" })
    const ui = await Page({ params: Promise.resolve({ postId: "p1" }), searchParams: Promise.resolve({}) })
    render(ui)
    expect(screen.getByTestId("post-page")).toBeInTheDocument()
  })
})
