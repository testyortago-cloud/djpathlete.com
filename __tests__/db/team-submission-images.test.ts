import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from "@/lib/supabase"

beforeEach(() => vi.resetAllMocks())

function mockChain<T>(returnValue: { data: T; error: null } | { data: null; error: Error }) {
  const fn = vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue(returnValue) }),
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue(returnValue),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue(returnValue),
    }),
  })
  ;(createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: fn })
  return fn
}

describe("team-submission-images DAL", () => {
  it("createImagesForVersion inserts each image", async () => {
    const inserted = [
      { id: "i1", version_id: "v1", position: 0 },
      { id: "i2", version_id: "v1", position: 1 },
    ]
    mockChain({ data: inserted, error: null })

    const { createImagesForVersion } = await import("@/lib/db/team-submission-images")
    const rows = await createImagesForVersion("v1", [
      { position: 0, storagePath: "p0", originalFilename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000 },
      { position: 1, storagePath: "p1", originalFilename: "b.jpg", mimeType: "image/jpeg", sizeBytes: 1000 },
    ])
    expect(rows).toEqual(inserted)
  })

  it("listImagesForVersion returns rows ordered by position", async () => {
    const rows = [{ id: "i1", position: 0 }, { id: "i2", position: 1 }]
    mockChain({ data: rows, error: null })
    const { listImagesForVersion } = await import("@/lib/db/team-submission-images")
    expect(await listImagesForVersion("v1")).toEqual(rows)
  })
})
