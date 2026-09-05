// @vitest-environment node
//
// lib/db/contact-tags.ts and the pure rule it delegates to.
//
// NODE ENVIRONMENT, PINNED — every jsdom suite in this repo currently fails to
// START (ERR_REQUIRE_ESM from html-encoding-sniffer) and vitest reports that as
// "no tests" rather than as a failure.
//
// The Supabase mock below FILTERS, rather than returning a fixed row set. An
// inert mock that answers the same thing regardless of the query has already
// shipped twice on this branch and made assertions pass while testing nothing —
// see the note in __tests__/lib/db/find-contact-by-identifiers.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest"

type Row = Record<string, any>

const store: { contact_tags: Row[]; failWith: { code?: string; message: string } | null } = {
  contact_tags: [],
  failWith: null,
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "contact_tags") throw new Error(`unexpected table ${table}`)
      const eqs: Array<[string, any]> = []
      const ins: Array<[string, any[]]> = []
      let orderCol: string | null = null

      const api: any = {
        select: () => api,
        eq: (col: string, val: any) => {
          eqs.push([col, val])
          return api
        },
        in: (col: string, vals: any[]) => {
          ins.push([col, vals])
          return api
        },
        order: (col: string) => {
          orderCol = col
          return api
        },
        insert: async (row: Row) => {
          if (store.failWith) return { data: null, error: store.failWith }
          const clash = store.contact_tags.some(
            (existing) => existing.contact_id === row.contact_id && existing.tag === row.tag,
          )
          // The real no-op comes from contact_tags_unique; the mock reproduces
          // the CODE the DAL keys on, not a message containing "duplicate".
          if (clash) return { data: null, error: { code: "23505", message: "duplicate key value" } }
          store.contact_tags.push({ id: `t${store.contact_tags.length + 1}`, created_at: "2026-09-01", ...row })
          return { data: null, error: null }
        },
        delete: () => {
          const del: any = {
            eq: (col: string, val: any) => {
              eqs.push([col, val])
              return del
            },
            then: (resolve: (value: any) => void) => {
              if (store.failWith) return resolve({ data: null, error: store.failWith })
              store.contact_tags = store.contact_tags.filter(
                (row) => !eqs.every(([col, val]) => row[col] === val),
              )
              return resolve({ data: null, error: null })
            },
          }
          return del
        },
        then: (resolve: (value: any) => void) => {
          if (store.failWith) return resolve({ data: null, error: store.failWith })
          let rows = store.contact_tags.filter((row) => eqs.every(([col, val]) => row[col] === val))
          for (const [col, vals] of ins) rows = rows.filter((row) => vals.includes(row[col]))
          if (orderCol) rows = [...rows].sort((a, b) => (a[orderCol!] < b[orderCol!] ? -1 : 1))
          return resolve({ data: rows, error: null })
        },
      }
      return api
    },
  }),
}))

import { addTag, isMissingTagsTable, listTags, removeTag, tagsForContacts } from "@/lib/db/contact-tags"
import { MAX_TAG_LENGTH, normaliseTag } from "@/lib/contacts/tag-format"

const A = "11111111-1111-1111-1111-111111111111"
const B = "22222222-2222-2222-2222-222222222222"
const BUSINESS = "00000000-0000-0000-0000-000000000001"

beforeEach(() => {
  store.contact_tags = []
  store.failWith = null
})

