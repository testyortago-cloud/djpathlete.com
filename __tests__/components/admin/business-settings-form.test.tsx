// @vitest-environment jsdom
// THE REFUSAL HAS TO BE READ.
//
// /admin/businesses/<id>/settings is a long form: the inline error banner
// renders above the FIRST card and the Save button sits at the bottom, below
// the fold on any normal screen. A sender-domain refusal shown only in that
// banner is a refusal nobody sees -- which is the exact failure the check was
// added to prevent (2026-08-31: a sender address on an unverified domain saved
// unnoticed, 73 sequence sends dropped).
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { BusinessSettingsForm } from "@/components/admin/businesses/BusinessSettingsForm"
import type { BusinessSettings } from "@/lib/db/businesses"
import { SMS_SENDER_PHONE_NEEDS_COUNTRY_CODE } from "@/lib/validators/business"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const SETTINGS = {
  business_id: "bbb",
  display_name: "DJP Athlete",
  logo_url: null,
  sender_name: "Darren",
  sender_email: "noreply@send.darrenjpaul.com",
  reply_to: "darren@example.com",
  timezone: "Australia/Sydney",
  quiet_hours_start: 21,
  quiet_hours_end: 8,
  daily_message_cap: 1,
  sms_help_text: null,
  sms_messaging_service_sid: null,
  sms_sender_phone: null,
  postal_address: null,
} as unknown as BusinessSettings

const REFUSAL = "darrenjpaul.com is not verified at Resend, so email sent from it would be dropped."

beforeEach(() => {
  vi.resetAllMocks()
})

function respondWith(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })),
  )
}

describe("BusinessSettingsForm -- a refused save", () => {
  it("shows the server's reason as a TOAST as well as inline -- MUTANT: dropping the toast.error call leaves the only copy of the refusal above the first card, off screen from the Save button the owner just pressed", async () => {
    respondWith(400, { error: REFUSAL })
    render(<BusinessSettingsForm businessId="bbb" settings={SETTINGS} />)

    await userEvent.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL))
  })

  it("KEEPS the inline banner too -- MUTANT: replacing setServerError with the toast, which leaves nothing on screen once the toast fades", async () => {
    respondWith(400, { error: REFUSAL })
    render(<BusinessSettingsForm businessId="bbb" settings={SETTINGS} />)

    await userEvent.click(screen.getByRole("button", { name: /save/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent(REFUSAL)
  })

  it("PRESENCE CONTROL: a successful save raises the success toast and no error", async () => {
    // Without this, both assertions above pass just as well for a form that
    // reports an error on every submit.
    respondWith(200, { settings: SETTINGS })
    render(<BusinessSettingsForm businessId="bbb" settings={SETTINGS} />)

    await userEvent.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

// G33. The sender number is compared verbatim with the E.164 `To` Twilio posts
// on every inbound text, so it has to leave this form in E.164.
describe("BusinessSettingsForm -- the sender phone number", () => {
  function sentSettings(): Record<string, unknown> {
    const calls = vi.mocked(fetch).mock.calls
    expect(calls).toHaveLength(1)
    return JSON.parse(String((calls[0][1] as RequestInit).body)).settings
  }

  it("SENDS E.164: a number typed with spaces and brackets reaches the server as +12025550123 -- MUTANT: zodResolver({ raw: true }), or a schema that validates without transforming, sends it as typed", async () => {
    respondWith(200, { settings: SETTINGS })
    render(<BusinessSettingsForm businessId="bbb" settings={SETTINGS} />)

    await userEvent.type(screen.getByLabelText("Sender phone number"), "+1 (202) 555-0123")
    await userEvent.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(sentSettings().sms_sender_phone).toBe("+12025550123")
  })

  it("REFUSES a number with no country code, says why beside the field, and sends nothing", async () => {
    respondWith(200, { settings: SETTINGS })
    render(<BusinessSettingsForm businessId="bbb" settings={SETTINGS} />)

    const field = screen.getByLabelText("Sender phone number")
    await userEvent.type(field, "(202) 555-0123")
    await userEvent.click(screen.getByRole("button", { name: /save/i }))

    // The error's OWN text. The hint under the field also says "country code",
    // so a looser match was satisfied by the hint on a form that showed no
    // error at all.
    expect(await screen.findByText(SMS_SENDER_PHONE_NEEDS_COUNTRY_CODE)).toBeInTheDocument()
    expect(field).toHaveAttribute("aria-invalid", "true")
    expect(document.getElementById("sms-sender-phone-hint")).toBeNull()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("tells the coach the expected shape before they type -- a placeholder and a hint the field is described by", () => {
    render(<BusinessSettingsForm businessId="bbb" settings={SETTINGS} />)

    const field = screen.getByLabelText("Sender phone number")
    expect(field).toHaveAttribute("placeholder", "+1 202 555 0123")
    expect(field).toHaveAccessibleDescription(/country code/i)
  })
})

// Small admin fixes, 2026-09-27. `quiet_hours_start`/`quiet_hours_end` hold the
// ALLOWED sending window `[start, end)` (`quietHoursDefer` in
// lib/lead-engine/guardrails.ts), but the fields used to be labelled "Quiet
// hours start/end" with a hint reading "No text messages go out ... between
// these hours" -- the exact OPPOSITE of what the column does. The column
// names are unchanged (the sequence runner and the DB schema still read
// `quiet_hours_start`/`quiet_hours_end`); only what the coach is told changes.
describe("BusinessSettingsForm -- the sending-window fields say what they do", () => {
  it("labels the fields 'Start sending at' / 'Stop sending at', keeping their ids and names", () => {
    render(<BusinessSettingsForm businessId="bbb" settings={SETTINGS} />)

    const start = screen.getByLabelText("Start sending at")
    const stop = screen.getByLabelText("Stop sending at")
    expect(start).toHaveAttribute("id", "quiet_hours_start")
    expect(start).toHaveAttribute("name", "quiet_hours_start")
    expect(stop).toHaveAttribute("id", "quiet_hours_end")
    expect(stop).toHaveAttribute("name", "quiet_hours_end")
  })

  it("no longer offers the old, backwards labels", () => {
    render(<BusinessSettingsForm businessId="bbb" settings={SETTINGS} />)

    expect(screen.queryByLabelText("Quiet hours start")).toBeNull()
    expect(screen.queryByLabelText("Quiet hours end")).toBeNull()
  })

  it("states the sending window correctly, in the spec's exact words", () => {
    render(<BusinessSettingsForm businessId="bbb" settings={SETTINGS} />)

    expect(
      screen.getByText(
        "Follow-up emails and texts only go out between these hours, in each person's own time zone when we know it, otherwise this business's. Use the hour of the day, from 0 (midnight) to 23 (11pm): 8 and 21 means 8am until 9pm.",
      ),
    ).toBeInTheDocument()
    // The old hint said the opposite -- that messages go out OUTSIDE these
    // hours. It must be gone, not merely joined by the correct one.
    expect(screen.queryByText(/No text messages go out/)).toBeNull()
  })

  it("states the daily limit in the spec's exact words, covering both channels", () => {
    render(<BusinessSettingsForm businessId="bbb" settings={SETTINGS} />)

    expect(
      screen.getByText(
        "The most follow-up messages (emails and texts together) one person can be sent in a day, across all sequences.",
      ),
    ).toBeInTheDocument()
    // The old hint claimed it was texts only, and per-client rather than the
    // cap's real scope (per CONTACT, across every sequence and channel).
    expect(screen.queryByText(/The most text messages a single client/)).toBeNull()
  })
})
