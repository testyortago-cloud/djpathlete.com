import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { BuySessionsClient } from "@/components/client/BuySessionsClient"

beforeEach(() => {
  global.fetch = vi.fn() as never
})

const product = {
  id: "x",
  name: "10x 1-on-1",
  session_type: "1-on-1",
  credits: 10,
  price_cents: 50000,
  validity_days: 90,
  stripe_price_id: null,
  is_active: true,
  sort_order: 0,
  created_at: "",
  updated_at: "",
}

describe("BuySessionsClient", () => {
  it("lists products with prices and a buy button", () => {
    render(<BuySessionsClient products={[product as never]} />)
    expect(screen.getByText(/10x 1-on-1/)).toBeInTheDocument()
    // Scoped to the <p> price element — the consent checkbox label also
    // mentions the price now ("...($500)"), so an unscoped match is ambiguous.
    expect(screen.getByText(/\$500/, { selector: "p" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /buy/i })).toBeInTheDocument()
  })

  it("shows an empty state when no products are available", () => {
    render(<BuySessionsClient products={[]} />)
    expect(screen.getByText(/no sessions available/i)).toBeInTheDocument()
  })
})
