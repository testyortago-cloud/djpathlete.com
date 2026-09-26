// notifyBusinessOwners (G35): an agent's alert goes to the OWNERS of the
// business the job was enqueued for, as one in-app bell row each.
//
// The fake APPLIES the filters and orders it is handed. An argument-blind fake
// — one that returns the same rows whatever `.eq` or `.order` was called with —
// passes with either predicate deleted, which is precisely the mutant these
// tests exist to catch. It also returns the inserted rows REVERSED, because
// RETURNING order is not something PostgREST promises; a helper that takes
// `rows[0]` gets the wrong owner's id here instead of by luck in production.
import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { notifyBusinessOwners } from "../lib/notify-business-owners.js"

type Member = { business_id: string; user_id: string; role: string; created_at: string }
type PgError = { code: string; message: string }
type Resolve = (value: unknown) => unknown
type Reject = (reason: unknown) => unknown

function fakeSupabase(opts: { members: Member[]; readError?: PgError; insertError?: PgError }) {
  const inserted: Array<Record<string, unknown>> = []
  const from = vi.fn((table: string) => {
    if (table === "business_members") {
      const filters: Array<[string, unknown]> = []
      const orders: Array<{ column: string; ascending: boolean }> = []
      const read = () => {
        if (opts.readError) return { data: null, error: opts.readError }
        const rows = opts.members
          .filter((m) => filters.every(([column, value]) => (m as Record<string, unknown>)[column] === value))
          .sort((a, b) => {
            for (const { column, ascending } of orders) {
              const x = String((a as Record<string, unknown>)[column])
              const y = String((b as Record<string, unknown>)[column])
              if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1)
            }
            return 0
          })
        return { data: rows.map((m) => ({ user_id: m.user_id })), error: null }
      }
      const builder = {
        select: (_columns: string) => builder,
        eq: (column: string, value: unknown) => {
          filters.push([column, value])
          return builder
        },
        order: (column: string, o?: { ascending?: boolean }) => {
          orders.push({ column, ascending: o?.ascending !== false })
          return builder
        },
        then: (resolve: Resolve, reject?: Reject) => Promise.resolve(read()).then(resolve, reject),
      }
      return builder
    }
    if (table === "notifications") {
      return {
        insert: (rows: Array<Record<string, unknown>>) => {
          inserted.push(...rows)
          return {
            select: (_columns: string) =>
              Promise.resolve(
                opts.insertError
                  ? { data: null, error: opts.insertError }
                  : {
                      data: rows.map((r) => ({ id: `notif-${String(r.user_id)}`, user_id: r.user_id })).reverse(),
                      error: null,
                    },
              ),
          }
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { client: { from } as unknown as SupabaseClient, inserted, from }
}

const NOTE = { type: "warning" as const, title: "T", message: "M", link: "/admin/strategy" }

const member = (business_id: string, user_id: string, role: string, created_at = "2026-01-01T00:00:00Z"): Member => ({
  business_id,
  user_id,
  role,
  created_at,
})

describe("notifyBusinessOwners", () => {
  // MUTANT: drop `.eq("business_id", businessId)` — biz-b's owner is belled
  // about biz-a's job. Presence control in the same test: biz-a's owner IS.
  it("bells the owners of the given business and nobody else's", async () => {
    const fake = fakeSupabase({
      members: [member("biz-a", "owner-a", "owner"), member("biz-b", "owner-b", "owner")],
    })
    const out = await notifyBusinessOwners(fake.client, "biz-a", NOTE)
    expect(out).toEqual({ ok: true, notificationId: "notif-owner-a", ownerCount: 1 })
    expect(fake.inserted.map((r) => r.user_id)).toEqual(["owner-a"])
  })

  // MUTANT: drop `.eq("role", "owner")` — the coach and the staff member are
  // belled too. Owner ruling 3 names owners only.
  it("skips the business's coaches and staff", async () => {
    const fake = fakeSupabase({
      members: [
        member("biz-a", "coach-a", "coach"),
        member("biz-a", "owner-a", "owner"),
        member("biz-a", "staff-a", "staff"),
      ],
    })
    await notifyBusinessOwners(fake.client, "biz-a", NOTE)
    expect(fake.inserted.map((r) => r.user_id)).toEqual(["owner-a"])
  })

  it("writes the row the bell reads: type, title, message, link, unread", async () => {
    const fake = fakeSupabase({ members: [member("biz-a", "owner-a", "owner")] })
    await notifyBusinessOwners(fake.client, "biz-a", NOTE)
    expect(fake.inserted).toEqual([
      { user_id: "owner-a", type: "warning", title: "T", message: "M", link: "/admin/strategy", is_read: false },
    ])
  })

  // The id the SEO agent stores and the outcome tracker reads back 14 days
  // later is ONE notifications row: the first owner's, by created_at then
  // user_id. The fixture is built so each mutant picks a different owner:
  //   - no `.order("created_at")`: user_id alone puts "owner-0-late" first;
  //   - no `.order("user_id")`: the two January owners keep fixture order,
  //     so "owner-2" comes first;
  //   - `ascending: false` on created_at: "owner-0-late" again;
  //   - `rows[0]` instead of a lookup by user_id: the fake returns the insert
  //     reversed, so that is "owner-0-late"'s row.
  it("returns the FIRST owner's notification id, by created_at then user_id", async () => {
    const fake = fakeSupabase({
      members: [
        member("biz-a", "owner-0-late", "owner", "2026-02-01T00:00:00Z"),
        member("biz-a", "owner-2", "owner", "2026-01-01T00:00:00Z"),
        member("biz-a", "owner-1", "owner", "2026-01-01T00:00:00Z"),
      ],
    })
    const out = await notifyBusinessOwners(fake.client, "biz-a", NOTE)
    expect(out).toEqual({ ok: true, notificationId: "notif-owner-1", ownerCount: 3 })
    // Every owner is still belled; only the returned id is the first one's.
    expect(fake.inserted.map((r) => r.user_id)).toEqual(["owner-1", "owner-2", "owner-0-late"])
  })

  // MUTANT: fall back to someone (the platform's owner, "the first admin")
  // when the business has no owner. The schema does not require one.
  it("reports a business with no owner and inserts nothing", async () => {
    const fake = fakeSupabase({ members: [member("biz-a", "coach-a", "coach")] })
    const out = await notifyBusinessOwners(fake.client, "biz-a", NOTE)
    expect(out).toEqual({ ok: false, error: "business biz-a has no owner to notify" })
    expect(fake.from).not.toHaveBeenCalledWith("notifications")
    // Presence control: the read itself did happen.
    expect(fake.from).toHaveBeenCalledWith("business_members")
  })

  // MUTANT: destructure `data` only (what social-agent.ts did with profiles) —
  // a failed read then looks like "no owners" and the error vanishes.
  it("returns a failed read as an error, with its code, and inserts nothing", async () => {
    const fake = fakeSupabase({
      members: [member("biz-a", "owner-a", "owner")],
      readError: { code: "PGRST205", message: "relation not found" },
    })
    const out = await notifyBusinessOwners(fake.client, "biz-a", NOTE)
    expect(out).toEqual({ ok: false, error: "business_members read failed (PGRST205 relation not found)" })
    expect(fake.from).not.toHaveBeenCalledWith("notifications")
  })

  it("returns a failed insert as an error", async () => {
    const fake = fakeSupabase({
      members: [member("biz-a", "owner-a", "owner")],
      insertError: { code: "23503", message: "fk violation" },
    })
    const out = await notifyBusinessOwners(fake.client, "biz-a", NOTE)
    expect(out).toEqual({ ok: false, error: "notifications insert failed (23503 fk violation)" })
    // Presence control: the insert was attempted.
    expect(fake.inserted.map((r) => r.user_id)).toEqual(["owner-a"])
  })
})
