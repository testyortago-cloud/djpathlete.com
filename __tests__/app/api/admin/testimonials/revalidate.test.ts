import { describe, it, expect, vi, beforeEach } from "vitest"
import { revalidatePath } from "next/cache"

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", role: "admin" } })) }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn(async () => true) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/testimonials", () => ({
  getTestimonials: vi.fn(async () => []),
  createTestimonial: vi.fn(async (input: object) => ({ id: "t1", ...input })),
  updateTestimonial: vi.fn(async (id: string, u: object) => ({ id, ...u })),
  deleteTestimonial: vi.fn(async () => undefined),
}))

import { POST } from "@/app/api/admin/testimonials/route"
import { PATCH, DELETE } from "@/app/api/admin/testimonials/[id]/route"

const params = { params: Promise.resolve({ id: "t1" }) }
const json = (body: unknown) =>
  new Request("http://x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })

// The home page and /testimonials are ISR with `revalidate = 3600`, which also caches the
// Supabase read. A saved avatar stayed invisible on the live home page until these ran.
describe("testimonial writes refresh the public pages", () => {
  beforeEach(() => vi.mocked(revalidatePath).mockClear())

  it("PATCH (e.g. a new avatar) revalidates / and /testimonials", async () => {
    const res = await PATCH(json({ avatar_url: "https://x/a.png" }), params)
    expect(res.status).toBe(200)
    expect(revalidatePath).toHaveBeenCalledWith("/")
    expect(revalidatePath).toHaveBeenCalledWith("/testimonials")
  })

  it("POST revalidates both pages", async () => {
    const res = await POST(json({ name: "A", quote: "Q" }))
    expect(res.status).toBe(201)
    expect(revalidatePath).toHaveBeenCalledWith("/")
    expect(revalidatePath).toHaveBeenCalledWith("/testimonials")
  })

  it("DELETE revalidates both pages", async () => {
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), params)
    expect(res.status).toBe(200)
    expect(revalidatePath).toHaveBeenCalledWith("/")
    expect(revalidatePath).toHaveBeenCalledWith("/testimonials")
  })

  it("a refused PATCH revalidates nothing", async () => {
    const res = await PATCH(json({}), params)
    expect(res.status).toBe(400)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
