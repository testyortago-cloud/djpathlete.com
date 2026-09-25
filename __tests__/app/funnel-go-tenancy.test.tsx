// __tests__/app/funnel-go-tenancy.test.tsx
//
// /go/<slug>[/<step>] must resolve ITS OWN tenant from the request's Host
// (the ONE boundary, lib/tenancy/public.ts) and thread that exact value into
// getPublishedStep — never a hard-coded platform id, never a slug-only lookup
// that would hand one tenant's page to a visitor on a different tenant's host.
//
// Three behaviours, and the third is the one this repo's own notes call out
// as the easiest to get backwards:
//   1. a funnel slug belonging to the resolved tenant renders that tenant's
//      page (the resolved value is threaded straight into getPublishedStep);
//   2. a slug that belongs to a DIFFERENT tenant 404s through the SAME branch
//      an unknown slug takes — there is no separate "wrong tenant" page;
//   3. an UNCLAIMED host (every dev host, every preview deploy, every
//      *.vercel.app URL) must still serve the platform's funnels, not 404.
//
// resolvePublicTenant()'s own fallback contract (unknown host -> platform,
// warned once) is proven exhaustively in __tests__/lib/tenancy/public.test.ts.
// This file's job is narrower and page-specific: prove the page calls that
// ONE boundary, passes whatever it resolves straight through with no second
// host-resolution path, and never special-cases the value it gets back —
// which is exactly what would make behaviour 3 quietly 404 instead.

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolvePublicTenant: vi.fn(async () => "tenant-a"),
  getPublishedStep: vi.fn(async (..._a: unknown[]) => null as unknown),
  isBusinessMember: vi.fn(async (..._a: unknown[]) => false),
}))

// The ONE Host boundary. A page that reads the Host itself, or that falls
// back to platformBusinessId() directly instead of going through this seam,
// cannot pass the assertions below.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: mocks.resolvePublicTenant }))
vi.mock("@/lib/db/funnels", () => ({ getPublishedStep: mocks.getPublishedStep }))
vi.mock("@/lib/db/business-members", () => ({ isBusinessMember: mocks.isBusinessMember }))
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
// __tests__/setup.tsx mocks next/navigation globally with a `notFound`-less
// stub (router hooks only), so the real notFound() this page calls needs its
// OWN override here — the REAL implementation, not a stand-in, so the 404
// test below pins the actual digest Next throws, not an approximation of it.
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>()
  return { ...actual }
})

import Page, { generateMetadata } from "@/app/(funnel)/go/[slug]/[[...step]]/page"
import { auth } from "@/lib/auth"

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>

const PUBLISHED = {
  funnel: { id: "f1", name: "Free Guide", slug: "free-guide" },
  step: {
    id: "s1",
    funnel_id: "f1",
    slug: "start",
    name: "Start",
    is_entry: true,
    seo_title: null,
    seo_description: null,
    og_image_url: null,
    noindex: false,
  },
  nodes: [],
  css: "",
}

const noSearchParams = Promise.resolve({})

function paramsFor(slug: string, step: string[] = []) {
  return Promise.resolve({ slug, step })
}

beforeEach(() => {
  mocks.resolvePublicTenant.mockReset().mockResolvedValue("tenant-a")
  mocks.getPublishedStep.mockReset()
  mocks.isBusinessMember.mockReset().mockResolvedValue(false)
  mockAuth.mockReset().mockResolvedValue(null)
})

describe("/go/<slug> resolves the requesting Host's own tenant", () => {
  it("serves tenant A's funnel on tenant A's host", async () => {
    mocks.resolvePublicTenant.mockResolvedValue("tenant-a")
    mocks.getPublishedStep.mockResolvedValue(PUBLISHED)

    await Page({ params: paramsFor("free-guide"), searchParams: noSearchParams })

    expect(mocks.getPublishedStep).toHaveBeenCalledWith("tenant-a", "free-guide", undefined, {
      includeUnpublished: false,
    })
  })

  it("404s a slug that belongs to another tenant — the SAME path an unknown slug takes", async () => {
    // Tenant A's host, but "b-only" is tenant B's slug: getPublishedStep
    // filters on business_id internally, so this is exactly what it returns
    // for a slug that plain doesn't exist. There is no distinct "wrong
    // tenant" response for the page to produce here.
    mocks.resolvePublicTenant.mockResolvedValue("tenant-a")
    mocks.getPublishedStep.mockResolvedValue(null)

    await expect(Page({ params: paramsFor("b-only"), searchParams: noSearchParams })).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    )
  })

  it("still serves the platform's funnel on an unclaimed host, rather than 404ing", async () => {
    // MUTANT this pins: special-casing the platform id, or adding a second
    // host-resolution path, so that an unclaimed host — every dev host,
    // every preview deploy, every *.vercel.app URL — comes back empty. The
    // page must treat whatever resolvePublicTenant() resolves to (here
    // standing in for the platform fallback it already returns for an
    // unclaimed host) as an ordinary tenant and pass it straight through.
    mocks.resolvePublicTenant.mockResolvedValue("platform-biz")
    mocks.getPublishedStep.mockResolvedValue(PUBLISHED)

    const result = await Page({ params: paramsFor("free-guide"), searchParams: noSearchParams })

    expect(result).not.toBeNull()
    expect(mocks.getPublishedStep).toHaveBeenCalledWith("platform-biz", "free-guide", undefined, {
      includeUnpublished: false,
    })
  })

  it("generateMetadata resolves its own tenant and scopes the slug lookup to it", async () => {
    // Next calls generateMetadata and the page component as separate
    // invocations, so each has to resolve independently — this pins that
    // generateMetadata didn't skip it.
    mocks.resolvePublicTenant.mockResolvedValue("tenant-a")
    mocks.getPublishedStep.mockResolvedValue(PUBLISHED)

    await generateMetadata({ params: paramsFor("free-guide"), searchParams: noSearchParams })

    expect(mocks.getPublishedStep).toHaveBeenCalledWith("tenant-a", "free-guide", undefined)
  })

  it("threads the resolved tenant into a non-entry step lookup too", async () => {
    mocks.resolvePublicTenant.mockResolvedValue("tenant-a")
    mocks.getPublishedStep.mockResolvedValue({
      ...PUBLISHED,
      step: { ...PUBLISHED.step, slug: "thank-you", is_entry: false },
    })

    await Page({ params: paramsFor("free-guide", ["thank-you"]), searchParams: noSearchParams })

    expect(mocks.getPublishedStep).toHaveBeenCalledWith("tenant-a", "free-guide", "thank-you", {
      includeUnpublished: false,
    })
  })
})

