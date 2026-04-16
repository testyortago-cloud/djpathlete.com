import { describe, it, expect, vi, beforeEach } from "vitest"

const fromMock = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}))

vi.mock("@/lib/shop/order-number", () => ({
  generateOrderNumber: vi.fn(() => "DJP-TESTNUM"),
}))

import { generateOrderNumber } from "@/lib/shop/order-number"
import {
  canTransition,
  createOrder,
  getOrderById,
  getOrderByNumber,
  getOrderByStripeSessionId,
  updateOrder,
  updateOrderStatus,
  listOrders,
  findPendingOrdersOlderThan,
  getOrderStats,
} from "@/lib/db/shop-orders"
import type { ShopOrderStatus } from "@/types/database"

function chainable(data: unknown, error: unknown = null) {
  const chain: any = {}
  const methods = [
    "select",
    "eq",
    "in",
    "lt",
    "gte",
    "order",
    "insert",
    "update",
    "single",
    "limit",
    "range",
    "not",
  ]
  methods.forEach((m) => {
    chain[m] = vi.fn(() => chain)
  })
  chain.then = (resolve: (v: unknown) => void) => resolve({ data, error })
  chain.single = vi.fn().mockResolvedValue({ data, error })
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
  vi.mocked(generateOrderNumber).mockReturnValue("DJP-TESTNUM")
})

// ─── canTransition ────────────────────────────────────────────────────────────
describe("canTransition", () => {
  it("allows valid forward transitions", () => {
    expect(canTransition("pending", "paid")).toBe(true)
    expect(canTransition("paid", "draft")).toBe(true)
    expect(canTransition("draft", "confirmed")).toBe(true)
    expect(canTransition("confirmed", "in_production")).toBe(true)
    expect(canTransition("in_production", "shipped")).toBe(true)
  })

  it("blocks backward transitions", () => {
    expect(canTransition("shipped", "paid")).toBe(false)
    expect(canTransition("paid", "pending")).toBe(false)
    expect(canTransition("in_production", "draft")).toBe(false)
    expect(canTransition("shipped", "confirmed")).toBe(false)
  })

  it("always allows transition to canceled regardless of current status", () => {
    const statuses: ShopOrderStatus[] = [
      "pending", "paid", "draft", "confirmed", "in_production", "shipped",
    ]
    for (const from of statuses) {
      expect(canTransition(from, "canceled")).toBe(true)
    }
  })

  it("always allows transition to refunded regardless of current status", () => {
    const statuses: ShopOrderStatus[] = [
      "pending", "paid", "draft", "confirmed", "in_production", "shipped",
    ]
    for (const from of statuses) {
      expect(canTransition(from, "refunded")).toBe(true)
    }
  })

  it("blocks skipping status levels", () => {
    expect(canTransition("pending", "confirmed")).toBe(true) // skipping is still forward
    expect(canTransition("confirmed", "pending")).toBe(false)
  })
})

