import { describe, expect, it } from "vitest"
import {
  createPhotoSubmissionSchema,
  createPhotoVersionSchema,
} from "@/lib/validators/team-video"

const okImage = {
  filename: "shot.jpg",
  mimeType: "image/jpeg" as const,
  sizeBytes: 1024,
  position: 0,
}

describe("createPhotoSubmissionSchema", () => {
  it("accepts 1 image", () => {
    const parsed = createPhotoSubmissionSchema.safeParse({
      title: "Coaching shot",
      images: [okImage],
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts 10 images", () => {
    const images = Array.from({ length: 10 }, (_, i) => ({ ...okImage, position: i }))
    const parsed = createPhotoSubmissionSchema.safeParse({ title: "Carousel", images })
    expect(parsed.success).toBe(true)
  })

  it("rejects 0 images", () => {
    const parsed = createPhotoSubmissionSchema.safeParse({ title: "T", images: [] })
    expect(parsed.success).toBe(false)
  })

  it("rejects 11 images", () => {
    const images = Array.from({ length: 11 }, (_, i) => ({ ...okImage, position: i }))
    const parsed = createPhotoSubmissionSchema.safeParse({ title: "T", images })
    expect(parsed.success).toBe(false)
  })

  it("rejects duplicate positions", () => {
    const parsed = createPhotoSubmissionSchema.safeParse({
      title: "T",
      images: [okImage, { ...okImage, position: 0, filename: "b.jpg" }],
    })
    expect(parsed.success).toBe(false)
  })

  it("rejects non-contiguous positions starting at 1", () => {
    const parsed = createPhotoSubmissionSchema.safeParse({
      title: "T",
      images: [{ ...okImage, position: 1 }],
    })
    expect(parsed.success).toBe(false)
  })

  it("rejects unsupported mime types", () => {
    const parsed = createPhotoSubmissionSchema.safeParse({
      title: "T",
      images: [{ ...okImage, mimeType: "image/gif" as unknown as "image/jpeg" }],
    })
    expect(parsed.success).toBe(false)
  })

  it("rejects file > 8 MB", () => {
    const parsed = createPhotoSubmissionSchema.safeParse({
      title: "T",
      images: [{ ...okImage, sizeBytes: 8_388_609 }],
    })
    expect(parsed.success).toBe(false)
  })
})

describe("createPhotoVersionSchema", () => {
  it("accepts a valid revision payload", () => {
    const parsed = createPhotoVersionSchema.safeParse({ images: [okImage] })
    expect(parsed.success).toBe(true)
  })
})
