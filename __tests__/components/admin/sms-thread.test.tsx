// @vitest-environment jsdom
//
// __tests__/components/admin/sms-thread.test.tsx — components/admin/sms/SmsThread.tsx
//
// The conversation is the one screen in this feature that a screenshot cannot
// guard. Three of its properties are the whole reason it exists, and each is
// silently loseable:
//
//   1. WHICH SIDE A MESSAGE IS ON. Inbound left, outbound right. Flip the
//      comparison and every message in the app appears to have been sent by
//      the other party — a wrong answer that still looks like a working
//      screen.
//   2. AN OUTBOUND MESSAGE SHOWS ITS DELIVERY STATE. "I texted them and they
//      never replied" and "the message never arrived" are different
//      conversations, and only this word separates them.
//   3. A FAILURE SHOWS ITS ERROR CODE. Twilio's numeric code is the only
//      thing that distinguishes "that handset is unreachable" from "your
//      account is blocked", and it is what a support ticket has to quote.
//
// Sides are asserted through the layout class rather than through text,
// because there is no text that says "this one is on the right" — the
// justify-end / justify-start pair IS the distinction a reader sees.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { SmsThread } from "@/components/admin/sms/SmsThread"
import type { SmsMessageRow } from "@/lib/db/sms-messages"

const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"

function message(overrides: Partial<SmsMessageRow> & { id: string }): SmsMessageRow {
  return {
    business_id: BUSINESS_ID,
    contact_id: "c1",
    phone: "+12025550123",
    direction: "inbound",
    body: "",
    twilio_sid: null,
    status: "received",
    error_code: null,
    sent_by: null,
    sequence_message_id: null,
    occurred_at: "2026-09-11T18:04:00Z",
    created_at: "2026-09-11T18:04:00Z",
    ...overrides,
  }
}

/** The bubble row wrapping a given message body. */
function rowFor(container: HTMLElement, body: string): HTMLElement {
  const paragraph = screen.getByText(body)
  const row = paragraph.closest("[class*='justify-']")
  expect(row, `no layout row found for "${body}"`).not.toBeNull()
  expect(container.contains(row)).toBe(true)
  return row as HTMLElement
}

afterEach(cleanup)

describe("SmsThread", () => {
  it("puts an inbound message on the left and an outbound one on the right", () => {
    const { container } = render(
      <SmsThread
        timezone="America/New_York"
        messages={[
          message({ id: "m1", direction: "inbound", body: "Is Tuesday still on?" }),
          message({ id: "m2", direction: "outbound", body: "Yes — 6pm", status: "delivered" }),
        ]}
      />,
    )
    expect(rowFor(container, "Is Tuesday still on?").className).toContain("justify-start")
    expect(rowFor(container, "Yes — 6pm").className).toContain("justify-end")
  })

  it("keeps them in the order given, newest at the bottom", () => {
    // getSmsThread orders ascending by occurred_at, so render order IS time
    // order. A component that reversed or sorted would read as a different
    // conversation entirely.
    const { container } = render(
      <SmsThread
        timezone="America/New_York"
        messages={[
          message({ id: "m1", body: "first", occurred_at: "2026-09-11T10:00:00Z" }),
          message({ id: "m2", body: "second", occurred_at: "2026-09-11T11:00:00Z" }),
        ]}
      />,
    )
    const bodies = [...container.querySelectorAll("p")].map((p) => p.textContent)
    expect(bodies).toEqual(["first", "second"])
  })

  it("shows the carrier's own word for a delivered outbound message", () => {
    render(
      <SmsThread
        timezone="America/New_York"
        messages={[message({ id: "m1", direction: "outbound", body: "See you then", status: "delivered" })]}
      />,
    )
    expect(screen.getByText("delivered")).toBeInTheDocument()
  })

  it("does not put a delivery state on an inbound message", () => {
    // There is nothing to report about a text they sent us, and a `received`
    // pill beside their own words reads as our delivery state for it.
    render(
      <SmsThread
        timezone="America/New_York"
        messages={[message({ id: "m1", direction: "inbound", body: "hi", status: "received" })]}
      />,
    )
    // Presence control first — an absence assertion passes just as well when
    // nothing rendered at all.
    expect(screen.getByText("hi")).toBeInTheDocument()
    expect(screen.queryByText("received")).not.toBeInTheDocument()
  })

  it("marks a failed outbound message and quotes its error code", () => {
    const { container } = render(
      <SmsThread
        timezone="America/New_York"
        messages={[
          message({
            id: "m1",
            direction: "outbound",
            body: "Are you free Thursday?",
            status: "failed",
            error_code: "30006",
          }),
        ]}
      />,
    )
    // The code is rendered beside the status, so match the pair rather than
    // the bare word: "failed" alone would also be satisfied by a status word
    // with no code next to it, which is the half that a support ticket needs.
    expect(screen.getByText(/failed \(30006\)/)).toBeInTheDocument()
    // And it is visibly a failure, not just another grey word.
    expect(container.querySelector(".text-destructive")).not.toBeNull()
  })

  it("does not invent an error code when there is none", () => {
    render(
      <SmsThread
        timezone="America/New_York"
        messages={[message({ id: "m1", direction: "outbound", body: "hello", status: "undelivered" })]}
      />,
    )
    expect(screen.getByText("undelivered")).toBeInTheDocument()
    expect(screen.queryByText(/undelivered \(/)).not.toBeInTheDocument()
  })

  it("marks a message the sequence engine sent, not a person", () => {
    render(
      <SmsThread
        timezone="America/New_York"
        messages={[
          message({
            id: "m1",
            direction: "outbound",
            body: "Checking in on your first week",
            status: "delivered",
            sequence_message_id: "sm1",
          }),
        ]}
      />,
    )
    expect(screen.getByText(/automatic/i)).toBeInTheDocument()
  })

  it("says the conversation is empty rather than rendering nothing", () => {
    render(<SmsThread timezone="America/New_York" messages={[]} />)
    expect(screen.getByText(/no texts with this number yet/i)).toBeInTheDocument()
  })
})
