// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, any>

const store: { consents: Row[]; suppressions: Row[] } = { consents: [], suppressions: [] }

// When set to a table name, the next `maybeSingle()` read against that table
// returns a Postgres-shaped error instead of data, so tests can prove a read
// failure is not silently treated as "no record" / "not suppressed".
let forceErrorOnTable: string | null = null

// NOTE: the brief's mock let `.eq()` return `api` unconditionally, so every
// query resolved to "the last row inserted into the table" regardless of
// which contact/channel/identifier was actually asked for. That mock made
// the tests pass without ever exercising the filtering the real code
// depends on. This version tracks applied filters and actually narrows the
// row set, so a broken `.eq()` chain in the implementation would fail these
// tests instead of being invisible to them.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const rows = table === "contact_consents" ? store.consents : store.suppressions
      const filters: Array<[string, any]> = []
      let orderCol: string | null = null
      let orderAscending = true
      let limitN: number | null = null

      const applyQuery = (): Row[] => {
        let result = rows.filter((row) => filters.every(([col, val]) => row[col] === val))
        if (orderCol) {
          const col = orderCol
          result = [...result].sort((a, b) => {
            if (a[col] === b[col]) return a._seq - b._seq
            return a[col] > b[col] ? 1 : -1
          })
          if (!orderAscending) result.reverse()
        }
        if (limitN != null) result = result.slice(0, limitN)
        return result
      }

      const api: any = {
        insert: async (payload: any) => {
          rows.push({
            ...payload,
            occurred_at: payload.occurred_at ?? new Date().toISOString(),
            _seq: rows.length,
          })
          return { error: null }
        },
        select: () => api,
        eq: (col: string, val: any) => {
          filters.push([col, val])
          return api
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          orderCol = col
          orderAscending = opts?.ascending ?? true
          return api
        },
        limit: (n: number) => {
          limitN = n
          return api
        },
        maybeSingle: async () => {
          if (forceErrorOnTable === table) {
            return { data: null, error: new Error(`simulated read failure on ${table}`) }
          }
          const result = applyQuery()
          return { data: result[0] ?? null, error: null }
        },
      }
      return api
    },
  }),
}))

import { recordConsent, hasConsent, isSuppressed, suppress } from "@/lib/db/contact-consents"

beforeEach(() => {
  store.consents = []
  store.suppressions = []
  forceErrorOnTable = null
})

describe("consent", () => {
  it("records the wording the person was actually shown", async () => {
    await recordConsent({
      contactId: "c1", channel: "sms", granted: true,
      source: "funnel_form", wordingShown: "Text me about camps and clinics.",
    })
    expect(store.consents[0].wording_shown).toBe("Text me about camps and clinics.")
    expect(store.consents[0].channel).toBe("sms")
    expect(store.consents[0].granted).toBe(true)
  })

  it("treats the most recent record as authoritative", async () => {
    await recordConsent({ contactId: "c1", channel: "email", granted: true, source: "form", wordingShown: "w" })
    await recordConsent({ contactId: "c1", channel: "email", granted: false, source: "unsubscribe", wordingShown: "w" })
    expect(await hasConsent("c1", "email")).toBe(false)
  })

  it("returns false when there is no consent record at all", async () => {
    expect(await hasConsent("c-unknown", "sms")).toBe(false)
  })

  it("finds a matching record and does not leak another contact's answer", async () => {
    // Mutation testing during this task caught that none of the tests above
    // ever assert a `true` result — a hardcoded/broken contact_id filter
    // would pass every prior test in this file while returning false for
    // everyone. This pins the positive case and isolation across contacts.
    await recordConsent({ contactId: "c1", channel: "email", granted: true, source: "form", wordingShown: "w" })
    await recordConsent({ contactId: "c2", channel: "email", granted: false, source: "form", wordingShown: "w" })
    expect(await hasConsent("c1", "email")).toBe(true)
    expect(await hasConsent("c2", "email")).toBe(false)
  })

  it("throws on a read failure instead of reporting no consent", async () => {
    // A record exists — if a failed read ever collapsed into `false`, this
    // test would still pass with the wrong answer for the wrong reason.
    // "Could not read" and "they said no" are different answers, and only
    // one of them is safe to act on.
    await recordConsent({ contactId: "c1", channel: "email", granted: true, source: "form", wordingShown: "w" })
    forceErrorOnTable = "contact_consents"
    await expect(hasConsent("c1", "email")).rejects.toThrow()
  })
})

describe("suppression", () => {
  it("suppresses by identifier", async () => {
    await suppress("marissa@example.com", "unsubscribed")
    expect(await isSuppressed("marissa@example.com")).toBe(true)
  })

  it("keys suppression by identifier, so it survives the contact it named being merged away", async () => {
    await suppress("marissa@example.com", "unsubscribed")

    // The suppression row itself must carry no contact reference at all —
    // that is what lets it survive a merge, a delete, and the same person
    // resurfacing under a brand-new contact id months later.
    expect(store.suppressions[0]).not.toHaveProperty("contact_id")

    // Simulate the contact being merged away: everything contact-shaped is
    // gone, and the lookup is repeated with no contact id in hand at all —
    // only the identifier, which is all `isSuppressed` ever accepts.
    store.consents = []

    expect(await isSuppressed("marissa@example.com")).toBe(true)
  })
})
