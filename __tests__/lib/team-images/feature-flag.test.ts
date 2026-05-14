import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { isTeamImagesEnabled } from "@/lib/team-images/feature-flag"

const originalEnv = process.env.NEXT_PUBLIC_TEAM_IMAGES_ENABLED

afterEach(() => {
  process.env.NEXT_PUBLIC_TEAM_IMAGES_ENABLED = originalEnv
})

describe("isTeamImagesEnabled", () => {
  it("returns true when env var is 'true'", () => {
    process.env.NEXT_PUBLIC_TEAM_IMAGES_ENABLED = "true"
    expect(isTeamImagesEnabled()).toBe(true)
  })
  it("returns false when env var is missing", () => {
    delete process.env.NEXT_PUBLIC_TEAM_IMAGES_ENABLED
    expect(isTeamImagesEnabled()).toBe(false)
  })
  it("returns false when env var is 'false'", () => {
    process.env.NEXT_PUBLIC_TEAM_IMAGES_ENABLED = "false"
    expect(isTeamImagesEnabled()).toBe(false)
  })
})
