// __tests__/lib/social/tiktok.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createTikTokPlugin } from "@/lib/social/plugins/tiktok"

describe("TikTokPlugin (hybrid)", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("publish() sends push + email and returns a synthetic post id", async () => {
    const sendPushMock = vi.fn().mockResolvedValue(undefined)
    const sendEmailMock = vi.fn().mockResolvedValue(undefined)

    const plugin = createTikTokPlugin({
      user_email: "coach@example.com",
      fcm_token: "fcm_device_tok",
      sendPush: sendPushMock,
      sendEmail: sendEmailMock,
    })

    const result = await plugin.publish({
      content: "Hook caption #viral\n\nClipboard body here.",
      mediaUrl: "https://example.com/v.mp4",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toMatch(/^tiktok_pending_/)

    expect(sendPushMock).toHaveBeenCalledWith({
      token: "fcm_device_tok",
      title: expect.stringContaining("TikTok"),
      body: expect.stringContaining("ready"),
      data: expect.objectContaining({ caption: expect.any(String), mediaUrl: "https://example.com/v.mp4" }),
    })
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "coach@example.com",
        subject: expect.stringContaining("TikTok"),
      }),
    )
  })

  it("publish() still succeeds if push channel fails (email is fallback)", async () => {
    const sendPushMock = vi.fn().mockRejectedValue(new Error("FCM unreachable"))
    const sendEmailMock = vi.fn().mockResolvedValue(undefined)

    const plugin = createTikTokPlugin({
      user_email: "coach@example.com",
      fcm_token: "tok",
      sendPush: sendPushMock,
      sendEmail: sendEmailMock,
    })

    const result = await plugin.publish({
      content: "caption",
      mediaUrl: "https://example.com/v.mp4",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(sendEmailMock).toHaveBeenCalled()
  })

  it("fetchAnalytics() returns empty object (hybrid flow has no API analytics)", async () => {
    const plugin = createTikTokPlugin({
      user_email: "a",
      fcm_token: "b",
      sendPush: vi.fn(),
      sendEmail: vi.fn(),
    })
    const analytics = await plugin.fetchAnalytics("tiktok_pending_1")
    expect(analytics).toEqual({})
  })

  it("plugin.name is 'tiktok'", () => {
    const plugin = createTikTokPlugin({
      user_email: "a",
      fcm_token: "b",
      sendPush: vi.fn(),
      sendEmail: vi.fn(),
    })
    expect(plugin.name).toBe("tiktok")
  })
})
