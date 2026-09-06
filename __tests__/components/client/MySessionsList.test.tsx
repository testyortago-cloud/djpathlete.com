// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MySessionsList } from "@/components/client/MySessionsList"

const base = {
  id: "p1",
  client_user_id: "c1",
  product_id: null,
  assignment_id: null,
  session_type: "1-on-1",
  credits_total: 10,
  credits_used: 4,
  price_cents: 0,
  payment_method: "comp",
  payment_status: "not_required",
  stripe_session_id: null,
  stripe_payment_id: null,
  purchased_at: "2026-06-01T00:00:00Z",
  expires_at: null,
  status: "active",
  last_reminded_threshold: null,
  notes: null,
  created_by: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  checkins: [],
  program_name: null,
}

describe("MySessionsList", () => {
  it("shows remaining/total for an active pack", () => {
    render(<MySessionsList packs={[base as never]} />)
    expect(screen.getByText(/6/)).toBeInTheDocument()
    expect(screen.getByText(/1-on-1/i)).toBeInTheDocument()
  })

  it("renders an empty state when there are no packs", () => {
    render(<MySessionsList packs={[]} />)
    expect(screen.getByText(/no .*sessions/i)).toBeInTheDocument()
  })
})
