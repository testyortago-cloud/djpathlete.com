import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useCart, type CartLine } from "@/lib/shop/cart"

const KEY = "djp_shop_cart"

describe("useCart", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("starts empty when localStorage has no key", () => {
    const { result } = renderHook(() => useCart())
    expect(result.current.lines).toEqual([])
    expect(result.current.totalItems).toBe(0)
    expect(result.current.hasItems).toBe(false)
  })

  it("restores from localStorage on mount", () => {
    const stored: CartLine[] = [
      { variant_id: "v1", quantity: 2 },
      { variant_id: "v2", quantity: 3 },
    ]
    localStorage.setItem(KEY, JSON.stringify(stored))

    const { result } = renderHook(() => useCart())
    expect(result.current.lines).toEqual(stored)
    expect(result.current.totalItems).toBe(5)
    expect(result.current.hasItems).toBe(true)
  })

  it("addItem increments quantity if same variant_id", () => {
    const { result } = renderHook(() => useCart())

    act(() => {
      result.current.addItem("v1", 2)
    })
    expect(result.current.lines).toEqual([{ variant_id: "v1", quantity: 2 }])
    expect(result.current.totalItems).toBe(2)

    act(() => {
      result.current.addItem("v1", 3)
    })
    expect(result.current.lines).toEqual([{ variant_id: "v1", quantity: 5 }])
    expect(result.current.totalItems).toBe(5)
  })

  it("addItem caps quantity at 99", () => {
    const { result } = renderHook(() => useCart())

    act(() => {
      result.current.addItem("v1", 100)
    })
    expect(result.current.lines[0].quantity).toBe(99)

    act(() => {
      result.current.addItem("v1", 50)
    })
    // 99 + 50 = 149, capped at 99
    expect(result.current.lines[0].quantity).toBe(99)
  })

  it("addItem defaults to quantity 1", () => {
    const { result } = renderHook(() => useCart())

    act(() => {
      result.current.addItem("v1")
    })
    expect(result.current.lines).toEqual([{ variant_id: "v1", quantity: 1 }])
  })

  it("removeItem removes the entry", () => {
    const { result } = renderHook(() => useCart())

    act(() => {
      result.current.addItem("v1", 2)
      result.current.addItem("v2", 3)
    })
    expect(result.current.lines.length).toBe(2)

    act(() => {
      result.current.removeItem("v1")
    })
    expect(result.current.lines).toEqual([{ variant_id: "v2", quantity: 3 }])
    expect(result.current.totalItems).toBe(3)
    expect(result.current.hasItems).toBe(true)
  })

  it("updateQuantity updates the quantity", () => {
    const { result } = renderHook(() => useCart())

    act(() => {
      result.current.addItem("v1", 2)
    })

    act(() => {
      result.current.updateQuantity("v1", 5)
    })
    expect(result.current.lines).toEqual([{ variant_id: "v1", quantity: 5 }])
    expect(result.current.totalItems).toBe(5)
  })

  it("updateQuantity removes when <= 0", () => {
    const { result } = renderHook(() => useCart())

    act(() => {
      result.current.addItem("v1", 2)
      result.current.addItem("v2", 3)
    })

    act(() => {
      result.current.updateQuantity("v1", 0)
    })
    expect(result.current.lines).toEqual([{ variant_id: "v2", quantity: 3 }])

    act(() => {
      result.current.updateQuantity("v2", -1)
    })
    expect(result.current.lines).toEqual([])
    expect(result.current.hasItems).toBe(false)
  })

  it("updateQuantity caps at 99", () => {
    const { result } = renderHook(() => useCart())

    act(() => {
      result.current.addItem("v1", 1)
    })

    act(() => {
      result.current.updateQuantity("v1", 200)
    })
    expect(result.current.lines[0].quantity).toBe(99)
  })

  it("clear empties the cart", () => {
    const { result } = renderHook(() => useCart())

    act(() => {
      result.current.addItem("v1", 2)
      result.current.addItem("v2", 3)
    })
    expect(result.current.lines.length).toBe(2)

    act(() => {
      result.current.clear()
    })
    expect(result.current.lines).toEqual([])
    expect(result.current.totalItems).toBe(0)
    expect(result.current.hasItems).toBe(false)
  })

  it("persists to localStorage after every mutation", () => {
    const { result } = renderHook(() => useCart())

    act(() => {
      result.current.addItem("v1", 2)
    })
    let stored = JSON.parse(localStorage.getItem(KEY) || "[]") as CartLine[]
    expect(stored).toEqual([{ variant_id: "v1", quantity: 2 }])

    act(() => {
      result.current.addItem("v2", 3)
    })
    stored = JSON.parse(localStorage.getItem(KEY) || "[]") as CartLine[]
    expect(stored).toEqual([
      { variant_id: "v1", quantity: 2 },
      { variant_id: "v2", quantity: 3 },
    ])

    act(() => {
      result.current.updateQuantity("v1", 5)
    })
    stored = JSON.parse(localStorage.getItem(KEY) || "[]") as CartLine[]
    expect(stored).toEqual([
      { variant_id: "v1", quantity: 5 },
      { variant_id: "v2", quantity: 3 },
    ])

    act(() => {
      result.current.removeItem("v1")
    })
    stored = JSON.parse(localStorage.getItem(KEY) || "[]") as CartLine[]
    expect(stored).toEqual([{ variant_id: "v2", quantity: 3 }])

    act(() => {
      result.current.clear()
    })
    stored = JSON.parse(localStorage.getItem(KEY) || "[]") as CartLine[]
    expect(stored).toEqual([])
  })

  it("totalItems sums quantities correctly", () => {
    const { result } = renderHook(() => useCart())

    act(() => {
      result.current.addItem("v1", 5)
      result.current.addItem("v2", 10)
      result.current.addItem("v3", 3)
    })
    expect(result.current.totalItems).toBe(18)
  })

  it("hasItems reflects cart state correctly", () => {
    const { result } = renderHook(() => useCart())

    expect(result.current.hasItems).toBe(false)

    act(() => {
      result.current.addItem("v1", 1)
    })
    expect(result.current.hasItems).toBe(true)

    act(() => {
      result.current.removeItem("v1")
    })
    expect(result.current.hasItems).toBe(false)
  })

  it("filters out invalid items when reading from localStorage", () => {
    // Store invalid data
    const invalid = [
      { variant_id: "v1", quantity: 2 },
      { variant_id: "v2", quantity: 0 }, // quantity should be > 0
      { variant_id: "v3" }, // missing quantity
      { quantity: 5 }, // missing variant_id
    ]
    localStorage.setItem(KEY, JSON.stringify(invalid))

    const { result } = renderHook(() => useCart())
    // Only v1 should be kept
    expect(result.current.lines).toEqual([{ variant_id: "v1", quantity: 2 }])
  })

  it("handles corrupt localStorage gracefully", () => {
    localStorage.setItem(KEY, "not valid json")

    const { result } = renderHook(() => useCart())
    expect(result.current.lines).toEqual([])
    expect(result.current.totalItems).toBe(0)
  })

  it("handles non-array data in localStorage gracefully", () => {
    localStorage.setItem(KEY, JSON.stringify({ variant_id: "v1", quantity: 2 }))

    const { result } = renderHook(() => useCart())
    expect(result.current.lines).toEqual([])
    expect(result.current.totalItems).toBe(0)
  })
})
