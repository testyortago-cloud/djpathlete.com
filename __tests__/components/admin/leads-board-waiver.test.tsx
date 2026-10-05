// @vitest-environment jsdom
// The reader for 00288's waiver evidence: a coach opening a lead from the
// pre-visit onboarding form sees that the person accepted the liability waiver,
// and when. A lead from a form with no waiver says nothing about one.
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { LeadsBoard } from "@/components/admin/funnels/LeadsBoard"
import type { FunnelLead } from "@/lib/db/funnel-leads"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

function lead(over: Partial<FunnelLead> = {}): FunnelLead {
  return {
    id: "lead-1",
    funnel_id: "f1",
    step_id: "s1",
    form_key: "pre-visit",
    email: "sam@example.com",
    name: "Sam Athlete",
    phone: null,
    payload: { goals: "Throw harder", waiver: "on" },
    attribution_session_id: null,
    ip_address: "198.51.100.7",
    user_agent: null,
    lead_user_id: null,
    created_at: "2026-10-05T12:00:00Z",
    status: "new",
    notes: null,
    status_changed_at: null,
    kind: "form",
    quiz_attempt_id: null,
    waiver_document_id: null,
    waiver_accepted_at: null,
    funnel_name: "Pre-visit onboarding",
    funnel_slug: "onboarding",
    step_name: "Landing page",
    ...over,
  }
}

function openRow(l: FunnelLead) {
  render(
    <LeadsBoard
      leads={[l]}
      total={1}
      counts={{ new: 1, contacted: 0, signed_up: 0 }}
      funnels={[{ id: "f1", name: "Pre-visit onboarding" }]}
      filters={{ funnelId: "", status: "", days: "", search: "" }}
      exportHref="/api/admin/funnels/leads/export"
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: /Show Sam Athlete's answers/i }))
}

describe("LeadsBoard — waiver acceptance", () => {
  it("says the lead accepted the liability waiver, with the date and IP filed", () => {
    openRow(lead({ waiver_document_id: "doc-7", waiver_accepted_at: "2026-10-05T12:00:00Z" }))
    const line = screen.getByText(/Accepted the liability waiver/)
    expect(line.textContent).toMatch(/2026/)
    expect(line.textContent).toContain("198.51.100.7")
  })

  it("says nothing about a waiver on a lead that never saw one", () => {
    openRow(lead())
    expect(screen.queryByText(/liability waiver/i)).toBeNull()
  })
})
