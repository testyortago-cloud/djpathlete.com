// @vitest-environment node
//
// __tests__/app/og-funnel-card.test.ts
//
// The generated share card at /og/funnel/<slug>[/<step>].
//
// WHAT THIS SUITE CAN AND CANNOT SEE. It runs the route and asserts the
// RESPONSE — that a PNG comes back, and that it comes back even when the row
// cannot be read. It does not look at the pixels; the card was verified by eye
// against a running server and the shot is in
// `screenshots/funnel-seo-panel/04-the-generated-share-card.png`.
//
// The one behaviour worth a test more than the drawing is the DEGRADE. A
// scraper that gets a 500 here shows no card at all, which is exactly the
// state this whole change exists to fix — so "unreadable row still returns an
// image" is the assertion that protects the feature from itself.

import { beforeEach, describe, expect, it, vi } from "vitest"

const getPublishedStep = vi.fn()
vi.mock("@/lib/db/funnels", () => ({ getPublishedStep }))
// The ONE Host boundary. Mocked to a sentinel that is NOT the platform id, so
// a route that hard-codes platformBusinessId() (or resolves it any other way)
// cannot pass the assertions below.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "og-biz" }))

const PUBLISHED = {
  funnel: { name: "Athlete Performance Insight", slug: "athlete-quiz" },
  step: {
    name: "Start",
    slug: "start",
    is_entry: true,
    seo_title: "Athlete Performance Quiz — 5 Questions, Free",
    seo_description: "Free athlete performance quiz for ages 13-25.",
    og_image_url: null,
    noindex: false,
  },
}

async function render(slug: string, step?: string[]) {
  const { GET } = await import("@/app/og/funnel/[slug]/[[...step]]/route")
  return GET(new Request("http://localhost/og/funnel/x"), {
    params: Promise.resolve({ slug, step }),
  })
}

describe("/og/funnel — the generated share card", () => {
  beforeEach(() => {
    vi.resetModules()
    getPublishedStep.mockReset()
  })

  it("returns a PNG for a published step", async () => {
    getPublishedStep.mockResolvedValue(PUBLISHED)
    const response = await render("athlete-quiz")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("image/png")
    // Non-trivial: an empty or near-empty body is a card that renders as a
    // broken image in the unfurl, which a status check alone would pass.
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(5_000)
  })

  it("looks the step up by the slug AND the step segment it was given", async () => {
    getPublishedStep.mockResolvedValue(PUBLISHED)
    await render("gap-map", ["thank-you"])
    // MUTANT KILLED: ignoring `step` and always reading the entry step, which
    // would draw the entry page's title onto every inner page's card — wrong,
    // and invisible, because a card still comes back.
    expect(getPublishedStep).toHaveBeenCalledWith("og-biz", "gap-map", "thank-you")
  })

  it("reads the entry step when there is no step segment", async () => {
    getPublishedStep.mockResolvedValue(PUBLISHED)
    await render("athlete-quiz")
    expect(getPublishedStep).toHaveBeenCalledWith("og-biz", "athlete-quiz", undefined)
  })

  it("still returns an image when the row cannot be read", async () => {
    // THE ONE THAT MATTERS. A throw here becomes a 500, and a 500 becomes no
    // share card at all.
    getPublishedStep.mockRejectedValue(new Error("connection refused"))
    const response = await render("athlete-quiz")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("image/png")
  })

  it("still returns an image for a slug that does not exist", async () => {
    getPublishedStep.mockResolvedValue(null)
    const response = await render("never-existed")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("image/png")
  })
})
