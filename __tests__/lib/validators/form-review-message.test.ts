import { describe, it, expect } from "vitest"
import { formReviewMessageSchema } from "@/lib/validators/form-review-message"

describe("formReviewMessageSchema", () => {
  it("accepts a text-only message", () => {
    const r = formReviewMessageSchema.safeParse({ message: "Reset your hips" })
    expect(r.success).toBe(true)
  })

  it("accepts a valid audio-only message", () => {
    const r = formReviewMessageSchema.safeParse({
      audio: {
        storage_path: "form-review-audio/u-123/1700000000000.webm",
        mime_type: "audio/webm",
        duration_seconds: 14,
        byte_size: 180_000,
      },
    })
    expect(r.success).toBe(true)
  })

  it("rejects empty text", () => {
    expect(formReviewMessageSchema.safeParse({ message: "" }).success).toBe(false)
  })

  it("rejects audio with bad path prefix", () => {
    const r = formReviewMessageSchema.safeParse({
      audio: {
        storage_path: "form-reviews/u-123/foo.webm",
        mime_type: "audio/webm",
        duration_seconds: 14,
        byte_size: 180_000,
      },
    })
    expect(r.success).toBe(false)
  })

  it("rejects audio over 120 seconds", () => {
    const r = formReviewMessageSchema.safeParse({
      audio: {
        storage_path: "form-review-audio/u-123/x.webm",
        mime_type: "audio/webm",
        duration_seconds: 121,
        byte_size: 100,
      },
    })
    expect(r.success).toBe(false)
  })

  it("rejects audio over 3 MB", () => {
    const r = formReviewMessageSchema.safeParse({
      audio: {
        storage_path: "form-review-audio/u-123/x.webm",
        mime_type: "audio/webm",
        duration_seconds: 14,
        byte_size: 3 * 1024 * 1024 + 1,
      },
    })
    expect(r.success).toBe(false)
  })

  it("rejects unsupported mime", () => {
    const r = formReviewMessageSchema.safeParse({
      audio: {
        storage_path: "form-review-audio/u-123/x.pdf",
        mime_type: "application/pdf",
        duration_seconds: 14,
        byte_size: 100,
      },
    })
    expect(r.success).toBe(false)
  })

  it("rejects payload with both message and audio", () => {
    const r = formReviewMessageSchema.safeParse({
      message: "hi",
      audio: {
        storage_path: "form-review-audio/u-123/x.webm",
        mime_type: "audio/webm",
        duration_seconds: 14,
        byte_size: 100,
      },
    })
    expect(r.success).toBe(false)
  })

  it("rejects empty payload", () => {
    expect(formReviewMessageSchema.safeParse({}).success).toBe(false)
  })
})
