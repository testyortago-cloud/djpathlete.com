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

  it("enqueues social_fanout when video_transcription flips to completed", async () => {
    const event = makeEvent(
      { type: "video_transcription", status: "processing" },
      {
        type: "video_transcription",
        status: "completed",
        result: { videoUploadId: "vid-789", transcriptId: "tr-1" },
        userId: "user-2",
      },
    )
    await handleAiJobCompleted(event as never)

    expect(mocks.set).toHaveBeenCalledTimes(1)
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "social_fanout",
        status: "pending",
        input: { videoUploadId: "vid-789" },
        userId: "user-2",
      }),
    )
  })

  it("enqueues social_fanout when video_vision flips to completed", async () => {
    const event = makeEvent(
      { type: "video_vision", status: "processing" },
      {
        type: "video_vision",
        status: "completed",
        result: { videoUploadId: "vid-vis-1", source: "vision" },
        userId: "user-3",
      },
    )
    await handleAiJobCompleted(event as never)

    expect(mocks.set).toHaveBeenCalledTimes(1)
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "social_fanout",
        input: { videoUploadId: "vid-vis-1" },
        userId: "user-3",
      }),
    )
  })

  it("does NOT chain when video_transcription completes with a fallbackJobId (vision handoff)", async () => {
    // Webhook sets the original transcription job to completed with
    // result.fallbackJobId (no videoUploadId) when AssemblyAI fails or
    // returns empty speech. The vision job will fire its own completion.
    const event = makeEvent(
      { type: "video_transcription", status: "processing" },
      {
        type: "video_transcription",
        status: "completed",
        result: { fallbackJobId: "vision-job-1", reason: "no speech" },
        userId: "user-4",
      },
    )
    await handleAiJobCompleted(event as never)
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
