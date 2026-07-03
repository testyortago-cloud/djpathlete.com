import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MembershipPlansManager } from "@/components/admin/billing/MembershipPlansManager"

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ plans: [] }) }) as never
})

const plan = {
  id: "x",
  name: "2x / week",
  price_cents: 12000,
  billing_interval: "month",
  sessions_per_period: 8,
  stripe_price_id: null,
  is_active: true,
  sort_order: 0,
  created_at: "",
  updated_at: "",
}

describe("MembershipPlansManager", () => {
  it("lists plans and a create form", () => {
    render(<MembershipPlansManager initialPlans={[plan as never]} />)
    expect(screen.getByText(/2x \/ week/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /add plan/i })).toBeInTheDocument()
  })

  it("shows an empty hint with no plans", () => {
    render(<MembershipPlansManager initialPlans={[]} />)
    expect(screen.getByText(/no plans/i)).toBeInTheDocument()
  })
})
