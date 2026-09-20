// @vitest-environment jsdom
// __tests__/components/admin/funnels/LeadsBoard.test.tsx
//
// The Follow-up column on the SECOND surface (G13). The contacts list keys it
// on contact id; this board cannot — `funnel_submissions` carries no
// contact_id, so it is keyed on the submission's email address and matched to
// a contact by the DAL. See `latestRunsForEmails` for what that match can and
// cannot do.
//
// WHY BOTH COLUMNS EXIST RATHER THAN ONE. This board already has a "Status"
// column, and it is a different thing entirely: `new / contacted / signed_up`
// is what a coach set by hand on this submission. "Follow-up" is what the
// engine is doing with the person automatically. A board that showed only the
// first tells a coach nothing about whether anybody has actually been messaged.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { LeadsBoard } from "@/components/admin/funnels/LeadsBoard"
import type { FunnelLead } from "@/lib/db/funnel-leads"
import type { LatestSequenceRun } from "@/lib/lead-engine/sequence-status"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
// next/navigation's useRouter is globally mocked in __tests__/setup.tsx.

beforeEach(() => {
  vi.clearAllMocks()
})

function lead(overrides: Partial<FunnelLead> = {}): FunnelLead {
  return {
    id: "s1",
    funnel_id: "f1",
    step_id: "st1",
    form_key: "contact",
    email: "sam@example.test",
    name: "Sam Athlete",
    phone: null,
    payload: {},
    attribution_session_id: null,
    ip_address: null,
    user_agent: null,
    lead_user_id: null,
    created_at: "2026-09-01T10:00:00Z",
    status: "new",
    notes: null,
    status_changed_at: null,
    kind: "form",
    quiz_attempt_id: null,
    funnels: { name: "Main funnel", slug: "main" },
    funnel_steps: { name: "Contact" },
    ...overrides,
  } as FunnelLead
}

function run(overrides: Partial<LatestSequenceRun> = {}): LatestSequenceRun {
  return {
    status: "active",
    exit_reason: null,
    current_position: 2,
    sequence_name: "New Lead Nurture",
    messagePositions: [0, 2, 4, 6],
    ...overrides,
  }
}

function renderBoard(props: { leads: FunnelLead[]; sequenceByEmail?: Record<string, LatestSequenceRun> }) {
  return render(
    <LeadsBoard
      leads={props.leads}
      sequenceByEmail={props.sequenceByEmail}
      total={props.leads.length}
      counts={{ new: props.leads.length, contacted: 0, signed_up: 0 }}
      funnels={[{ id: "f1", name: "Main funnel" }]}
      filters={{ funnelId: "", status: "", days: "", search: "" }}
      exportHref="/export"
    />,
  )
}

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr")
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

/**
 * The Follow-up CELL, not the row.
 *
 * Scoped deliberately: "—" already renders in the Contact column for a lead
 * with no phone number, so a row-wide `getByText("—")` passes even when the
 * Follow-up column does not exist at all. Two of these tests did exactly that
 * before this helper.
 *
 * Found by position — expand, When, Page, Lead, Contact, Follow-up, Status —
 * because no cell here carries a stable role or label to query by.
 */
const FOLLOW_UP_CELL_INDEX = 5

function followUpCell(name: string): HTMLElement {
  const cell = rowFor(name).querySelectorAll("td")[FOLLOW_UP_CELL_INDEX]
  if (!cell) throw new Error(`no Follow-up cell in the row for ${name}`)
  return cell as HTMLElement
}

describe("LeadsBoard — the Follow-up column", () => {
  it("has a Follow-up header, beside the hand-set Status one", () => {
    renderBoard({ leads: [lead()] })

    expect(screen.getByRole("columnheader", { name: /follow-up/i })).toBeTruthy()
    // The presence control: the two columns are different facts and both stay.
    expect(screen.getByRole("columnheader", { name: /^status$/i })).toBeTruthy()
  })

  it("shows the follow-up for the person that submission belongs to", () => {
    renderBoard({ leads: [lead()], sequenceByEmail: { "sam@example.test": run() } })

    expect(within(rowFor("Sam Athlete")).getByText("New Lead Nurture · 1 of 4 sent")).toBeTruthy()
  })

  it("matches however the address was typed into the form", () => {
    // The map is keyed lowercase because capture stores addresses lowercase.
    renderBoard({ leads: [lead({ email: "Sam@Example.TEST" })], sequenceByEmail: { "sam@example.test": run() } })

    expect(within(rowFor("Sam Athlete")).getByText("New Lead Nurture · 1 of 4 sent")).toBeTruthy()
  })

  it("shows the empty marker for a submission nobody matched", () => {
    renderBoard({ leads: [lead()], sequenceByEmail: {} })

    expect(within(followUpCell("Sam Athlete")).getByText("—")).toBeTruthy()
  })

  it("shows the empty marker for a phone-only submission rather than somebody else's status", () => {
    // A submission with no email cannot be matched at all. The one thing it
    // must never do is pick up the first entry in the map.
    renderBoard({
      leads: [lead({ email: null, name: "Riley Parent", phone: "0412 345 678" })],
      sequenceByEmail: { "sam@example.test": run() },
    })

    const cell = within(followUpCell("Riley Parent"))
    expect(cell.getByText("—")).toBeTruthy()
    expect(cell.queryByText("New Lead Nurture · 1 of 4 sent")).toBeNull()
  })

  it("gives each row its own person's status", () => {
    renderBoard({
      leads: [lead(), lead({ id: "s2", name: "Riley Parent", email: "riley@example.test" })],
      sequenceByEmail: {
        "sam@example.test": run(),
        "riley@example.test": run({ status: "exited", exit_reason: "unsubscribed" }),
      },
    })

    expect(within(rowFor("Sam Athlete")).getByText("New Lead Nurture · 1 of 4 sent")).toBeTruthy()
    expect(within(rowFor("Riley Parent")).getByText("Opted out")).toBeTruthy()
  })

  it("keeps the empty state spanning the whole table now that there are seven columns", () => {
    renderBoard({ leads: [] })

    const empty = screen.getByText(/no leads yet|no leads match/i).closest("td")
    expect(empty?.getAttribute("colspan")).toBe("7")
  })
})
