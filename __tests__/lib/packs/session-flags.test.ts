import { describe, it, expect, vi, beforeEach } from "vitest"

const getSettingMock = vi.fn()
vi.mock("@/lib/db/system-settings", () => ({ getSetting: (...a: unknown[]) => getSettingMock(...a) }))

import {
  recurringSessionsEnabled,
  cardOnFileEnabled,
  sessionMembershipsEnabled,
  sessionFeesEnabled,
  noShowFeeCents,
  lateCancelFeeCents,
  cancelWindowHours,
  RECURRING_SESSIONS_KEY,
  NO_SHOW_FEE_CENTS_KEY,
} from "@/lib/packs/flags"

beforeEach(() => vi.clearAllMocks())

describe("session phase flags + fee config", () => {
  it("all four phase flags default to false", async () => {
    getSettingMock.mockImplementation(async (_k: string, fallback: boolean) => fallback)
    expect(await recurringSessionsEnabled()).toBe(false)
    expect(await cardOnFileEnabled()).toBe(false)
    expect(await sessionMembershipsEnabled()).toBe(false)
    expect(await sessionFeesEnabled()).toBe(false)
  })

  it("fee amounts default to 0 and cancel window to 12h (safe / no-op)", async () => {
    getSettingMock.mockImplementation(async (_k: string, fallback: number) => fallback)
    expect(await noShowFeeCents()).toBe(0)
    expect(await lateCancelFeeCents()).toBe(0)
    expect(await cancelWindowHours()).toBe(12)
  })

  it("reads under the documented keys", async () => {
    getSettingMock.mockResolvedValue(true)
    await recurringSessionsEnabled()
    expect(getSettingMock).toHaveBeenCalledWith(RECURRING_SESSIONS_KEY, false)
    getSettingMock.mockResolvedValue(500)
    await noShowFeeCents()
    expect(getSettingMock).toHaveBeenCalledWith(NO_SHOW_FEE_CENTS_KEY, 0)
  })
})