// ─── createOrder ─────────────────────────────────────────────────────────────
describe("createOrder", () => {
  const baseInput = {
    user_id: null,
    customer_email: "test@example.com",
    customer_name: "Test User",
    shipping_address: {
      name: "Test User",
      email: "test@example.com",
      phone: null,
      line1: "123 Main St",
      line2: null,
      city: "Austin",
      state: "TX",
      country: "US",
      postal_code: "78701",
    },
    status: "pending" as ShopOrderStatus,
    items: [],
    subtotal_cents: 2500,
    shipping_cents: 500,
    total_cents: 3000,
    notes: null,
  }

  it("successful insert with generated order_number", async () => {
    const inserted = { ...baseInput, id: "ord-1", order_number: "DJP-TESTNUM" }
    fromMock.mockReturnValueOnce(chainable(inserted))

    const result = await createOrder(baseInput)
    expect(result.order_number).toBe("DJP-TESTNUM")
    expect(result.id).toBe("ord-1")
    expect(fromMock).toHaveBeenCalledWith("shop_orders")
  })

  it("retries on 23505 unique constraint violation and succeeds", async () => {
    const err23505 = { code: "23505", message: "duplicate key" }
    const successData = { ...baseInput, id: "ord-2", order_number: "DJP-RETRY" }

    // First two calls return 23505, third succeeds
    vi.mocked(generateOrderNumber)
      .mockReturnValueOnce("DJP-COLLISION1")
      .mockReturnValueOnce("DJP-COLLISION2")
      .mockReturnValueOnce("DJP-RETRY")

    fromMock
      .mockReturnValueOnce(chainable(null, err23505))
      .mockReturnValueOnce(chainable(null, err23505))
      .mockReturnValueOnce(chainable(successData))

    const result = await createOrder(baseInput)
    expect(result.id).toBe("ord-2")
    expect(fromMock).toHaveBeenCalledTimes(3)
  })

  it("throws after 3 failed 23505 attempts", async () => {
    const err23505 = { code: "23505", message: "duplicate key" }

    vi.mocked(generateOrderNumber).mockReturnValue("DJP-COLLISION")
    fromMock
      .mockReturnValueOnce(chainable(null, err23505))
      .mockReturnValueOnce(chainable(null, err23505))
      .mockReturnValueOnce(chainable(null, err23505))

    await expect(createOrder(baseInput)).rejects.toThrow(
      "Failed to generate unique order_number after 3 attempts",
    )
    expect(fromMock).toHaveBeenCalledTimes(3)
  })

  it("throws immediately on non-23505 error", async () => {
    const otherErr = { code: "OTHER", message: "boom" }
    fromMock.mockReturnValueOnce(chainable(null, otherErr))

    await expect(createOrder(baseInput)).rejects.toMatchObject({ code: "OTHER" })
    expect(fromMock).toHaveBeenCalledTimes(1)
  })
})

// ─── getOrderById ─────────────────────────────────────────────────────────────
describe("getOrderById", () => {
  it("returns null on PGRST116", async () => {
    fromMock.mockReturnValueOnce(chainable(null, { code: "PGRST116" }))
    const result = await getOrderById("missing-id")
    expect(result).toBeNull()
  })

  it("returns order when found", async () => {
    const order = { id: "ord-1", order_number: "DJP-ABC123" }
    fromMock.mockReturnValueOnce(chainable(order))
    const result = await getOrderById("ord-1")
    expect(result).toEqual(order)
  })

  it("throws on non-PGRST116 error", async () => {
    fromMock.mockReturnValueOnce(chainable(null, { code: "OTHER", message: "fail" }))
    await expect(getOrderById("id")).rejects.toMatchObject({ code: "OTHER" })
  })
})

// ─── getOrderByNumber ─────────────────────────────────────────────────────────
describe("getOrderByNumber", () => {
  it("returns null on PGRST116", async () => {
    fromMock.mockReturnValueOnce(chainable(null, { code: "PGRST116" }))
    const result = await getOrderByNumber("DJP-MISSING")
    expect(result).toBeNull()
  })
})

// ─── getOrderByStripeSessionId ────────────────────────────────────────────────
describe("getOrderByStripeSessionId", () => {
  it("returns null on PGRST116", async () => {
    fromMock.mockReturnValueOnce(chainable(null, { code: "PGRST116" }))
    const result = await getOrderByStripeSessionId("cs_missing")
    expect(result).toBeNull()
  })
})

