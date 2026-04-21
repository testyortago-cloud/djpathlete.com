import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u", role: "admin" } })),
}))
const searchMock = vi.fn()
vi.mock("@/lib/content-studio/search", () => ({
  searchContentStudio: (...args: unknown[]) => searchMock(...args),
}))

import { GET } from "@/app/api/admin/content-studio/search/route"

beforeEach(() => searchMock.mockReset())

describe("GET /api/admin/content-studio/search", () => {
  it("returns empty buckets when ?q is missing", async () => {
    const res = await GET(new Request("http://x/api/admin/content-studio/search"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ videos: [], transcripts: [], posts: [] })
    expect(searchMock).not.toHaveBeenCalled()
  })

  it("delegates to searchContentStudio when ?q is set", async () => {
    searchMock.mockResolvedValueOnce({ videos: [], transcripts: [], posts: [] })
    const res = await GET(
      new Request("http://x/api/admin/content-studio/search?q=rotational"),
    )
    expect(res.status).toBe(200)
    expect(searchMock).toHaveBeenCalledWith("rotational")
  })
})
