import { describe, it, expect } from "vitest"
import { captionedCutRequestSchema } from "@/lib/validators/captioned-cut"

const UUID = "11111111-1111-1111-8111-111111111111"

describe("captionedCutRequestSchema", () => {
  it("accepts videoUploadId alone", () => {
    expect(captionedCutRequestSchema.safeParse({ videoUploadId: UUID }).success).toBe(true)
  })
  it("accepts submissionId alone", () => {
    expect(captionedCutRequestSchema.safeParse({ submissionId: UUID }).success).toBe(true)
  })
  it("rejects both at once", () => {
    expect(
      captionedCutRequestSchema.safeParse({ videoUploadId: UUID, submissionId: UUID }).success,
    ).toBe(false)
  })
  it("rejects neither", () => {
    expect(captionedCutRequestSchema.safeParse({}).success).toBe(false)
  })
  it("rejects a non-uuid", () => {
    expect(captionedCutRequestSchema.safeParse({ videoUploadId: "nope" }).success).toBe(false)
  })
})
