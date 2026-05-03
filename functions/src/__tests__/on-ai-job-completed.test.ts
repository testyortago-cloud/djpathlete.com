import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  doc: vi.fn(),
  collection: vi.fn(),
}))
mocks.doc.mockImplementation(() => ({ set: mocks.set, id: "new-job-id" }))
mocks.collection.mockImplementation(() => ({ doc: mocks.doc }))

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: mocks.collection }),
  FieldValue: { serverTimestamp: () => "TS" },
}))

import { handleAiJobCompleted } from "../on-ai-job-completed.js"

function makeEvent(before: Record<string, unknown>, after: Record<string, unknown>) {
  return {
    data: {
      before: { exists: true, data: () => before },
      after: { exists: true, data: () => after },
    },
    params: { jobId: "parent-job" },
  }
}

describe("handleAiJobCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.set.mockResolvedValue(undefined)
    // re-establish chain after clearAllMocks
    mocks.doc.mockImplementation(() => ({ set: mocks.set, id: "new-job-id" }))
    mocks.collection.mockImplementation(() => ({ doc: mocks.doc }))
  })

  it("enqueues blog_image_generation when blog_generation flips to completed", async () => {
    const event = makeEvent(
      { type: "blog_generation", status: "processing" },
      {
        type: "blog_generation",
        status: "completed",
        result: { blog_post_id: "post-123" },
        userId: "user-1",
      },
    )
    await handleAiJobCompleted(event as never)

    expect(mocks.set).toHaveBeenCalledTimes(1)
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "blog_image_generation",
        status: "pending",
        input: { blog_post_id: "post-123" },
        userId: "user-1",
      }),
    )
  })

  it("does NOT enqueue when type is not blog_generation", async () => {
    const event = makeEvent(
      { type: "newsletter_generation", status: "processing" },
      { type: "newsletter_generation", status: "completed", result: {} },
    )
    await handleAiJobCompleted(event as never)
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it("does NOT enqueue when status was already completed before", async () => {
    const event = makeEvent(
      { type: "blog_generation", status: "completed", result: { blog_post_id: "post-123" } },
      { type: "blog_generation", status: "completed", result: { blog_post_id: "post-123" } },
    )
    await handleAiJobCompleted(event as never)
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it("does NOT enqueue when blog_post_id is missing from result", async () => {
    const event = makeEvent(
      { type: "blog_generation", status: "processing" },
      { type: "blog_generation", status: "completed", result: {} },
    )
    await handleAiJobCompleted(event as never)
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
