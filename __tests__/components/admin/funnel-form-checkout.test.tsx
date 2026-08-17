// A funnel form that takes payment: the waiver it must show, and the redirect it
// must follow.
//
// The waiver assertions are the legally load-bearing ones. The server files the
// waiver document's id, the visitor's IP and their user agent as evidence of
// agreement, so a tick with no document beside it would be evidence of agreement
// to something never shown.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
// fireEvent, not user-event: @testing-library/user-event is not a dependency of
// this repo, and receipt-upload-dialog.test.tsx shows fireEvent is the house
// idiom for component interaction.
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { FunnelForm } from "@/components/funnels/islands/FunnelForm"
import type { FunnelFormField } from "@/lib/funnels/islands"

const FIELDS: FunnelFormField[] = [
  { name: "email", label: "Email", type: "email", required: true, role: "parent_email" },
  { name: "waiver", label: "I accept the waiver", type: "checkbox", required: true, role: "waiver_accepted" },
]

function setup(over: Record<string, unknown> = {}) {
  return render(
    <FunnelForm
      funnelId="f"
      stepId="s"
      formKey="register"
      fields={FIELDS}
      submitLabel="Pay and hold the spot"
      successMode="checkout"
      successMessage="ok"
      isPreview={false}
      {...over}
    />,
  )
}

const originalLocation = window.location

beforeEach(() => {
  // jsdom's location is not writable; the component assigns `href` on success.
  Object.defineProperty(window, "location", { value: { href: "" }, writable: true, configurable: true })
})

afterEach(() => {
  Object.defineProperty(window, "location", { value: originalLocation, writable: true, configurable: true })
  vi.restoreAllMocks()
})

describe("a funnel form that takes payment", () => {
  it("renders the waiver document above the consent tick", () => {
    setup({ waiverHtml: "<p>Waiver terms here</p>" })
    expect(screen.getByText("Waiver terms here")).toBeInTheDocument()
  })

  it("falls back to a link when no waiver document is active", () => {
    // MUTANT: rendering nothing. The tick would then claim acceptance of a
    // document the parent was never offered, and the server would file that as
    // evidence.
    setup({ waiverHtml: null })
    expect(screen.getByRole("link", { name: /liability waiver/i })).toHaveAttribute("href", "/liability-waiver")
  })

  it("shows no waiver box on a form with no waiver field", () => {
    setup({ fields: [FIELDS[0]], waiverHtml: "<p>Waiver terms here</p>" })
    expect(screen.queryByText("Waiver terms here")).not.toBeInTheDocument()
  })

  it("sends the visitor to Stripe when the server returns a session url", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sessionUrl: "https://stripe.test/pay" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    setup()
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "a@b.test" } })
    fireEvent.click(screen.getByLabelText(/I accept the waiver/))
    fireEvent.click(screen.getByRole("button", { name: /Pay and hold the spot/ }))
    await waitFor(() => expect(window.location.href).toBe("https://stripe.test/pay"))
  })

  it("refuses a non-https session url rather than navigating to it", async () => {
    // MUTANT: assigning whatever the response contained. The server is the only
    // producer of this value today, but the check is one line and the failure it
    // prevents is a navigation to an attacker-chosen scheme.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sessionUrl: "javascript:alert(1)" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    setup()
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "a@b.test" } })
    fireEvent.click(screen.getByLabelText(/I accept the waiver/))
    fireEvent.click(screen.getByRole("button", { name: /Pay and hold the spot/ }))
    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument())
    expect(window.location.href).toBe("")
  })

  it("shows the server's own message when the camp is full", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "This camp is full." }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    )
    setup()
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "a@b.test" } })
    fireEvent.click(screen.getByLabelText(/I accept the waiver/))
    fireEvent.click(screen.getByRole("button", { name: /Pay and hold the spot/ }))
    expect(await screen.findByText("This camp is full.")).toBeInTheDocument()
  })

  it("still shows the success message for an ordinary message-mode form", async () => {
    // The sessionUrl branch runs before the successMode check, so this pins that
    // a response WITHOUT one still behaves exactly as it did.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    )
    setup({ successMode: "message", fields: [FIELDS[0]] })
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "a@b.test" } })
    fireEvent.click(screen.getByRole("button", { name: /Pay and hold the spot/ }))
    expect(await screen.findByText("ok")).toBeInTheDocument()
    expect(window.location.href).toBe("")
  })
})
