// @vitest-environment node
//
// G45: markAsRead updated a notification by id alone, so PATCH
// /api/notifications with {id} marked ANYONE's notification read, and the
// response handed back that row (its title and message) to whoever asked.
// It is now scoped to the caller's own notification.
//
// The fake APPLIES the filters it is given. A fake that answered the same row
// whatever it was asked is exactly how a missing predicate passes a test.

import { describe, it, expect, vi, beforeEach } from "vitest"

const MINE = "11111111-1111-4111-8111-111111111111"
const THEIRS = "22222222-2222-4222-8222-222222222222"
const ME = "me-user"
const THEM = "them-user"

let rows: Record<string, unknown>[] = []
let updateFilters: { col: string; val: unknown }[] = []

function makeClient() {
  return {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const filters: { col: string; val: unknown }[] = []
        const chain = {
          eq: (col: string, val: unknown) => {
            filters.push({ col, val })
            updateFilters.push({ col, val })
            return chain
          },
          select: () => ({
            maybeSingle: async () => {
              const match = rows.find((r) => filters.every((f) => r[f.col] === f.val))
              if (!match) return { data: null, error: null }
              Object.assign(match, patch)
              return { data: { ...match }, error: null }
            },
            single: async () => {
              const match = rows.find((r) => filters.every((f) => r[f.col] === f.val))
              if (!match) return { data: null, error: { code: "PGRST116", message: "0 rows" } }
              Object.assign(match, patch)
              return { data: { ...match }, error: null }
            },
          }),
        }
        return chain
      },
    }),
  }
}

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => makeClient() }))

import { markAsRead } from "@/lib/db/notifications"

beforeEach(() => {
  updateFilters = []
  rows = [
    { id: MINE, user_id: ME, is_read: false, title: "Your plan is ready" },
    { id: THEIRS, user_id: THEM, is_read: false, title: "Someone else's payment failed" },
  ]
})

describe("markAsRead(userId, id)", () => {
  it("marks the caller's own notification read (permissive control)", async () => {
    const updated = await markAsRead(ME, MINE)
    expect(updated?.id).toBe(MINE)
    expect(rows.find((r) => r.id === MINE)?.is_read).toBe(true)
  })

  it("does not touch another user's notification, and returns nothing for it", async () => {
    const updated = await markAsRead(ME, THEIRS)
    expect(updated).toBeNull()
    expect(rows.find((r) => r.id === THEIRS)?.is_read).toBe(false)
  })

  it("filters the update on the user_id VALUE it was given", async () => {
    await markAsRead(ME, MINE)
    expect(updateFilters).toContainEqual({ col: "user_id", val: ME })
    expect(updateFilters).toContainEqual({ col: "id", val: MINE })
  })
})
