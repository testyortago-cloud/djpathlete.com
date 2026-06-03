import { describe, it, expect } from "vitest"
import { splitReelGenerateSchema } from "@/lib/validators/split-reel"

describe("splitReelGenerateSchema", () => {
  it("accepts a bare videoUploadId", () => {
    // Valid RFC-4122 v4 UUID (Zod 4's .uuid() validates version/variant bits, as real Supabase ids do).
    const r = splitReelGenerateSchema.safeParse({ videoUploadId: "11111111-1111-4111-8111-111111111111" })
    expect(r.success).toBe(true)
  })
  it("rejects a missing videoUploadId", () => {
    expect(splitReelGenerateSchema.safeParse({}).success).toBe(false)
  })
  it("rejects a non-uuid videoUploadId", () => {
    expect(splitReelGenerateSchema.safeParse({ videoUploadId: "nope" }).success).toBe(false)
  })
})
