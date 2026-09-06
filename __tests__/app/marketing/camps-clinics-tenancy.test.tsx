// __tests__/app/marketing/camps-clinics-tenancy.test.tsx
//
// The four public camps/clinics pages must read only the requesting host's
// own events. Each page (or its generateMetadata) resolves the tenant
// through the ONE Host boundary (lib/tenancy/public.ts) and threads that
// exact value into the events DAL — never the platform id, never
// expect.any(String).
//
// Pages are invoked directly and asserted on via the DAL mock calls, the
// same pattern as __tests__/app/ask-page.test.tsx: calling the async page
// function builds its React element tree without executing any child
// component (React doesn't call a component function until something
// actually renders it), so the only code that runs is the page body itself.
// That means the child components below never need real mocking beyond
// satisfying their own module imports — none of them touch the DB or the
// tenancy boundary at module scope.

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Event } from "@/types/database"

const mocks = vi.hoisted(() => ({
  getPublishedEvents: vi.fn(async (..._a: unknown[]) => [] as unknown[]),
  getEventBySlug: vi.fn(async (..._a: unknown[]) => null as unknown),
  getActiveDocument: vi.fn(async (..._a: unknown[]) => null as unknown),
  getBusinessSettings: vi.fn(async (..._a: unknown[]) => ({ display_name: "" }) as unknown),
}))

vi.mock("@/lib/db/events", () => ({
  getPublishedEvents: (...a: unknown[]) => mocks.getPublishedEvents(...a),
  getEventBySlug: (...a: unknown[]) => mocks.getEventBySlug(...a),
}))
vi.mock("@/lib/db/legal-documents", () => ({
  getActiveDocument: (...a: unknown[]) => mocks.getActiveDocument(...a),
}))
vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: (...a: unknown[]) => mocks.getBusinessSettings(...a),
}))
// The ONE Host boundary. Mocked to a sentinel that is NOT the platform id, so
// a page that hard-codes platformBusinessId() (or resolves it any other way)
// cannot pass these assertions.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
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

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getPublishedEvents.mockResolvedValue([])
  mocks.getEventBySlug.mockResolvedValue(null)
  mocks.getActiveDocument.mockResolvedValue(null)
  mocks.getBusinessSettings.mockResolvedValue({ display_name: "" })
})

describe("camps list is scoped to the host's business", () => {
  it("passes the host business to getPublishedEvents", async () => {
    const { default: Page } = await import("@/app/(marketing)/camps/page")
    await Page()
    expect(mocks.getPublishedEvents).toHaveBeenCalledWith("host-biz", { type: "camp" })
  })
})

describe("clinics list is scoped to the host's business", () => {
  it("passes the host business to getPublishedEvents", async () => {
    const { default: Page } = await import("@/app/(marketing)/clinics/page")
    await Page()
    expect(mocks.getPublishedEvents).toHaveBeenCalledWith("host-biz", { type: "clinic" })
  })
})

describe("camp detail page is scoped to the host's business", () => {
  it("passes the host business to getEventBySlug", async () => {
    mocks.getEventBySlug.mockResolvedValue(FAKE_CAMP)
    const { default: Page } = await import("@/app/(marketing)/camps/[slug]/page")
    await Page({ params: Promise.resolve({ slug: "test-camp" }) })
    expect(mocks.getEventBySlug).toHaveBeenCalledWith("host-biz", "test-camp")
  })

  it("reuses the resolved tenant for the business-settings read (does not resolve twice)", async () => {
    mocks.getEventBySlug.mockResolvedValue(FAKE_CAMP)
    const { default: Page } = await import("@/app/(marketing)/camps/[slug]/page")
    await Page({ params: Promise.resolve({ slug: "test-camp" }) })
    expect(mocks.getBusinessSettings).toHaveBeenCalledWith("host-biz")
  })

  it("generateMetadata resolves its own tenant and scopes the slug lookup to it", async () => {
    mocks.getEventBySlug.mockResolvedValue(FAKE_CAMP)
    const { generateMetadata } = await import("@/app/(marketing)/camps/[slug]/page")
    await generateMetadata({ params: Promise.resolve({ slug: "test-camp" }) })
    expect(mocks.getEventBySlug).toHaveBeenCalledWith("host-biz", "test-camp")
  })

  it("has no generateStaticParams", async () => {
    const mod = await import("@/app/(marketing)/camps/[slug]/page")
    expect((mod as { generateStaticParams?: unknown }).generateStaticParams).toBeUndefined()
  })
})

describe("clinic detail page is scoped to the host's business", () => {
  it("passes the host business to getEventBySlug", async () => {
    mocks.getEventBySlug.mockResolvedValue(FAKE_CLINIC)
    const { default: Page } = await import("@/app/(marketing)/clinics/[slug]/page")
    await Page({ params: Promise.resolve({ slug: "test-clinic" }) })
    expect(mocks.getEventBySlug).toHaveBeenCalledWith("host-biz", "test-clinic")
  })

  it("reuses the resolved tenant for the business-settings read (does not resolve twice)", async () => {
    mocks.getEventBySlug.mockResolvedValue(FAKE_CLINIC)
    const { default: Page } = await import("@/app/(marketing)/clinics/[slug]/page")
    await Page({ params: Promise.resolve({ slug: "test-clinic" }) })
    expect(mocks.getBusinessSettings).toHaveBeenCalledWith("host-biz")
  })

  it("generateMetadata resolves its own tenant and scopes the slug lookup to it", async () => {
    mocks.getEventBySlug.mockResolvedValue(FAKE_CLINIC)
    const { generateMetadata } = await import("@/app/(marketing)/clinics/[slug]/page")
    await generateMetadata({ params: Promise.resolve({ slug: "test-clinic" }) })
    expect(mocks.getEventBySlug).toHaveBeenCalledWith("host-biz", "test-clinic")
  })

  it("has no generateStaticParams", async () => {
    const mod = await import("@/app/(marketing)/clinics/[slug]/page")
    expect((mod as { generateStaticParams?: unknown }).generateStaticParams).toBeUndefined()
  })
})
