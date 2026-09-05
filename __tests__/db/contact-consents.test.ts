// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, any>

const store: { consents: Row[]; suppressions: Row[] } = { consents: [], suppressions: [] }

// When set to a table name, the next `maybeSingle()` read against that table
// returns a Postgres-shaped error instead of data, so tests can prove a read
// failure is not silently treated as "no record" / "not suppressed".
let forceErrorOnTable: string | null = null

// When set, the next `insert()` against the named table returns this
// Postgres-shaped error instead of writing the row — lets `suppress`'s error
// handling be exercised directly (a real 23505 vs. a genuine failure whose
// message happens to contain "duplicate").
let forceInsertError: { table: string; error: { code?: string; message: string } } | null = null

// NOTE: the brief's mock let `.eq()` return `api` unconditionally, so every
// query resolved to "the last row inserted into the table" regardless of
// which contact/channel/identifier was actually asked for. That mock made
// the tests pass without ever exercising the filtering the real code
// depends on. This version tracks applied filters and actually narrows the
// row set, so a broken `.eq()` chain in the implementation would fail these
// tests instead of being invisible to them.
//
// It also tracks EVERY `.order()` call, not just the last one — a mock that
// let a second `.order()` overwrite the first would make the occurred_at/
// created_at tiebreak test pass without the implementation actually chaining
// both order clauses. See CONTEXT.md's mock trap.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const rows = table === "contact_consents" ? store.consents : store.suppressions
      const filters: Array<[string, any]> = []
      const orders: Array<{ col: string; ascending: boolean }> = []
      let limitN: number | null = null

      const applyQuery = (): Row[] => {
        let result = rows.filter((row) => filters.every(([col, val]) => row[col] === val))
        if (orders.length) {
          // Sort ascending across every ordered column in the order they
          // were chained, falling back to insertion order (_seq) as the
          // final tiebreak, then reverse the whole result once if the LAST
          // `.order()` call asked for descending. This mirrors how a real
          // multi-column ORDER BY ... DESC behaves when every chained column
          // shares the same direction (true for every caller in this file).
          result = [...result].sort((a, b) => {
            for (const { col } of orders) {
              if (a[col] !== b[col]) return a[col] > b[col] ? 1 : -1
            }
            return a._seq - b._seq
          })
          if (orders[orders.length - 1].ascending === false) result.reverse()
        }
        if (limitN != null) result = result.slice(0, limitN)
        return result
      }

      const api: any = {
        insert: async (payload: any) => {
          if (forceInsertError && forceInsertError.table === table) {
            return { error: forceInsertError.error }
          }
          rows.push({
            ...payload,
            occurred_at: payload.occurred_at ?? new Date().toISOString(),
            created_at: payload.created_at ?? new Date().toISOString(),
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
          orders.push({ col, ascending: opts?.ascending ?? true })
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

// Every tenant parameter in this module is REQUIRED — there is no default to
// fall back on — so each call below names the business it is writing to or
// reading from, and the writes and reads share this one id on purpose.
const BUSINESS_ID = "biz-1"

beforeEach(() => {
  store.consents = []
  store.suppressions = []
  forceErrorOnTable = null
  forceInsertError = null
})

describe("consent", () => {
  it("records the wording the person was actually shown", async () => {
    await recordConsent({
      contactId: "c1",
      channel: "sms",
      granted: true,
      businessId: BUSINESS_ID,
      source: "funnel_form",
      wordingShown: "Text me about camps and clinics.",
    })
    expect(store.consents[0].wording_shown).toBe("Text me about camps and clinics.")
    expect(store.consents[0].channel).toBe("sms")
    expect(store.consents[0].granted).toBe(true)
    // The tenant the caller named is the tenant the row is FILED under. Every
    // other assertion in this file reads a column the caller also supplied, so
    // a `business_id` hard-coded back to the platform constant would survive
    // all of them — BUSINESS_ID here is deliberately not that constant.
    expect(store.consents[0].business_id).toBe(BUSINESS_ID)
  })

  it("treats the most recent record as authoritative", async () => {
    await recordConsent({
      contactId: "c1",
      channel: "email",
      granted: true,
      source: "form",
      wordingShown: "w",
      businessId: BUSINESS_ID,
    })
    await recordConsent({
      contactId: "c1",
      channel: "email",
      granted: false,
      source: "unsubscribe",
      wordingShown: "w",
      businessId: BUSINESS_ID,
    })
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
    await recordConsent({
      contactId: "c1",
      channel: "email",
      granted: true,
      source: "form",
      wordingShown: "w",
      businessId: BUSINESS_ID,
    })
    await recordConsent({
      contactId: "c2",
      channel: "email",
      granted: false,
      source: "form",
      wordingShown: "w",
      businessId: BUSINESS_ID,
    })
    expect(await hasConsent("c1", "email")).toBe(true)
    expect(await hasConsent("c2", "email")).toBe(false)
  })

  it("breaks an occurred_at tie by created_at, newest wins", async () => {
    // Two rows sharing an identical occurred_at — exactly what a future
    // marketing_consent_log backfill would produce for many rows at once.
    // Without a secondary sort key, which one "the most recent record" means
    // is undefined. The row with the newer created_at (the revoke) must win.
    //
    // The revoke is deliberately inserted FIRST (lower _seq) and the grant
    // SECOND (higher _seq, but an OLDER created_at): if the implementation
    // ever loses the created_at tiebreak and this mock's query fell back to
    // insertion order, it would pick the grant (wrong answer, true) instead
    // of the revoke — so this only passes when created_at is genuinely
    // consulted, not by insertion-order coincidence.
    const tiedOccurredAt = "2026-01-01T00:00:00.000Z"
    store.consents.push(
      {
        contact_id: "c1",
        channel: "email",
        granted: false,
        occurred_at: tiedOccurredAt,
        created_at: "2026-01-01T00:00:00.002Z",
        _seq: 0,
      },
      {
        contact_id: "c1",
        channel: "email",
        granted: true,
        occurred_at: tiedOccurredAt,
        created_at: "2026-01-01T00:00:00.001Z",
        _seq: 1,
      },
    )

    expect(await hasConsent("c1", "email")).toBe(false)
  })

  it("throws on a read failure instead of reporting no consent", async () => {
    // A record exists — if a failed read ever collapsed into `false`, this
    // test would still pass with the wrong answer for the wrong reason.
    // "Could not read" and "they said no" are different answers, and only
    // one of them is safe to act on.
    await recordConsent({
      contactId: "c1",
      channel: "email",
      granted: true,
      source: "form",
      wordingShown: "w",
      businessId: BUSINESS_ID,
    })
    forceErrorOnTable = "contact_consents"
    await expect(hasConsent("c1", "email")).rejects.toThrow()
  })
})

describe("suppression", () => {
  it("suppresses by identifier", async () => {
    await suppress("marissa@example.com", "unsubscribed", BUSINESS_ID)
    expect(await isSuppressed("marissa@example.com", BUSINESS_ID)).toBe(true)
  })

  it("keys suppression by identifier, so it survives the contact it named being merged away", async () => {
    await suppress("marissa@example.com", "unsubscribed", BUSINESS_ID)

    // The suppression row itself must carry no contact reference at all —
    // that is what lets it survive a merge, a delete, and the same person
    // resurfacing under a brand-new contact id months later.
    expect(store.suppressions[0]).not.toHaveProperty("contact_id")

    // Simulate the contact being merged away: everything contact-shaped is
    // gone, and the lookup is repeated with no contact id in hand at all —
    // only the identifier, which is all `isSuppressed` ever accepts.
    store.consents = []

    expect(await isSuppressed("marissa@example.com", BUSINESS_ID)).toBe(true)
  })

  it("swallows a real 23505 and rethrows anything else", async () => {
    // The old code matched the string "duplicate" in error.message, so a
    // genuine failure whose message happened to contain that word was
    // silently swallowed. Matching the Postgres code instead fixes that.
    forceInsertError = {
      table: "contact_suppressions",
      error: { code: "23505", message: 'duplicate key value violates unique constraint "contact_suppressions_uniq"' },
    }
    await expect(suppress("dup@example.com", "unsubscribed", BUSINESS_ID)).resolves.toBeUndefined()

    forceInsertError = {
      table: "contact_suppressions",
      error: { code: "42501", message: "permission denied — this looks like a duplicate but is not one" },
    }
    await expect(suppress("other@example.com", "unsubscribed", BUSINESS_ID)).rejects.toThrow(/permission denied/)
  })
})
