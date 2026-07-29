import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SellPackDialog } from "@/components/admin/packs/SellPackDialog"

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const CLIENT = "11111111-1111-4111-8111-111111111111"

/** Bodies of every POST to the sell-a-pack endpoint. */
let checkoutBodies: Record<string, unknown>[] = []
/** URLs of every POST to the email-the-link endpoint. */
let emailLinkCalls: string[] = []

function mockFetch() {
  checkoutBodies = []
  emailLinkCalls = []
  vi.spyOn(global, "fetch").mockImplementation((async (url: string, init?: RequestInit) => {
    if (String(url).includes("/email-link")) {
      emailLinkCalls.push(String(url))
      return new Response(JSON.stringify({ ok: true, sentTo: "dad@example.com" }), { status: 200 })
    }
    if (String(url).includes("/checkout")) {
      checkoutBodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ url: "https://stripe.test/cs_1", packageId: "pack-1" }), { status: 200 })
    }
    return new Response(JSON.stringify({ products: [], programs: [] }), { status: 200 })
  }) as unknown as typeof fetch)
}

/** Open the dialog and wait for its async product/program loads to settle. */
async function openDialog() {
  render(<SellPackDialog clientUserId={CLIENT} onSold={() => {}} trigger={<button>Sell pack</button>} />)
  fireEvent.click(screen.getByText("Sell pack"))
  return screen.findByLabelText(/someone else is paying/i)
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /create payment link/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  mockFetch()
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

describe("<SellPackDialog> — bill to someone else", () => {
  it("sends billToEmail with the sale when the box is checked", async () => {
    const checkbox = await openDialog()
    fireEvent.click(checkbox)
    fireEvent.change(screen.getByLabelText(/billing email/i), { target: { value: "dad@example.com" } })
    submit()

    await waitFor(() => expect(checkoutBodies).toHaveLength(1))
    expect(checkoutBodies[0].billToEmail).toBe("dad@example.com")
  })

  it("omits billToEmail entirely when the box is left unchecked", async () => {
    await openDialog()
    submit()

    await waitFor(() => expect(checkoutBodies).toHaveLength(1))
    // Sending "" would fail the server's .email() validator and break every
    // ordinary sale, so the key must be absent — not empty.
    expect("billToEmail" in checkoutBodies[0]).toBe(false)
  })

  it("refuses to submit a ticked box with an empty address", async () => {
    const checkbox = await openDialog()
    fireEvent.click(checkbox)
    submit()

    // Never reaches the server: a blank address would silently fall back to the
    // client, which is the bug this feature exists to fix.
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(checkoutBodies).toHaveLength(0)
  })

  it("trims whitespace before sending", async () => {
    const checkbox = await openDialog()
    fireEvent.click(checkbox)
    fireEvent.change(screen.getByLabelText(/billing email/i), { target: { value: "  dad@example.com  " } })
    submit()

    await waitFor(() => expect(checkoutBodies).toHaveLength(1))
    // An untrimmed address fails .email() server-side for an invisible reason.
    expect(checkoutBodies[0].billToEmail).toBe("dad@example.com")
  })

  it("names the addressee on the finished link screen", async () => {
    const checkbox = await openDialog()
    fireEvent.click(checkbox)
    fireEvent.change(screen.getByLabelText(/billing email/i), { target: { value: "dad@example.com" } })
    submit()

    expect(await screen.findByText("dad@example.com")).toBeInTheDocument()
  })

  it("says the client is billed when no address was given", async () => {
    await openDialog()
    submit()
    expect(await screen.findByText("the client")).toBeInTheDocument()
  })

  it("hides the billing-email field until the box is ticked", async () => {
    await openDialog()
    expect(screen.queryByLabelText(/billing email/i)).not.toBeInTheDocument()
  })

  it("emails the link for the pack it just created", async () => {
    const checkbox = await openDialog()
    fireEvent.click(checkbox)
    fireEvent.change(screen.getByLabelText(/billing email/i), { target: { value: "dad@example.com" } })
    submit()

    fireEvent.click(await screen.findByRole("button", { name: /email this link/i }))

    // Must target the pack just sold, not some other id — this is the primary
    // flow: sell, then send it to the parent without leaving the dialog.
    await waitFor(() => expect(emailLinkCalls).toHaveLength(1))
    expect(emailLinkCalls[0]).toBe("/api/admin/session-packs/pack-1/email-link")
    expect(await screen.findByRole("button", { name: /emailed/i })).toBeInTheDocument()
  })
})
