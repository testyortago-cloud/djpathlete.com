import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ProductCatalogueManager } from "@/components/admin/packs/ProductCatalogueManager"

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ products: [] }) }) as never
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

describe("ProductCatalogueManager", () => {
  it("renders existing products and a create form", () => {
    render(<ProductCatalogueManager initialProducts={[product as never]} />)
    expect(screen.getByText(/10x 1-on-1/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /add product/i })).toBeInTheDocument()
  })

  it("shows an empty hint when there are no products", () => {
    render(<ProductCatalogueManager initialProducts={[]} />)
    expect(screen.getByText(/no products/i)).toBeInTheDocument()
  })
})
