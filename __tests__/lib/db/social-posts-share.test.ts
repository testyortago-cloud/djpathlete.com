import { describe, it, expect, vi, beforeEach } from "vitest"

const calls: Array<[string, ...unknown[]]> = []
let result: { data: unknown; error: unknown } = { data: null, error: null }
const builder: Record<string, (...args: unknown[]) => unknown> = {}
for (const m of ["select", "eq", "not", "order", "limit"]) {
  builder[m] = (...args: unknown[]) => {
    calls.push([m, ...args])
    return builder
  }
}
builder.maybeSingle = () => Promise.resolve(result)
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (t: string) => {
      calls.push(["from", t])
      return builder
    },
  }),
}))

import { findOpenShareDraft } from "@/lib/db/social-posts"

beforeEach(() => {
  calls.length = 0
  result = { data: null, error: null }
})

describe("findOpenShareDraft", () => {
  it("looks for an un-posted LinkedIn draft from the same blog post", async () => {
    result = { data: { id: "sp-1" }, error: null }
    const found = await findOpenShareDraft({ blogPostId: "blog-1" })
    expect(found).toEqual({ id: "sp-1" })
    expect(calls).toContainEqual(["from", "social_posts"])
    expect(calls).toContainEqual(["eq", "platform", "linkedin"])
    expect(calls).toContainEqual(["eq", "source_blog_post_id", "blog-1"])
    expect(calls).toContainEqual(["not", "approval_status", "in", "(published,rejected)"])
  })

  it("keys a newsletter share on source_newsletter_id, not the blog column", async () => {
    await findOpenShareDraft({ newsletterId: "nl-1" })
    expect(calls).toContainEqual(["eq", "source_newsletter_id", "nl-1"])
    expect(calls.some((c) => c[1] === "source_blog_post_id")).toBe(false)
  })

  it("rethrows a database error instead of reporting 'no draft'", async () => {
    result = { data: null, error: { code: "42703", message: "column does not exist" } }
    await expect(findOpenShareDraft({ blogPostId: "blog-1" })).rejects.toMatchObject({ code: "42703" })
  })
})
