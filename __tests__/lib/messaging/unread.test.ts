import { describe, it, expect } from "vitest"
import { unreadCount, previewFor } from "@/lib/messaging/unread"
import type { MessageSenderRole } from "@/types/database"

const msg = (created_at: string, sender_role: MessageSenderRole) => ({ created_at, sender_role })

describe("unreadCount", () => {
  const messages = [
    msg("2024-03-01T10:00:00Z", "client"),
    msg("2024-03-01T11:00:00Z", "admin"),
    msg("2024-03-01T12:00:00Z", "client"),
  ]

  it("counts only messages from the other side", () => {
    expect(unreadCount(messages, null, "admin")).toBe(2)
  })

  it("never counts your own messages", () => {
    expect(unreadCount(messages, null, "client")).toBe(1)
  })

  // Marking read stamps `now`, so the boundary message IS read. An off-by-one
  // here shows a permanent phantom unread badge that reading cannot clear.
  it("excludes a message sent at exactly last_read_at", () => {
    expect(unreadCount(messages, "2024-03-01T12:00:00Z", "admin")).toBe(0)
  })

  it("counts a message sent one millisecond after last_read_at", () => {
    expect(unreadCount(messages, "2024-03-01T11:59:59.999Z", "admin")).toBe(1)
  })

  it("is zero for an empty thread", () => {
    expect(unreadCount([], null, "admin")).toBe(0)
  })
})

describe("previewFor", () => {
  it("prefers the body over the attachment description", () => {
    expect(previewFor("Nice squat", 1, "image")).toBe("Nice squat")
  })

  it("truncates a long body to 120 characters", () => {
    expect(previewFor("x".repeat(200), 0, null)).toHaveLength(120)
  })

  it("describes an attachment-only message", () => {
    expect(previewFor(null, 1, "image")).toBe("Photo")
    expect(previewFor("", 1, "video")).toBe("Video")
    expect(previewFor(null, 3, "image")).toBe("3 photos")
    expect(previewFor(null, 2, "video")).toBe("2 videos")
  })

  it("is empty when there is nothing to describe", () => {
    expect(previewFor(null, 0, null)).toBe("")
    expect(previewFor("   ", 0, null)).toBe("")
  })
})
