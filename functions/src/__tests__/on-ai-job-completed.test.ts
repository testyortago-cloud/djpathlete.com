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

  it("always enqueues split_reel_render when broll_generation flips to completed", async () => {
    // The gate (split_reel_auto_render) has been removed — render always chains.
    const event = makeEvent(
      { type: "broll_generation", status: "processing" },
      {
        type: "broll_generation",
        status: "completed",
        input: { videoUploadId: "vid-broll-1" },
        result: { segmentCount: 4 },
        userId: "user-5",
      },
    )
    await handleAiJobCompleted(event as never)

    expect(mocks.set).toHaveBeenCalledTimes(1)
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "split_reel_render",
        status: "pending",
        input: { videoUploadId: "vid-broll-1" },
        userId: "user-5",
        parentJobId: "parent-job",
      }),
    )
  })

  it("does NOT enqueue split_reel_render when broll_generation completes without input.videoUploadId", async () => {
    const event = makeEvent(
      { type: "broll_generation", status: "processing" },
      {
        type: "broll_generation",
        status: "completed",
        input: {},
        result: { segmentCount: 0 },
        userId: "user-6",
      },
    )
    await handleAiJobCompleted(event as never)
    expect(mocks.set).not.toHaveBeenCalled()
  })

  // ── Program-generation continuation chain ──────────────────────────────────
  // A full program is generated one week per invocation (540s ceiling), so the
  // orchestrator hands the weeks it could not reach to week_generation jobs
  // that chain themselves. See ai/generation-continuation.ts.

  const continuationJob = (completedWeek: number, finalWeek: number) => ({
    type: "week_generation",
    status: "completed",
    input: {
      request: {
        program_id: "prog-1",
        client_id: "client-1",
        admin_instructions: "12 exercises, 5 days",
        target_week_number: completedWeek,
        pool_exercise_ids: null,
        pool_mode: "preferred",
        ignore_profile: false,
      },
      requestedBy: "coach-1",
      // Nulled on every intermediate link; the durable address lives on the
      // continuation block below.
      notify_email: null,
      continuation: {
        final_week: finalWeek,
        origin: "program_generation",
        origin_log_id: "log-1",
        notify_email: "coach@example.com",
      },
    },
    result: { new_week_number: completedWeek, exercises_added: 60 },
    userId: "user-7",
  })

  it("enqueues the next week when a continuation week completes", async () => {
    const event = makeEvent({ type: "week_generation", status: "processing" }, continuationJob(2, 4))
    await handleAiJobCompleted(event as never)

    expect(mocks.set).toHaveBeenCalledTimes(1)
    const written = mocks.set.mock.calls[0][0] as {
      type: string
      input: { request: Record<string, unknown>; notify_email: string | null }
    }
    expect(written.type).toBe("week_generation")
    expect(written.input.request.target_week_number).toBe(3)
    expect(written.input.request.program_id).toBe("prog-1")
    // The coach's instructions must survive every link or later weeks drift.
    expect(written.input.request.admin_instructions).toBe("12 exercises, 5 days")
  })

  it("stops the chain after the final week", async () => {
    const event = makeEvent({ type: "week_generation", status: "processing" }, continuationJob(4, 4))
    await handleAiJobCompleted(event as never)
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it("emails only on the final week of the chain", async () => {
    // Week 3 of 4 is queued silently...
    await handleAiJobCompleted(
      makeEvent({ type: "week_generation", status: "processing" }, continuationJob(2, 4)) as never,
    )
    expect((mocks.set.mock.calls[0][0] as { input: { notify_email: string | null } }).input.notify_email).toBeNull()

    mocks.set.mockClear()
    // ...and week 4 of 4 carries the address.
    await handleAiJobCompleted(
      makeEvent({ type: "week_generation", status: "processing" }, continuationJob(3, 4)) as never,
    )
    expect((mocks.set.mock.calls[0][0] as { input: { notify_email: string | null } }).input.notify_email).toBe(
      "coach@example.com",
    )
  })

  it("does NOT chain an ordinary week_generation job the coach ran by hand", async () => {
    // No continuation block — this is the "generate week" button, which must
    // stay a single week and never start queueing more.
    const job = continuationJob(2, 4) as { input: Record<string, unknown> }
    delete job.input.continuation
    const event = makeEvent({ type: "week_generation", status: "processing" }, job)
    await handleAiJobCompleted(event as never)
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it("does NOT chain when the completed week is missing from the result", async () => {
    const job = continuationJob(2, 4) as { result: Record<string, unknown> }
    job.result = { exercises_added: 0 }
    const event = makeEvent({ type: "week_generation", status: "processing" }, job)
    await handleAiJobCompleted(event as never)
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
