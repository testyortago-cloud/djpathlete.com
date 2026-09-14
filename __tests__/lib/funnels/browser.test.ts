import { describe, expect, it } from "vitest"
import { chromeExecutablePath } from "@/lib/funnels/browser"

describe("chromeExecutablePath", () => {
  it("prefers an explicit PUPPETEER_EXECUTABLE_PATH over anything installed", () => {
    const chosen = chromeExecutablePath(
      { PUPPETEER_EXECUTABLE_PATH: "/custom/chrome" } as unknown as NodeJS.ProcessEnv,
      ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    )
    expect(chosen).toBe("/custom/chrome")
  })

  it("falls back to the first candidate that exists on disk", () => {
    // __filename is guaranteed to exist; the bogus path ahead of it proves the
    // function probes rather than taking the head of the list.
    const chosen = chromeExecutablePath({} as NodeJS.ProcessEnv, ["/nope/not/here", __filename])
    expect(chosen).toBe(__filename)
  })

  it("returns null when nothing is found — no browser is a normal outcome", () => {
    expect(chromeExecutablePath({} as NodeJS.ProcessEnv, ["/nope/not/here"])).toBeNull()
  })

  it("ignores an empty PUPPETEER_EXECUTABLE_PATH rather than launching ''", () => {
    expect(
      chromeExecutablePath({ PUPPETEER_EXECUTABLE_PATH: "" } as unknown as NodeJS.ProcessEnv, ["/nope"]),
    ).toBeNull()
  })
})
