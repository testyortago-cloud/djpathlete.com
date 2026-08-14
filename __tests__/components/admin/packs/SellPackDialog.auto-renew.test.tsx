import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SellPackDialog } from "@/components/admin/packs/SellPackDialog"

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const CLIENT = "11111111-1111-4111-8111-111111111111"

/** Bodies of every POST to the sell-a-pack endpoint. */
let checkoutBodies: Record<string, unknown>[] = []

function mockFetch() {
  checkoutBodies = []
  vi.spyOn(global, "fetch").mockImplementation((async (url: string, init?: RequestInit) => {
    if (String(url).includes("/checkout")) {
      checkoutBodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ url: "https://stripe.test/cs_1", packageId: "pack-1" }), { status: 200 })
    }
    return new Response(JSON.stringify({ products: [], programs: [] }), { status: 200 })
  }) as unknown as typeof fetch)
}

/** Open the dialog (defaults to Stripe + custom/adhoc mode, since the mocked
 *  product catalogue is empty) and wait for its async loads to settle. */
async function openDialog() {
  render(<SellPackDialog clientUserId={CLIENT} onSold={() => {}} trigger={<button>Sell pack</button>} />)
  fireEvent.click(screen.getByText("Sell pack"))
  return screen.findByLabelText(/someone else is paying/i)
}

function autoRenewCheckbox() {
  return screen.getByRole("checkbox", { name: /automatically buy another/i })
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

describe("<SellPackDialog> — auto-renew consent", () => {
  it("leaves auto-renew unchecked by default and names the amount in the label", async () => {
    await openDialog()
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: "750" } })

    const box = autoRenewCheckbox()
    expect(box).not.toBeChecked()
    expect(screen.getByText(/\$750/)).toBeInTheDocument()
  })

  it("names the credit count in the label too", async () => {
    await openDialog()
    fireEvent.change(screen.getByLabelText(/sessions/i), { target: { value: "10" } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: "750" } })

    expect(screen.getByText(/10-session pack/i)).toBeInTheDocument()
  })

  it("posts autoRenew: true to the checkout route when checked", async () => {
    await openDialog()
    fireEvent.click(autoRenewCheckbox())
    submit()

    await waitFor(() => expect(checkoutBodies).toHaveLength(1))
    expect(checkoutBodies[0].autoRenew).toBe(true)
  })

  it("posts autoRenew: false to the checkout route when left unchecked", async () => {
    await openDialog()
    submit()

    await waitFor(() => expect(checkoutBodies).toHaveLength(1))
    expect(checkoutBodies[0].autoRenew).toBe(false)
  })

  it("turns auto-renew off and disables it when billing someone else, since there's no card to save", async () => {
    await openDialog()
    const box = autoRenewCheckbox()
    fireEvent.click(box)
    expect(box).toBeChecked()

    fireEvent.click(screen.getByLabelText(/someone else is paying/i))

    expect(box).not.toBeChecked()
    expect(box).toBeDisabled()
  })
})
