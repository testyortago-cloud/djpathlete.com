// __tests__/app/marketing/event-success-tenancy.test.ts
//
// The camps/clinics post-purchase success pages read a signup by its Stripe
// session id — a lookup that is DELIBERATELY unscoped (see
// getEventSignupByStripeSessionId's own doc comment in lib/db/event-signups.ts).
// That comment claims, in the present tense, that its callers guard: "the
// camps/clinics success pages compare the returned row's business_id against
// the host's resolved business and 404 on a mismatch." This suite is what
// makes that claim true, and pins it so it stays true.
//
// "It 404s on a mismatch" passes just as well if the page rendered nothing at
// all, or an unrelated error threw first. Every mismatch test below is paired
// with a presence-control test asserting the SAME page does NOT 404 when the
// signup's business_id matches the host — proving the guard, not just its
// absence-of-success case.
//
// Pages are invoked directly and asserted on via the DAL mock calls and the
// notFound mock, the same pattern as camps-clinics-tenancy.test.tsx: calling
// the async page function builds its React element tree without executing any
// child component, so nothing beyond the page body itself needs mocking.

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Event, EventSignup } from "@/types/database"

const mocks = vi.hoisted(() => ({
  getEventBySlug: vi.fn(async (..._a: unknown[]) => null as unknown),
  getEventById: vi.fn(async (..._a: unknown[]) => null as unknown),
  getEventSignupByStripeSessionId: vi.fn(async (..._a: unknown[]) => null as unknown),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))

vi.mock("@/lib/db/events", () => ({
  getEventBySlug: (...a: unknown[]) => mocks.getEventBySlug(...a),
  getEventById: (...a: unknown[]) => mocks.getEventById(...a),
}))
vi.mock("@/lib/db/event-signups", () => ({
  getEventSignupByStripeSessionId: (...a: unknown[]) => mocks.getEventSignupByStripeSessionId(...a),
}))
// The ONE Host boundary. Mocked to a sentinel that is NOT the platform id, so
// a page that hard-codes platformBusinessId() (or resolves it any other way)
// cannot pass these assertions.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))
vi.mock("next/navigation", () => ({
  notFound: () => mocks.notFound(),
}))

const FAKE_CAMP: Event = {
  id: "11111111-1111-1111-1111-111111111111",
  business_id: "host-biz",
  type: "camp",
  slug: "test-camp",
  title: "Test Camp",
  summary: "A test camp",
  description: "Line one.\n\nLine two.",
  focus_areas: [],
  audience: [],
  start_date: "2027-01-01T14:00:00.000Z",
  end_date: "2027-01-02T14:00:00.000Z",
  session_schedule: null,
  location_name: "Test Field",
  location_address: null,
  location_map_url: null,
  age_min: 14,
  age_max: 17,
  capacity: 8,
  signup_count: 2,
  price_cents: 50000,
  stripe_product_id: null,
  stripe_price_id: null,
  status: "published",
  hero_image_url: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
}

const FAKE_CLINIC: Event = { ...FAKE_CAMP, type: "clinic", slug: "test-clinic", title: "Test Clinic" }

function fakeSignup(businessId: string): EventSignup {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    event_id: FAKE_CAMP.id,
    business_id: businessId,
    signup_type: "paid",
    parent_name: "Parent Name",
    parent_email: "parent@example.com",
    parent_phone: null,
    athlete_name: "Athlete Name",
    athlete_age: 15,
    sport: null,
    notes: null,
    status: "confirmed",
    stripe_session_id: "cs_1",
    stripe_payment_intent_id: null,
    amount_paid_cents: 50000,
    user_id: null,
    waiver_accepted_at: null,
    waiver_document_id: null,
    waiver_ip_address: null,
    waiver_user_agent: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    gclid: null,
    gbraid: null,
    wbraid: null,
    fbclid: null,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getEventBySlug.mockResolvedValue(null)
  mocks.getEventById.mockResolvedValue(null)
  mocks.getEventSignupByStripeSessionId.mockResolvedValue(null)
  mocks.notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND")
  })
})

