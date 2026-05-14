import { describe, it, expect, vi } from "vitest"
import {
  latestSignal,
  insertPreflightFailedSignal,
} from "@/lib/db/cross-channel-signals"

describe("cross_channel_signals DAL", () => {
  it("latestSignal returns the most recent row", async () => {
    const sb = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "s1", preflight_status: "ok" },
        error: null,
      }),
    }
    const row = await latestSignal(sb as never)
    expect(row?.id).toBe("s1")
  })

  it("insertPreflightFailedSignal writes status=failed with reasons", async () => {
    const insert = vi.fn().mockReturnThis()
    const sb = {
      from: vi.fn().mockReturnThis(),
      insert,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "s2" }, error: null }),
    }
    await insertPreflightFailedSignal(sb as never, "2026-05-09", ["sparse memos"])
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        preflight_status: "failed",
        preflight_reasons: ["sparse memos"],
        week_of: "2026-05-09",
      }),
    )
  })
})
