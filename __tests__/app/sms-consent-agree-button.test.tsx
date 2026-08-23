// @vitest-environment jsdom
//
// The "I agree" button, and the one thing it exists to prevent.
//
// `confirmSmsConsent` is check-then-insert: it asks `hasConsent` whether this
// contact already said yes, and inserts if not. Nothing sits behind that —
// `contact_consents` carries no unique constraint (migration 00215), and it
// deliberately does not: the table is an append-only log where a person
// legitimately has many rows.
//
// So two presses that overlap both read "no consent yet" and both insert. The
// result is two granted consent rows, two timeline events and two
// `marketing.sms_consent_confirmed` audit rows for ONE act of agreement — a
// compliance trail that overstates what happened, which is the one thing a
// compliance trail must not do.
//
// It is not a contrived double-click. A server-component <form> posting to a
// server action gives no feedback at all while the request is in flight: the
// button looks exactly as it did before the press. On a slow phone connection
// pressing it again is the obvious thing to do.
//
// The form action here is a real React 19 form action, not a stub of one, and
// `useFormStatus` is the real hook reading the real pending state — mocking
// either would leave this suite asserting its own mock.
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AgreeButton } from "@/app/(marketing)/sms-consent/[token]/agree-button"

/** An action that stays in flight until the test lets it finish. */
function gatedAction() {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const action = vi.fn(async () => {
    await gate
  })
  return { action, release: () => release() }
}

describe("the I agree button", () => {
  it("is pressable to begin with", () => {
    const { action } = gatedAction()
    render(
      <form action={action}>
        <AgreeButton />
      </form>,
    )
    expect(screen.getByRole("button")).not.toBeDisabled()
  })

  it("disables itself while the answer is being recorded", async () => {
    const { action, release } = gatedAction()
    render(
      <form action={action}>
        <AgreeButton />
      </form>,
    )

    const button = screen.getByRole("button")
    fireEvent.click(button)

    await waitFor(() => expect(button).toBeDisabled())
    release()
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
  })

  it("swallows a second press, so one agreement files one consent row", async () => {
    const { action, release } = gatedAction()
    render(
      <form action={action}>
        <AgreeButton />
      </form>,
    )

    const button = screen.getByRole("button")
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())

    // The impatient second tap on a slow connection.
    fireEvent.click(button)
    fireEvent.click(button)

    release()
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
  })

  it("says what is happening rather than going quiet", async () => {
    const { action, release } = gatedAction()
    render(
      <form action={action}>
        <AgreeButton />
      </form>,
    )

    const button = screen.getByRole("button")
    expect(button).toHaveTextContent(/I agree/i)

    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveTextContent(/saving your answer/i))

    // Let the action finish before the test ends, so the label going back is
    // asserted rather than landing after teardown as a stray update.
    release()
    await waitFor(() => expect(button).toHaveTextContent(/I agree/i))
  })
})
