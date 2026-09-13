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
