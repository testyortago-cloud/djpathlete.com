// @vitest-environment jsdom
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

// `__tests__/setup.tsx` mocks next/navigation with a FRESH vi.fn() per
// useRouter() call, so nothing there can be asserted on. The pager tests below
// need to see the URL that was pushed, so this file supplies a stable one.
const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/contacts",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
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
      page={1}
      pageSize={100}
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
        page={1}
        pageSize={100}
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

describe("ContactsTable — reaching past the first page", () => {
  // Production already holds 166 imported contacts and the page showed 100 of
  // them, newest first, with no way to reach the rest: `days` only sets a lower
  // bound so it cannot select OLDER rows, and all 166 imports share one
  // created_at, so no `days` value split them either. Rows 101+ could not be
  // ticked at all.

  it("offers a next page when there are more contacts than fit, and says which rows these are", () => {
    renderTable({ total: 166, pageSize: 100, page: 1 })
    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /next page/i })).toBeEnabled()
    expect(screen.getByText(/showing 1–3 of 166/i)).toBeInTheDocument()
  })

  it("has no pager at all when everyone fits on one page", () => {
    renderTable({ total: 3, pageSize: 100, page: 1 })
    expect(screen.queryByRole("button", { name: /next page/i })).not.toBeInTheDocument()
  })

  it("next puts the page in the URL and keeps the filters that are already there", () => {
    renderTable({ total: 166, pageSize: 100, page: 1, filters: { search: "sam", has: "email", days: "" } })
    fireEvent.click(screen.getByRole("button", { name: /next page/i }))

    expect(pushMock).toHaveBeenCalled()
    const url = pushMock.mock.calls.at(-1)?.[0] as string
    expect(url).toContain("page=2")
    expect(url).toContain("search=sam")
    expect(url).toContain("has=email")
  })

  it("the last page cannot go further forward", () => {
    renderTable({ total: 166, pageSize: 100, page: 2 })
    expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /previous page/i })).toBeEnabled()
  })

  it("changing a FILTER drops the page, so a narrowed list starts at the top", () => {
    // MUTANT: carrying `page` through setParam. Search for one name while on
    // page 2 and the result is an empty table over a footer that says there are
    // matches.
    renderTable({ total: 166, pageSize: 100, page: 2 })
    fireEvent.change(screen.getByLabelText(/filter by what you can reach them on/i), { target: { value: "email" } })

    const url = pushMock.mock.calls.at(-1)?.[0] as string
    expect(url).toContain("has=email")
    expect(url).not.toContain("page=")
  })

  it("CHANGING PAGE CLEARS THE TICKS — a selection never spans two pages", () => {
    // Only the rows on screen are ever posted, so an off-page tick was already
    // harmless; it was not HONEST. It survived invisibly, the counter stopped
    // agreeing with it, and paging back resurrected a selection the operator
    // made minutes ago and had no reason to still want.
    const { rerender } = renderTable({ total: 166, pageSize: 100, page: 1 })
    fireEvent.click(screen.getByLabelText("Select Sam Reyes"))
    expect(screen.getByText("1 contact ticked")).toBeInTheDocument()

    rerender(
      <ContactsTable
        contacts={CONTACTS}
        total={166}
        page={2}
        pageSize={100}
        sequences={SEQUENCES}
        filters={{ search: "", has: "", days: "" }}
      />,
    )
    expect(screen.getByText("No contacts ticked")).toBeInTheDocument()
    expect(screen.getByLabelText("Select Sam Reyes")).not.toBeChecked()
  })

  it("says out loud that the ticks do not travel between pages", () => {
    renderTable({ total: 166, pageSize: 100, page: 1 })
    expect(screen.getByText(/ticks clear when you change page/i)).toBeInTheDocument()
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

  it("re-ticks EXACTLY the contacts that failed, so 'try again' is one click", async () => {
    // MUTANT: `setSelected(new Set())` on every non-error result. The response
    // carries counts, the audit row carries no ids on purpose, and no row on
    // screen is marked as failed — so clearing every tick left "3 contacts
    // could not be enrolled" as an instruction nobody could follow.
    fetchMock.mockReturnValue(
      okResponse({
        ok: true,
        tally: {
          enrolled: 2,
          already_enrolled: 0,
          already_enrolled_once: 0,
          sequence_not_found: 0,
          sequence_not_active: 0,
          failed: 1,
        },
        failedContactIds: ["c3"],
        sequenceStatus: null,
      }),
    )
    renderTable()

    fireEvent.click(screen.getByLabelText(/select every contact on this page/i))
    fireEvent.change(screen.getByLabelText(/sequence to enrol into/i), { target: { value: "new_lead_nurture" } })
    fireEvent.click(screen.getByRole("button", { name: /enrol selected/i }))

    await screen.findByRole("status")
    await waitFor(() => expect(screen.getByText("1 contact ticked")).toBeInTheDocument())
    expect(screen.getByLabelText("Select Jo Tan")).toBeChecked()
    expect(screen.getByLabelText("Select Sam Reyes")).not.toBeChecked()
  })

  it("a 500 that still carries a tally says what happened, not 'could not reach the server'", async () => {
    // The route answers a non-2xx when a batch enrolled nobody and something
    // threw, so the audit row is honest. The screen must stay honest too: the
    // server WAS reached, and the tally it sent back is the true story.
    fetchMock.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({
            ok: false,
            error: "Every contact in this batch failed to enrol.",
            tally: {
              enrolled: 0,
              already_enrolled: 0,
              already_enrolled_once: 0,
              sequence_not_found: 0,
              sequence_not_active: 0,
              failed: 1,
            },
            failedContactIds: ["c1"],
            sequenceStatus: null,
          }),
      } as Response),
    )
    renderTable()

    fireEvent.click(screen.getByLabelText("Select Sam Reyes"))
    fireEvent.change(screen.getByLabelText(/sequence to enrol into/i), { target: { value: "new_lead_nurture" } })
    fireEvent.click(screen.getByRole("button", { name: /enrol selected/i }))

    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent(/Nobody was added/i)
    expect(status).not.toHaveTextContent(/could not reach the server/i)
    expect(screen.getByLabelText("Select Sam Reyes")).toBeChecked()
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
