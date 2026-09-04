// @vitest-environment node
//
// POST and DELETE /api/admin/contacts/[id]/tags — driven THROUGH the route.
//
// A fixture proves render, not origination: building a `contact_tags` row in a
// test proves the screen can draw one, and proves nothing at all about whether
// this route can create one. So the handlers are imported and called, with only
// the layers BELOW them (auth, the DAL, the audit writer) replaced.
//
// NODE ENVIRONMENT, PINNED. Note that the 27 existing API-route suites under
// __tests__/app/api/admin/ do NOT pin it and therefore cannot start at all
// right now — they inherit jsdom from vitest.config.ts and die on
// ERR_REQUIRE_ESM, which vitest reports as "no tests" rather than as red.
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/contact-detail", () => ({ getContactById: vi.fn() }))
// Mocked as of 2026-09-04. `/api/admin/contacts` is now mapped to the
// `contacts` permission, so the route resolves a tenant -- and without this
// mock it reached a real Supabase client, which made this suite both slow and
// dependent on whatever the dev clone happened to contain.
//
// Declared inside the factory, not above it: vi.mock is hoisted, so a
// top-level class referenced from the factory is still in its temporal dead
// zone when the factory runs, and that failure reports as "no tests".
const resolveTenantMock = vi.fn()
vi.mock("@/lib/tenancy/resolve", () => {
  class NoAccessibleBusinessError extends Error {}
  return {
    resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
    NoAccessibleBusinessError,
  }
})
vi.mock("@/lib/db/contact-tags", async () => {
  // The pure rule is NOT mocked: the route's rejection must be the real one, or
  // the test pins a validator that does not ship.
  const real = await vi.importActual<typeof import("@/lib/contacts/tag-format")>("@/lib/contacts/tag-format")
  return {
    addTag: vi.fn(),
    removeTag: vi.fn(),
    normaliseTag: real.normaliseTag,
    MAX_TAG_LENGTH: real.MAX_TAG_LENGTH,
  }
})

