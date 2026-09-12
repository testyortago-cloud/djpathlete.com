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

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, waitFor } from "@testing-library/react"
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
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ body: "you up?", confirmQuietHours: true }))
  })

  it("sends on the first click during the day", async () => {
    const onSend = vi.fn()
    render(<SmsComposer {...base} contactLocalHour={14} onSend={onSend} />)
    await userEvent.type(screen.getByRole("textbox"), "hello")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))
    expect(onSend).toHaveBeenCalledOnce()
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ body: "hello", confirmQuietHours: false }))
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

// ---------------------------------------------------------------------------
// THE REAL SEND PATH.
//
// Every test above injects `onSend`, which means none of them execute `post()`
// — the function that actually runs in production. A typo in ONE field name
// (`confirmQuietHours`, `contactId`, `phone`, `body`) leaves all of them green
// while the route's `sendSchema` either rejects the request or, worse for
// `confirmQuietHours`, silently accepts it and stops recording that the admin
// was warned. So these render the component with NO `onSend` and read the
// request off a mocked `fetch`.
//
// The field names below are not decoration: they are `sendSchema` in
// app/api/admin/sms/send/route.ts, and the equality assertion on the key SET
// is what makes an extra or renamed field fail rather than pass unnoticed.
//
// The error cases matter for a reason this repo has already recorded: "a send
// that did not throw is not a send". A refusal that scrolls past silently and
// leaves an empty box looks exactly like a delivered text.
// ---------------------------------------------------------------------------
describe("SmsComposer — the request it actually sends", () => {
  const originalFetch = global.fetch
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "m1", providerMessageId: "SM1" }),
    })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  /** The parsed JSON body of the one request that was made. */
  function sentBody(): Record<string, unknown> {
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    return JSON.parse(String(init.body)) as Record<string, unknown>
  }

  it("POSTs JSON to /api/admin/sms/send", async () => {
    render(<SmsComposer {...base} />)
    await userEvent.type(screen.getByRole("textbox"), "hello")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/admin/sms/send")
    expect(init.method).toBe("POST")
    expect(init.headers).toEqual({ "Content-Type": "application/json" })
  })

  it("sends exactly the fields sendSchema names, spelled the way it spells them", async () => {
    render(<SmsComposer {...base} />)
    await userEvent.type(screen.getByRole("textbox"), "hello")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = sentBody()
    // MUTANT: rename any key here (e.g. confirmQuietHours -> confirmQuiethours)
    // and this equality fails. Zod strips unknown keys rather than erroring,
    // so a misspelled `confirmQuietHours` would otherwise be a silent no-op
    // that un-warns every audit row.
    expect(Object.keys(body).sort()).toEqual(["body", "confirmQuietHours", "contactId", "phone"])
    expect(body).toEqual({
      phone: "+12025550123",
      body: "hello",
      contactId: "c1",
      confirmQuietHours: false,
    })
  })

  it("puts confirmQuietHours: true in the BODY on the second click", async () => {
    render(<SmsComposer {...base} contactLocalHour={23} />)
    await userEvent.type(screen.getByRole("textbox"), "you up?")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))
    expect(fetchMock).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole("button", { name: /send anyway/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    // On the wire, not merely handed to a callback: the route reads this off
    // the parsed body to stamp `confirmed_quiet_hours` on the audit row.
    expect(sentBody()).toMatchObject({ confirmQuietHours: true, body: "you up?" })
  })

  it("omits contactId entirely when nobody is on file", async () => {
    // `sendSchema` types it `z.string().uuid().optional()`, so a literal null
    // is a 400 and `undefined` disappears in JSON.stringify anyway — but an
    // explicitly absent key is the only spelling that is correct on purpose
    // rather than by accident.
    render(<SmsComposer {...base} contactId={null} contactName={null} />)
    await userEvent.type(screen.getByRole("textbox"), "who is this")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = sentBody()
    expect("contactId" in body).toBe(false)
    expect(Object.keys(body).sort()).toEqual(["body", "confirmQuietHours", "phone"])
  })

  it("clears the box only after the send succeeded", async () => {
    render(<SmsComposer {...base} />)
    await userEvent.type(screen.getByRole("textbox"), "hello")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""))
  })

  it("surfaces a 409 refusal instead of looking like it sent", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "This number has opted out of texts. You cannot message them.",
        reason: "suppressed",
      }),
    })
    render(<SmsComposer {...base} />)
    await userEvent.type(screen.getByRole("textbox"), "come back")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/opted out of texts/i)
    // And the message stays in the box, because it was never sent.
    expect(screen.getByRole("textbox")).toHaveValue("come back")
  })

  it("surfaces a 503 not-configured refusal the same way", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: "Texting is not set up for this business yet.",
        reason: "not_configured",
      }),
    })
    render(<SmsComposer {...base} />)
    await userEvent.type(screen.getByRole("textbox"), "hello")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/not set up/i)
    expect(screen.getByRole("textbox")).toHaveValue("hello")
  })

  it("still says something when the response carries no error text", async () => {
    // A 502 from a provider fault, or an HTML error page: `json()` rejects and
    // the catch below it must not leave a silent failure on screen.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json")
      },
    })
    render(<SmsComposer {...base} />)
    await userEvent.type(screen.getByRole("textbox"), "hello")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/did not send/i)
  })
})
