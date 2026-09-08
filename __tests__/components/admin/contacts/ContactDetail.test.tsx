// @vitest-environment jsdom
// __tests__/components/admin/contacts/ContactDetail.test.tsx
//
// Round 1 review finding: this screen rendered `run.exit_reason` raw
// (`{run.exit_reason}`), so the same sequence run read "Stopped because the
// sequence was edited" on /admin/sequences/[key] and the raw jargon
// "sequence_edited" here, on the same person's own page. Fixed by routing
// both screens through the one shared lib/lead-engine/sequence-exit-reasons.ts.
//
// This file pins: every known reason renders its written sentence (not the
// raw value), an unknown reason still renders readable text, and — the
// finding itself — this screen and SequenceRunsTable.tsx render the IDENTICAL
// sentence for the same reason.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ContactDetail } from "@/components/admin/contacts/ContactDetail"
import { SequenceRunsTable } from "@/components/admin/sequences/SequenceRunsTable"
import type { ContactDetail as ContactDetailData, SequenceRunRow } from "@/lib/db/contact-detail"
import type { SequenceRunRowForReport } from "@/lib/db/sequence-reporting"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
// next/navigation's useRouter is globally mocked in __tests__/setup.tsx.

beforeEach(() => {
  vi.clearAllMocks()
})

function sequenceRun(overrides: Partial<SequenceRunRow> = {}): SequenceRunRow {
  return {
    id: "run-1",
    status: "exited",
    current_position: 2,
    enrolled_at: "2026-09-01T10:00:00Z",
    completed_at: "2026-09-02T10:00:00Z",
    exit_reason: null,
    last_error: null,
    next_run_at: "2026-09-03T10:00:00Z",
    sequence_key: "cold_lead",
    sequence_name: "Cold Lead Nurture",
    ...overrides,
  }
}

function contactData(overrides: Partial<ContactDetailData> = {}): ContactDetailData {
  return {
    contact: {
      id: "contact-1",
      business_id: "biz-1",
      user_id: null,
      name: "Alex Rivera",
      email: "alex@example.com",
      phone_e164: null,
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
      timezone: null,
    },
    timeline: [],
    consents: [],
    suppressions: [],
    runs: [],
    tags: [],
    bookingsWindowFull: false,
    timelineWindowFull: false,
    ...overrides,
  }
}

/** `canEnrol={false}` renders nothing for ContactEnrol — see its own header —
 * so no sequence-enrolment fixture or fetch mocking is needed for this screen. */
function renderContact(runs: SequenceRunRow[]) {
  return render(<ContactDetail data={contactData({ runs })} canEnrol={false} />)
}

describe("<ContactDetail> — every known exit reason renders its written sentence", () => {
  it("payment", () => {
    renderContact([sequenceRun({ exit_reason: "payment" })])
    expect(screen.getByText("Bought something")).toBeInTheDocument()
    expect(screen.queryByText("payment")).not.toBeInTheDocument()
  })

  it("booking", () => {
    renderContact([sequenceRun({ exit_reason: "booking" })])
    expect(screen.getByText("Booked a call")).toBeInTheDocument()
  })

  it("unsubscribed", () => {
    renderContact([sequenceRun({ exit_reason: "unsubscribed" })])
    expect(screen.getByText("Clicked unsubscribe in an email")).toBeInTheDocument()
  })

  it("sms_stop", () => {
    renderContact([sequenceRun({ exit_reason: "sms_stop" })])
    expect(screen.getByText("Replied STOP to a text")).toBeInTheDocument()
  })

  it("suppressed", () => {
    renderContact([sequenceRun({ exit_reason: "suppressed" })])
    expect(screen.getByText("Was already on your do-not-contact list")).toBeInTheDocument()
  })

  it("merged_into_survivor", () => {
    renderContact([sequenceRun({ exit_reason: "merged_into_survivor" })])
    expect(screen.getByText("Their details were merged into another person's record.")).toBeInTheDocument()
  })

  it("superseded_by_merged_run", () => {
    renderContact([sequenceRun({ exit_reason: "superseded_by_merged_run" })])
    expect(screen.getByText("They were already in this sequence under another record.")).toBeInTheDocument()
  })

  // THE FINDING. Before this fix, this test failed: the raw string
  // "sequence_edited" rendered instead of the sentence.
  it("sequence_edited — the finding this round of review is about", () => {
    renderContact([sequenceRun({ exit_reason: "sequence_edited" })])
    expect(screen.getByText("Stopped because the sequence was edited")).toBeInTheDocument()
    expect(screen.queryByText("sequence_edited")).not.toBeInTheDocument()
  })
})

describe("<ContactDetail> — an exit reason nobody has named a sentence for yet", () => {
  it("still renders readable text, never a raw underscored slug", () => {
    renderContact([sequenceRun({ exit_reason: "refunded_and_left" })])
    expect(screen.getByText("Refunded and left")).toBeInTheDocument()
    expect(screen.queryByText("refunded_and_left")).not.toBeInTheDocument()
  })
})

describe("<ContactDetail> — no exit reason", () => {
  it("renders nothing extra when a run has not exited", () => {
    // Presence control for every test above: without this, an implementation
    // that always rendered SOME text regardless of exit_reason would still
    // pass, because it's never asserting the null case renders nothing.
    renderContact([sequenceRun({ exit_reason: null, status: "active" })])
    expect(screen.queryByText(/bought something/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/stopped because/i)).not.toBeInTheDocument()
  })
})

describe("ContactDetail and SequenceRunsTable — the same run reads the same sentence on both screens", () => {
  function reportRun(overrides: Partial<SequenceRunRowForReport> = {}): SequenceRunRowForReport {
    return {
      id: "r1",
      contactId: "contact-1",
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

  // This is the exact drift the round 1 review named: two admin screens
  // disagreeing about one run. Both renders read from the SAME
  // exitReasonSentence function, so a regression that special-cases either
  // component fails this test even if each component's own suite stays green.
  it.each(["sequence_edited", "suppressed", "merged_into_survivor", "an_unnamed_future_reason"])(
    "renders the identical sentence for exit_reason=%s",
    (reason) => {
      const { unmount } = renderContact([sequenceRun({ exit_reason: reason })])
      // The sentence sits right after the status badge text on ContactDetail;
      // grab everything rendered and pull out the one line of interest via the
      // shared function itself would defeat the point of an integration test,
      // so instead assert BOTH screens show a text node with the same content.
      const contactScreenText = document.body.textContent ?? ""
      unmount()

      render(<SequenceRunsTable runs={[reportRun({ exitReason: reason })]} />)
      const sequenceScreenText = document.body.textContent ?? ""

      // Extract the sentence via the two known un-ambiguous fixtures rather
      // than string-searching the whole body: assert the exact substring each
      // screen's own per-reason test already pins is present in the OTHER
      // screen's rendered output too.
      const expectedSentences: Record<string, string> = {
        sequence_edited: "Stopped because the sequence was edited",
        suppressed: "Was already on your do-not-contact list",
        merged_into_survivor: "Their details were merged into another person's record.",
        an_unnamed_future_reason: "An unnamed future reason",
      }
      const expected = expectedSentences[reason]
      expect(contactScreenText).toContain(expected)
      expect(sequenceScreenText).toContain(expected)
    },
  )
})
