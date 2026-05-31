import { describe, it, expect } from "vitest"
import { captionedCutRequestSchema } from "@/lib/validators/captioned-cut"

const VID = "396afdd4-4ebc-4eaa-b39a-da074bca0285"

describe("captionedCutRequestSchema", () => {
  it("accepts a videoUploadId with no hook", () => {
    const r = captionedCutRequestSchema.safeParse({ videoUploadId: VID })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.hook).toBeUndefined()
  })

  it("accepts and trims a hook", () => {
    const r = captionedCutRequestSchema.safeParse({ videoUploadId: VID, hook: "  5 mistakes athletes make  " })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.hook).toBe("5 mistakes athletes make")
  })

  it("rejects a hook longer than 80 chars", () => {
    const r = captionedCutRequestSchema.safeParse({ videoUploadId: VID, hook: "x".repeat(81) })
    expect(r.success).toBe(false)
  })

  it("still requires exactly one of videoUploadId / submissionId", () => {
    expect(captionedCutRequestSchema.safeParse({ hook: "hi" }).success).toBe(false)
    expect(captionedCutRequestSchema.safeParse({ videoUploadId: VID, submissionId: VID }).success).toBe(false)
  })
})
