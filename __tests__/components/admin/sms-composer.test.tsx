// @vitest-environment jsdom
//
// __tests__/components/admin/sms-composer.test.tsx — components/admin/sms/SmsComposer.tsx
//
// THREE PRODUCT DECISIONS LIVE IN THIS COMPONENT, and each one is a rule that
// is easy to "simplify" into its opposite:
//
//   1. QUIET HOURS WARN, THEY NEVER BLOCK (§3.1). Late at night the first
//      click asks and does not send; the second sends and tells the route the
//      admin was warned. Neither "send it anyway, silently" nor "refuse until
//      morning" is the behaviour.
//   2. A SUPPRESSED NUMBER CAN NEVER BE TEXTED. The box is disabled and says
//      why. The route refuses too — that is deliberate defence in depth, and
//      the two are tested separately on purpose. Two guards that mask each
//      other pin nothing: this file proves the BOX, and
//      __tests__/app/api/admin/sms-send-route.test.ts proves the ROUTE.
//   3. The opt-out sentence is the SERVER's decision, appended in
//      `sendManualSms` on the first outbound in 30 days. The box never
//      appends it, so nothing here asserts it — see the route's own tests.
//
// A NOTE ON NAMES. Testing Library's `getByRole(name:)` is a full-string
// match against the accessible name, unlike Playwright's substring matcher,
// and two controls sharing a name cannot be told apart with `exact: true`.
// The send button is therefore named differently in each state — "Send"
// normally, "Send anyway" once it has warned — and nothing else in the
// component renders the words "send anyway", so `getByText` finds exactly
// one node.

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SmsComposer } from "@/components/admin/sms/SmsComposer"

const base = {
  phone: "+12025550123",
  contactId: "c1",
  contactName: "Jane Doe",
  suppressed: false,
  contactLocalHour: 14,
  contactTimezone: "America/New_York",
}

afterEach(cleanup)

describe("SmsComposer — the segment counter", () => {
  it("counts a plain message as one segment", async () => {
    render(<SmsComposer {...base} />)
    await userEvent.type(screen.getByRole("textbox"), "Hey Jane")
    expect(screen.getByText(/8 characters · 1 segment/i)).toBeInTheDocument()
  })

  it("warns that one emoji halves the room", async () => {
    render(<SmsComposer {...base} />)
    await userEvent.type(screen.getByRole("textbox"), "Hi \u{1F44B}")
    expect(screen.getByText(/UCS-2/i)).toBeInTheDocument()
  })
})

describe("SmsComposer — suppression", () => {
  it("disables the box and says why", () => {
    render(<SmsComposer {...base} suppressed />)
    expect(screen.getByRole("textbox")).toBeDisabled()
    expect(screen.getByText(/opted out/i)).toBeInTheDocument()
  })

  it("disables Send too", () => {
    render(<SmsComposer {...base} suppressed />)
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled()
  })

  it("cannot be typed into or sent even with a body already in hand", async () => {
    // The `disabled` attribute is the whole guard on this path, so pin what it
    // is actually for: neither typing nor clicking may reach `onSend`.
    const onSend = vi.fn()
    render(<SmsComposer {...base} suppressed onSend={onSend} />)
    await userEvent.type(screen.getByRole("textbox"), "please come back")
    expect(screen.getByRole("textbox")).toHaveValue("")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))
    expect(onSend).not.toHaveBeenCalled()
  })
})

describe("SmsComposer — quiet hours warn, never block", () => {
  it("asks for a second click at 11:40pm but still allows the send", async () => {
    const onSend = vi.fn()
    render(<SmsComposer {...base} contactLocalHour={23} onSend={onSend} />)

    await userEvent.type(screen.getByRole("textbox"), "you up?")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))

    // First click warns and does NOT send.
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByText(/send anyway/i)).toBeInTheDocument()

    // Second click sends. Warn, do not block (§3.1).
    await userEvent.click(screen.getByRole("button", { name: /send anyway/i }))
    expect(onSend).toHaveBeenCalledOnce()
  })

  it("tells the route the admin was warned, so the audit row can record it", async () => {
    const onSend = vi.fn()
    render(<SmsComposer {...base} contactLocalHour={23} onSend={onSend} />)
    await userEvent.type(screen.getByRole("textbox"), "you up?")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))
    await userEvent.click(screen.getByRole("button", { name: /send anyway/i }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ body: "you up?", confirmQuietHours: true }),
    )
  })

  it("sends on the first click during the day", async () => {
    const onSend = vi.fn()
    render(<SmsComposer {...base} contactLocalHour={14} onSend={onSend} />)
    await userEvent.type(screen.getByRole("textbox"), "hello")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))
    expect(onSend).toHaveBeenCalledOnce()
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ body: "hello", confirmQuietHours: false }),
    )
  })

  it("names the hour and the person, so the warning is checkable", async () => {
    render(<SmsComposer {...base} contactLocalHour={23} onSend={vi.fn()} />)
    await userEvent.type(screen.getByRole("textbox"), "you up?")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))
    expect(screen.getByText(/11pm for Jane Doe/i)).toBeInTheDocument()
  })
})

describe("SmsComposer — texting not set up", () => {
  it("disables the box when the business has no Twilio sender", () => {
    // The route answers 503 for this. Saying so before the click is the
    // difference between a feature that looks broken and one that is not
    // switched on yet.
    render(<SmsComposer {...base} notConfigured />)
    expect(screen.getByRole("textbox")).toBeDisabled()
    expect(screen.getByText(/not set up/i)).toBeInTheDocument()
  })
})
