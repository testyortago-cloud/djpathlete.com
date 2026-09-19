// @vitest-environment node
//
// __tests__/app/sitemap-funnels.test.ts
//
// Published /go/ pages belong in the sitemap; noindexed ones do not. Before
// this feature `curl sitemap.xml | grep -c /go/` returned 0 against production
// while robots.txt allowed the whole prefix — crawlable and undiscoverable.
//
// The DAL is mocked because the CONDITIONS live in SQL and are pinned in
// `__tests__/db/funnels-published-steps.test.ts`; what this suite owns is the
// URL shape and the noindex exclusion at the point they reach the file.

import { beforeEach, describe, expect, it, vi } from "vitest"

const listPublishedFunnelSteps = vi.fn()

vi.mock("@/lib/db/funnels", () => ({ listPublishedFunnelSteps }))
vi.mock("@/lib/db/blog-posts", () => ({ getPublishedBlogPosts: vi.fn(async () => []) }))
vi.mock("@/lib/db/events", () => ({ getPublishedEvents: vi.fn(async () => []) }))
vi.mock("@/lib/db/shop-products", () => ({ listActiveProducts: vi.fn(async () => []) }))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "biz-1" }))

function entry(overrides: Record<string, unknown> = {}) {
  return {
    funnel: { name: "Athlete Performance Insight", slug: "athlete-quiz" },
    step: {
      name: "Start",
      slug: "start",
      is_entry: true,
      seo_title: null,
      seo_description: null,
      og_image_url: null,
      noindex: false,
    },
    updatedAt: "2026-09-19T00:00:00.000Z",
    ...overrides,
  }
}

async function urls() {
  const { default: sitemap } = await import("@/app/sitemap")
  return (await sitemap()).map((row) => row.url)
}

describe("sitemap — published funnel pages", () => {
  beforeEach(() => {
    vi.resetModules()
    listPublishedFunnelSteps.mockReset()
  })

  it("lists a published entry step at its bare funnel URL", async () => {
    listPublishedFunnelSteps.mockResolvedValue([entry()])
    const all = await urls()

    // MUTANT KILLED: dropping `...funnelPages` from the return. Verified red.
    expect(all).toContain("https://www.darrenjpaul.com/go/athlete-quiz")
    // The entry step must NOT also be advertised under its own slug — that is
    // the duplicate-content pair the canonical exists to resolve, and a
    // sitemap listing the non-canonical form argues with the page.
    expect(all).not.toContain("https://www.darrenjpaul.com/go/athlete-quiz/start")
  })

  it("lists a non-entry step under its slug", async () => {
    listPublishedFunnelSteps.mockResolvedValue([
      entry({
        funnel: { name: "Gap Map", slug: "gap-map" },
        step: { ...entry().step, name: "Thank you", slug: "thank-you", is_entry: false },
      }),
    ])
    expect(await urls()).toContain("https://www.darrenjpaul.com/go/gap-map/thank-you")
  })

  it("leaves out a noindexed step", async () => {
    // The DAL filters these out, so this asserts the CONTRACT rather than a
    // second filter: if `listPublishedFunnelSteps` ever stops excluding them,
    // this file must not start advertising them. It is paired with the
    // positive case above so it cannot pass by listing nothing at all.
    listPublishedFunnelSteps.mockResolvedValue([])
    const all = await urls()
    expect(all.some((url) => url.includes("/go/"))).toBe(false)
    // The presence control: the rest of the sitemap is still there, so an
    // empty funnel section is a real answer and not a collapsed sitemap.
    expect(all).toContain("https://www.darrenjpaul.com/online")
  })

  it("keeps the rest of the sitemap when the funnel read throws", async () => {
    // MUTANT KILLED: removing the try/catch. A DB blip must cost the funnel
    // section, never the 34 static URLs — the same degrade every other
    // dynamic block in this file already makes.
    listPublishedFunnelSteps.mockRejectedValue(new Error("connection refused"))
    const all = await urls()
    expect(all).toContain("https://www.darrenjpaul.com/online")
    expect(all.some((url) => url.includes("/go/"))).toBe(false)
  })

  it("carries the step's own updated_at as lastModified", async () => {
    listPublishedFunnelSteps.mockResolvedValue([entry({ updatedAt: "2026-03-04T05:06:07.000Z" })])
    const { default: sitemap } = await import("@/app/sitemap")
    const row = (await sitemap()).find((candidate) => candidate.url.includes("/go/"))
    // MUTANT KILLED: `lastModified: now`. A sitemap that reports every funnel
    // as modified on every crawl is a sitemap whose dates mean nothing.
    expect(new Date(row!.lastModified as Date).toISOString()).toBe("2026-03-04T05:06:07.000Z")
  })
})