describe("camp success page enforces signup ownership", () => {
  it("passes the host business to getEventBySlug", async () => {
    mocks.getEventBySlug.mockResolvedValue(FAKE_CAMP)
    const { default: Page } = await import("@/app/(marketing)/camps/[slug]/success/page")
    await Page({
      params: Promise.resolve({ slug: "test-camp" }),
      searchParams: Promise.resolve({}),
    } as never)
    expect(mocks.getEventBySlug).toHaveBeenCalledWith("host-biz", "test-camp")
  })

  it("404s when the signup belongs to a different business than the host", async () => {
    mocks.getEventBySlug.mockResolvedValue(FAKE_CAMP)
    mocks.getEventSignupByStripeSessionId.mockResolvedValue(fakeSignup("other-biz"))
    const { default: Page } = await import("@/app/(marketing)/camps/[slug]/success/page")
    await expect(
      Page({
        params: Promise.resolve({ slug: "test-camp" }),
        searchParams: Promise.resolve({ session_id: "cs_1" }),
      } as never),
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.notFound).toHaveBeenCalled()
  })

  it("renders when the signup belongs to the host's business (presence control)", async () => {
    mocks.getEventBySlug.mockResolvedValue(FAKE_CAMP)
    mocks.getEventSignupByStripeSessionId.mockResolvedValue(fakeSignup("host-biz"))
    const { default: Page } = await import("@/app/(marketing)/camps/[slug]/success/page")
    const result = await Page({
      params: Promise.resolve({ slug: "test-camp" }),
      searchParams: Promise.resolve({ session_id: "cs_1" }),
    } as never)
    expect(result).toBeTruthy()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
})

describe("clinic success page enforces signup ownership", () => {
  it("passes the host business to getEventBySlug", async () => {
    mocks.getEventBySlug.mockResolvedValue(FAKE_CLINIC)
    const { default: Page } = await import("@/app/(marketing)/clinics/[slug]/success/page")
    await Page({
      params: Promise.resolve({ slug: "test-clinic" }),
      searchParams: Promise.resolve({}),
    } as never)
    expect(mocks.getEventBySlug).toHaveBeenCalledWith("host-biz", "test-clinic")
  })

  it("404s when the signup belongs to a different business than the host", async () => {
    mocks.getEventBySlug.mockResolvedValue(FAKE_CLINIC)
    mocks.getEventSignupByStripeSessionId.mockResolvedValue(fakeSignup("other-biz"))
    const { default: Page } = await import("@/app/(marketing)/clinics/[slug]/success/page")
    await expect(
      Page({
        params: Promise.resolve({ slug: "test-clinic" }),
        searchParams: Promise.resolve({ session_id: "cs_1" }),
      } as never),
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.notFound).toHaveBeenCalled()
  })

  it("renders when the signup belongs to the host's business (presence control)", async () => {
    mocks.getEventBySlug.mockResolvedValue(FAKE_CLINIC)
    mocks.getEventSignupByStripeSessionId.mockResolvedValue(fakeSignup("host-biz"))
    const { default: Page } = await import("@/app/(marketing)/clinics/[slug]/success/page")
    const result = await Page({
      params: Promise.resolve({ slug: "test-clinic" }),
      searchParams: Promise.resolve({ session_id: "cs_1" }),
    } as never)
    expect(result).toBeTruthy()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
})

describe("EventIsland is scoped to the host's business", () => {
  it("passes the host business to getEventById", async () => {
    mocks.getEventById.mockResolvedValue({ ...FAKE_CAMP, status: "published" })
    const { EventIsland } = await import("@/components/funnels/islands/EventIsland")
    await EventIsland({ props: { eventId: FAKE_CAMP.id } })
    expect(mocks.getEventById).toHaveBeenCalledWith("host-biz", FAKE_CAMP.id)
  })
})
