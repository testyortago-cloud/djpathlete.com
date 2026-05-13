import { describe, expect, it, vi, beforeEach } from "vitest"

const readResponse = vi.fn()
const writeResponse = vi.fn()
const updateMock = vi.fn(() => ({
  eq: vi.fn(() => ({
    select: vi.fn(() => ({ single: () => writeResponse() })),
  })),
}))
const selectReadMock = vi.fn(() => ({
  eq: vi.fn(() => ({ single: () => readResponse() })),
}))
const fromMock = vi.fn(() => ({
  select: selectReadMock,
  update: updateMock,
  // The other DAL functions in this file expect more methods — provide stubs.
  insert: vi.fn(() => ({ select: vi.fn(() => ({ single: () => readResponse() })) })),
  delete: vi.fn(() => ({ eq: () => readResponse() })),
}))

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}))

const { refreshBlogPost } = await import("@/lib/db/blog-posts")

beforeEach(() => {
  fromMock.mockClear()
  updateMock.mockClear()
  selectReadMock.mockClear()
  readResponse.mockReset()
  writeResponse.mockReset()
})

describe("refreshBlogPost", () => {
  it("reads current refresh_count, increments by 1, forces status=draft", async () => {
    readResponse.mockResolvedValueOnce({ data: { refresh_count: 2 }, error: null })
    writeResponse.mockResolvedValueOnce({
      data: { id: "post-1", refresh_count: 3, status: "draft" },
      error: null,
    })

    const out = await refreshBlogPost({
      id: "post-1",
      title: "New title",
      excerpt: "New excerpt that is long enough to satisfy the schema validator if any",
      content: "<p>New content</p>",
      meta_description: "New meta",
      faq: [],
      tags: ["a", "b"],
    })

    expect(out).toEqual({ id: "post-1", refresh_count: 3, status: "draft" })

    // Verify the update payload was constructed correctly.
    const updateArg = updateMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updateArg.status).toBe("draft")
    expect(updateArg.refresh_count).toBe(3)
    expect(updateArg.title).toBe("New title")
    expect(updateArg.last_refreshed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(updateArg.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // These fields must NOT be present in the update payload (they're preserved):
    expect(updateArg).not.toHaveProperty("id")
    expect(updateArg).not.toHaveProperty("slug")
    expect(updateArg).not.toHaveProperty("published_at")
    expect(updateArg).not.toHaveProperty("author_id")
    expect(updateArg).not.toHaveProperty("category")
    expect(updateArg).not.toHaveProperty("primary_keyword")
  })

  it("starts refresh_count at 1 when current is null", async () => {
    readResponse.mockResolvedValueOnce({ data: { refresh_count: null }, error: null })
    writeResponse.mockResolvedValueOnce({ data: { id: "post-2", refresh_count: 1 }, error: null })

    await refreshBlogPost({
      id: "post-2",
      title: "t",
      excerpt: "x",
      content: "<p>c</p>",
      meta_description: "m",
      faq: [],
      tags: [],
    })

    const updateArg = updateMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updateArg.refresh_count).toBe(1)
  })

  it("throws when the read fails", async () => {
    readResponse.mockResolvedValueOnce({ data: null, error: { message: "no row" } })
    await expect(
      refreshBlogPost({
        id: "missing",
        title: "t",
        excerpt: "x",
        content: "<p>c</p>",
        meta_description: "m",
        faq: [],
        tags: [],
      }),
    ).rejects.toMatchObject({ message: "no row" })
  })

  it("throws when the write fails", async () => {
    readResponse.mockResolvedValueOnce({ data: { refresh_count: 0 }, error: null })
    writeResponse.mockResolvedValueOnce({ data: null, error: { message: "constraint violation" } })
    await expect(
      refreshBlogPost({
        id: "post-3",
        title: "t",
        excerpt: "x",
        content: "<p>c</p>",
        meta_description: "m",
        faq: [],
        tags: [],
      }),
    ).rejects.toMatchObject({ message: "constraint violation" })
  })
})
