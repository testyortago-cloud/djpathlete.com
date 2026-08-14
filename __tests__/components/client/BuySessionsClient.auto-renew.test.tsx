import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { BuySessionsClient } from "@/components/client/BuySessionsClient"
import type { SessionPackProduct } from "@/types/database"

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

function product(overrides: Partial<SessionPackProduct> = {}): SessionPackProduct {
  return {
    id: "prod-1",
    name: "10-Pack",
    session_type: "1-on-1",
    credits: 10,
    price_cents: 75000,
    validity_days: null,
    stripe_price_id: null,
    is_active: true,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

/** Bodies of every POST to the self-checkout endpoint. */
let checkoutBodies: Record<string, unknown>[]

function mockFetch() {
  checkoutBodies = []
  vi.spyOn(global, "fetch").mockImplementation((async (_url: string, init?: RequestInit) => {
    checkoutBodies.push(JSON.parse(String(init?.body)))
    // No `url` in the response — avoids jsdom's unimplemented-navigation
    // noise from the component's `window.location.href = data.url` on
    // success; the request body is already captured by then regardless.
    return new Response(JSON.stringify({}), { status: 200 })
  }) as unknown as typeof fetch)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  mockFetch()
})

function autoRenewCheckbox() {
  return screen.getByRole("checkbox", { name: /automatically buy another/i })
}

describe("<BuySessionsClient> — auto-renew consent", () => {
  it("leaves auto-renew unchecked by default and names the credits and price in the label", () => {
    render(<BuySessionsClient products={[product()]} />)
    const box = autoRenewCheckbox()
    expect(box).not.toBeChecked()
    // Scoped to the checkbox's own label — the $750 price is also shown
    // separately as the product's headline price, so an unscoped text query
    // would match both and throw on ambiguity.
    expect(box.closest("label")).toHaveTextContent("10-session pack ($750)")
  })

  it("posts autoRenew: true to the checkout route when checked", async () => {
    render(<BuySessionsClient products={[product()]} />)
    fireEvent.click(autoRenewCheckbox())
    fireEvent.click(screen.getByRole("button", { name: /buy/i }))

    await waitFor(() => expect(checkoutBodies).toHaveLength(1))
    expect(checkoutBodies[0]).toEqual({ productId: "prod-1", autoRenew: true })
  })

  it("posts autoRenew: false to the checkout route when left unchecked", async () => {
    render(<BuySessionsClient products={[product()]} />)
    fireEvent.click(screen.getByRole("button", { name: /buy/i }))

    await waitFor(() => expect(checkoutBodies).toHaveLength(1))
    expect(checkoutBodies[0]).toEqual({ productId: "prod-1", autoRenew: false })
  })

  it("keeps each product's checkbox independent when more than one is shown", async () => {
    render(<BuySessionsClient products={[product(), product({ id: "prod-2", credits: 5, price_cents: 40000 })]} />)
    const boxes = screen.getAllByRole("checkbox", { name: /automatically buy another/i })
    expect(boxes).toHaveLength(2)

    fireEvent.click(boxes[0])
    expect(boxes[0]).toBeChecked()
    expect(boxes[1]).not.toBeChecked()

    fireEvent.click(screen.getAllByRole("button", { name: /buy/i })[1])
    await waitFor(() => expect(checkoutBodies).toHaveLength(1))
    expect(checkoutBodies[0]).toEqual({ productId: "prod-2", autoRenew: false })
  })
})