// Whole-branch review item 2: `?preview=1` used to gate on the session's
// GLOBAL role alone. A staff member of tenant B could open tenant A's host
// with `?preview=1` and read A's unpublished funnel, because nothing checked
// which tenant they actually belong to. The fix requires MEMBERSHIP of the
// tenant being previewed (the Host's tenant), not merely the role.
//
// `getPublishedStep` here is host/tenant-aware only through `includeUnpublished`
// in this fake — it stands in for "the draft escalation actually fired",
// mirroring how the real DAL only returns unpublished rows when that flag is
// set.
describe("?preview=1 requires membership of the tenant being previewed", () => {
  beforeEach(() => {
    mocks.getPublishedStep.mockImplementation(async (..._args: unknown[]) => {
      const opts = _args[3] as { includeUnpublished?: boolean } | undefined
      return opts?.includeUnpublished ? PUBLISHED : null
    })
  })

  it("404s a staff member of tenant B previewing tenant A's unpublished funnel on tenant A's host", async () => {
    mocks.resolvePublicTenant.mockResolvedValue("tenant-a")
    mockAuth.mockResolvedValue({ user: { id: "staff-b", role: "staff" } })
    // NOT a member of tenant-a — the disclosure this fix closes.
    mocks.isBusinessMember.mockResolvedValue(false)

    await expect(
      Page({ params: paramsFor("free-guide"), searchParams: Promise.resolve({ preview: "1" }) }),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404")

    // MUTANT: checking `role` alone and never calling the membership check.
    expect(mocks.isBusinessMember).toHaveBeenCalledWith("tenant-a", "staff-b")
    expect(mocks.getPublishedStep).toHaveBeenCalledWith("tenant-a", "free-guide", undefined, {
      includeUnpublished: false,
    })
  })

  it("PERMISSIVE CONTROL: a staff member of tenant A still sees A's own unpublished draft", async () => {
    // Without this control, a broken gate that denies EVERY staff preview
    // would still pass the refusal test above.
    mocks.resolvePublicTenant.mockResolvedValue("tenant-a")
    mockAuth.mockResolvedValue({ user: { id: "staff-a", role: "staff" } })
    mocks.isBusinessMember.mockResolvedValue(true)

    const result = await Page({
      params: paramsFor("free-guide"),
      searchParams: Promise.resolve({ preview: "1" }),
    })

    expect(result).not.toBeNull()
    expect(mocks.isBusinessMember).toHaveBeenCalledWith("tenant-a", "staff-a")
    expect(mocks.getPublishedStep).toHaveBeenCalledWith("tenant-a", "free-guide", undefined, {
      includeUnpublished: true,
    })
  })

  it("an admin (operator) previews any tenant without a membership check", async () => {
    mocks.resolvePublicTenant.mockResolvedValue("tenant-a")
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })

    const result = await Page({
      params: paramsFor("free-guide"),
      searchParams: Promise.resolve({ preview: "1" }),
    })

    expect(result).not.toBeNull()
    expect(mocks.isBusinessMember).not.toHaveBeenCalled()
    expect(mocks.getPublishedStep).toHaveBeenCalledWith("tenant-a", "free-guide", undefined, {
      includeUnpublished: true,
    })
  })

  it("a client session never escalates, even with preview=1", async () => {
    mocks.resolvePublicTenant.mockResolvedValue("tenant-a")
    mockAuth.mockResolvedValue({ user: { id: "client-1", role: "client" } })

    await expect(
      Page({ params: paramsFor("free-guide"), searchParams: Promise.resolve({ preview: "1" }) }),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404")

    expect(mocks.isBusinessMember).not.toHaveBeenCalled()
    expect(mocks.getPublishedStep).toHaveBeenCalledWith("tenant-a", "free-guide", undefined, {
      includeUnpublished: false,
    })
  })

  it("a failed membership read fails closed — denies the escalation rather than throwing", async () => {
    mocks.resolvePublicTenant.mockResolvedValue("tenant-a")
    mockAuth.mockResolvedValue({ user: { id: "staff-a", role: "staff" } })
    mocks.isBusinessMember.mockRejectedValue(new Error("db unavailable"))

    await expect(
      Page({ params: paramsFor("free-guide"), searchParams: Promise.resolve({ preview: "1" }) }),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404")

    expect(mocks.getPublishedStep).toHaveBeenCalledWith("tenant-a", "free-guide", undefined, {
      includeUnpublished: false,
    })
  })
})
