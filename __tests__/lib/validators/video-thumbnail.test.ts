import { describe, it, expect } from "vitest"
import { z } from "zod"
import {
  customThumbnailUrlSchema,
  commitThumbnailSchema,
  autoThumbnailPath,
  customThumbnailPath,
  isLegalCustomThumbnailPath,
} from "@/lib/validators/video-thumbnail"
import { THUMBNAIL_SOURCES } from "@/types/database"

// THUMBNAIL_SOURCES is the runtime form of ThumbnailSource — a `const` array
// in types/database.ts, not a hand-typed mirror. Comparing the live schema
// against THIS (imported, not retyped) is what makes the cross-check able to
// fail in both directions: widen THUMBNAIL_SOURCES without touching the
// schema, or widen the schema without touching THUMBNAIL_SOURCES, and one of
// the two assertions below goes red. A hand-typed local copy could drift from
// either side silently; this cannot, because there is only one copy.

/**
 * Walk commitThumbnailSchema's discriminated-union options and read back the
 * literal `source` values each branch actually accepts, straight off the
 * live zod schema objects (ZodLiteral.values / ZodEnum.options) — not a
 * hand-typed list that could silently drift from the schema.
 */
function acceptedSourceValues(schema: typeof commitThumbnailSchema): string[] {
  const values: string[] = []
  for (const option of schema.options) {
    const sourceField = (option as z.ZodObject<{ source: z.ZodTypeAny }>).shape.source
    if (sourceField instanceof z.ZodLiteral) {
      values.push(...Array.from(sourceField.values as Set<string>))
    } else if (sourceField instanceof z.ZodEnum) {
      values.push(...(sourceField.options as string[]))
    } else {
      throw new Error(`unrecognized source field kind on schema option: ${String(sourceField)}`)
    }
  }
  return values
}

describe("video-thumbnail validators", () => {
  describe("customThumbnailUrlSchema", () => {
    it("accepts the three allowed thumbnail mime types", () => {
      for (const contentType of ["image/jpeg", "image/png", "image/webp"]) {
        expect(customThumbnailUrlSchema.safeParse({ contentType }).success).toBe(true)
      }
    })

    it("rejects a disallowed content type", () => {
      expect(customThumbnailUrlSchema.safeParse({ contentType: "application/pdf" }).success).toBe(false)
    })
  })

  describe("commitThumbnailSchema vs ThumbnailSource — runtime cross-check", () => {
    it("accepts exactly the members of ThumbnailSource, read off the schema at runtime", () => {
      const schemaValues = acceptedSourceValues(commitThumbnailSchema)
      expect(new Set(schemaValues)).toEqual(new Set(THUMBNAIL_SOURCES))
      expect(schemaValues).toHaveLength(THUMBNAIL_SOURCES.length)
    })

    it("parses every ThumbnailSource member through the actual schema", () => {
      expect(commitThumbnailSchema.safeParse({ source: "auto" }).success).toBe(true)
      expect(
        commitThumbnailSchema.safeParse({ source: "frame", thumbnailPath: "x" }).success,
      ).toBe(true)
      expect(
        commitThumbnailSchema.safeParse({ source: "upload", thumbnailPath: "x" }).success,
      ).toBe(true)
    })

    it("rejects a source outside ThumbnailSource", () => {
      expect(
        commitThumbnailSchema.safeParse({ source: "manual", thumbnailPath: "x" }).success,
      ).toBe(false)
    })
  })

  describe("customThumbnailPath", () => {
    it("derives a fresh path from storage_path and a timestamp", () => {
      expect(customThumbnailPath("videos/u/clip.mp4", 1700000000000)).toBe(
        "videos/u/clip.mp4.thumb-custom-1700000000000.jpg",
      )
    })

    it("never collides with the auto thumbnail's path", () => {
      const storagePath = "videos/u/clip.mp4"
      expect(customThumbnailPath(storagePath, Date.now())).not.toBe(autoThumbnailPath(storagePath))
    })
  })

  describe("isLegalCustomThumbnailPath", () => {
    const storagePath = "videos/u/clip.mp4"

    it("accepts a path this video's own custom-thumbnail path shape", () => {
      expect(isLegalCustomThumbnailPath(storagePath, customThumbnailPath(storagePath, 123))).toBe(true)
    })

    it("rejects a path belonging to a different video", () => {
      expect(
        isLegalCustomThumbnailPath(storagePath, "videos/u/other.mp4.thumb-custom-123.jpg"),
      ).toBe(false)
    })

    it("rejects the auto thumbnail's own path", () => {
      expect(isLegalCustomThumbnailPath(storagePath, autoThumbnailPath(storagePath))).toBe(false)
    })

    it("rejects a non-numeric suffix", () => {
      expect(
        isLegalCustomThumbnailPath(storagePath, `${storagePath}.thumb-custom-abc.jpg`),
      ).toBe(false)
    })
  })
})
