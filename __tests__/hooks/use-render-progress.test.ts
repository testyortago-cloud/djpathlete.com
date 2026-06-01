import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

// Capture the onValue callback so the test can drive snapshots, and the unsub fn.
let valueCb: ((snap: { exists: () => boolean; val: () => unknown }) => void) | null = null
const unsub = vi.fn()
vi.mock("firebase/database", () => ({
  ref: (_db: unknown, path: string) => ({ path }),
  onValue: (_ref: unknown, cb: typeof valueCb) => {
    valueCb = cb
    return unsub
  },
}))
vi.mock("@/lib/firebase", () => ({ rtdb: {} }))

import { useRenderProgress } from "@/hooks/use-render-progress"

describe("useRenderProgress", () => {
  beforeEach(() => {
    valueCb = null
    unsub.mockClear()
  })

  it("returns null and does not subscribe when jobId is null", () => {
    const { result } = renderHook(() => useRenderProgress(null))
    expect(result.current).toBeNull()
    expect(valueCb).toBeNull()
  })

  it("returns the snapshot value when the node exists", () => {
    const { result } = renderHook(() => useRenderProgress("job-1"))
    expect(result.current).toBeNull() // before any snapshot arrives
    const sample = { progress: 0.42, pct: 42, stage: "rendering", updatedAt: 1 }
    act(() => valueCb?.({ exists: () => true, val: () => sample }))
    expect(result.current).toEqual(sample)
  })

  it("returns null when the node does not exist", () => {
    const { result } = renderHook(() => useRenderProgress("job-1"))
    act(() => valueCb?.({ exists: () => false, val: () => null }))
    expect(result.current).toBeNull()
  })

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useRenderProgress("job-1"))
    unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })
})
