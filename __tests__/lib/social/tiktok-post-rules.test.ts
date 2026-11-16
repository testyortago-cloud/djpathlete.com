import { describe, it, expect } from "vitest"
import {
  creatorInfoRefusal,
  disclosureLabel,
  emptyDraft,
  prefillDraft,
  submitBlocker,
  toSettings,
  type TikTokCreatorInfo,
  type TikTokDraft,
} from "@/lib/social/tiktok-post-rules"
import type { TikTokPostSettings } from "@/lib/validators/tiktok-post-settings"

const creator: TikTokCreatorInfo = {
  avatarUrl: null,
  username: "coach",
  nickname: "Coach",
  maxVideoPostDurationSec: 600,
  privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
  commentDisabled: false,
  duetDisabled: true,
  stitchDisabled: false,
}

const saved: TikTokPostSettings = {
  privacy_level: "PUBLIC_TO_EVERYONE",
  allow_comment: false,
  allow_duet: false,
  allow_stitch: false,
  disclose: false,
  your_brand: false,
  branded_content: false,
}

const pub = (over: Partial<TikTokDraft> = {}): TikTokDraft => ({
  ...emptyDraft(),
  privacy_level: "PUBLIC_TO_EVERYONE",
  ...over,
})

describe("emptyDraft", () => {
  it("has no privacy and every box off", () => {
    expect(emptyDraft()).toEqual({
      privacy_level: null,
      allow_comment: false,
      allow_duet: false,
      allow_stitch: false,
      disclose: false,
      your_brand: false,
      branded_content: false,
    })
  })
})

describe("prefillDraft", () => {
  it("gives the empty draft when nothing is saved", () => {
    expect(prefillDraft(null, creator)).toEqual(emptyDraft())
  })
  it("drops a saved privacy level the account no longer offers", () => {
    expect(prefillDraft({ ...saved, privacy_level: "FOLLOWER_OF_CREATOR" }, creator).privacy_level).toBeNull()
  })
  it("turns off an interaction the account has disabled", () => {
    expect(prefillDraft({ ...saved, allow_duet: true }, creator).allow_duet).toBe(false)
  })
  it("keeps a saved privacy level and interaction that are still allowed", () => {
    const d = prefillDraft({ ...saved, allow_comment: true }, creator)
    expect(d.privacy_level).toBe("PUBLIC_TO_EVERYONE")
    expect(d.allow_comment).toBe(true)
  })
})

describe("submitBlocker", () => {
  it("waits for the duration", () => {
    expect(submitBlocker(emptyDraft(), creator, null)).toBe("Loading the video…")
  })
  it("refuses a video that is too long, before anything else", () => {
    expect(submitBlocker(emptyDraft(), creator, 601)).toBe(
      "This video is 601 seconds long. TikTok allows up to 600 seconds for this account.",
    )
  })
  it("asks for a privacy level", () => {
    expect(submitBlocker(emptyDraft(), creator, 30)).toBe("Choose who can view this video.")
  })
  it("asks which kind of promotion when disclosure is on but neither box is ticked", () => {
    expect(submitBlocker(pub({ disclose: true }), creator, 30)).toBe(
      "You need to indicate if your content promotes yourself, a third party, or both.",
    )
  })
  it("refuses branded content that is private", () => {
    expect(submitBlocker(pub({ privacy_level: "SELF_ONLY", disclose: true, branded_content: true }), creator, 30)).toBe(
      "Branded content can't be private. Choose another audience.",
    )
  })
  it("lets a complete draft through", () => {
    expect(submitBlocker(pub(), creator, 30)).toBeNull()
  })
})

describe("disclosureLabel", () => {
  it("is null when disclosure is off", () => {
    expect(disclosureLabel(pub({ your_brand: true }))).toBeNull()
  })
  it("is null when disclosure is on with neither box", () => {
    expect(disclosureLabel(pub({ disclose: true }))).toBeNull()
  })
  it("says promotional content for your own brand", () => {
    expect(disclosureLabel(pub({ disclose: true, your_brand: true }))).toBe(
      'Your photo/video will be labeled as "Promotional content"',
    )
  })
  it("says paid partnership for branded content", () => {
    expect(disclosureLabel(pub({ disclose: true, branded_content: true }))).toBe(
      'Your photo/video will be labeled as "Paid partnership"',
    )
  })
  it("says paid partnership when both are ticked", () => {
    expect(disclosureLabel(pub({ disclose: true, your_brand: true, branded_content: true }))).toBe(
      'Your photo/video will be labeled as "Paid partnership"',
    )
  })
})

describe("toSettings", () => {
  it("throws when no privacy level is chosen", () => {
    expect(() => toSettings(emptyDraft())).toThrow()
  })
  it("returns the same fields with the privacy level narrowed", () => {
    expect(toSettings(pub({ allow_comment: true }))).toEqual({ ...saved, allow_comment: true })
  })
})

describe("creatorInfoRefusal", () => {
  it.each([
    ["spam_risk_too_many_posts", "This TikTok account has reached today's posting limit. Try again tomorrow."],
    ["spam_risk_user_banned_from_posting", "TikTok has stopped this account from posting right now."],
    ["reached_active_user_cap", "TikTok's daily limit for this app has been reached. Try again tomorrow."],
    ["token_invalid", "The TikTok connection has expired. Reconnect TikTok on the Connections page."],
  ])("explains %s in plain words", (code, text) => {
    expect(creatorInfoRefusal(code, "x")).toBe(text)
  })
  it("passes TikTok's own message through for an unknown code", () => {
    expect(creatorInfoRefusal("other_code", "Some message")).toBe("TikTok said: Some message")
  })
  it("falls back to the code when there is no message", () => {
    expect(creatorInfoRefusal("other_code", "")).toBe("TikTok said: other_code")
  })
})
