// @vitest-environment jsdom
// __tests__/components/admin/sequences/SequenceReportTable.test.tsx
//
// The "paused" empty-state sentence, fixed for migration 00256: pausing now
// stops everybody in the sequence, not just new arrivals, so the copy must
// say both halves.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { SequenceReportTable } from "@/components/admin/sequences/SequenceReportTable"
import type { SequenceReportRow, OutcomeBucket } from "@/lib/db/sequence-reporting"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
// next/navigation's useRouter is globally mocked in __tests__/setup.tsx.

beforeEach(() => {
  vi.clearAllMocks()
})

function emptyBuckets(): Record<OutcomeBucket, number> {
  return { in_progress: 0, bought: 0, booked: 0, opted_out: 0, finished: 0, failed: 0, other: 0 }
}

function row(overrides: Partial<SequenceReportRow> = {}): SequenceReportRow {
  return {
    id: "s1",
    key: "cold_lead",
    name: "Cold Lead Nurture",
    status: "active",
    trigger_source: "funnel_form",
    entered: 0,
    buckets: emptyBuckets(),
    contactsWithoutEmailConsent: 0,
    ...overrides,
  }
}

describe("<SequenceReportTable> — the paused empty-state sentence", () => {
  it("says a paused sequence stops EVERYBODY, not just new arrivals", () => {
    // MUTANT: revert to "Paused, so nobody new is being added." — false since
    // migration 00256, which gates the tick's claim on the sequence being
    // active. This must be a test that only the NEW sentence satisfies.
    render(<SequenceReportTable rows={[row({ status: "paused", entered: 0 })]} />)
    expect(
      screen.getByText("Switched off, so nobody is being added and nobody is moving through it."),
    ).toBeInTheDocument()
    expect(screen.queryByText(/paused, so nobody new is being added/i)).not.toBeInTheDocument()
  })

  it("still says 'Not switched on yet' for a draft sequence — unaffected by 00256", () => {
    // Presence control: without this, an implementation that always returns
    // the new paused sentence regardless of status would still pass the test
    // above.
    render(<SequenceReportTable rows={[row({ status: "draft", entered: 0 })]} />)
    expect(screen.getByText("Not switched on yet.")).toBeInTheDocument()
  })

  it("keeps the shipped 'Paused' badge label — Ruling B, do not churn shipped copy", () => {
    render(<SequenceReportTable rows={[row({ status: "paused" })]} />)
    expect(screen.getByText("Paused")).toBeInTheDocument()
  })
})

describe("<SequenceReportTable> — regression: buckets still render", () => {
  it("renders a row's counts unchanged by any of the above", () => {
    render(
      <SequenceReportTable
        rows={[
          row({
            entered: 5,
            buckets: { in_progress: 1, bought: 1, booked: 0, opted_out: 1, finished: 1, failed: 1, other: 0 },
          }),
        ]}
      />,
    )
    const dataRow = screen.getByText("Cold Lead Nurture").closest("tr")!
    expect(within(dataRow).getByText("5")).toBeInTheDocument()
  })
})
