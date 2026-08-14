import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ClientPackagesPanel } from "@/components/admin/packs/ClientPackagesPanel"
import type { PackWithCheckins } from "@/lib/services/client-packs-view"
import type { PackRenewalAttempt } from "@/types/database"

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const CLIENT = "22222222-2222-4222-8222-222222222222"

function pack(overrides: Partial<PackWithCheckins> = {}): PackWithCheckins {
  return {
    id: "pack-1",
    client_user_id: CLIENT,
    product_id: null,
    assignment_id: null,
    session_type: "1-on-1",
    credits_total: 10,
    credits_used: 3,
    price_cents: 75000,
    payment_method: "stripe",
    payment_status: "paid",
    stripe_session_id: null,
    stripe_payment_id: "pi_1",
    purchased_at: "2026-07-01T00:00:00Z",
    expires_at: null,
    status: "active",
    last_reminded_threshold: null,
    notes: null,
    bill_to_email: null,
    bill_to_emailed_at: null,
    auto_renew: false,
    renewed_from_package_id: null,
    renewal_attempted_at: null,
    created_by: "coach-1",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    checkins: [],
    program_name: null,
    ...overrides,
  }
}

function attempt(overrides: Partial<PackRenewalAttempt> = {}): PackRenewalAttempt {
  return {
    id: "attempt-1",
    source_package_id: "pack-0",
    new_package_id: "pack-1",
    user_id: CLIENT,
    billing_user_id: CLIENT,
    amount_cents: 75000,
    status: "succeeded",
    stripe_payment_intent_id: "pi_renew_1",
    failure_reason: null,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  }
}

/** Every PATCH body sent to an auto-renew toggle endpoint, keyed by URL. */
let patchCalls: { url: string; body: unknown }[]
let attemptsResponse: PackRenewalAttempt[]

function mockFetch() {
  patchCalls = []
  vi.spyOn(global, "fetch").mockImplementation((async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      patchCalls.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify({ ok: true, autoRenew: JSON.parse(String(init.body)).autoRenew }), {
        status: 200,
      })
    }
    // GET ?clientUserId= — attempts fetch
    return new Response(JSON.stringify({ packages: [], attempts: attemptsResponse }), { status: 200 })
  }) as unknown as typeof fetch)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  attemptsResponse = []
  mockFetch()
})

describe("<ClientPackagesPanel> — auto-renew", () => {
  it("reflects the pack's auto_renew state on its switch", () => {
    render(<ClientPackagesPanel clientUserId={CLIENT} initialPacks={[pack({ auto_renew: true })]} />)
    expect(screen.getByRole("switch")).toHaveAttribute("data-state", "checked")
  })

  it("PATCHes the pack's own auto-renew endpoint when the switch is flipped", async () => {
    render(<ClientPackagesPanel clientUserId={CLIENT} initialPacks={[pack({ id: "pack-9", auto_renew: false })]} />)
    fireEvent.click(screen.getByRole("switch"))

    await waitFor(() => expect(patchCalls).toHaveLength(1))
    expect(patchCalls[0].url).toBe("/api/admin/session-packs/pack-9/auto-renew")
    expect(patchCalls[0].body).toEqual({ autoRenew: true })
  })

  // M1: arming a DEPLETED pack passes every renewal guard immediately, so the
  // next sweep run charges it — not "when it runs out" the way the switch's
  // own label reads, since it already has. Confirmation is required only for
  // arm+depleted; disarming and arming a pack that still has credits are
  // unaffected (covered above).
  it("requires confirmation before PATCHing when arming auto-renew on an already-depleted pack", async () => {
    render(<ClientPackagesPanel clientUserId={CLIENT} initialPacks={[pack({ id: "pack-9", status: "depleted", auto_renew: false })]} />)
    fireEvent.click(screen.getByRole("switch"))

    expect(await screen.findByText(/charge the card on file now/i)).toBeInTheDocument()
    expect(patchCalls).toHaveLength(0)
  })

  it("PATCHes only after the depleted-pack confirmation is accepted", async () => {
    render(<ClientPackagesPanel clientUserId={CLIENT} initialPacks={[pack({ id: "pack-9", status: "depleted", auto_renew: false })]} />)
    fireEvent.click(screen.getByRole("switch"))
    fireEvent.click(await screen.findByRole("button", { name: /turn on and charge/i }))

    await waitFor(() => expect(patchCalls).toHaveLength(1))
    expect(patchCalls[0].url).toBe("/api/admin/session-packs/pack-9/auto-renew")
    expect(patchCalls[0].body).toEqual({ autoRenew: true })
  })

  it("does not ask for confirmation when disarming an already-depleted pack", async () => {
    render(<ClientPackagesPanel clientUserId={CLIENT} initialPacks={[pack({ id: "pack-9", status: "depleted", auto_renew: true })]} />)
    fireEvent.click(screen.getByRole("switch"))

    await waitFor(() => expect(patchCalls).toHaveLength(1))
    expect(patchCalls[0].body).toEqual({ autoRenew: false })
    expect(screen.queryByText(/charge the card on file now/i)).not.toBeInTheDocument()
  })

  it("does not ask for confirmation when arming a pack that still has credits", async () => {
    render(<ClientPackagesPanel clientUserId={CLIENT} initialPacks={[pack({ id: "pack-9", status: "active", auto_renew: false })]} />)
    fireEvent.click(screen.getByRole("switch"))

    await waitFor(() => expect(patchCalls).toHaveLength(1))
    expect(patchCalls[0].body).toEqual({ autoRenew: true })
  })

  it("shows an empty state when there are no renewal attempts yet", async () => {
    render(<ClientPackagesPanel clientUserId={CLIENT} initialPacks={[pack()]} />)
    expect(await screen.findByText(/no renewal attempts yet/i)).toBeInTheDocument()
  })

  it("lists renewal attempts with their status once loaded", async () => {
    attemptsResponse = [
      attempt({ id: "a1", status: "succeeded" }),
      attempt({ id: "a2", status: "failed", failure_reason: "Card declined" }),
    ]
    render(<ClientPackagesPanel clientUserId={CLIENT} initialPacks={[pack()]} />)

    expect(await screen.findByText("succeeded")).toBeInTheDocument()
    expect(screen.getByText("failed")).toBeInTheDocument()
    expect(screen.getByText("Card declined")).toBeInTheDocument()
  })
})
