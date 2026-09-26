// @vitest-environment node
//
// PATCH /api/notifications with {id}: G45. The route passes the SESSION's user
// to markAsRead, and a notification that is not the caller's reads as not
// found (404), never as a 500 and never with the row in the body.

import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const markAsReadMock = vi.fn()
const markAllAsReadMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/notifications", () => ({
  getNotifications: vi.fn(async () => []),
  markAsRead: (...a: unknown[]) => markAsReadMock(...a),
  markAllAsRead: (...a: unknown[]) => markAllAsReadMock(...a),
}))

import { PATCH } from "@/app/api/notifications/route"

const ID = "11111111-1111-4111-8111-111111111111"

function patch(body: unknown) {
  return new Request("http://localhost/api/notifications", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "me-user" } })
})

describe("PATCH /api/notifications {id}", () => {
  it("marks the notification as the SESSION's user, not merely by id", async () => {
    markAsReadMock.mockResolvedValue({ id: ID, user_id: "me-user", is_read: true })
    const res = await PATCH(patch({ id: ID }))
    expect(res.status).toBe(200)
    expect(markAsReadMock).toHaveBeenCalledWith("me-user", ID)
  })

  it("answers 404 with no row when the notification is not the caller's", async () => {
    markAsReadMock.mockResolvedValue(null)
    const res = await PATCH(patch({ id: ID }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Notification not found" })
  })

  it("still answers 401 without a session", async () => {
    authMock.mockResolvedValue(null)
    expect((await PATCH(patch({ id: ID }))).status).toBe(401)
    expect(markAsReadMock).not.toHaveBeenCalled()
  })
})
