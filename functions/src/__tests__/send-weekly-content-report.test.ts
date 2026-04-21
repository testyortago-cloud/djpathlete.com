import { describe, it, expect, vi } from "vitest"
import { runSendWeeklyContentReport } from "../send-weekly-content-report.js"

describe("runSendWeeklyContentReport", () => {
  it("posts to the internal route with a bearer token", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            sentTo: "coach@example.com",
            subject: "Weekly Content Report — Week of Apr 14",
            rangeStart: "2026-04-14T00:00:00Z",
            rangeEnd: "2026-04-21T00:00:00Z",
          }),
          { status: 200 },
        ),
    )

    const result = await runSendWeeklyContentReport({
      fetchImpl,
      internalToken: "tok",
      appUrl: "https://app.local",
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.local/api/admin/internal/send-weekly-report",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer tok" }),
      }),
    )
    expect(result.sentTo).toBe("coach@example.com")
  })

  it("strips trailing slashes from appUrl", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            sentTo: "c@e.com",
            subject: "s",
            rangeStart: "",
            rangeEnd: "",
          }),
          { status: 200 },
        ),
    )

    await runSendWeeklyContentReport({
      fetchImpl,
      internalToken: "tok",
      appUrl: "https://app.local/",
    })

    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toBe("https://app.local/api/admin/internal/send-weekly-report")
  })

  it("throws on non-200 responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("server broken", { status: 500 }))
    await expect(
      runSendWeeklyContentReport({
        fetchImpl,
        internalToken: "tok",
        appUrl: "https://app.local",
      }),
    ).rejects.toThrow(/500/)
  })

  it("throws when INTERNAL_CRON_TOKEN is missing", async () => {
    await expect(
      runSendWeeklyContentReport({
        fetchImpl: vi.fn(),
        internalToken: "",
        appUrl: "https://app.local",
      }),
    ).rejects.toThrow(/INTERNAL_CRON_TOKEN/)
  })

  it("throws when APP_URL is missing", async () => {
    await expect(
      runSendWeeklyContentReport({
        fetchImpl: vi.fn(),
        internalToken: "tok",
        appUrl: "",
      }),
    ).rejects.toThrow(/APP_URL/)
  })
})
