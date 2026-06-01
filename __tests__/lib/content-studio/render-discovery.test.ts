import { describe, expect, it } from "vitest"
import { hasUntrackedRender } from "@/lib/content-studio/render-discovery"

describe("hasUntrackedRender", () => {
  it("is false when nothing is rendering live", () => {
    expect(hasUntrackedRender(new Set(), new Set(["a"]))).toBe(false)
    expect(hasUntrackedRender(new Set(), new Set())).toBe(false)
  })

  it("is false when every live render is already known to the server snapshot", () => {
    expect(hasUntrackedRender(new Set(["a", "b"]), new Set(["a", "b", "c"]))).toBe(false)
  })

  it("is true when a live render is NOT yet in the known set (newly started)", () => {
    // 'x' just started (in Firestore) but the board's server snapshot only knows 'a'.
    expect(hasUntrackedRender(new Set(["a", "x"]), new Set(["a"]))).toBe(true)
    expect(hasUntrackedRender(new Set(["x"]), new Set())).toBe(true)
  })
})
