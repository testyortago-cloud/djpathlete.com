// __tests__/components/funnels/form-island-waiver.test.tsx
//
// FormIsland decides whether `FunnelForm` gets the live liability waiver to
// show above the tick. It used to fetch it for a CHECKOUT form only, so a
// plain form with a waiver tick (the pre-visit onboarding form) showed a link
// instead of the document the visitor was agreeing to. The rule now: any form
// with a `waiver_accepted` field gets the document; a form without one costs
// no legal_documents read.

import { describe, expect, it, vi, beforeEach } from "vitest"

const getActiveDocument = vi.fn()

vi.mock("@/lib/db/legal-documents", () => ({
  getActiveDocument: (...a: unknown[]) => getActiveDocument(...a),
}))
vi.mock("@/lib/legal-content", () => ({ renderLegalContent: (html: string) => `<rendered>${html}</rendered>` }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn(async () => ({ display_name: "Acme" })) }))
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))

import { FormIsland } from "@/components/funnels/islands/FormIsland"
import type { FunnelFormField } from "@/lib/funnels/islands"

const CONTEXT = {
  businessId: "route-biz",
  funnelId: "ffffffff-1111-4222-8333-444444444444",
  funnelSlug: "onboarding",
  stepId: "3f1b7c5e-1111-4222-8333-444444444444",
  stepSlug: "index",
  isPreview: false,
}

const WAIVER: FunnelFormField = {
  name: "waiver",
  label: "I agree to the waiver above.",
  type: "checkbox",
  required: true,
  role: "waiver_accepted",
}
const NOTES: FunnelFormField = { name: "notes", label: "Anything else?", type: "textarea", required: false }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const waiverOf = (element: any): string | null | undefined => element.props.waiverHtml

beforeEach(() => {
  getActiveDocument.mockReset().mockResolvedValue({ id: "doc-7", content: "Assumption of risk" })
})

describe("FormIsland — liability waiver", () => {
  it("shows the live waiver on a plain (non-checkout) form that has a waiver tick", async () => {
    // MUTANT KILLED: the old `successMode === "checkout"` gate, which renders
    // a link here instead of the document.
    const element = await FormIsland({ props: { fields: [NOTES, WAIVER], successMode: "message" }, context: CONTEXT })
    expect(getActiveDocument).toHaveBeenCalledWith("liability_waiver")
    expect(waiverOf(element)).toBe("<rendered>Assumption of risk</rendered>")
  })

  it("reads no legal document for a form with no waiver tick", async () => {
    const element = await FormIsland({ props: { fields: [NOTES], successMode: "message" }, context: CONTEXT })
    expect(getActiveDocument).not.toHaveBeenCalled()
    expect(waiverOf(element)).toBeNull()
  })
})
