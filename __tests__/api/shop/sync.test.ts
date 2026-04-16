import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}))

vi.mock("@/lib/shop/sync", () => ({
  syncPrintfulCatalog: vi.fn(),
}))

vi.mock("@/lib/db/shop-orders", () => ({
  findPendingOrdersOlderThan: vi.fn(),
  updateOrderStatus: vi.fn(),
}))

import { auth } from "@/lib/auth"
import { syncPrintfulCatalog } from "@/lib/shop/sync"
import { findPendingOrdersOlderThan, updateOrderStatus } from "@/lib/db/shop-orders"

const mockAuth = vi.mocked(auth)
const mockSyncPrintfulCatalog = vi.mocked(syncPrintfulCatalog)
const mockFindPendingOrdersOlderThan = vi.mocked(findPendingOrdersOlderThan)
const mockUpdateOrderStatus = vi.mocked(updateOrderStatus)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/shop/sync", () => {
  it("returns 403 when there is no session", async () => {
    mockAuth.mockResolvedValue(null as never)

    const { POST } = await import("@/app/api/shop/sync/route")
    const res = await POST()

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Forbidden")
    expect(mockSyncPrintfulCatalog).not.toHaveBeenCalled()
  })

  it("returns 403 when session user is not admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "client" } } as never)

    const { POST } = await import("@/app/api/shop/sync/route")
    const res = await POST()

    expect(res.status).toBe(403)
    expect(mockSyncPrintfulCatalog).not.toHaveBeenCalled()
  })

  it("returns 200 with sync result and stale_orders_canceled when admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
    mockSyncPrintfulCatalog.mockResolvedValue({ added: 2, updated: 1, deactivated_variants: 3 })
    mockFindPendingOrdersOlderThan.mockResolvedValue([
      { id: "order-1" } as never,
      { id: "order-2" } as never,
    ])
    mockUpdateOrderStatus.mockResolvedValue({} as never)

    const { POST } = await import("@/app/api/shop/sync/route")
    const res = await POST()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      added: 2,
      updated: 1,
      deactivated_variants: 3,
      stale_orders_canceled: 2,
    })
    expect(mockSyncPrintfulCatalog).toHaveBeenCalledOnce()
    expect(mockFindPendingOrdersOlderThan).toHaveBeenCalledWith(25)
    expect(mockUpdateOrderStatus).toHaveBeenCalledWith("order-1", "canceled")
    expect(mockUpdateOrderStatus).toHaveBeenCalledWith("order-2", "canceled")
  })

  it("returns 200 with stale_orders_canceled: 0 when no stale orders", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
    mockSyncPrintfulCatalog.mockResolvedValue({ added: 0, updated: 0, deactivated_variants: 0 })
    mockFindPendingOrdersOlderThan.mockResolvedValue([])

    const { POST } = await import("@/app/api/shop/sync/route")
    const res = await POST()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stale_orders_canceled).toBe(0)
  })

  it("still counts successful cancellations even when one updateOrderStatus throws", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
    mockSyncPrintfulCatalog.mockResolvedValue({ added: 0, updated: 0, deactivated_variants: 0 })
    mockFindPendingOrdersOlderThan.mockResolvedValue([
      { id: "order-ok" } as never,
      { id: "order-fail" } as never,
    ])
    mockUpdateOrderStatus
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error("DB error"))

    const { POST } = await import("@/app/api/shop/sync/route")
    const res = await POST()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stale_orders_canceled).toBe(1)
  })

  it("returns 500 when syncPrintfulCatalog throws", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
    mockSyncPrintfulCatalog.mockRejectedValue(new Error("Printful API down"))

    const { POST } = await import("@/app/api/shop/sync/route")
    const res = await POST()

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Printful API down")
  })
})
