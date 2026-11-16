import { describe, it, expect } from "vitest"
import { tiktokPostSettingsSchema } from "@/lib/validators/tiktok-post-settings"

const ok = {
  privacy_level: "SELF_ONLY",
  allow_comment: false,
  allow_duet: false,
  allow_stitch: false,
  disclose: false,
  your_brand: false,
  branded_content: false,
}

describe("tiktokPostSettingsSchema", () => {
  it("accepts a complete, consistent settings object", () =>
    expect(tiktokPostSettingsSchema.safeParse(ok).success).toBe(true))
  it("rejects a missing privacy level", () =>
    expect(tiktokPostSettingsSchema.safeParse({ ...ok, privacy_level: undefined }).success).toBe(false))
  it("rejects an unknown privacy level", () =>
    expect(tiktokPostSettingsSchema.safeParse({ ...ok, privacy_level: "PUBLIC" }).success).toBe(false))
  it("rejects disclose with neither brand box", () =>
    expect(
      tiktokPostSettingsSchema.safeParse({ ...ok, privacy_level: "PUBLIC_TO_EVERYONE", disclose: true }).success,
    ).toBe(false))
  it("rejects branded content that is private", () =>
    expect(tiktokPostSettingsSchema.safeParse({ ...ok, disclose: true, branded_content: true }).success).toBe(false))
  it("rejects a brand box without disclose", () =>
    expect(tiktokPostSettingsSchema.safeParse({ ...ok, your_brand: true }).success).toBe(false))
  it("accepts branded content that is public", () =>
    expect(
      tiktokPostSettingsSchema.safeParse({
        ...ok,
        privacy_level: "PUBLIC_TO_EVERYONE",
        disclose: true,
        branded_content: true,
      }).success,
    ).toBe(true))
  it("rejects unknown keys", () => expect(tiktokPostSettingsSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false))
})
