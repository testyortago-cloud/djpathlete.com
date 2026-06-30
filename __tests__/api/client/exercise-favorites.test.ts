import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const addFavorite = vi.fn()
const removeFavorite = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/exercise-favorites", () => ({
  addFavorite: (...a: unknown[]) => addFavorite(...a),
  removeFavorite: (...a: unknown[]) => removeFavorite(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { POST } from "@/app/api/client/exercise-favorites/route"

const UUID = "11111111-1111-1111-8111-111111111111"
function req(body: unknown) {
  return new Request("http://localhost/api/client/exercise-favorites", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  authMock.mockReset()
  addFavorite.mockReset()
  removeFavorite.mockReset()
})

describe("POST /api/client/exercise-favorites", () => {
  it("401s when unauthenticated", async () => {
    authMock.mockResolvedValue(null)
    const res = await POST(req({ exerciseId: UUID, favorited: true }))
    expect(res.status).toBe(401)
  })

  it("adds a favorite for the authed user, ignoring any body client id", async () => {
    authMock.mockResolvedValue({ user: { id: "me" } })
    const res = await POST(req({ exerciseId: UUID, favorited: true, clientUserId: "someone-else" }))
    expect(res.status).toBe(200)
    expect(addFavorite).toHaveBeenCalledWith("me", UUID, { createdBy: "me", source: "client" })
    expect(removeFavorite).not.toHaveBeenCalled()
  })

  it("removes a favorite when favorited=false", async () => {
    authMock.mockResolvedValue({ user: { id: "me" } })
    const res = await POST(req({ exerciseId: UUID, favorited: false }))
    expect(res.status).toBe(200)
    expect(removeFavorite).toHaveBeenCalledWith("me", UUID)
  })

  it("400s on a bad payload", async () => {
    authMock.mockResolvedValue({ user: { id: "me" } })
    const res = await POST(req({ exerciseId: "nope", favorited: true }))
    expect(res.status).toBe(400)
  })
})
