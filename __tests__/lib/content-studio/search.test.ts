import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        ilike: () => builder,
        or: () => builder,
        limit: () => Promise.resolve({ data: [], error: null }),
        textSearch: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }
      return builder
    },
  }),
}))

import { searchContentStudio } from "@/lib/content-studio/search"

describe("searchContentStudio", () => {
  it("returns three empty buckets for the empty query", async () => {
    const result = await searchContentStudio("")
    expect(result.videos).toEqual([])
    expect(result.transcripts).toEqual([])
    expect(result.posts).toEqual([])
  })

  it("trims whitespace-only queries to empty", async () => {
    const result = await searchContentStudio("     ")
    expect(result.videos).toEqual([])
    expect(result.transcripts).toEqual([])
    expect(result.posts).toEqual([])
  })
})
