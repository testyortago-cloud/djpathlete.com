// __tests__/lib/social/linkedin.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createLinkedInPlugin } from "@/lib/social/plugins/linkedin"

describe("LinkedInPlugin", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("publish() POSTs a UGC post with author=urn:li:organization:{id}", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: "urn:li:share:ABC" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const result = await plugin.publish({
      content: "A coaching insight post for the DJP audience.",
      mediaUrl: null,
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("urn:li:share:ABC")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("linkedin.com/v2/ugcPosts")
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok",
      "X-Restli-Protocol-Version": "2.0.0",
    })
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.author).toBe("urn:li:organization:123456")
    expect(body.lifecycleState).toBe("PUBLISHED")
    expect(body.specificContent["com.linkedin.ugc.ShareContent"].shareCommentary.text).toBe(
      "A coaching insight post for the DJP audience.",
    )
    expect(body.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory).toBe("NONE")
  })

  it("publish() uses shareMediaCategory=ARTICLE when mediaUrl looks like a web link", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: "urn:li:share:DEF" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    await plugin.publish({
      content: "Check out our new blog post",
      mediaUrl: "https://djpathlete.com/blog/new-article",
      scheduledAt: null,
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory).toBe("ARTICLE")
    expect(body.specificContent["com.linkedin.ugc.ShareContent"].media[0].originalUrl).toBe(
      "https://djpathlete.com/blog/new-article",
    )
  })

  it("publish() returns failure text on 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ message: "Token expired" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "bad", organization_id: "123456" })
    const result = await plugin.publish({ content: "x", mediaUrl: null, scheduledAt: null })
    expect(result.success).toBe(false)
    expect(result.error).toContain("Token expired")
  })

  it("getSetupInstructions() mentions Company Page + Marketing Developer Platform", async () => {
    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const instructions = await plugin.getSetupInstructions()
    expect(instructions).toMatch(/Company Page/i)
    expect(instructions).toMatch(/Marketing Developer Platform/i)
  })
})
