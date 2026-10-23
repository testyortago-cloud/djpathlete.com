// importSubscribers must never put someone who opted out back on the list.
// Until 2026-10-23 it upserted `unsubscribed_at: null`, so re-importing the old
// CSV (or a GHL sync) would have resubscribed the 596 people who bounced or
// marked a newsletter as spam. The fake below is a real little table: it reads
// the `.in()` list it is given and honours `ignoreDuplicates`, so a merge-upsert
// shows up as a changed row, not as a call that merely happened.
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = { email: string; source: string; unsubscribed_at: string | null }
let table: Row[] = []
const upserts: { rows: Partial<Row>[]; opts: { ignoreDuplicates?: boolean } }[] = []

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (name: string) => {
      if (name !== "newsletter_subscribers") throw new Error(`unexpected table ${name}`)
      return {
        select: () => ({
          in: async (col: keyof Row, vals: string[]) => ({
            data: table.filter((r) => vals.includes(r[col] as string)).map((r) => ({ ...r })),
            error: null,
          }),
        }),
        upsert: (rows: Partial<Row>[], opts: { ignoreDuplicates?: boolean }) => {
          upserts.push({ rows, opts })
          const written: Row[] = []
          for (const row of rows) {
            const existing = table.find((r) => r.email === row.email)
            if (existing && opts.ignoreDuplicates) continue
            if (existing) Object.assign(existing, row)
            else table.push({ unsubscribed_at: null, source: "x", ...row } as Row)
            written.push(table.find((r) => r.email === row.email)!)
          }
          return { select: async () => ({ data: written.map((r) => ({ id: r.email })), error: null }) }
        },
      }
    },
  }),
}))

import { importSubscribers } from "@/lib/db/newsletter"

beforeEach(() => {
  table = [
    { email: "active@gmail.com", source: "website", unsubscribed_at: null },
    { email: "bounced@gmail.com", source: "csv_import", unsubscribed_at: "2026-10-23T03:54:37.847Z" },
  ]
  upserts.length = 0
})

describe("importSubscribers", () => {
  it("keeps an opted-out person opted out, and adds only new addresses", async () => {
    const result = await importSubscribers(["Bounced@Gmail.com", "active@gmail.com", "new@gmail.com"])

    expect(result).toEqual({ added: 1, alreadySubscribed: 1, optedOut: 1, rejected: 0 })
    expect(table.find((r) => r.email === "bounced@gmail.com")?.unsubscribed_at).toBe("2026-10-23T03:54:37.847Z")
    expect(table.find((r) => r.email === "new@gmail.com")).toMatchObject({
      source: "csv_import",
      unsubscribed_at: null,
    })
    // Only the new address is written, and never with an unsubscribed_at key.
    expect(upserts.flatMap((u) => u.rows)).toEqual([{ email: "new@gmail.com", source: "csv_import" }])
    expect(upserts.every((u) => u.opts.ignoreDuplicates === true)).toBe(true)
  })

  it("rejects malformed and throwaway addresses, and counts a repeated address once", async () => {
    const result = await importSubscribers(["not-an-email", "x@mailinator.com", "new@gmail.com", " NEW@gmail.com "])
    expect(result).toEqual({ added: 1, alreadySubscribed: 0, optedOut: 0, rejected: 2 })
  })

  it("dryRun gives the same counts and writes nothing", async () => {
    const result = await importSubscribers(["bounced@gmail.com", "active@gmail.com", "new@gmail.com"], "csv_import", {
      dryRun: true,
    })
    expect(result).toEqual({ added: 1, alreadySubscribed: 1, optedOut: 1, rejected: 0 })
    expect(upserts).toHaveLength(0)
    expect(table).toHaveLength(2)
  })

  it("checks every address of a list longer than one batch of 100", async () => {
    const emails = Array.from({ length: 250 }, (_, i) => `p${i}@gmail.com`)
    table.push({ email: "p199@gmail.com", source: "csv_import", unsubscribed_at: "2026-10-01T00:00:00.000Z" })
    const result = await importSubscribers(emails)
    expect(result).toEqual({ added: 249, alreadySubscribed: 0, optedOut: 1, rejected: 0 })
    expect(table.find((r) => r.email === "p199@gmail.com")?.unsubscribed_at).toBe("2026-10-01T00:00:00.000Z")
  })
})