describe("normaliseTag", () => {
  it("lowercases and collapses whitespace so the unique constraint means something", () => {
    expect(normaliseTag("  Coaching   Lead ")).toBe("coaching lead")
  })

  it("turns a tab into a space rather than rejecting the paste", () => {
    expect(normaliseTag("coaching\tlead")).toBe("coaching lead")
  })

  // A TAB IS NOT ENOUGH TO PIN THE CONTROL-CHARACTER STRIP. A mutation sweep
  // found that deleting the `[\u0000-\u001F\u007F]` replace entirely left the
  // suite green, because `\t` is also matched by the `\s+` collapse that runs
  // after it. These use control characters `\s` does NOT match, so without the
  // strip they reach the database as literal bytes — and a NUL inside a tag is a
  // value the operator can neither see on screen nor retype in order to delete.
  it("strips control characters that are not whitespace", () => {
    expect(normaliseTag("camp\u00012026")).toBe("camp 2026")
    expect(normaliseTag("camp\u00002026")).toBe("camp 2026")
    expect(normaliseTag("camp\u007f2026")).toBe("camp 2026")
  })

  it("a tag of nothing but control characters is rejected", () => {
    expect(normaliseTag("\u0000\u0001")).toBeNull()
  })

  it("rejects empty and whitespace-only", () => {
    expect(normaliseTag("")).toBeNull()
    expect(normaliseTag("   ")).toBeNull()
    expect(normaliseTag(null)).toBeNull()
    expect(normaliseTag(undefined)).toBeNull()
  })

  it("rejects a non-string, which is what a JSON body can carry", () => {
    expect(normaliseTag(42 as unknown as string)).toBeNull()
    expect(normaliseTag({} as unknown as string)).toBeNull()
  })

  it(`rejects anything longer than ${MAX_TAG_LENGTH} characters`, () => {
    expect(normaliseTag("x".repeat(MAX_TAG_LENGTH))).toBe("x".repeat(MAX_TAG_LENGTH))
    expect(normaliseTag("x".repeat(MAX_TAG_LENGTH + 1))).toBeNull()
  })
})

describe("addTag", () => {
  it("creates the tag and reports that it created one", async () => {
    const result = await addTag({ contactId: A, tag: "Camp 2026", createdBy: "user-1", businessId: BUSINESS })
    expect(result).toEqual({ tag: "camp 2026", created: true })
    // Pins WHICH row landed, not merely that something was stored.
    expect(store.contact_tags).toHaveLength(1)
    expect(store.contact_tags[0]).toMatchObject({ contact_id: A, tag: "camp 2026", created_by: "user-1" })
  })

  it("re-adding is a no-op, reported as created:false rather than thrown", async () => {
    await addTag({ contactId: A, tag: "camp-2026", businessId: BUSINESS })
    const second = await addTag({ contactId: A, tag: "CAMP-2026", businessId: BUSINESS })
    expect(second).toEqual({ tag: "camp-2026", created: false })
    expect(store.contact_tags).toHaveLength(1)
  })

  it("the same tag on a DIFFERENT contact is a separate row", async () => {
    await addTag({ contactId: A, tag: "camp-2026", businessId: BUSINESS })
    await addTag({ contactId: B, tag: "camp-2026", businessId: BUSINESS })
    expect(store.contact_tags).toHaveLength(2)
  })

  it("rethrows a real failure instead of swallowing it as a duplicate", async () => {
    store.failWith = { code: "42501", message: "permission denied" }
    await expect(addTag({ contactId: A, tag: "camp-2026", businessId: BUSINESS })).rejects.toThrow(/permission denied/)
  })

  it("refuses a tag that normalises to nothing", async () => {
    await expect(addTag({ contactId: A, tag: "   ", businessId: BUSINESS })).rejects.toThrow(/empty or too long/)
  })
})

describe("removeTag", () => {
  it("removes the row, and only for that contact", async () => {
    await addTag({ contactId: A, tag: "camp-2026", businessId: BUSINESS })
    await addTag({ contactId: B, tag: "camp-2026", businessId: BUSINESS })
    await removeTag({ contactId: A, tag: "camp-2026", businessId: BUSINESS })
    expect(store.contact_tags.map((row) => row.contact_id)).toEqual([B])
  })

  it("normalises before deleting, so the pill you can see is the pill you can remove", async () => {
    await addTag({ contactId: A, tag: "Coaching Lead", businessId: BUSINESS })
    await removeTag({ contactId: A, tag: "  COACHING   lead ", businessId: BUSINESS })
    expect(store.contact_tags).toEqual([])
  })

  it("removing a tag that is not there succeeds", async () => {
    await expect(removeTag({ contactId: A, tag: "never-applied", businessId: BUSINESS })).resolves.toEqual({
      tag: "never-applied",
    })
  })
})

