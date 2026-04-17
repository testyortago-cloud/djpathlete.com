import { afterEach, describe, expect, it, vi } from "vitest"
import { addContactToAudience } from "@/lib/shop/resend-audience"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

describe("addContactToAudience", () => {
  afterEach(() => mockFetch.mockReset())

  it("POSTs to /audiences/:id/contacts with tag in unsubscribed=false contact payload", async () => {
    process.env.RESEND_API_KEY = "re_test"
    process.env.RESEND_AUDIENCE_ID = "aud_1"
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "contact_abc" }), { status: 200 }),
    )
    const id = await addContactToAudience({
      email: "user@example.com",
      firstName: null,
      lastName: null,
      tag: "lead-magnet:comeback-code",
    })
    expect(id).toBe("contact_abc")
    const [url, init] = mockFetch.mock.calls[0]
    expect(String(url)).toContain("/audiences/aud_1/contacts")
    expect(init.headers.Authorization).toBe("Bearer re_test")
    const body = JSON.parse(init.body)
    expect(body.email).toBe("user@example.com")
    expect(body.unsubscribed).toBe(false)
  })

  it("throws on non-2xx", async () => {
    process.env.RESEND_API_KEY = "re_test"
    process.env.RESEND_AUDIENCE_ID = "aud_1"
    mockFetch.mockResolvedValueOnce(new Response("boom", { status: 500 }))
    await expect(
      addContactToAudience({
        email: "u@x.com",
        firstName: null,
        lastName: null,
        tag: "t",
      }),
    ).rejects.toThrow(/resend/i)
  })
})
