// @vitest-environment jsdom
//
// __tests__/app/admin-sms-list.test.tsx — components/admin/sms/SmsThreadList.tsx
//
// The thread list is a `DataTable` (components/ui/data-table.tsx), which is
// the house standard and not optional: CLAUDE.md records that /admin/team
// hand-rolled its own table and now reads as a different app.
//
// THE EMPTY-STATE TEST IS THE ONE THAT IS EASY TO GET WRONG, and the obvious
// version of it is wrong. `DataTableEmpty` renders its OWN `<tr>`; wrapping it
// in a `DataTableRow` nests `<tr>` inside `<tr>` and the empty row's `colSpan`
// then spans nothing — the message goes narrow and left-aligned under the
// first column instead of centred across the table.
//
// Counting `tbody > tr` does NOT tell those two apart. That was run as a
// mutation, and it SURVIVED: React builds the DOM with `createElement`, so
// unlike the HTML parser it does not un-nest the inner `<tr>` — it logs a
// `validateDOMNesting` warning and carries on, leaving the wrapper as the one
// and only `tbody > tr`. The count is kept below because it is still true and
// still cheap, but the assertions that actually bite are the two beneath it:
// the `td[colspan]`'s row must be a direct child of the `<tbody>`, and no
// `<tr>` may sit inside another.
//
// `cleanup` is explicit: __tests__/setup.tsx installs no global afterEach, so
// without it the second test's phone number matches the first test's still-
// mounted render as well.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { SmsThreadList } from "@/components/admin/sms/SmsThreadList"
import type { SmsThreadSummary } from "@/lib/db/sms-messages"

const THREADS: SmsThreadSummary[] = [
  {
    phone: "+15551230000",
    contactId: "c1",
    contactName: "Jane Doe",
    lastBody: "See you Tuesday",
    lastDirection: "inbound" as const,
    lastOccurredAt: "2026-09-11T18:04:00Z",
    lastStatus: "received",
    inboundCount: 2,
    messageCount: 5,
  },
]

afterEach(cleanup)

describe("SmsThreadList", () => {
  it("shows one row per phone with the contact's name and last message", () => {
    render(<SmsThreadList threads={THREADS} />)
    expect(screen.getByText("Jane Doe")).toBeInTheDocument()
    expect(screen.getByText("See you Tuesday")).toBeInTheDocument()
  })

  it("falls back to the number when nobody matches", () => {
    render(<SmsThreadList threads={[{ ...THREADS[0], contactId: null, contactName: null }]} />)
    expect(screen.getByText("+15551230000")).toBeInTheDocument()
  })

  it("renders an empty state with no threads", () => {
    render(<SmsThreadList threads={[]} />)
    expect(screen.getByText(/no text conversations yet/i)).toBeInTheDocument()
  })

  it("renders the empty state inside a valid table body", () => {
    // DataTableEmpty renders its own <tr>; wrapping it makes colSpan span
    // nothing. A stray <tr> inside <table> is what that looks like.
    const { container } = render(<SmsThreadList threads={[]} />)
    expect(container.querySelectorAll("tbody > tr")).toHaveLength(1)

    // THE ROW COUNT ABOVE IS NOT ENOUGH ON ITS OWN, and this was measured,
    // not assumed: wrapping DataTableEmpty in a DataTableRow still leaves
    // exactly one `tbody > tr` — the wrapper — with the real row nested
    // inside it. React builds the DOM with createElement, so unlike the HTML
    // parser it does not un-nest the inner <tr>; it only logs a warning,
    // which a passing test happily ignores. What actually breaks is the
    // colSpan: it only spans the table when its <td> sits in a row that is a
    // direct child of the <tbody>. Assert that, and assert no <tr> is ever
    // inside another.
    const cell = container.querySelector("td[colspan='5']")
    expect(cell).not.toBeNull()
    expect(cell?.parentElement?.tagName).toBe("TR")
    expect(cell?.parentElement?.parentElement?.tagName).toBe("TBODY")
    expect(container.querySelectorAll("tr tr")).toHaveLength(0)
  })

  it("says so when the counts are truncated, instead of showing a partial total as exact", () => {
    render(<SmsThreadList threads={THREADS} countsTruncated />)
    expect(screen.getByText(/Texts\*/)).toBeInTheDocument()
    expect(screen.getByText(/only the most recent activity/i)).toBeInTheDocument()
  })

  it("says nothing extra when the counts are not truncated", () => {
    render(<SmsThreadList threads={THREADS} />)
    expect(screen.queryByText(/only the most recent activity/i)).not.toBeInTheDocument()
  })

  it("links each row to that phone's conversation with the + encoded", () => {
    // The phone rides in the path, so `+` has to be `%2B` or the route
    // receives a space. `/admin/sms/+1555…` and `/admin/sms/%2B1555…` are not
    // the same URL.
    render(<SmsThreadList threads={THREADS} />)
    const link = screen.getByRole("link", { name: /Jane Doe/ })
    expect(link).toHaveAttribute("href", "/admin/sms/%2B15551230000")
  })
})
