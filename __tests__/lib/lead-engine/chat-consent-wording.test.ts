// @vitest-environment node
//
// The chat assistant's two consent sentences, and the ONE gate that decides
// whether either of them may be shown or filed at all.
//
// `business_settings.display_name` is seeded `''` (migration 00212 — NOT NULL
// DEFAULT `''`), which is the state of production today and of the dev clone.
// A consent sentence that cannot name who is getting in touch is consent to
// nothing, so `hasChatConsentDisplayName` is checked by BOTH the card renderer
// (deciding whether to show the marketing tick) and the capture route
// (deciding whether a consent row may be filed). One verdict, both sides — the
// sentence shown and the sentence filed can never disagree.
import { describe, it, expect } from "vitest"
import {
  renderChatContactWording,
  renderChatMarketingWording,
  hasChatConsentDisplayName,
} from "@/lib/lead-engine/chat/consent-wording"

describe("chat consent wording", () => {
  it("names the business, because consent to hear from nobody is consent to nothing", () => {
    expect(renderChatMarketingWording("Acme Performance")).toContain("Acme Performance")
  })

  it("names the business in the contact sentence too", () => {
    expect(renderChatContactWording("Acme Performance")).toContain("Acme Performance")
  })

  it("tells the reader they can stop the marketing emails", () => {
    expect(renderChatMarketingWording("Acme Performance").toLowerCase()).toContain("unsubscribe")
  })

  it("keeps the two sentences distinct — asking to be contacted is not opting into marketing", () => {
    expect(renderChatContactWording("Acme Performance")).not.toBe(renderChatMarketingWording("Acme Performance"))
  })

  it("refuses a blank display name — production seeds it as an empty string", () => {
    expect(hasChatConsentDisplayName("")).toBe(false)
    expect(hasChatConsentDisplayName("   ")).toBe(false)
    expect(hasChatConsentDisplayName(null)).toBe(false)
    expect(hasChatConsentDisplayName(undefined)).toBe(false)
    expect(hasChatConsentDisplayName("Acme")).toBe(true)
  })
})
