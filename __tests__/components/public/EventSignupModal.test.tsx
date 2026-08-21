// __tests__/components/public/EventSignupModal.test.tsx
//
// The SMS opt-in checkbox EventSignupModal gained alongside the spine wiring
// (Lead Engine Stage 4, Task 4): given a `smsConsentWording` prop (or its
// absence), does the checkbox render correctly, default unchecked, and does
// ticking it actually change what gets posted to the signup route? Mirrors
// the assertions in __tests__/components/public/InquiryFormClient.test.tsx's
// "SMS consent checkbox" describe block — same contract, different form.
//
// jsdom has no ResizeObserver, which Radix's Dialog primitive touches on
// mount; stubbed locally (not in the shared __tests__/setup.tsx) since no
// other suite in this repo renders a Dialog-based component yet.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { EventSignupModal, type EventSignupModalEvent } from "@/components/public/EventSignupModal"

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// jsdom doesn't implement ResizeObserver at runtime; Radix's Dialog touches
// it on mount. The `dom` lib already declares the global's TYPE, so no
// `@ts-expect-error` is needed here — only the runtime value is missing.
global.ResizeObserver = ResizeObserverStub

const WORDING =
  "I agree to receive text messages from Acme Fitness about my inquiry. Message and data rates may apply. Reply STOP to opt out, HELP for help."

const EVENT: EventSignupModalEvent = {
  id: "evt-1",
  title: "Summer Camp",
  type: "camp",
  capacity: 10,
  signup_count: 3,
  stripe_price_id: null,
  price_cents: null,
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/Parent full name/i), { target: { value: "Alex Parent" } })
  fireEvent.change(screen.getByLabelText(/Parent email/i), { target: { value: "alex@example.com" } })
  fireEvent.change(screen.getByLabelText(/Athlete full name/i), { target: { value: "Sam Athlete" } })
  fireEvent.change(screen.getByLabelText(/Athlete age/i), { target: { value: "14" } })
  // Waiver checkbox is a Radix Checkbox (role="checkbox", not a native
  // input) — required for the submit button to enable at all.
  fireEvent.click(screen.getByRole("checkbox", { name: /Liability Waiver/i }))
}

function renderModal(smsConsentWording?: string) {
  return render(
    <EventSignupModal
      event={EVENT}
      open={true}
      onOpenChange={vi.fn()}
      waiverContent={null}
      smsConsentWording={smsConsentWording}
    />,
  )
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EventSignupModal — SMS consent checkbox", () => {
  it("renders no checkbox when smsConsentWording is not provided", () => {
    // MUTANT KILLED: rendering the checkbox unconditionally. The event
    // page's server component only ever passes this prop when a usable
    // business name was found — a modal with no wording must render no
    // checkbox at all, not a broken/empty one.
    renderModal(undefined)
    expect(document.querySelector('[name="sms_consent"]')).toBeNull()
  })

  it("renders an UNCHECKED checkbox with the rendered wording when smsConsentWording is provided", () => {
    renderModal(WORDING)
    const checkbox = document.querySelector<HTMLInputElement>('input[name="sms_consent"]')!
    expect(checkbox).not.toBeNull()
    expect(checkbox.type).toBe("checkbox")
    expect(checkbox.checked).toBe(false)
    expect(screen.getByText(WORDING)).toBeInTheDocument()
  })

  it("posts sms_consent: true when the box is ticked before submit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, signupId: "sig-1" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    renderModal(WORDING)
    fillRequiredFields()
    const checkbox = document.querySelector<HTMLInputElement>('input[name="sms_consent"]')!
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)

    fireEvent.submit(document.querySelector("form")!)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    // Let the success-phase state update (setPhase("success")) settle so
    // React Testing Library doesn't warn about an act()-less update.
    await screen.findByText(/We'll be in touch within 48 hours\./i)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.sms_consent).toBe(true)
  })

  it("posts sms_consent: false when the box is left unchecked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, signupId: "sig-1" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    renderModal(WORDING)
    fillRequiredFields()
    fireEvent.submit(document.querySelector("form")!)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    // Let the success-phase state update (setPhase("success")) settle so
    // React Testing Library doesn't warn about an act()-less update.
    await screen.findByText(/We'll be in touch within 48 hours\./i)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.sms_consent).toBe(false)
  })

  it("posts sms_consent: false when there is no checkbox at all (no wording)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, signupId: "sig-1" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    renderModal(undefined)
    fillRequiredFields()
    fireEvent.submit(document.querySelector("form")!)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    // Let the success-phase state update (setPhase("success")) settle so
    // React Testing Library doesn't warn about an act()-less update.
    await screen.findByText(/We'll be in touch within 48 hours\./i)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.sms_consent).toBe(false)
  })

  it("posts to the signup (not checkout) route for a free/interest event — the same POST the sms_consent field rides on", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, signupId: "sig-1" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    renderModal(WORDING)
    fillRequiredFields()
    fireEvent.submit(document.querySelector("form")!)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    // Let the success-phase state update (setPhase("success")) settle so
    // React Testing Library doesn't warn about an act()-less update.
    await screen.findByText(/We'll be in touch within 48 hours\./i)

    expect(fetchMock.mock.calls[0][0]).toBe(`/api/events/${EVENT.id}/signup`)
  })
})
