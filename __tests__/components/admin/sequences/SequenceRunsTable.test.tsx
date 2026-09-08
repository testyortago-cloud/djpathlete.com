// @vitest-environment jsdom
// __tests__/components/admin/sequences/SequenceRunsTable.test.tsx
//
// One thing pinned: the per-person detail line for `sequence_edited`, the
// exit reason migration 00256 writes when an edit removes the step somebody
// was standing on. Left unhandled it would fall through to the raw string
// "sequence_edited" — exactly the underscored, jargon-y phrase the rest of
// this table works to avoid.

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { SequenceRunsTable } from "@/components/admin/sequences/SequenceRunsTable"
import type { SequenceRunRowForReport } from "@/lib/db/sequence-reporting"

function run(overrides: Partial<SequenceRunRowForReport> = {}): SequenceRunRowForReport {
  return {
    id: "r1",
    contactId: "c1",
    contactName: "Alex Rivera",
    contactEmail: "alex@example.com",
    enteredAt: "2026-09-01T10:00:00Z",
    completedAt: "2026-09-02T10:00:00Z",
    bucket: "other",
    exitReason: null,
    lastError: null,
    ...overrides,
  }
}

describe("<SequenceRunsTable> — naming an edited-away run", () => {
  it("names 'sequence_edited' in plain words rather than showing the raw reason", () => {
    render(<SequenceRunsTable runs={[run({ exitReason: "sequence_edited" })]} />)
    expect(screen.getByText("Stopped because the sequence was edited")).toBeInTheDocument()
    expect(screen.queryByText("sequence_edited")).not.toBeInTheDocument()
  })

  it("still falls through to the raw string for a reason nobody has named yet — presence control", () => {
    // Without this, an implementation that hardcoded the new sentence for
    // EVERY reason would also pass the test above.
    render(<SequenceRunsTable runs={[run({ exitReason: "brand_new_reason" })]} />)
    expect(screen.getByText("brand_new_reason")).toBeInTheDocument()
  })

  it("shows the 'Something else' badge for the edited-away bucket", () => {
    render(<SequenceRunsTable runs={[run({ bucket: "other", exitReason: "sequence_edited" })]} />)
    expect(screen.getByText("Something else")).toBeInTheDocument()
  })
})
