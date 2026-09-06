// @vitest-environment jsdom
// __tests__/components/public/StepUpInquiryFormClient.test.tsx
//
// See InquiryFormClient.test.tsx's header comment — identical coverage for
// the Step Up For Students form's checkbox.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { StepUpInquiryFormClient } from "@/components/public/StepUpInquiryFormClient"

const WORDING =
  "I agree to receive text messages from Acme Fitness about my inquiry. Message and data rates may apply. Reply STOP to opt out, HELP for help."

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/Parent \/ Guardian Name/i), { target: { value: "Ada Lovelace" } })
  fireEvent.change(screen.getByLabelText(/^Email/i), { target: { value: "ada@example.com" } })
  fireEvent.change(screen.getByLabelText(/What are you interested in/i), { target: { value: "assessment" } })
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("StepUpInquiryFormClient — SMS consent checkbox", () => {
  it("renders no checkbox when smsConsentWording is not provided", () => {
    render(<StepUpInquiryFormClient />)
    expect(document.querySelector('[name="sms_consent"]')).toBeNull()
  })

  it("renders an UNCHECKED checkbox with the rendered wording when smsConsentWording is provided", () => {
    render(<StepUpInquiryFormClient smsConsentWording={WORDING} />)
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

    render(<StepUpInquiryFormClient smsConsentWording={WORDING} />)
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

    render(<StepUpInquiryFormClient smsConsentWording={WORDING} />)
    fillRequiredFields()
    fireEvent.submit(document.querySelector("form")!)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.sms_consent).toBe(false)
  })
})

describe("StepUpInquiryFormClient — form identity", () => {
  it('posts form_context: "step_up" — the route maps this to the step_up spine source', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<StepUpInquiryFormClient />)
    fillRequiredFields()
    fireEvent.submit(document.querySelector("form")!)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.form_context).toBe("step_up")
  })
})
