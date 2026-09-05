// @vitest-environment jsdom
// __tests__/components/admin/leads-board-columns.test.tsx
//
// The leads inbox shipped with its heads wrapped in a `<tr>` — but
// `DataTableHeader` already renders the row, so the markup nested a row inside
// a row. CSS lays a nested table-row out in its own anonymous table, so every
// header label sat bunched at the left while the data it named was columns
// away. Nothing in the app crashed and no test noticed.
//
// The guard is structural, not visual: a header that is a SECOND row inside
// `<thead>`, or a header whose cell count disagrees with a body row's, cannot
// line up whatever the stylesheet does. jsdom can see both.

import { describe, expect, it, vi } from "vitest"
import { render, fireEvent } from "@testing-library/react"
import { LeadsBoard } from "@/components/admin/funnels/LeadsBoard"
import type { FunnelLead } from "@/lib/db/funnel-leads"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

function lead(over: Partial<FunnelLead> = {}): FunnelLead {
  return {
    id: "lead-1",
    funnel_id: "f1",
    step_id: "s1",
    form_key: "lead",
    email: "someone@example.com",
    name: "Aean Gabrielle Tayawa",
    phone: "09952017559",
    payload: { sport: "Soccer" },
    attribution_session_id: null,
    ip_address: null,
    user_agent: null,
    lead_user_id: null,
    created_at: new Date().toISOString(),
    status: "new",
    notes: null,
    status_changed_at: null,
    kind: "form",
    quiz_attempt_id: null,
    funnel_name: "TEST",
    funnel_slug: "test",
    step_name: "Landing page",
    ...over,
  }
}

function renderBoard(leads: FunnelLead[]) {
  return render(
    <LeadsBoard
      leads={leads}
      total={leads.length}
      counts={{ new: leads.length, contacted: 0, signed_up: 0 }}
      funnels={[{ id: "f1", name: "TEST" }]}
      filters={{ funnelId: "", status: "", days: "", search: "" }}
      exportHref="/api/admin/funnels/leads/export"
    />,
  )
}

describe("LeadsBoard column alignment", () => {
  it("puts exactly one row in the header, directly under <thead>", () => {
    const { container } = renderBoard([lead()])

    const head = container.querySelector("thead")
    expect(head).not.toBeNull()

    const rows = head!.querySelectorAll("tr")
    expect(rows).toHaveLength(1)
    // Directly under thead — a row reached only through another row is the bug.
    expect(rows[0].parentElement).toBe(head)
  })

  it("gives the header one cell per cell in a lead row", () => {
    const { container } = renderBoard([lead()])

    const headCells = container.querySelectorAll("thead th")
    const bodyCells = container.querySelectorAll('tbody tr[data-slot="data-table-row"] td')

    expect(headCells.length).toBe(6)
    expect(bodyCells.length).toBe(headCells.length)
  })

  it("spans the whole table when the expanded panel opens", () => {
    // The panel's colSpan has to match the column count too, or the answers
    // pane sits under part of the table and shoves the rest sideways.
    const { container } = renderBoard([lead()])

    const toggle = container.querySelector("tbody button[aria-expanded]") as HTMLButtonElement
    expect(toggle).not.toBeNull()
    fireEvent.click(toggle)

    const panel = container.querySelector("tbody td[colspan]") as HTMLTableCellElement
    expect(panel).not.toBeNull()
    expect(Number(panel.getAttribute("colspan"))).toBe(container.querySelectorAll("thead th").length)
  })
})
