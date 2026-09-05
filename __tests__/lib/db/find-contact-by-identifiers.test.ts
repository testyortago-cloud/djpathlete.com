// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, any>

const store: { contacts: Row[] } = { contacts: [] }

// Mirrors the filtering mock in __tests__/db/contact-consents.test.ts: `.eq()`
// records the applied filter and `maybeSingle()` actually narrows the row set
// by every filter applied, instead of returning the first/last row regardless
// of the query. That inert-mock shape has already shipped twice on this
// branch and made assertions pass while testing nothing.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "contacts") throw new Error(`unexpected table ${table}`)
      const filters: Array<[string, any]> = []
      const api: any = {
        select: () => api,
        eq: (col: string, val: any) => {
          filters.push([col, val])
          return api
        },
        maybeSingle: async () => {
          const rows = store.contacts.filter((row) => filters.every(([col, val]) => row[col] === val))
          return { data: rows[0] ?? null, error: null }
        },
      }
      return api
    },
  }),
}))

import { findContactByIdentifiers } from "@/lib/db/contacts"

const BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

beforeEach(() => {
  store.contacts = []
})

describe("findContactByIdentifiers", () => {
  it("resolves by user_id when present", async () => {
    store.contacts.push({ id: "c-uid", business_id: BUSINESS_ID, user_id: "user-1", email: null, phone_e164: null })
    const id = await findContactByIdentifiers({ userId: "user-1", businessId: BUSINESS_ID })
    expect(id).toBe("c-uid")
  })

  it("resolves by user_id in preference to email when both would match different contacts", async () => {
    store.contacts.push({ id: "c-uid", business_id: BUSINESS_ID, user_id: "user-1", email: null, phone_e164: null })
    store.contacts.push({
      id: "c-email",
      business_id: BUSINESS_ID,
      user_id: null,
      email: "lead@example.com",
      phone_e164: null,
    })
    const id = await findContactByIdentifiers({ userId: "user-1", email: "lead@example.com", businessId: BUSINESS_ID })
    expect(id).toBe("c-uid")
  })

  it("falls back to email when user_id does not match any contact", async () => {
    store.contacts.push({
      id: "c-email",
      business_id: BUSINESS_ID,
      user_id: null,
      email: "lead@example.com",
      phone_e164: null,
    })
    const id = await findContactByIdentifiers({
      userId: "user-missing",
      email: "lead@example.com",
      businessId: BUSINESS_ID,
    })
    expect(id).toBe("c-email")
  })

  it("normalises email before querying — mixed case and whitespace still match", async () => {
    store.contacts.push({
      id: "c-email",
      business_id: BUSINESS_ID,
      user_id: null,
      email: "lead@example.com",
      phone_e164: null,
    })
    const id = await findContactByIdentifiers({ email: "  Lead@Example.com  ", businessId: BUSINESS_ID })
    expect(id).toBe("c-email")
  })

  it("falls back to phone (normalised) when user_id and email don't match", async () => {
    store.contacts.push({
      id: "c-phone",
      business_id: BUSINESS_ID,
      user_id: null,
      email: null,
      phone_e164: "+16176504548",
    })
    const id = await findContactByIdentifiers({ phone: "617-650-4548", businessId: BUSINESS_ID })
    expect(id).toBe("c-phone")
  })

  it("returns null when nothing matches — that is a legitimate answer, not an error", async () => {
    const id = await findContactByIdentifiers({
      userId: "nope",
      email: "nobody@example.com",
      phone: "617-650-4548",
      businessId: BUSINESS_ID,
    })
    expect(id).toBeNull()
  })

  it("scopes lookups to the business the caller names", async () => {
    // `businessId` is required now, so this pins WHICH tenant was applied
    // rather than which one a default happened to pick. The second assertion
    // is the presence control: without it, this would pass just as well if
    // the lookup were broken for every business.
    store.contacts.push({
      id: "c-other-biz",
      business_id: "some-other-business",
      user_id: null,
      email: "lead@example.com",
      phone_e164: null,
    })
    await expect(findContactByIdentifiers({ email: "lead@example.com", businessId: BUSINESS_ID })).resolves.toBeNull()
    await expect(
      findContactByIdentifiers({ email: "lead@example.com", businessId: "some-other-business" }),
    ).resolves.toBe("c-other-biz")
  })
})
