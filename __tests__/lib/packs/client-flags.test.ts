import { describe, it, expect, vi, beforeEach } from "vitest"

const getSettingMock = vi.fn()
vi.mock("@/lib/db/system-settings", () => ({ getSetting: (...a: unknown[]) => getSettingMock(...a) }))

import {
  clientPackBalanceEnabled,
  clientSelfCheckinEnabled,
  clientSelfPurchaseEnabled,
  CLIENT_PACK_BALANCE_KEY,
} from "@/lib/packs/flags"

beforeEach(() => vi.clearAllMocks())

describe("client pack flags", () => {
  it("defaults each flag to false", async () => {
    getSettingMock.mockImplementation(async (_k: string, fallback: boolean) => fallback)
    expect(await clientPackBalanceEnabled()).toBe(false)
    expect(await clientSelfCheckinEnabled()).toBe(false)
    expect(await clientSelfPurchaseEnabled()).toBe(false)
  })

  it("reads the balance flag under the right key with false default", async () => {
    getSettingMock.mockResolvedValue(true)
    expect(await clientPackBalanceEnabled()).toBe(true)
    expect(getSettingMock).toHaveBeenCalledWith(CLIENT_PACK_BALANCE_KEY, false)
  })
})
