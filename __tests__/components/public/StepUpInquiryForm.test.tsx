// __tests__/components/public/StepUpInquiryForm.test.tsx
//
// `StepUpInquiryForm` (the async server wrapper) decides whether
// StepUpInquiryFormClient gets any `smsConsentWording` at all. See
// InquiryForm.test.tsx's header comment for the full reasoning — identical
// here.

import { describe, expect, it, vi, beforeEach } from "vitest"

const getBusinessSettings = vi.fn()

vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: (...a: unknown[]) => getBusinessSettings(...a),
}))

import { StepUpInquiryForm } from "@/components/public/StepUpInquiryForm"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wordingOf(element: any): string | undefined {
  return element.props.smsConsentWording
}

beforeEach(() => {
  getBusinessSettings.mockReset()
})

describe("StepUpInquiryForm (server wrapper) — SMS consent wording gate", () => {
  it("passes no wording when the settings read fails", async () => {
    getBusinessSettings.mockRejectedValue(new Error("db unreachable"))
    const element = await StepUpInquiryForm()
    expect(wordingOf(element)).toBeUndefined()
  })

  it("passes no wording when display_name is blank", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "" })
    const element = await StepUpInquiryForm()
    expect(wordingOf(element)).toBeUndefined()
  })

  it("passes no wording when display_name is whitespace-only", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "   " })
    const element = await StepUpInquiryForm()
    expect(wordingOf(element)).toBeUndefined()
  })

  it("passes the rendered wording when display_name is set", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "Acme Fitness" })
    const element = await StepUpInquiryForm()
    expect(wordingOf(element)).toBe(
      "I agree to receive text messages from Acme Fitness about my inquiry. Message and data rates may apply. Reply STOP to opt out, HELP for help.",
    )
  })
})
