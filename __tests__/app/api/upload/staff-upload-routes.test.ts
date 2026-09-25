// @vitest-environment node
//
// __tests__/app/api/upload/staff-upload-routes.test.ts
//
// Three upload routes a teammate's editor calls, and why each refused them.
//
// `/api/upload/*` sits OUTSIDE proxy.ts's matcher (it covers `/api/admin/*`
// only), so the proxy never stamps ADMIN_PATH_HEADER on these requests. Two
// shapes of the same bug followed:
//
//   - blog-image and extract-text checked `role !== "admin"` — owner only, so
//     a teammate holding `blog` could open the editor but not add an image or
//     draft from a document.
//   - funnel-image called `canAccessAdminPath(session.user)` with NO request.
//     That reads the header the proxy never sets here, finds it absent, and
//     denies every staff member — a permission check that could only ever say
//     no to the people it was written for.
//
// All three now pass the request, so the path comes from the URL itself and is
// resolved against the same registry rows every other guard reads.
//
// The REAL guard and registry run here. Only the session, the storage writes
// and next/headers (empty, as it is on these routes in production) are faked.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("@/lib/blog-storage", () => ({
  uploadBlogImage: vi.fn(async () => "https://storage.example/blog/cover/p1.png"),
}))
vi.mock("@/lib/funnel-storage", () => ({
  uploadFunnelImage: vi.fn(async () => ({ url: "https://storage.example/funnel-images/s1/a.png" })),
}))

import { auth } from "@/lib/auth"
import { uploadBlogImage } from "@/lib/blog-storage"
import { uploadFunnelImage } from "@/lib/funnel-storage"
import { POST as blogImagePOST } from "@/app/api/upload/blog-image/route"
import { POST as extractTextPOST } from "@/app/api/upload/extract-text/route"
import { POST as funnelImagePOST } from "@/app/api/upload/funnel-image/route"

type Session = { user: { id: string; role: string; permissions?: Record<string, unknown> } }

function as(session: Session | null) {
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(session)
}

const owner: Session = { user: { id: "owner", role: "admin" } }
/** The teammate who reported this: blog, social, seo, funnels, analytics. */
const marketer: Session = {
  user: {
    id: "zf",
    role: "staff",
    permissions: { blog: true, social: true, seo: true, funnels: true, analytics: "view" },
  },
}
/** Holds everything EXCEPT the two areas these routes belong to. */
const coach: Session = {
  user: { id: "coach", role: "staff", permissions: { clients: true, contacts: true, programs: true } },
}
const client: Session = { user: { id: "client", role: "client" } }

function png(): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", { type: "image/png" })
}

function post(path: string, fields: Record<string, string | File> = {}): Request {
  const body = new FormData()
  for (const [k, v] of Object.entries(fields)) body.append(k, v)
  return new Request(`http://localhost${path}`, { method: "POST", body })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/upload/blog-image", () => {
  const call = (fields?: Record<string, string | File>) => blogImagePOST(post("/api/upload/blog-image", fields))

  it("uploads for a teammate holding `blog`", async () => {
    // MUTANT: `role !== "admin"` — 403, and nothing is stored.
    as(marketer)
    const res = await call({ file: png(), postId: "p1" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: "https://storage.example/blog/cover/p1.png" })
    expect(uploadBlogImage).toHaveBeenCalledTimes(1)
  })

  it("refuses a teammate without `blog`", async () => {
    as(coach)
    const res = await call({ file: png() })
    expect(res.status).toBe(403)
    expect(uploadBlogImage).not.toHaveBeenCalled()
  })

  it("refuses a client and an anonymous caller", async () => {
    for (const s of [client, null]) {
      as(s)
      expect((await call({ file: png() })).status).toBe(403)
    }
    expect(uploadBlogImage).not.toHaveBeenCalled()
  })

  it("changes nothing for the owner", async () => {
    as(owner)
    expect((await call({ file: png() })).status).toBe(200)
  })
})

describe("POST /api/upload/extract-text", () => {
  const call = (fields?: Record<string, string | File>) => extractTextPOST(post("/api/upload/extract-text", fields))

  it("lets a teammate holding `blog` past the guard", async () => {
    // Past the guard = the file checks run. An empty form is the cheapest way
    // to reach them without parsing a real PDF.
    // MUTANT: `role !== "admin"` — 403 before the body is read.
    as(marketer)
    const res = await call()
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "No file provided" })
  })

  it("refuses a teammate without `blog`, a client and an anonymous caller", async () => {
    for (const s of [coach, client, null]) {
      as(s)
      expect((await call()).status).toBe(403)
    }
  })

  it("changes nothing for the owner", async () => {
    as(owner)
    expect((await call()).status).toBe(400)
  })
})

describe("POST /api/upload/funnel-image", () => {
  const valid = () => ({ file: png(), stepId: "step_1", width: "1200", height: "800" })
  const call = (fields?: Record<string, string | File>) => funnelImagePOST(post("/api/upload/funnel-image", fields))

  it("uploads for a teammate holding `funnels`", async () => {
    // MUTANT: `canAccessAdminPath(session.user)` with no request — reads the
    // header the proxy never sets on /api/upload, and denies.
    as(marketer)
    const res = await call(valid())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      url: "https://storage.example/funnel-images/s1/a.png",
      width: 1200,
      height: 800,
    })
    expect(uploadFunnelImage).toHaveBeenCalledTimes(1)
  })

  it("refuses a teammate holding `blog` but not `funnels`", async () => {
    // Holding the neighbouring marketing grant is not enough: the three routes
    // resolve to their OWN permissions, not to "any marketing teammate".
    as({ user: { id: "writer", role: "staff", permissions: { blog: true } } })
    expect((await call(valid())).status).toBe(403)
    expect(uploadFunnelImage).not.toHaveBeenCalled()
  })

  it("refuses a teammate without `funnels`, a client and an anonymous caller", async () => {
    for (const s of [coach, client, null]) {
      as(s)
      expect((await call(valid())).status).toBe(403)
    }
    expect(uploadFunnelImage).not.toHaveBeenCalled()
  })

  it("changes nothing for the owner", async () => {
    as(owner)
    expect((await call(valid())).status).toBe(200)
  })
})
