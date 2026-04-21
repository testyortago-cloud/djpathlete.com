import { afterEach, describe, expect, it } from "vitest"
import { isContentStudioEnabled } from "@/lib/content-studio/feature-flag"

describe("content studio feature flag", () => {
  const origEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...origEnv }
  })

  it("is disabled by default", () => {
    delete process.env.CONTENT_STUDIO_ENABLED
    expect(isContentStudioEnabled()).toBe(false)
  })

  it("is enabled when env var is 'true'", () => {
    process.env.CONTENT_STUDIO_ENABLED = "true"
    expect(isContentStudioEnabled()).toBe(true)
  })

  it("is disabled when env var is anything other than 'true'", () => {
    process.env.CONTENT_STUDIO_ENABLED = "1"
    expect(isContentStudioEnabled()).toBe(false)
    process.env.CONTENT_STUDIO_ENABLED = "yes"
    expect(isContentStudioEnabled()).toBe(false)
    process.env.CONTENT_STUDIO_ENABLED = ""
    expect(isContentStudioEnabled()).toBe(false)
  })
})