describe("listTags", () => {
  it("returns only this contact's tags", async () => {
    await addTag({ contactId: A, tag: "b-tag", businessId: BUSINESS })
    await addTag({ contactId: A, tag: "a-tag", businessId: BUSINESS })
    await addTag({ contactId: B, tag: "other-contact-tag", businessId: BUSINESS })
    const tags = await listTags(A, BUSINESS)
    // Pins the CONTACT as well as the values — a read that ignored contact_id
    // would return all three and still be "non-empty".
    expect(tags.map((row) => row.tag)).toEqual(["a-tag", "b-tag"])
  })

  // BUSINESS SCOPING. addTag requires its tenant and every call in this file
  // names BUSINESS, so a read that dropped `.eq("business_id", …)` behaved
  // identically in every other test here. Asking as a DIFFERENT business must
  // come back empty — and the second assertion is the presence control, so
  // this cannot pass by the read being broken for everyone.
  it("scopes the read to the given business", async () => {
    await addTag({ contactId: A, tag: "a-tag", businessId: BUSINESS })
    await expect(listTags(A, "99999999-9999-9999-9999-999999999999")).resolves.toEqual([])
    expect((await listTags(A, BUSINESS)).map((row) => row.tag)).toEqual(["a-tag"])
  })

  it("throws on a read failure rather than reporting an empty tag list", async () => {
    store.failWith = { message: "connection reset" }
    await expect(listTags(A, BUSINESS)).rejects.toThrow(/connection reset/)
  })
})

describe("isMissingTagsTable — the one-deploy schema tolerance", () => {
  // MEASURED, NOT ASSUMED. PostgREST resolves table names against its schema
  // cache before the query reaches Postgres, so a missing table comes back as
  // PGRST205 and never as Postgres's 42P01. A guard written against 42P01 alone
  // would never fire, and the deploy-race outage it exists to prevent would
  // happen anyway.
  it("recognises PostgREST's missing-table code", () => {
    expect(isMissingTagsTable({ code: "PGRST205", message: "Could not find the table 'public.contact_tags'" })).toBe(true)
  })

  it("also recognises Postgres's undefined_table, for paths that skip the cache", () => {
    expect(isMissingTagsTable({ code: "42P01" })).toBe(true)
  })

  it("does NOT swallow anything else — a permissions error is a real failure", () => {
    expect(isMissingTagsTable({ code: "42501", message: "permission denied" })).toBe(false)
    expect(isMissingTagsTable({ code: "23505" })).toBe(false)
    expect(isMissingTagsTable(null)).toBe(false)
    expect(isMissingTagsTable(undefined)).toBe(false)
    expect(isMissingTagsTable({})).toBe(false)
  })

  // The message mentions the table by name, which is exactly the kind of string
  // a sloppier guard would match on. Code only.
  it("does not match on the message text alone", () => {
    expect(isMissingTagsTable({ code: "42501", message: "Could not find the table 'public.contact_tags'" })).toBe(false)
  })
})

describe("tagsForContacts", () => {
  it("degrades to an empty map when contact_tags does not exist yet", async () => {
    store.failWith = { code: "PGRST205", message: "Could not find the table 'public.contact_tags' in the schema cache" }
    await expect(tagsForContacts([A, B], BUSINESS)).resolves.toEqual(new Map())
  })

  it("still THROWS on any other read failure — the tolerance is one code wide", async () => {
    store.failWith = { code: "42501", message: "permission denied" }
    await expect(tagsForContacts([A, B], BUSINESS)).rejects.toThrow(/permission denied/)
  })

  // The per-row walk matters: a deduping helper reads identically at the call
  // site and silently drops one of two contacts that share a tag value.
  it("keeps both contacts when they share a tag", async () => {
    await addTag({ contactId: A, tag: "shared", businessId: BUSINESS })
    await addTag({ contactId: B, tag: "shared", businessId: BUSINESS })
    const map = await tagsForContacts([A, B], BUSINESS)
    expect(map.get(A)).toEqual(["shared"])
    expect(map.get(B)).toEqual(["shared"])
    expect(map.size).toBe(2)
  })

  it("groups several tags under the right contact", async () => {
    await addTag({ contactId: A, tag: "a1", businessId: BUSINESS })
    await addTag({ contactId: A, tag: "a2", businessId: BUSINESS })
    await addTag({ contactId: B, tag: "b1", businessId: BUSINESS })
    const map = await tagsForContacts([A, B], BUSINESS)
    expect(map.get(A)).toEqual(["a1", "a2"])
    expect(map.get(B)).toEqual(["b1"])
  })

  it("returns an empty map without querying when given no ids", async () => {
    store.failWith = { message: "should never be reached" }
    await expect(tagsForContacts([], BUSINESS)).resolves.toEqual(new Map())
  })
})
