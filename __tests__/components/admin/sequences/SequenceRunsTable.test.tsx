// @vitest-environment jsdom
// __tests__/components/admin/sequences/SequenceRunsTable.test.tsx
//
// One thing pinned: the per-person detail line for `sequence_edited`, the
// exit reason migration 00256 writes when an edit removes the step somebody
// was standing on. Left unhandled it would fall through to the raw string
// "sequence_edited" — exactly the underscored, jargon-y phrase the rest of
// this table works to avoid.
//
// The reason -> sentence mapping itself now lives in
// lib/lead-engine/sequence-exit-reasons.ts, shared with
// components/admin/contacts/ContactDetail.tsx (see
// __tests__/lib/lead-engine/sequence-exit-reasons.test.ts for the exhaustive
// per-reason tests, and __tests__/components/admin/contacts/ContactDetail.test.tsx
// for the cross-screen parity test). What stays here is RENDER behaviour: does
// this table call the shared function, and does its own "don't say the same
// thing twice" suppression logic still work.

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

  it("still shows readable text for a reason nobody has named yet — presence control", () => {
    // Without this, an implementation that hardcoded the new sentence for
    // EVERY reason would also pass the test above. Updated for round 1's
    // review: the shared humanizer now replaces underscores with spaces
    // rather than showing the raw slug, so the assertion is the humanized
    // form, not the literal database value.
    render(<SequenceRunsTable runs={[run({ exitReason: "brand_new_reason" })]} />)
    expect(screen.getByText("Brand new reason")).toBeInTheDocument()
    expect(screen.queryByText("brand_new_reason")).not.toBeInTheDocument()
  })

  it("shows the 'Something else' badge for the edited-away bucket", () => {
    render(<SequenceRunsTable runs={[run({ bucket: "other", exitReason: "sequence_edited" })]} />)
    expect(screen.getByText("Something else")).toBeInTheDocument()
  })
})
