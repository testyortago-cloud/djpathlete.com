// __tests__/components/admin/contacts-table.test.tsx
//
// The multi-select table is the first one in this admin, so the wiring is not
// covered by any existing test — and two of its properties are load-bearing
// rather than cosmetic:
//
//   1. THE REQUEST CARRIES THE ROWS THE OPERATOR CAN SEE. The component builds
//      the payload by filtering the visible contacts through the selection,
//      not by posting the selection set. That is what stops a tick left behind
//      by an earlier filter from quietly enrolling somebody who is not on the
//      screen.
//   2. `sequence_not_active` IS REPORTED AS A DRAFT. `cold_lead_re_engagement`
//      ships `draft` (migration 00218), so this is the first thing a real user
//      hits. `describeEnrolResult` (lib/lead-engine/manual-enrol.ts) is
//      unit-tested on its own, but a component that renders its own string
//      instead of calling it would pass every one of those tests — this is the
//      test that pins the wiring rather than the wording.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { ContactsTable } from "@/components/admin/contacts/ContactsTable"
import type { ContactListRow } from "@/lib/db/contacts-list"
import type { SequenceSummary } from "@/lib/db/sequences"

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

const CONTACTS: ContactListRow[] = [
  { id: "c1", name: "Sam Reyes", email: "sam@example.com", phone_e164: null, created_at: "2026-08-01T09:00:00.000Z" },
  { id: "c2", name: null, email: null, phone_e164: "+61400000000", created_at: "2026-07-02T09:00:00.000Z" },
  { id: "c3", name: "Jo Tan", email: "jo@example.com", phone_e164: null, created_at: "2026-06-03T09:00:00.000Z" },
]

const SEQUENCES: SequenceSummary[] = [
  {
    id: "s1",
    key: "cold_lead_re_engagement",
    name: "Cold Lead Re-Engagement",
    status: "draft",
    trigger_source: null,
  },
  { id: "s2", key: "new_lead_nurture", name: "New Lead Nurture", status: "active", trigger_source: "funnel_form" },
]

function renderTable(over: Partial<React.ComponentProps<typeof ContactsTable>> = {}) {
  return render(
    <ContactsTable
      contacts={CONTACTS}
      total={CONTACTS.length}
      sequences={SEQUENCES}
      filters={{ search: "", has: "", days: "" }}
      {...over}
    />,
  )
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  // resetAllMocks rather than clearAllMocks: a queued `mockResolvedValueOnce`
  // left over from one test would otherwise answer the NEXT test's fetch and
  // misattribute the failure to it.
  vi.resetAllMocks()
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const okResponse = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)

