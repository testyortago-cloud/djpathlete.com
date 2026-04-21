import { describe, it, expect, vi } from "vitest"
import { runSendDailyPulse } from "../send-daily-pulse.js"

describe("runSendDailyPulse", () => {
  it("posts to the internal route with a bearer token", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            sentTo: "coach@example.com",
            subject: "Daily Pulse — Tue, Apr 21",
            isMondayEdition: false,
          }),
          { status: 200 },
        ),
    )

    const result = await runSendDailyPulse({
      fetchImpl,
      internalToken: "tok",
      appUrl: "https://app.local",
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.local/api/admin/internal/send-daily-pulse",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer tok" }),
      }),
    )
    expect(result.sentTo).toBe("coach@example.com")
    expect(result.isMondayEdition).toBe(false)
  })

  it("throws on non-200 responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("server broken", { status: 500 }))
    await expect(
      runSendDailyPulse({
        fetchImpl,
        internalToken: "tok",
        appUrl: "https://app.local",
      }),
    ).rejects.toThrow(/500/)
  })

  it("throws when INTERNAL_CRON_TOKEN is missing", async () => {
    await expect(
      runSendDailyPulse({ fetchImpl: vi.fn(), internalToken: "", appUrl: "https://app.local" }),
    ).rejects.toThrow(/INTERNAL_CRON_TOKEN/)
  })

  it("throws when APP_URL is missing", async () => {
    await expect(runSendDailyPulse({ fetchImpl: vi.fn(), internalToken: "tok", appUrl: "" })).rejects.toThrow(/APP_URL/)
  })
})
