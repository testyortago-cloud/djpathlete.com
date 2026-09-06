// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

const getDrawerDataMock = vi.fn()
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND")
})

vi.mock("@/lib/content-studio/drawer-data", () => ({
  getDrawerData: (...a: unknown[]) => getDrawerDataMock(...a),
}))
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }))
vi.mock("@/components/admin/content-studio/detail/VideoDetailPage", () => ({
  VideoDetailPage: ({ backLabel }: { backLabel: string }) => <div data-testid="video-page">{backLabel}</div>,
}))

import Page from "@/app/(admin)/admin/content/[videoId]/page"

beforeEach(() => vi.clearAllMocks())

describe("video detail route", () => {
  it("calls notFound when the video is missing", async () => {
    getDrawerDataMock.mockResolvedValue(null)
    await expect(
      Page({ params: Promise.resolve({ videoId: "x" }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("renders VideoDetailPage with the back label from ?tab=", async () => {
    getDrawerDataMock.mockResolvedValue({ mode: "video", video: { id: "v1" }, posts: [] })
    const ui = await Page({
      params: Promise.resolve({ videoId: "v1" }),
      searchParams: Promise.resolve({ tab: "videos" }),
    })
    render(ui)
    expect(screen.getByTestId("video-page")).toHaveTextContent("Videos")
  })
})
