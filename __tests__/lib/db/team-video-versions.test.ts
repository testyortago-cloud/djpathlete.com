import { describe, it, expect, vi, beforeEach } from "vitest"

const insertMock = vi.fn()
const updateMock = vi.fn()
const selectMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: insertMock,
      update: updateMock,
      select: selectMock,
    }),
  }),
}))

import {
  createVersion,
  finalizeVersion,
  nextVersionNumber,
} from "@/lib/db/team-video-versions"

beforeEach(() => vi.clearAllMocks())

describe("createVersion", () => {
  it("inserts a pending version row with the given fields", async () => {
    const row = { id: "v1", submission_id: "sub1", version_number: 1, status: "pending" }
    insertMock.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
    })
    const result = await createVersion({
      submissionId: "sub1",
      versionNumber: 1,
      storagePath: "team-videos/sub1/v1/squat.mp4",
      originalFilename: "squat.mp4",
      mimeType: "video/mp4",
      sizeBytes: 12345,
    })
    expect(result).toEqual(row)
    const args = insertMock.mock.calls[0][0]
    expect(args.submission_id).toBe("sub1")
    expect(args.version_number).toBe(1)
    expect(args.storage_path).toBe("team-videos/sub1/v1/squat.mp4")
    expect(args.status).toBe("pending")
  })
})

describe("finalizeVersion", () => {
  it("flips status to uploaded and stamps uploaded_at", async () => {
    updateMock.mockReturnValue({ eq: () => Promise.resolve({ data: null, error: null }) })
    await finalizeVersion("v1")
    const args = updateMock.mock.calls[0][0]
    expect(args.status).toBe("uploaded")
    expect(args.uploaded_at).toBeTruthy()
  })
})

describe("nextVersionNumber", () => {
  it("returns 1 when no versions exist yet", async () => {
    selectMock.mockReturnValue({
      eq: () => ({
        order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
      }),
    })
    expect(await nextVersionNumber("sub1")).toBe(1)
  })
  it("returns max+1 when versions exist", async () => {
    selectMock.mockReturnValue({
      eq: () => ({
        order: () => ({ limit: () => Promise.resolve({
          data: [{ version_number: 3 }],
          error: null,
        }) }),
      }),
    })
    expect(await nextVersionNumber("sub1")).toBe(4)
  })
})
