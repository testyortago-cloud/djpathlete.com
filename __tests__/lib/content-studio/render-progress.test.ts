import { describe, it, expect } from "vitest"
import { renderPhase, formatElapsed } from "@/lib/content-studio/render-progress"

describe("renderPhase", () => {
  it("maps pending to queued and processing to rendering", () => {
    expect(renderPhase("pending")).toBe("queued")
    expect(renderPhase("processing")).toBe("rendering")
  })
  it("treats any non-pending status as rendering", () => {
    expect(renderPhase("streaming")).toBe("rendering")
  })
})

describe("formatElapsed", () => {
  it("formats milliseconds as m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00")
    expect(formatElapsed(5000)).toBe("0:05")
    expect(formatElapsed(65000)).toBe("1:05")
    expect(formatElapsed(600000)).toBe("10:00")
  })
  it("clamps negative input to 0:00", () => {
    expect(formatElapsed(-1000)).toBe("0:00")
  })
})
