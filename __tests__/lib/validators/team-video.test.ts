import { describe, it, expect } from "vitest"
import {
  createSubmissionSchema,
  createVersionSchema,
  createCommentSchema,
  statusTransitionSchema,
  drawingJsonSchema,
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

describe("drawingJsonSchema", () => {
  const goodPath = {
    tool: "arrow", color: "#FF3B30", width: 3,
    points: [[0.1, 0.1], [0.9, 0.9]],
  }
  it("accepts a valid drawing", () => {
    const r = drawingJsonSchema.safeParse({ paths: [goodPath] })
    expect(r.success).toBe(true)
  })
  it("rejects unknown color", () => {
    const r = drawingJsonSchema.safeParse({
      paths: [{ ...goodPath, color: "#123456" }],
    })
    expect(r.success).toBe(false)
  })
  it("rejects coords > 1", () => {
    const r = drawingJsonSchema.safeParse({
      paths: [{ ...goodPath, points: [[0, 0], [1.5, 0.5]] }],
    })
    expect(r.success).toBe(false)
  })
  it("rejects single-point path", () => {
    const r = drawingJsonSchema.safeParse({
      paths: [{ ...goodPath, points: [[0.5, 0.5]] }],
    })
    expect(r.success).toBe(false)
  })
  it("rejects empty paths array", () => {
    const r = drawingJsonSchema.safeParse({ paths: [] })
    expect(r.success).toBe(false)
  })
  it("rejects arrow with more than 2 points", () => {
    const r = drawingJsonSchema.safeParse({
      paths: [{ tool: "arrow", color: "#FF3B30", width: 3,
                points: [[0, 0], [0.5, 0.5], [1, 1]] }],
    })
    expect(r.success).toBe(false)
  })
  it("rejects rectangle with more than 2 points", () => {
    const r = drawingJsonSchema.safeParse({
      paths: [{ tool: "rectangle", color: "#FF3B30", width: 3,
                points: [[0, 0], [0.5, 0.5], [1, 1]] }],
    })
    expect(r.success).toBe(false)
  })
  it("accepts pen with many points", () => {
    const r = drawingJsonSchema.safeParse({
      paths: [{ tool: "pen", color: "#000000", width: 2,
                points: [[0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1, 1]] }],
    })
    expect(r.success).toBe(true)
  })
  it("accepts pin with exactly 1 point", () => {
    const r = drawingJsonSchema.safeParse({
      paths: [{ tool: "pin", color: "#FF3B30", width: 4, points: [[0.42, 0.66]] }],
    })
    expect(r.success).toBe(true)
  })
  it("rejects pin with 0 points", () => {
    const r = drawingJsonSchema.safeParse({
      paths: [{ tool: "pin", color: "#FF3B30", width: 4, points: [] }],
    })
    expect(r.success).toBe(false)
  })
  it("rejects pin with more than 1 point", () => {
    const r = drawingJsonSchema.safeParse({
      paths: [{ tool: "pin", color: "#FF3B30", width: 4, points: [[0.1, 0.1], [0.9, 0.9]] }],
    })
    expect(r.success).toBe(false)
  })
})

describe("createCommentSchema with annotation", () => {
  it("accepts a comment without annotation (backwards compat)", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: 1, commentText: "x",
    })
    expect(r.success).toBe(true)
  })
  it("accepts a comment with valid annotation", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: 1, commentText: "x",
      annotation: { paths: [{ tool: "pen", color: "#000000", width: 2,
                              points: [[0, 0], [1, 1]] }] },
    })
    expect(r.success).toBe(true)
  })
  it("rejects a comment with invalid annotation", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: 1, commentText: "x",
      annotation: { paths: [{ tool: "scribble", color: "#000000", width: 2,
                               points: [[0, 0], [1, 1]] }] },
    })
    expect(r.success).toBe(false)
  })
  it("rejects annotation when timecodeSeconds is null (general comment)", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: null, commentText: "x",
      annotation: { paths: [{ tool: "pen", color: "#000000", width: 2,
                              points: [[0, 0], [1, 1]] }] },
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
