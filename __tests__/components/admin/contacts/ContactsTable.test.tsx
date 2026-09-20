// @vitest-environment jsdom
// __tests__/components/admin/contacts/ContactsTable.test.tsx
//
// The Follow-up column (G13). Until it existed, the only way to find out
// whether somebody was mid-sequence was to open their record one at a time —
// so an operator ticking a hundred boxes to enrol them had no way to see which
// of those hundred were already being messaged, or which had opted out.
//
// THE ASSERTIONS NAME THE TEXT, not merely that a cell rendered. A column that
// shows the wrong badge is worse than no column: "not in a follow-up" on
// somebody who unsubscribed is the difference between leaving them alone and
// enrolling them again.
//
// The wording itself is pinned in __tests__/lib/lead-engine/sequence-status.test.ts.
// This file is about the COLUMN — that each row gets its own person's status,
// that a contact with no run renders the empty marker rather than nothing, and
// that the header exists at all.
//
// A SECOND FILE FOR THE SAME COMPONENT, deliberately.
// __tests__/components/admin/contacts-table.test.tsx already covers the
// multi-select enrolment wiring — which rows a request carries, and that a
// draft sequence is reported as one. Those properties and this column have
// nothing to do with each other, and folding the two together would give one
// file two subjects. Sibling precedent: ContactDetail.test.tsx lives in this
// same directory.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { ContactsTable } from "@/components/admin/contacts/ContactsTable"
import type { ContactListRow } from "@/lib/db/contacts-list"
import type { LatestSequenceRun } from "@/lib/lead-engine/sequence-status"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
// next/navigation's useRouter is globally mocked in __tests__/setup.tsx.

beforeEach(() => {
  vi.clearAllMocks()
})

function contact(overrides: Partial<ContactListRow> = {}): ContactListRow {
  return {
    id: "c1",
    name: "Sam Athlete",
    email: "sam@example.test",
    phone_e164: "+15550101234",
    created_at: "2026-09-01T10:00:00Z",
    ...overrides,
  }
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

function renderTable(props: { contacts: ContactListRow[]; sequenceByContact?: Record<string, LatestSequenceRun> }) {
  return render(
    <ContactsTable
      contacts={props.contacts}
      sequenceByContact={props.sequenceByContact}
      total={props.contacts.length}
      page={1}
      pageSize={100}
      sequences={[]}
      filters={{ search: "", has: "", days: "", seq: "" }}
    />,
  )
}

/** The row for one contact, found by their name so the assertion cannot drift onto a neighbour. */
function rowFor(name: string): HTMLElement {
  const cell = screen.getByText(name).closest("tr")
  if (!cell) throw new Error(`no row for ${name}`)
  return cell
}

describe("ContactsTable — the Follow-up column", () => {
  it("has a Follow-up header", () => {
    renderTable({ contacts: [contact()] })

    expect(screen.getByRole("columnheader", { name: /follow-up/i })).toBeTruthy()
  })

  it("names the sequence and how far through it somebody is", () => {
    renderTable({ contacts: [contact()], sequenceByContact: { c1: run() } })

    expect(within(rowFor("Sam Athlete")).getByText("New Lead Nurture · 1 of 4 sent")).toBeTruthy()
  })

  it("shows the empty marker for a contact in no follow-up", () => {
    // Rendered, not blank: an empty cell would be indistinguishable from a
    // column that failed to load.
    renderTable({ contacts: [contact()], sequenceByContact: {} })

    expect(within(rowFor("Sam Athlete")).getByText("—")).toBeTruthy()
  })

  it("gives each row ITS OWN person's status", () => {
    // The bug this catches is a column keyed on the wrong thing — index, or
    // the first entry in the map — which reads perfectly on a one-row table.
    renderTable({
      contacts: [contact(), contact({ id: "c2", name: "Riley Parent", email: "riley@example.test" })],
      sequenceByContact: {
        c1: run(),
        c2: run({ status: "exited", exit_reason: "unsubscribed" }),
      },
    })

    expect(within(rowFor("Sam Athlete")).getByText("New Lead Nurture · 1 of 4 sent")).toBeTruthy()
    expect(within(rowFor("Riley Parent")).getByText("Opted out")).toBeTruthy()
    expect(within(rowFor("Sam Athlete")).queryByText("Opted out")).toBeNull()
  })

  it("surfaces a run that broke instead of showing it as nothing", () => {
    renderTable({ contacts: [contact()], sequenceByContact: { c1: run({ status: "failed" }) } })

    const row = within(rowFor("Sam Athlete"))
    expect(row.getByText("Stopped early")).toBeTruthy()
    // PRESENCE CONTROL for the assertion above: the empty marker is what this
    // cell would show if the status were being dropped on the floor.
    expect(row.queryByText("—")).toBeNull()
  })

  it("says Bought and Booked a call for the two endings a coach acts on", () => {
    renderTable({
      contacts: [contact(), contact({ id: "c2", name: "Riley Parent", email: "riley@example.test" })],
      sequenceByContact: {
        c1: run({ status: "exited", exit_reason: "payment" }),
        c2: run({ status: "exited", exit_reason: "booking" }),
      },
    })

    expect(within(rowFor("Sam Athlete")).getByText("Bought")).toBeTruthy()
    expect(within(rowFor("Riley Parent")).getByText("Booked a call")).toBeTruthy()
  })

  it("renders without the column's data at all, so an older caller is unchanged", () => {
    // `sequenceByContact` is optional on purpose — the funnel leads board and
    // any future caller must not have to supply it to render a table.
    renderTable({ contacts: [contact()] })

    expect(within(rowFor("Sam Athlete")).getByText("—")).toBeTruthy()
  })

  it("keeps the empty state spanning the whole table now that there are six columns", () => {
    // colSpan and the column count are two numbers that must agree. When they
    // do not, the "no contacts" message is squeezed into the first column —
    // the exact failure DataTableEmpty's own note in ContactDetail records.
    renderTable({ contacts: [] })

    const empty = screen.getByText(/no contacts yet/i).closest("td")
    expect(empty?.getAttribute("colspan")).toBe("6")
  })
})
