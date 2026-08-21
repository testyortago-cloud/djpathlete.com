// __tests__/components/public/InquiryFormClient.test.tsx
//
// The half of the SMS consent checkbox InquiryForm.test.tsx cannot see:
// given a wording prop (or its absence), does the checkbox render correctly,
// default unchecked, and does ticking it actually change what gets posted to
// /api/inquiry? Mirrors the assertions in
// __tests__/components/funnels/funnel-form-editable.test.tsx's "SMS consent
// checkbox" describe block.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { InquiryFormClient } from "@/components/public/InquiryFormClient"

const WORDING =
  "I agree to receive text messages from Acme Fitness about my inquiry. Message and data rates may apply. Reply STOP to opt out, HELP for help."

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: "Ada Lovelace" } })
  fireEvent.change(screen.getByLabelText(/^Email/i), { target: { value: "ada@example.com" } })
  fireEvent.change(screen.getByLabelText(/Service/i), { target: { value: "in_person" } })
  fireEvent.change(screen.getByLabelText(/Goals/i), {
    target: { value: "Return to sprinting after a hamstring strain this season." },
  })
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("InquiryFormClient — SMS consent checkbox", () => {
  it("renders no checkbox when smsConsentWording is not provided", () => {
    // MUTANT KILLED: rendering the checkbox unconditionally. The server
    // wrapper only ever passes this prop when a usable business name was
    // found — a form with no wording must render no checkbox at all, not a
    // broken/empty one.
    render(<InquiryFormClient />)
    expect(document.querySelector('[name="sms_consent"]')).toBeNull()
  })

  it("renders an UNCHECKED checkbox with the rendered wording when smsConsentWording is provided", () => {
    render(<InquiryFormClient smsConsentWording={WORDING} />)
    const checkbox = document.querySelector<HTMLInputElement>('input[name="sms_consent"]')!
    expect(checkbox).not.toBeNull()
    expect(checkbox.type).toBe("checkbox")
    expect(checkbox.checked).toBe(false)
    expect(screen.getByText(WORDING)).toBeInTheDocument()
  })

  it("posts sms_consent: true when the box is ticked before submit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<InquiryFormClient smsConsentWording={WORDING} />)
    fillRequiredFields()
    const checkbox = document.querySelector<HTMLInputElement>('input[name="sms_consent"]')!
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)

    fireEvent.submit(document.querySelector("form")!)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.sms_consent).toBe(true)
  })

  it("posts sms_consent: false when the box is left unchecked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<InquiryFormClient smsConsentWording={WORDING} />)
    fillRequiredFields()
    fireEvent.submit(document.querySelector("form")!)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.sms_consent).toBe(false)
  })

  it("posts sms_consent: false when there is no checkbox at all (no wording)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<InquiryFormClient />)
    fillRequiredFields()
    fireEvent.submit(document.querySelector("form")!)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.sms_consent).toBe(false)
  })
})

describe("InquiryFormClient — form identity", () => {
  it('posts no form_context — the route\'s default ("inquiry") applies, unlike StepUpInquiryForm', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<InquiryFormClient />)
    fillRequiredFields()
    fireEvent.submit(document.querySelector("form")!)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.form_context).toBeUndefined()
  })
})
