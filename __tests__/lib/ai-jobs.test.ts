// __tests__/lib/ai-jobs.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Firestore first (before the module under test is imported).
// Use vi.hoisted() so the mock variables are initialized before vi.mock()
// factories (which are hoisted to the top of the file) can reference them.
const { setMock, docMock, collectionMock, getAdminFirestoreMock } = vi.hoisted(() => {
  const setMock = vi.fn().mockResolvedValue(undefined)
  const docMock = vi.fn().mockReturnValue({ id: "generated_job_id", set: setMock })
  const collectionMock = vi.fn().mockReturnValue({ doc: docMock })
  const getAdminFirestoreMock = vi.fn().mockReturnValue({ collection: collectionMock })
  return { setMock, docMock, collectionMock, getAdminFirestoreMock }
})

vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: getAdminFirestoreMock,
}))

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => "SERVER_TIMESTAMP_STUB",
  },
}))

import { createAiJob } from "@/lib/ai-jobs"

describe("createAiJob", () => {
  beforeEach(() => {
    setMock.mockClear()
    docMock.mockClear()
    collectionMock.mockClear()
    getAdminFirestoreMock.mockClear()
  })

  it("writes an ai_jobs doc with the expected shape", async () => {
    const result = await createAiJob({
      type: "social_fanout",
      userId: "user-123",
      input: { videoId: "v1", platforms: ["instagram", "tiktok"] },
    })

    expect(collectionMock).toHaveBeenCalledWith("ai_jobs")
    expect(docMock).toHaveBeenCalledWith()
    expect(setMock).toHaveBeenCalledTimes(1)

    const writtenDoc = setMock.mock.calls[0][0]
    expect(writtenDoc).toMatchObject({
      type: "social_fanout",
      status: "pending",
      result: null,
      error: null,
      userId: "user-123",
      createdAt: "SERVER_TIMESTAMP_STUB",
      updatedAt: "SERVER_TIMESTAMP_STUB",
    })
    expect(writtenDoc.input).toEqual({
      videoId: "v1",
      platforms: ["instagram", "tiktok"],
      userId: "user-123",
    })

    expect(result).toEqual({ jobId: "generated_job_id", status: "pending" })
  })

  it("throws if userId is missing", async () => {
    await expect(
      createAiJob({
        type: "social_fanout",
        userId: "",
        input: {},
      }),
    ).rejects.toThrow(/userId is required/)
  })

  it("merges userId into the input payload so downstream handlers always see it", async () => {
    await createAiJob({
      type: "tavily_research",
      userId: "user-456",
      input: { topic: "rotational training" },
    })

    const writtenDoc = setMock.mock.calls[0][0]
    expect(writtenDoc.input.userId).toBe("user-456")
    expect(writtenDoc.input.topic).toBe("rotational training")
  })
})