// ─── updateOrderStatus ────────────────────────────────────────────────────────
describe("updateOrderStatus", () => {
  it("throws on invalid backward transition (shipped → paid)", async () => {
    const existingOrder = {
      id: "ord-1",
      order_number: "DJP-ABC",
      status: "shipped" as ShopOrderStatus,
    }
    fromMock.mockReturnValueOnce(chainable(existingOrder))

    await expect(updateOrderStatus("ord-1", "paid")).rejects.toThrow(
      "Invalid status transition",
    )
  })

  it("no-ops when already at target status", async () => {
    const existingOrder = {
      id: "ord-1",
      order_number: "DJP-ABC",
      status: "paid" as ShopOrderStatus,
    }
    fromMock.mockReturnValueOnce(chainable(existingOrder))

    const result = await updateOrderStatus("ord-1", "paid")
    expect(result).toEqual(existingOrder)
    // fromMock called once for getOrderById, no second call for update
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it("calls updateOrder on valid transition", async () => {
    const existingOrder = {
      id: "ord-1",
      order_number: "DJP-ABC",
      status: "pending" as ShopOrderStatus,
    }
    const updated = { ...existingOrder, status: "paid" as ShopOrderStatus }

    fromMock
      .mockReturnValueOnce(chainable(existingOrder)) // getOrderById
      .mockReturnValueOnce(chainable(updated)) // updateOrder

    const result = await updateOrderStatus("ord-1", "paid")
    expect(result.status).toBe("paid")
  })

  it("throws when order not found", async () => {
    fromMock.mockReturnValueOnce(chainable(null, { code: "PGRST116" }))
    await expect(updateOrderStatus("missing", "paid")).rejects.toThrow("not found")
  })
})

// ─── listOrders ───────────────────────────────────────────────────────────────
describe("listOrders", () => {
  it("returns all orders when no filter provided", async () => {
    const rows = [{ id: "o1" }, { id: "o2" }]
    const chain = chainable(rows)
    fromMock.mockReturnValueOnce(chain)

    const result = await listOrders()
    expect(result).toEqual(rows)
    expect(fromMock).toHaveBeenCalledWith("shop_orders")
  })

  it("filters by single status using .eq()", async () => {
    const rows = [{ id: "o1", status: "paid" }]
    const chain = chainable(rows)
    fromMock.mockReturnValueOnce(chain)

    const result = await listOrders({ status: "paid" })
    expect(result).toEqual(rows)
    expect(chain.eq).toHaveBeenCalledWith("status", "paid")
  })

  it("filters by status array using .in()", async () => {
    const rows = [{ id: "o1", status: "confirmed" }, { id: "o2", status: "in_production" }]
    const chain = chainable(rows)
    fromMock.mockReturnValueOnce(chain)

    const result = await listOrders({ status: ["confirmed", "in_production"] })
    expect(result).toEqual(rows)
    expect(chain.in).toHaveBeenCalledWith("status", ["confirmed", "in_production"])
  })

  it("applies limit when provided", async () => {
    const chain = chainable([])
    fromMock.mockReturnValueOnce(chain)

    await listOrders({ limit: 10 })
    expect(chain.limit).toHaveBeenCalledWith(10)
  })
})

// ─── findPendingOrdersOlderThan ───────────────────────────────────────────────
describe("findPendingOrdersOlderThan", () => {
  it("queries status=pending and created_at < cutoff", async () => {
    const rows = [{ id: "o1", status: "pending" }]
    const chain = chainable(rows)
    fromMock.mockReturnValueOnce(chain)

    const before = Date.now()
    const result = await findPendingOrdersOlderThan(24)
    const after = Date.now()

    expect(result).toEqual(rows)
    expect(chain.eq).toHaveBeenCalledWith("status", "pending")

    // Verify lt was called with a cutoff timestamp that is ~24h before now
    const ltCall = chain.lt.mock.calls[0]
    expect(ltCall[0]).toBe("created_at")
    const cutoffMs = new Date(ltCall[1] as string).getTime()
    const expectedCutoff = before - 24 * 3600 * 1000
    // Allow 1 second tolerance
    expect(cutoffMs).toBeGreaterThanOrEqual(expectedCutoff - 1000)
    expect(cutoffMs).toBeLessThanOrEqual(after - 24 * 3600 * 1000 + 1000)
  })
})

// ─── getOrderStats ────────────────────────────────────────────────────────────
describe("getOrderStats", () => {
  it("returns stats object with correct shape using parallel queries", async () => {
    // today count
    fromMock.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockResolvedValue({ count: 3, error: null }),
    })
    // needs_action count (paid)
    fromMock.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ count: 2, error: null }),
    })
    // in_production count (confirmed + in_production)
    fromMock.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ count: 5, error: null }),
    })
    // shipped_this_week count
    fromMock.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockResolvedValue({ count: 1, error: null }),
    })
    // revenue (total_cents rows)
    fromMock.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{ total_cents: 3000 }, { total_cents: 2500 }],
        error: null,
      }),
    })

    const stats = await getOrderStats()
    expect(stats).toMatchObject({
      today: 3,
      needs_action: 2,
      in_production: 5,
      shipped_this_week: 1,
      revenue_all_time_cents: 5500,
    })
  })
})
