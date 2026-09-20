// @vitest-environment node
//
// G06. `browserTimezone` sits in front of eight public lead forms, so its two
// defensive arms matter more than its happy path: whatever it returns is
// stored fill-only and never corrected, and whatever it THROWS would break a
// lead form over a scheduling nicety.
import { describe, it, expect, vi, afterEach } from "vitest"
import { browserTimezone } from "@/lib/browser-timezone"

const realDTF = Intl.DateTimeFormat

afterEach(() => {
  Intl.DateTimeFormat = realDTF
  vi.restoreAllMocks()
})

describe("browserTimezone", () => {
  it("returns the runtime's own zone, which is a zone the writer will accept", () => {
    const tz = browserTimezone()
    expect(typeof tz).toBe("string")
    // Not just "a string came back": it has to survive `Intl`, or the DAL
    // discards it and the whole helper is decoration.
    expect(() => new Intl.DateTimeFormat("en-US", { timeZone: tz as string })).not.toThrow()
  })

  it("returns undefined rather than throwing when the environment refuses", () => {
    // A locked-down or instrumented browser can make this throw. A lead form
    // must not break over it.
    Intl.DateTimeFormat = (() => {
      throw new Error("blocked by policy")
    }) as unknown as typeof Intl.DateTimeFormat

    expect(() => browserTimezone()).not.toThrow()
    expect(browserTimezone()).toBeUndefined()
  })

  it("returns undefined for an empty zone, never an empty string", () => {
    // An empty string is falsy but would still serialise as a key. undefined
    // is dropped by JSON.stringify, which is what keeps the field absent
    // rather than present-and-blank.
    Intl.DateTimeFormat = (() =>
      ({ resolvedOptions: () => ({ timeZone: "" }) }) as unknown as Intl.DateTimeFormat) as unknown as typeof Intl.DateTimeFormat

    expect(browserTimezone()).toBeUndefined()
  })
})
