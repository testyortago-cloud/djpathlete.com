// __tests__/components/funnels/funnel-form-test-run.test.tsx
//
// Three submit behaviours share one handler, and getting the branch wrong is
// either "the owner cannot test the form" or "a preview created a real lead".

import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { FunnelForm } from "@/components/funnels/islands/FunnelForm"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const FIELDS = [{ name: "email", label: "Email", type: "email" as const, required: true }]

function renderForm(extra: Record<string, unknown> = {}) {
  return render(
    <FunnelForm
      funnelId="ffffffff-1111-4222-8333-444444444444"
      stepId="3f1b7c5e-1111-4222-8333-444444444444"
      formKey="optin"
      fields={FIELDS}
      submitLabel="Request a spot"
      successMode="message"
      successMessage="Thanks — you're in."
      waiverHtml={null}
      isPreview={false}
      {...extra}
    />,
  )
}

/**
 * The live route rejects anything submitted faster than 1500ms as a bot, and
 * the component stamps `mountedAt` on mount — so a test that clicks instantly
 * is testing the honeypot, not the branch. The elapsed value is only read
 * server-side, but keeping the shape honest costs nothing.
 */
function submit(email: string) {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } })
  fireEvent.click(screen.getByRole("button", { name: /request a spot/i }))
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    clone: () => ({ json: async () => body }),
    json: async () => body,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, outcome: { kind: "message" } })))
})

describe("FunnelForm submit routing", () => {
  it("posts to the LIVE endpoint when there is no test run", async () => {
    renderForm()
    submit("a@b.com")
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(mock(fetch).mock.calls[0][0]).toBe("/api/funnels/submit")
  })

  it("posts to the PREVIEW endpoint when testRun is set", async () => {
    // MUTANT KILLED: leaving the URL alone. The live route validates against
    // getPublishedFormConfig, which is null on a draft, so this would answer
    // "This form is no longer available" and the test run would be impossible.
    renderForm({ testRun: true })
    submit("a@b.com")
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(mock(fetch).mock.calls[0][0]).toBe("/api/funnels/preview-submit")
  })

  it("never posts at all while the canvas is editable", async () => {
    // MUTANT KILLED: checking testRun before editable. The first click of a
    // double-click to RENAME the button is a submit.
    renderForm({ editable: true, testRun: true })
    submit("a@b.com")
    await new Promise((r) => setTimeout(r, 10))
    expect(fetch).not.toHaveBeenCalled()
  })

  it("still refuses a plain preview with no test run", async () => {
    // MUTANT KILLED: dropping the old isPreview guard once testRun exists. The
    // builder iframe and /go?preview=1 both still rely on it.
    renderForm({ isPreview: true })
    submit("a@b.com")
    await waitFor(() => expect(screen.getByText(/submissions are disabled/i)).toBeInTheDocument())
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe("what a test run reports", () => {
  it("shows what would have been captured, and that nothing was saved", async () => {
    mock(fetch).mockResolvedValue(
      jsonResponse({ ok: true, outcome: { kind: "message" }, captured: [{ label: "Email", value: "a@b.com" }] }),
    )
    renderForm({ testRun: true })
    submit("a@b.com")
    await waitFor(() => expect(screen.getByText(/nothing was saved/i)).toBeInTheDocument())
    expect(screen.getByText("a@b.com")).toBeInTheDocument()
    // MUTANT KILLED: rendering the wire name. The panel is read by a coach, and
    // `email` the column is not `Email` the label they typed next to.
    expect(screen.getByText("Email")).toBeInTheDocument()
  })

  it("reports an external redirect instead of following it", async () => {
    mock(fetch).mockResolvedValue(
      jsonResponse({ ok: true, outcome: { kind: "external", href: "https://example.com/thanks" } }),
    )
    renderForm({
      testRun: true,
      successMode: "redirect",
      redirectUrl: "https://example.com/thanks",
    })
    submit("a@b.com")
    await waitFor(() => expect(screen.getByText(/would send you to/i)).toBeInTheDocument())
    expect(screen.getByRole("link", { name: /example\.com/i })).toBeInTheDocument()
  })

  it("reports a checkout instead of starting one", async () => {
    mock(fetch).mockResolvedValue(
      jsonResponse({ ok: true, outcome: { kind: "checkout", label: "Comeback Code" } }),
    )
    renderForm({ testRun: true, successMode: "checkout" })
    submit("a@b.com")
    await waitFor(() => expect(screen.getByText(/would start a checkout/i)).toBeInTheDocument())
  })

  it("says so when the next page has no draft, rather than walking to a blank page", async () => {
    mock(fetch).mockResolvedValue(
      jsonResponse({ ok: true, outcome: { kind: "no-draft", stepName: "Thanks" } }),
    )
    renderForm({ testRun: true, successMode: "redirect", redirectUrl: "/go/x/thanks" })
    submit("a@b.com")
    await waitFor(() => expect(screen.getByText(/has no draft yet/i)).toBeInTheDocument())
  })

  it("speaks to a coach, not a developer", async () => {
    mock(fetch).mockResolvedValue(
      jsonResponse({ ok: true, outcome: { kind: "message" }, captured: [{ label: "Email", value: "a@b.com" }] }),
    )
    renderForm({ testRun: true })
    submit("a@b.com")
    await waitFor(() => expect(screen.getByText(/nothing was saved/i)).toBeInTheDocument())
    // MUTANT KILLED: jargon leaking onto a screen the audience is a coach.
    expect(document.body.textContent).not.toMatch(/endpoint|payload|POST|database|record|persist/i)
  })
})