import { DELETE, POST } from "@/app/api/admin/contacts/[id]/tags/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { recordAudit } from "@/lib/audit/record"
import { getContactById } from "@/lib/db/contact-detail"
import { NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { addTag, removeTag } from "@/lib/db/contact-tags"

const CONTACT_ID = "11111111-1111-1111-1111-111111111111"
/**
 * The caller's tenant. Deliberately NOT SINGLETON_BUSINESS_ID: `getContactById`
 * DEFAULTS its second argument to the singleton, so a fixture equal to it would
 * be satisfied by the very bug this asserts against -- the route omitting the
 * argument entirely and writing tags against the operator's contacts.
 */
const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"

function ctx(id: string = CONTACT_ID) {
  return { params: Promise.resolve({ id }) }
}

function req(body: unknown, method = "POST") {
  return new Request(`https://www.darrenjpaul.com/api/admin/contacts/${CONTACT_ID}/tags`, {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued `*Once` implementation left over
  // from a previous test leaks across the boundary and misattributes the
  // failure to the wrong test.
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
  vi.mocked(canAccessAdminPath).mockResolvedValue(true)
  resolveTenantMock.mockResolvedValue({ businessId: BUSINESS_ID, choices: [], isOperator: false })
  vi.mocked(recordAudit).mockResolvedValue(undefined as never)
  vi.mocked(getContactById).mockResolvedValue({
    id: CONTACT_ID,
    business_id: "00000000-0000-0000-0000-000000000001",
    user_id: null,
    name: "Jane Smith",
    email: "jane@example.com",
    phone_e164: null,
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T00:00:00.000Z",
    timezone: null,
  } as never)
  vi.mocked(addTag).mockResolvedValue({ tag: "camp-2026", created: true } as never)
  vi.mocked(removeTag).mockResolvedValue({ tag: "camp-2026" } as never)
})

describe("POST /api/admin/contacts/[id]/tags", () => {
  it("looks the contact up in the CALLER'S tenant, not the singleton", async () => {
    // MUTANT: `getContactById(id)` with one argument. The parameter defaults to
    // SINGLETON_BUSINESS_ID, so a coach's tag write would land on the
    // operator's own contact records -- and, because the lookup would SUCCEED
    // for a platform contact, it reads as working rather than as a refusal.
    // Asserting the VALUE, not the arity: an argument-blind assertion is
    // satisfied by the wrong id just as happily as the right one.
    await POST(req({ tag: "camp-2026" }), ctx())
    expect(getContactById).toHaveBeenCalledWith(CONTACT_ID, BUSINESS_ID)
    const [, passed] = vi.mocked(getContactById).mock.calls[0]
    expect(passed).not.toBe("00000000-0000-0000-0000-000000000001")
  })

  it("WRITES the tag in the caller's tenant, not just reads in it", async () => {
    // The bug this replaces: guard() resolved a businessId, spent it on the
    // read gate, and did not return it -- so addTag fell to its
    // SINGLETON_BUSINESS_ID default. The insert SUCCEEDED and answered 200,
    // filing a coach's tag in the operator's partition, where every reader
    // (getContactDetail, tagsForContacts) filters it straight back out. The
    // pill appeared optimistically and vanished on refresh.
    //
    // Scoping a read and then writing unscoped is worse than not scoping at
    // all: the read PROVES the caller owns this contact, and the write then
    // files the row under a different business.
    await POST(req({ tag: "camp-2026" }), ctx())
    const [addArg] = vi.mocked(addTag).mock.calls[0]
    expect(addArg.businessId).toBe(BUSINESS_ID)
    expect(addArg.businessId).not.toBe("00000000-0000-0000-0000-000000000001")
  })

  it("DELETES in the caller's tenant too", async () => {
    // Mis-keyed the same way, with the mirror consequence: filtering on the
    // singleton meant a coach could never remove a tag that was filed right.
    await DELETE(req({ tag: "camp-2026" }, "DELETE"), ctx())
    const [delArg] = vi.mocked(removeTag).mock.calls[0]
    expect(delArg.businessId).toBe(BUSINESS_ID)
    expect(delArg.businessId).not.toBe("00000000-0000-0000-0000-000000000001")
  })

  it("404s for a contact in ANOTHER tenant, the same answer as one that does not exist", async () => {
    // The scoped read returns null for both cases, and 404 is the right answer
    // to fail closed to: distinguishing them would confirm the row exists.
    vi.mocked(getContactById).mockResolvedValue(null as never)
    const res = await POST(req({ tag: "camp-2026" }), ctx())
    expect(res.status).toBe(404)
    expect(addTag).not.toHaveBeenCalled()
  })

  it("403s when the caller resolves to no business at all", async () => {
    // A revoked membership or a paused business. Failing closed here is what
    // stops the route falling through to the singleton default.
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())
    const res = await POST(req({ tag: "camp-2026" }), ctx())
    expect(res.status).toBe(403)
    expect(addTag).not.toHaveBeenCalled()
  })

  it("creates the tag for the contact named in the PATH", async () => {
    const res = await POST(req({ tag: "camp-2026" }), ctx())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ tag: "camp-2026", created: true })
    // Pins WHICH contact and WHICH tag reached the DAL — a route that tagged
    // the wrong person would still answer 200.
    expect(addTag).toHaveBeenCalledWith({
      contactId: CONTACT_ID,
      tag: "camp-2026",
      createdBy: "admin-1",
      businessId: BUSINESS_ID,
    })
  })

  it("normalises before writing, using the same rule the DAL applies", async () => {
    await POST(req({ tag: "  Camp   2026 " }), ctx())
    expect(addTag).toHaveBeenCalledWith(expect.objectContaining({ tag: "camp 2026" }))
  })

  it("reports created:false when the contact already had the tag", async () => {
    vi.mocked(addTag).mockResolvedValue({ tag: "camp-2026", created: false } as never)
    const res = await POST(req({ tag: "camp-2026" }), ctx())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ tag: "camp-2026", created: false })
  })

  it("403s an anonymous caller and writes nothing", async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const res = await POST(req({ tag: "camp-2026" }), ctx())
    expect(res.status).toBe(403)
    expect(addTag).not.toHaveBeenCalled()
  })

  it("403s a signed-in caller the permission guard refuses", async () => {
    vi.mocked(canAccessAdminPath).mockResolvedValue(false)
    const res = await POST(req({ tag: "camp-2026" }), ctx())
    expect(res.status).toBe(403)
    expect(addTag).not.toHaveBeenCalled()
  })

  it("404s for a contact that does not exist, rather than failing on the foreign key", async () => {
    vi.mocked(getContactById).mockResolvedValue(null as never)
    const res = await POST(req({ tag: "camp-2026" }), ctx("99999999-9999-9999-9999-999999999999"))
    expect(res.status).toBe(404)
    expect(addTag).not.toHaveBeenCalled()
  })

  it("400s an empty tag", async () => {
    const res = await POST(req({ tag: "   " }), ctx())
    expect(res.status).toBe(400)
    expect(addTag).not.toHaveBeenCalled()
  })

  it("400s an over-long tag", async () => {
    const res = await POST(req({ tag: "x".repeat(41) }), ctx())
    expect(res.status).toBe(400)
    expect(addTag).not.toHaveBeenCalled()
  })

  // The Add-a-question incident: a button that minted `prompt: ""` had its whole
  // save thrown away by a `min(1)`. A non-string is what a hand-rolled fetch
  // actually sends, so it gets a 400 and not a 500.
  it("400s a non-string tag rather than throwing", async () => {
    const res = await POST(req({ tag: 42 }), ctx())
    expect(res.status).toBe(400)
    expect(addTag).not.toHaveBeenCalled()
  })

  it("400s a body that is not JSON at all", async () => {
    const res = await POST(req("not json", "POST"), ctx())
    expect(res.status).toBe(400)
    expect(addTag).not.toHaveBeenCalled()
  })

  it("500s — not 200 — when the DAL throws", async () => {
    vi.mocked(addTag).mockRejectedValue(new Error("connection reset"))
    const res = await POST(req({ tag: "camp-2026" }), ctx())
    expect(res.status).toBe(500)
  })

  it("records an audit row for the write", async () => {
    await POST(req({ tag: "camp-2026" }), ctx())
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "contact.tag_added",
        category: "admin_write",
        target: expect.objectContaining({ type: "contact", id: CONTACT_ID }),
      }),
    )
  })

  // WITHOUT THE METADATA THE TRAIL CANNOT ANSWER ITS OWN QUESTION. `tagTarget`
  // carries only the contact id, so two `contact.tag_added` rows for different
  // tags would be byte-identical — and a re-add that hit the unique-constraint
  // no-op would be indistinguishable from one that actually created a row.
  // The metadata is read off the RESPONSE, so it records what the write actually
  // stored rather than what was asked for. Proved by making the DAL answer with
  // a tag deliberately different from the one posted: if the resolver read the
  // request body instead, this would carry "typed-by-the-operator".
  it("puts the STORED tag and the created flag on the audit row", async () => {
    vi.mocked(addTag).mockResolvedValue({ tag: "stored-by-the-dal", created: true } as never)
    await POST(req({ tag: "typed-by-the-operator" }), ctx())
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "contact.tag_added",
        metadata: expect.objectContaining({ tag: "stored-by-the-dal", created: true }),
      }),
    )
  })

  it("records created:false on the audit row when the tag was already there", async () => {
    vi.mocked(addTag).mockResolvedValue({ tag: "camp-2026", created: false } as never)
    await POST(req({ tag: "camp-2026" }), ctx())
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ created: false }) }),
    )
  })

  it("records the audit row as DENIED when the caller is refused", async () => {
    vi.mocked(canAccessAdminPath).mockResolvedValue(false)
    await POST(req({ tag: "camp-2026" }), ctx())
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }))
  })
})

describe("DELETE /api/admin/contacts/[id]/tags", () => {
  it("removes the tag for the contact named in the path", async () => {
    const res = await DELETE(req({ tag: "camp-2026" }, "DELETE"), ctx())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ tag: "camp-2026", removed: true })
    expect(removeTag).toHaveBeenCalledWith({
      contactId: CONTACT_ID,
      tag: "camp-2026",
      businessId: BUSINESS_ID,
    })
  })

  it("403s an anonymous caller and removes nothing", async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const res = await DELETE(req({ tag: "camp-2026" }, "DELETE"), ctx())
    expect(res.status).toBe(403)
    expect(removeTag).not.toHaveBeenCalled()
  })

  it("400s an empty tag", async () => {
    const res = await DELETE(req({ tag: "" }, "DELETE"), ctx())
    expect(res.status).toBe(400)
    expect(removeTag).not.toHaveBeenCalled()
  })

  it("records an audit row for the removal, carrying which tag went", async () => {
    await DELETE(req({ tag: "camp-2026" }, "DELETE"), ctx())
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "contact.tag_removed",
        category: "admin_write",
        metadata: expect.objectContaining({ tag: "camp-2026", removed: true }),
      }),
    )
  })
})