describe("ContactsTable — picking people", () => {
  it("the enrol button explains itself instead of just being greyed out", () => {
    renderTable()
    expect(screen.getByRole("button", { name: /enrol selected/i })).toBeDisabled()
    expect(screen.getByText("Pick a sequence first.")).toBeInTheDocument()
  })

  it("still refuses with a sequence chosen but nobody ticked, and says which is missing", async () => {
    renderTable()
    fireEvent.change(screen.getByLabelText(/sequence to enrol into/i), { target: { value: "new_lead_nurture" } })
    expect(screen.getByRole("button", { name: /enrol selected/i })).toBeDisabled()
    expect(screen.getByText("Tick at least one contact.")).toBeInTheDocument()
  })

  it("select-all ticks every row on the page and the footer count follows", async () => {
    renderTable()
    fireEvent.click(screen.getByLabelText(/select every contact on this page/i))
    expect(screen.getByText("3 contacts ticked")).toBeInTheDocument()
    for (const box of screen.getAllByRole("checkbox")) {
      if ((box as HTMLInputElement).getAttribute("aria-label")?.startsWith("Select ")) {
        expect(box).toBeChecked()
      }
    }
  })

  it("labels a nameless contact by an identifier rather than 'Select undefined'", () => {
    renderTable()
    // c2 has no name and no email — the phone number is what a human would
    // recognise it by, and a checkbox nobody can name is a checkbox nobody can
    // use with a screen reader.
    expect(screen.getByLabelText("Select +61400000000")).toBeInTheDocument()
  })

  it("posts only the contacts that are BOTH ticked and on the page", async () => {
    fetchMock.mockReturnValue(
      okResponse({ ok: true, tally: { enrolled: 2 }, sequenceStatus: null, sequenceKey: "new_lead_nurture" }),
    )
    renderTable()

    fireEvent.click(screen.getByLabelText("Select Sam Reyes"))
    fireEvent.click(screen.getByLabelText("Select Jo Tan"))
    fireEvent.change(screen.getByLabelText(/sequence to enrol into/i), { target: { value: "new_lead_nurture" } })
    fireEvent.click(screen.getByRole("button", { name: /enrol selected/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({
      contactIds: ["c1", "c3"],
      sequenceKey: "new_lead_nurture",
      onePerContact: false,
    })
  })

  it("a tick left behind by an earlier filter is NOT posted once that row is off the page", async () => {
    // MUTANT: posting `[...selected]` instead of filtering the visible rows
    // through it. Tick someone, narrow the filter until they are off screen,
    // enrol — and marketing email goes to a person the operator cannot see on
    // the page they are looking at. There is no undo for a sent email.
    fetchMock.mockReturnValue(okResponse({ ok: true, tally: { enrolled: 1 }, sequenceStatus: null }))
    const { rerender } = renderTable()

    fireEvent.click(screen.getByLabelText("Select Sam Reyes"))
    fireEvent.click(screen.getByLabelText("Select Jo Tan"))

    // The filter narrows and Jo Tan drops off the page, still ticked.
    rerender(
      <ContactsTable
        contacts={[CONTACTS[0]]}
        total={1}
        sequences={SEQUENCES}
        filters={{ search: "sam", has: "", days: "" }}
      />,
    )
    expect(screen.queryByLabelText("Select Jo Tan")).not.toBeInTheDocument()
    expect(screen.getByText("1 contact ticked")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/sequence to enrol into/i), { target: { value: "new_lead_nurture" } })
    fireEvent.click(screen.getByRole("button", { name: /enrol selected/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.contactIds).toEqual(["c1"])
  })

  it("sends onePerContact only when the box is ticked", async () => {
    fetchMock.mockReturnValue(okResponse({ ok: true, tally: { enrolled: 1 }, sequenceStatus: null }))
    renderTable()

    fireEvent.click(screen.getByLabelText("Select Sam Reyes"))
    fireEvent.change(screen.getByLabelText(/sequence to enrol into/i), { target: { value: "new_lead_nurture" } })
    fireEvent.click(screen.getByLabelText(/skip anyone who has been in it before/i))
    fireEvent.click(screen.getByRole("button", { name: /enrol selected/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.onePerContact).toBe(true)
  })
})

describe("ContactsTable — telling the truth about a draft sequence", () => {
  it("warns BEFORE the click that a draft sequence will enrol nobody", async () => {
    renderTable()
    fireEvent.change(screen.getByLabelText(/sequence to enrol into/i), { target: { value: "cold_lead_re_engagement" } })
    expect(screen.getByText(/is still a draft/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing will be sent/i)).toBeInTheDocument()
  })

  it("renders the DRAFT explanation, not a generic failure, when every attempt is refused", async () => {
    fetchMock.mockReturnValue(
      okResponse({
        ok: true,
        sequenceKey: "cold_lead_re_engagement",
        requested: 1,
        tally: {
          enrolled: 0,
          already_enrolled: 0,
          already_enrolled_once: 0,
          sequence_not_found: 0,
          sequence_not_active: 1,
          failed: 0,
        },
        sequenceStatus: "draft",
      }),
    )
    renderTable()

    fireEvent.click(screen.getByLabelText("Select Sam Reyes"))
    fireEvent.change(screen.getByLabelText(/sequence to enrol into/i), { target: { value: "cold_lead_re_engagement" } })
    fireEvent.click(screen.getByRole("button", { name: /enrol selected/i }))

    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent(/Nobody was enrolled/i)
    expect(status).toHaveTextContent(/Cold Lead Re-Engagement/)
    expect(status).toHaveTextContent(/still a draft/i)
    // The generic wording this test exists to prevent.
    expect(status).not.toHaveTextContent(/something went wrong/i)
  })

  it("a partial failure reports the enrolments that DID happen alongside the ones that did not", async () => {
    fetchMock.mockReturnValue(
      okResponse({
        ok: true,
        tally: {
          enrolled: 2,
          already_enrolled: 1,
          already_enrolled_once: 0,
          sequence_not_found: 0,
          sequence_not_active: 0,
          failed: 1,
        },
        sequenceStatus: null,
      }),
    )
    renderTable()

    fireEvent.click(screen.getByLabelText(/select every contact on this page/i))
    fireEvent.change(screen.getByLabelText(/sequence to enrol into/i), { target: { value: "new_lead_nurture" } })
    fireEvent.click(screen.getByRole("button", { name: /enrol selected/i }))

    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent(/Enrolled 2 contacts/)
    expect(status).toHaveTextContent(/1 contact were already in it|1 contact was already|already in it/i)
    expect(status).toHaveTextContent(/could not be enrolled/i)
  })

  it("a refused request shows the server's reason rather than a silent no-op", async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: "Too many contacts at once — enrol at most 100 in one go." }),
      } as Response),
    )
    renderTable()

    fireEvent.click(screen.getByLabelText("Select Sam Reyes"))
    fireEvent.change(screen.getByLabelText(/sequence to enrol into/i), { target: { value: "new_lead_nurture" } })
    fireEvent.click(screen.getByRole("button", { name: /enrol selected/i }))

    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent(/at most 100/)
  })
})
