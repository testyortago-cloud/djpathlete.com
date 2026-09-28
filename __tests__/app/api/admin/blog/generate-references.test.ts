// @vitest-environment node
//
// The owner attached four example posts to "Generate with AI" and every
// attempt answered "Invalid request." (2026-09-29). The dialog allowed five
// documents; this route allowed three, and its error named neither.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn(async () => true) }))
vi.mock("@/lib/ai-jobs", () => ({ findInFlightBlogGeneration: vi.fn(async () => null) }))
const set = vi.fn(async () => undefined)
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ id: "job-1", set }) }) }),
}))
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "ts" } }))

import { auth } from "@/lib/auth"
import { POST } from "@/app/api/admin/blog/generate/route"
import { MAX_REFERENCE_FILES, MAX_REFERENCE_FILE_CHARS } from "@/lib/blog/reference-limits"

function docs(n: number, chars = 2_000) {
  return Array.from({ length: n }, (_, i) => ({ name: `${i + 1}.pdf`, content: "x".repeat(chars) }))
}

// A distinct user per request: the route rate-limits 5 per minute per user.
let user = 0
function generate(fileContents: { name: string; content: string }[]) {
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: `u${++user}`, role: "admin" } })
  return POST(
    new Request("http://localhost/api/admin/blog/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Redo this article in more basic layman terminology",
        primary_keyword: "injured athletes",
        references: { file_contents: fileContents },
      }),
    }) as never,
  )
}

beforeEach(() => vi.clearAllMocks())

describe("POST /api/admin/blog/generate — attached documents", () => {
  it("accepts the four documents from the owner's recording", async () => {
    // MUTANT: `.max(3)` — the original bug, a 400.
    const res = await generate(docs(4))
    expect(res.status).toBe(202)
    expect(set).toHaveBeenCalledTimes(1)
  })

  it("accepts as many documents as the dialog allows", async () => {
    const res = await generate(docs(MAX_REFERENCE_FILES))
    expect(res.status).toBe(202)
  })

  it("refuses one more than that and says why", async () => {
    const res = await generate(docs(MAX_REFERENCE_FILES + 1))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(`Couldn't start: Attach at most ${MAX_REFERENCE_FILES} documents.`)
    expect(set).not.toHaveBeenCalled()
  })

  it("names an over-long document rather than a bare Invalid request", async () => {
    const res = await generate(docs(1, MAX_REFERENCE_FILE_CHARS + 1))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Couldn't start: Each document must be under 50,000 characters.")
  })
})
