import { describe, expect, it } from "vitest"
import {
  joinContentToRevenue,
  matchesSlug,
  type JoinerInput,
} from "@/lib/automation/content-revenue-joiner"

describe("matchesSlug", () => {
  it("matches exact path", () => {
    expect(matchesSlug("https://djp.com/blog/foo", "foo")).toBe(true)
    expect(matchesSlug("/blog/foo", "foo")).toBe(true)
  })
  it("matches trailing slash + query string", () => {
    expect(matchesSlug("/blog/foo/", "foo")).toBe(true)
    expect(matchesSlug("/blog/foo?utm=x", "foo")).toBe(true)
  })
  it("does not match a different slug", () => {
    expect(matchesSlug("/blog/foobar", "foo")).toBe(false)
    expect(matchesSlug("/blog/other", "foo")).toBe(false)
    expect(matchesSlug("/", "foo")).toBe(false)
  })
})

const empty: JoinerInput = { posts: [], gsc: [], attributions: [], payments: [] }

describe("joinContentToRevenue", () => {
  it("returns empty when no posts", () => {
    expect(joinContentToRevenue(empty)).toEqual([])
  })

  it("aggregates gsc clicks + impressions per post", () => {
    const r = joinContentToRevenue({
      ...empty,
      posts: [{ id: "p1", slug: "foo" }],
      gsc: [
        { page: "/blog/foo", clicks: 5, impressions: 100 },
        { page: "/blog/foo", clicks: 3, impressions: 50 },
        { page: "/blog/other", clicks: 99, impressions: 999 },
      ],
    })
    expect(r[0].gsc_clicks_7d).toBe(8)
    expect(r[0].gsc_impressions_7d).toBe(150)
  })

  it("counts sessions landing on the post (first-touch only)", () => {
    const r = joinContentToRevenue({
      ...empty,
      posts: [{ id: "p1", slug: "foo" }],
      attributions: [
        { user_id: "u1", landing_url: "/blog/foo" },
        { user_id: "u2", landing_url: "/blog/foo?utm=a" },
        { user_id: "u3", landing_url: "/" }, // not attributed
      ],
    })
    expect(r[0].sessions_from_post_7d).toBe(2)
  })

  it("attributes revenue from payments whose user landed on the post", () => {
    const r = joinContentToRevenue({
      ...empty,
      posts: [{ id: "p1", slug: "foo" }],
      attributions: [
        { user_id: "u1", landing_url: "/blog/foo" },
        { user_id: "u2", landing_url: "/" }, // didn't land here
      ],
      payments: [
        { user_id: "u1", amount_cents: 5000, status: "succeeded" },
        { user_id: "u2", amount_cents: 3000, status: "succeeded" },
      ],
    })
    expect(r[0].revenue_attributed_cents).toBe(5000)
  })

  it("ignores non-succeeded payments", () => {
    const r = joinContentToRevenue({
      ...empty,
      posts: [{ id: "p1", slug: "foo" }],
      attributions: [{ user_id: "u1", landing_url: "/blog/foo" }],
      payments: [
        { user_id: "u1", amount_cents: 5000, status: "failed" },
        { user_id: "u1", amount_cents: 7000, status: "refunded" },
      ],
    })
    expect(r[0].revenue_attributed_cents).toBe(0)
  })

  it("attributes a single user's full revenue (sum of all their succeeded payments)", () => {
    const r = joinContentToRevenue({
      ...empty,
      posts: [{ id: "p1", slug: "foo" }],
      attributions: [{ user_id: "u1", landing_url: "/blog/foo" }],
      payments: [
        { user_id: "u1", amount_cents: 1000, status: "succeeded" },
        { user_id: "u1", amount_cents: 2000, status: "succeeded" },
      ],
    })
    expect(r[0].revenue_attributed_cents).toBe(3000)
  })

  it("multiple posts, isolated math", () => {
    const r = joinContentToRevenue({
      posts: [
        { id: "p1", slug: "foo" },
        { id: "p2", slug: "bar" },
      ],
      gsc: [
        { page: "/blog/foo", clicks: 1, impressions: 10 },
        { page: "/blog/bar", clicks: 2, impressions: 20 },
      ],
      attributions: [
        { user_id: "u1", landing_url: "/blog/foo" },
        { user_id: "u2", landing_url: "/blog/bar" },
      ],
      payments: [
        { user_id: "u1", amount_cents: 100, status: "succeeded" },
        { user_id: "u2", amount_cents: 200, status: "succeeded" },
      ],
    })
    const foo = r.find((x) => x.blog_post_id === "p1")!
    const bar = r.find((x) => x.blog_post_id === "p2")!
    expect(foo.gsc_clicks_7d).toBe(1)
    expect(foo.revenue_attributed_cents).toBe(100)
    expect(bar.revenue_attributed_cents).toBe(200)
  })
})
