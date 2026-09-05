// __tests__/components/public/InquiryForm.test.tsx
//
// `InquiryForm` (the async server wrapper in components/public/InquiryForm.tsx)
// decides whether InquiryFormClient gets any `smsConsentWording` at all — the
// decision that matters is made HERE, not in InquiryFormClient (which already
// correctly renders no checkbox whenever the prop is absent; that half is
// covered in InquiryFormClient.test.tsx). Mirrors
// __tests__/components/funnels/form-island-sms-consent.test.tsx exactly: a
// failed `business_settings` read and a blank `display_name` must both
// suppress the wording, never one of them falling through to a checkbox whose
// sentence has a hole in it ("I agree to receive text messages from about my
// inquiry.").

import { describe, expect, it, vi, beforeEach } from "vitest"

const getBusinessSettings = vi.fn()

vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: (...a: unknown[]) => getBusinessSettings(...a),
}))

// The component resolves its tenant from the request's Host through the ONE
// Host boundary (lib/tenancy/public.ts). Mocked to a sentinel that is not the
// platform's, so a component that hard-codes platformBusinessId() cannot pass.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))

import { InquiryForm } from "@/components/public/InquiryForm"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wordingOf(element: any): string | undefined {
  return element.props.smsConsentWording
}

beforeEach(() => {
  getBusinessSettings.mockReset()
})

describe("InquiryForm (server wrapper) — SMS consent wording gate", () => {
  it("passes no wording when the settings read fails", async () => {
    // MUTANT KILLED: `.catch(() => null)` combined with `?.display_name ?? ""`
    // — that substitutes an empty string for a failed read and still
    // renders the checkbox, over a sentence with no name in it.
    getBusinessSettings.mockRejectedValue(new Error("db unreachable"))
    const element = await InquiryForm({ defaultService: "assessment" })
    expect(wordingOf(element)).toBeUndefined()
  })

  it("passes no wording when display_name is blank", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "" })
    const element = await InquiryForm({ defaultService: "assessment" })
    expect(wordingOf(element)).toBeUndefined()
  })

  it("passes no wording when display_name is whitespace-only", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "   " })
    const element = await InquiryForm({ defaultService: "assessment" })
    expect(wordingOf(element)).toBeUndefined()
  })

  it("passes the rendered wording when display_name is set", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "Acme Fitness" })
    const element = await InquiryForm({ defaultService: "assessment" })
    expect(wordingOf(element)).toBe(
      "I agree to receive text messages from Acme Fitness about my inquiry. Message and data rates may apply. Reply STOP to opt out, HELP for help.",
    )
  })

  it("threads heading/description/defaultService through to the client component unchanged", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "" })
    const element = await InquiryForm({
      defaultService: "camp",
      heading: "Apply for a spot",
      description: "Places are limited.",
    })
    expect(element.props.defaultService).toBe("camp")
    expect(element.props.heading).toBe("Apply for a spot")
    expect(element.props.description).toBe("Places are limited.")
  })

  it("reads the business settings for the Host-resolved tenant, not the platform's", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "Acme Fitness" })
    await InquiryForm({ defaultService: "assessment" })
    expect(getBusinessSettings).toHaveBeenCalledWith("host-biz")
  })
})
