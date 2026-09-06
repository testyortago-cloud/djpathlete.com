// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MyCardPanel } from "@/components/client/MyCardPanel"
import type { ClientPackage, UserPaymentMethod } from "@/types/database"

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const CARD: UserPaymentMethod = {
  id: "pm-1",
  user_id: "client-1",
  stripe_payment_method_id: "pm_stripe_1",
  brand: "visa",
  last4: "4242",
  exp_month: 12,
  exp_year: 2030,
  is_default: true,
  created_at: "2026-07-01T00:00:00Z",
}

function pack(overrides: Partial<ClientPackage> = {}) {
  return {
    id: "pack-1",
    session_type: "1-on-1",
    credits_total: 10,
    price_cents: 75000,
    auto_renew: true,
    ...overrides,
  } as Pick<ClientPackage, "id" | "session_type" | "credits_total" | "price_cents" | "auto_renew">
}

let patchCalls: { url: string; body: unknown }[]

function mockFetch() {
  patchCalls = []
  vi.spyOn(global, "fetch").mockImplementation((async (url: string, init?: RequestInit) => {
    patchCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify({ ok: true, autoRenew: false }), { status: 200 })
  }) as unknown as typeof fetch)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  mockFetch()
})

describe("<MyCardPanel> — auto-renew", () => {
  it("shows nothing extra when no pack has auto-renew armed", () => {
    render(<MyCardPanel card={CARD} packs={[pack({ auto_renew: false })]} />)
    expect(screen.queryByText(/turn off/i)).not.toBeInTheDocument()
  })

  it("names the pack, credits and price, with an always-visible off switch", () => {
    render(<MyCardPanel card={CARD} packs={[pack({ session_type: "1-on-1", credits_total: 10, price_cents: 75000 })]} />)
    expect(screen.getByText(/10-session pack/i)).toBeInTheDocument()
    expect(screen.getByText(/\$750/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /turn off/i })).toBeInTheDocument()
  })

  it("PATCHes the client's own auto-renew endpoint with autoRenew: false when turned off", async () => {
    render(<MyCardPanel card={CARD} packs={[pack({ id: "pack-7" })]} />)
    fireEvent.click(screen.getByRole("button", { name: /turn off/i }))

    await waitFor(() => expect(patchCalls).toHaveLength(1))
    expect(patchCalls[0].url).toBe("/api/client/session-packs/pack-7/auto-renew")
    expect(patchCalls[0].body).toEqual({ autoRenew: false })
  })

  it("still offers the off switch even when the card itself has been removed", () => {
    // auto_renew can outlive the card (removing a card doesn't clear it) —
    // the client must still be able to see and disarm it.
    render(<MyCardPanel card={null} packs={[pack({ auto_renew: true })]} />)
    expect(screen.getByRole("button", { name: /turn off/i })).toBeInTheDocument()
  })
})
