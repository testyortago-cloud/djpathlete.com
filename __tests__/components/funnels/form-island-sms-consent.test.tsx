// __tests__/components/funnels/form-island-sms-consent.test.tsx
//
// FormIsland decides whether `FunnelForm` gets any `smsConsentWording` at
// all — the decision that matters is made HERE, not in `FunnelForm` (which
// already correctly renders no checkbox whenever the prop is absent; that
// half is covered in funnel-form-editable.test.tsx).
//
// A failed `business_settings` read and a blank `display_name` must both
// suppress the wording, never one of them falling through to a checkbox
// whose sentence has a hole in it ("I agree to receive text messages from
// about my inquiry."). Code review caught a version of this file that
// substituted `""` on a failed read and still rendered the checkbox —
// these tests pin the fixed behavior: no usable name, no checkbox, full stop.

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
  funnelId: "ffffffff-1111-4222-8333-444444444444",
  funnelSlug: "test",
  stepId: "3f1b7c5e-1111-4222-8333-444444444444",
  stepSlug: "index",
  isPreview: false,
}

const FIELDS_WITH_PHONE: FunnelFormField[] = [
  { name: "email", label: "Email", type: "email", required: true },
  { name: "phone", label: "Phone", type: "tel", required: false },
]

const FIELDS_NO_PHONE: FunnelFormField[] = [{ name: "email", label: "Email", type: "email", required: true }]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wordingOf(element: any): string | undefined {
  return element.props.smsConsentWording
}

beforeEach(() => {
  getActiveDocument.mockReset()
  getBusinessSettings.mockReset()
})

describe("FormIsland — SMS consent wording gate", () => {
  it("passes no wording when the settings read fails", async () => {
    // MUTANT KILLED: `.catch(() => null)` combined with `?.display_name ?? ""`
    // — that substitutes an empty string for a failed read and still
    // renders the checkbox, over a sentence with no name in it.
    getBusinessSettings.mockRejectedValue(new Error("db unreachable"))
    const element = await FormIsland({
      props: { fields: FIELDS_WITH_PHONE, successMode: "message" },
      context: CONTEXT,
    })
    expect(wordingOf(element)).toBeUndefined()
  })

  it("passes no wording when display_name is blank", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "" })
    const element = await FormIsland({
      props: { fields: FIELDS_WITH_PHONE, successMode: "message" },
      context: CONTEXT,
    })
    expect(wordingOf(element)).toBeUndefined()
  })

  it("passes no wording when display_name is whitespace-only", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "   " })
    const element = await FormIsland({
      props: { fields: FIELDS_WITH_PHONE, successMode: "message" },
      context: CONTEXT,
    })
    expect(wordingOf(element)).toBeUndefined()
  })

  it("passes the rendered wording when display_name is set", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "Acme Fitness" })
    const element = await FormIsland({
      props: { fields: FIELDS_WITH_PHONE, successMode: "message" },
      context: CONTEXT,
    })
    expect(wordingOf(element)).toBe(
      "I agree to receive text messages from Acme Fitness about my inquiry. Message and data rates may apply. Reply STOP to opt out, HELP for help.",
    )
  })

  it("never reads business_settings for a form with no tel field", async () => {
    const element = await FormIsland({
      props: { fields: FIELDS_NO_PHONE, successMode: "message" },
      context: CONTEXT,
    })
    expect(getBusinessSettings).not.toHaveBeenCalled()
    expect(wordingOf(element)).toBeUndefined()
  })

  it("reads the business settings for the Host-resolved tenant, not the platform's", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "Acme Fitness" })
    await FormIsland({
      props: { fields: FIELDS_WITH_PHONE, successMode: "message" },
      context: CONTEXT,
    })
    expect(getBusinessSettings).toHaveBeenCalledWith("host-biz")
  })
})
