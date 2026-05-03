import { describe, it, expect } from "vitest"
import {
  createSubmissionSchema,
  createVersionSchema,
  createCommentSchema,
  statusTransitionSchema,
} from "@/lib/validators/team-video"

describe("createSubmissionSchema", () => {
  it("accepts a valid submission", () => {
    const r = createSubmissionSchema.safeParse({
      title: "Squat tutorial v1",
      description: "First cut",
      filename: "squat.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1024 * 1024 * 50,
    })
    expect(r.success).toBe(true)
  })
  it("rejects empty title", () => {
    const r = createSubmissionSchema.safeParse({
      title: "",
      filename: "a.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1,
    })
    expect(r.success).toBe(false)
  })
  it("rejects unsupported mime", () => {
    const r = createSubmissionSchema.safeParse({
      title: "X",
      filename: "a.gif",
      mimeType: "image/gif",
      sizeBytes: 1,
    })
    expect(r.success).toBe(false)
  })
  it("rejects size > 5GB", () => {
    const r = createSubmissionSchema.safeParse({
      title: "X",
      filename: "big.mp4",
      mimeType: "video/mp4",
      sizeBytes: 6 * 1024 ** 3,
    })
    expect(r.success).toBe(false)
  })
})

describe("createVersionSchema", () => {
  it("accepts valid version", () => {
    const r = createVersionSchema.safeParse({
      filename: "squat-v2.mp4", mimeType: "video/mp4", sizeBytes: 1234,
    })
    expect(r.success).toBe(true)
  })
})

describe("createCommentSchema", () => {
  it("accepts a timecoded comment", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: 42.5, commentText: "Tighten this cut",
    })
    expect(r.success).toBe(true)
  })
  it("accepts a general comment (null timecode)", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: null, commentText: "Overall vibe",
    })
    expect(r.success).toBe(true)
  })
  it("rejects empty text", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: 0, commentText: "   ",
    })
    expect(r.success).toBe(false)
  })
  it("rejects negative timecode", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: -1, commentText: "x",
    })
    expect(r.success).toBe(false)
  })
})

describe("statusTransitionSchema", () => {
  it("accepts the three valid actions", () => {
    for (const action of ["request_revision", "approve", "reopen"]) {
      const r = statusTransitionSchema.safeParse({ action })
      expect(r.success).toBe(true)
    }
  })
  it("rejects unknown actions", () => {
    expect(statusTransitionSchema.safeParse({ action: "nuke" }).success).toBe(false)
  })
})
