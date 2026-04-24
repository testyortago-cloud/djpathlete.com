import { describe, it, expect } from "vitest"
import {
  mediaAssetUploadUrlSchema,
  mediaAssetPatchSchema,
} from "@/lib/validators/media-asset"

describe("mediaAssetUploadUrlSchema", () => {
  it("accepts a valid image/jpeg upload request", () => {
    const result = mediaAssetUploadUrlSchema.safeParse({
      filename: "squat.jpg",
      contentType: "image/jpeg",
    })
    expect(result.success).toBe(true)
  })

  it("rejects non-image mime types", () => {
    const result = mediaAssetUploadUrlSchema.safeParse({
      filename: "squat.mp4",
      contentType: "video/mp4",
    })
    expect(result.success).toBe(false)
  })

  it("rejects filenames that don't look like images", () => {
    const result = mediaAssetUploadUrlSchema.safeParse({
      filename: "squat.mp4",
      contentType: "image/jpeg",
    })
    expect(result.success).toBe(false)
  })

  it("rejects empty filename", () => {
    const result = mediaAssetUploadUrlSchema.safeParse({
      filename: "",
      contentType: "image/jpeg",
    })
    expect(result.success).toBe(false)
  })
})

describe("mediaAssetPatchSchema", () => {
  it("accepts partial dimension metadata", () => {
    const result = mediaAssetPatchSchema.safeParse({
      width: 1080,
      height: 1080,
      bytes: 123456,
    })
    expect(result.success).toBe(true)
  })

  it("accepts an empty patch (all fields optional)", () => {
    const result = mediaAssetPatchSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it("rejects negative bytes", () => {
    const result = mediaAssetPatchSchema.safeParse({ bytes: -1 })
    expect(result.success).toBe(false)
  })
})
