// __tests__/components/funnels/form-island-email-consent.test.tsx
//
// The email-permission mirror of form-island-sms-consent.test.tsx. FormIsland
// decides whether `FunnelForm` gets any `emailConsentWording` at all — the
// same "a failed read and a blank name both suppress the wording" contract,
// applied to the email tick instead of the SMS one.
//
// The read this gate depends on (`getBusinessSettings`) is now fetched for
// `tel` OR `email` (decision 7 widened it) — see
// form-island-sms-consent.test.tsx's own widened-gate test for that half.

import { describe, expect, it, vi, beforeEach } from "vitest"

const getActiveDocument = vi.fn()
const getBusinessSettings = vi.fn()

vi.mock("@/lib/db/legal-documents", () => ({
  getActiveDocument: (...a: unknown[]) => getActiveDocument(...a),
}))
vi.mock("@/lib/legal-content", () => ({ renderLegalContent: (html: string) => html }))
vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: (...a: unknown[]) => getBusinessSettings(...a),
}))

// The component resolves its tenant from the request's Host through the ONE
// Host boundary (lib/tenancy/public.ts). Mocked to a sentinel that is not the
// platform's, so a component that hard-codes platformBusinessId() cannot pass.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))

import { FormIsland } from "@/components/funnels/islands/FormIsland"
import type { FunnelFormField } from "@/lib/funnels/islands"

const CONTEXT = {
  businessId: "route-biz",
  funnelId: "ffffffff-1111-4222-8333-444444444444",
  funnelSlug: "test",
  stepId: "3f1b7c5e-1111-4222-8333-444444444444",
  stepSlug: "index",
  isPreview: false,
}

const FIELDS_WITH_EMAIL: FunnelFormField[] = [{ name: "email", label: "Email", type: "email", required: true }]

const FIELDS_NO_EMAIL_NO_PHONE: FunnelFormField[] = [
  { name: "notes", label: "Anything else?", type: "textarea", required: false },
]

// A form with a `tel` field and NO `email` field. The widened read fires for
// this form (a `tel` field alone is enough — see form-island-sms-consent.test.tsx's
// own widened-gate test), but there is no email field to attach the email
// tick to, so `emailConsentWording` must stay undefined even with a usable
// display name and even though the settings read genuinely happened.
const FIELDS_TEL_ONLY: FunnelFormField[] = [{ name: "phone", label: "Phone", type: "tel", required: false }]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emailWordingOf(element: any): string | undefined {
  return element.props.emailConsentWording
}

beforeEach(() => {
  getActiveDocument.mockReset()
  getBusinessSettings.mockReset()
})

describe("FormIsland — email consent wording gate", () => {
  it("passes no wording when the settings read fails", async () => {
    getBusinessSettings.mockRejectedValue(new Error("db unreachable"))
    const element = await FormIsland({
      props: { fields: FIELDS_WITH_EMAIL, successMode: "message" },
      context: CONTEXT,
    })
    expect(emailWordingOf(element)).toBeUndefined()
  })

  it("passes no wording when display_name is blank", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "" })
    const element = await FormIsland({
      props: { fields: FIELDS_WITH_EMAIL, successMode: "message" },
      context: CONTEXT,
    })
    expect(emailWordingOf(element)).toBeUndefined()
  })

  it("passes no wording when display_name is whitespace-only", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "   " })
    const element = await FormIsland({
      props: { fields: FIELDS_WITH_EMAIL, successMode: "message" },
      context: CONTEXT,
    })
    expect(emailWordingOf(element)).toBeUndefined()
  })

  it("passes the rendered wording when display_name is set", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "Acme Fitness" })
    const element = await FormIsland({
      props: { fields: FIELDS_WITH_EMAIL, successMode: "message" },
      context: CONTEXT,
    })
    expect(emailWordingOf(element)).toBe(
      "Yes, Acme Fitness can email me training tips, news and offers. I can unsubscribe at any time.",
    )
  })

  it("never reads business_settings for a form with neither an email nor a tel field", async () => {
    const element = await FormIsland({
      props: { fields: FIELDS_NO_EMAIL_NO_PHONE, successMode: "message" },
      context: CONTEXT,
    })
    expect(getBusinessSettings).not.toHaveBeenCalled()
    expect(emailWordingOf(element)).toBeUndefined()
  })

  it("reads business_settings for a tel-only form (the read fires), but passes no email wording — there is no email field to attach it to", async () => {
    // MUTANT KILLED: dropping `hasEmailField &&` from the emailConsentWording
    // computation in FormIsland — that would let this tel-only form's
    // perfectly usable display name leak into a wording prop with nowhere to
    // render, and `FunnelForm` would then never be asked to check for an
    // email field before showing it.
    getBusinessSettings.mockResolvedValue({ display_name: "Acme Fitness" })
    const element = await FormIsland({
      props: { fields: FIELDS_TEL_ONLY, successMode: "message" },
      context: CONTEXT,
    })
    expect(getBusinessSettings).toHaveBeenCalled()
    expect(emailWordingOf(element)).toBeUndefined()
  })

  it("reads the business settings for the Host-resolved tenant, not the platform's", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "Acme Fitness" })
    await FormIsland({
      props: { fields: FIELDS_WITH_EMAIL, successMode: "message" },
      context: CONTEXT,
    })
    expect(getBusinessSettings).toHaveBeenCalledWith("host-biz")
  })

  it("reads business_settings only ONCE for a form with both a tel and an email field", async () => {
    // MUTANT KILLED: a naive widened condition that fetches settings twice
    // (once per field type check) rather than once for the form.
    getBusinessSettings.mockResolvedValue({ display_name: "Acme Fitness" })
    await FormIsland({
      props: {
        fields: [
          { name: "email", label: "Email", type: "email", required: true },
          { name: "phone", label: "Phone", type: "tel", required: false },
        ],
        successMode: "message",
      },
      context: CONTEXT,
    })
    expect(getBusinessSettings).toHaveBeenCalledTimes(1)
  })
})
