import { describe, it, expect } from "vitest"
import { kindForMime, validateAttachmentSpecs, buildStoragePath } from "@/lib/messaging/attachments"
import { MAX_ATTACHMENT_BYTES } from "@/lib/messaging/config"
import { isValidEmoji } from "@/lib/messaging/reactions"

describe("kindForMime", () => {
  it("maps images and video", () => {
    expect(kindForMime("image/png")).toBe("image")
    expect(kindForMime("image/jpeg")).toBe("image")
    expect(kindForMime("video/mp4")).toBe("video")
    expect(kindForMime("video/quicktime")).toBe("video")
  })

  // A permissive fallback on a path that decides what gets STORED is a
  // correctness hole, not a convenience.
  it("returns null for anything not on the allowlist", () => {
    expect(kindForMime("application/pdf")).toBeNull()
    expect(kindForMime("text/plain")).toBeNull()
    expect(kindForMime("")).toBeNull()
  })
})

describe("validateAttachmentSpecs", () => {
  const img = (bytes: number) => ({ mime_type: "image/jpeg", byte_size: bytes })

  it("accepts a file of exactly the cap", () => {
    expect(validateAttachmentSpecs([img(MAX_ATTACHMENT_BYTES)]).ok).toBe(true)
  })

  it("rejects one byte over the cap", () => {
    const res = validateAttachmentSpecs([img(MAX_ATTACHMENT_BYTES + 1)])
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/25 MB/)
  })

  it("rejects a disallowed mime type", () => {
    const res = validateAttachmentSpecs([{ mime_type: "application/pdf", byte_size: 100 }])
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not supported/)
  })

  it("rejects more than five attachments but accepts five", () => {
    expect(validateAttachmentSpecs(Array(6).fill(img(10))).ok).toBe(false)
    expect(validateAttachmentSpecs(Array(5).fill(img(10))).ok).toBe(true)
  })

  it("rejects a zero or negative size", () => {
    expect(validateAttachmentSpecs([img(0)]).ok).toBe(false)
    expect(validateAttachmentSpecs([img(-1)]).ok).toBe(false)
  })

  it("accepts an empty list (a body-only message)", () => {
    expect(validateAttachmentSpecs([]).ok).toBe(true)
  })
})

describe("buildStoragePath", () => {
  it("sanitizes the filename and nests under the conversation", () => {
    expect(buildStoragePath("conv-1", "up-2", "my photo (1).png")).toBe("messaging/conv-1/up-2/my_photo_1_.png")
  })

  it("cannot be escaped with traversal segments", () => {
    const path = buildStoragePath("conv-1", "up-2", "../../etc/passwd")
    expect(path).toBe("messaging/conv-1/up-2/.._.._etc_passwd")
    expect(path).not.toContain("/../")
  })
})

describe("isValidEmoji", () => {
  it("accepts emoji including multi-codepoint sequences", () => {
    expect(isValidEmoji("👍")).toBe(true)
    expect(isValidEmoji("🎉")).toBe(true)
    expect(isValidEmoji("👨‍👩‍👧")).toBe(true)
    expect(isValidEmoji("🏋️‍♀️")).toBe(true)
  })

  it("rejects text, empty strings, bare digits, and long input", () => {
    expect(isValidEmoji("nice")).toBe(false)
    expect(isValidEmoji("")).toBe(false)
    expect(isValidEmoji("7")).toBe(false)
    expect(isValidEmoji("<script>")).toBe(false)
    expect(isValidEmoji("👍".repeat(10))).toBe(false)
  })
})
