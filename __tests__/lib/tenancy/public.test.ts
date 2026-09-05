// @vitest-environment node
//
// lib/tenancy/public.ts is the ONLY Host boundary. This suite pins the
// decision table in the spec's §6 — WHICH tenant comes back and WHAT is
// logged — with the seam, the reader, the audit writer and next/headers all
// mocked. The module is re-imported per test (vi.resetModules) because the
// "warn once per host" dedupe is module state, and a test that inherited a
// warned host from its neighbour would pass for the wrong reason.
//
// The two claims most likely to be "tidied" away are pinned by name:
//   - a throwing headers() PROPAGATES. Next throws from headers() during a
//     static prerender to bail the route out to dynamic rendering; catching it
//     would prerender the page with the platform tenant and keep it static
//     forever, silently.
//   - a failed read is NOT the same as an unknown host: it logs an error and
//     files an audit row, where an unknown host only warns.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest"

const h = vi.hoisted(() => {
  class BusinessDomainReadError extends Error {
    readonly code: string
    constructor(code: string, message: string) {
      super(`business_domains read failed (${code}): ${message}`)
      this.name = "BusinessDomainReadError"
      this.code = code
    }
  }
  return {
    headers: vi.fn(),
    find: vi.fn(),
    recordAudit: vi.fn(async () => {}),
    platform: vi.fn(() => "platform-biz"),
    BusinessDomainReadError,
  }
})

vi.mock("next/headers", () => ({ headers: h.headers }))
vi.mock("@/lib/db/business-domains", () => ({
  findBusinessIdByHost: h.find,
  BusinessDomainReadError: h.BusinessDomainReadError,
}))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: h.platform }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: h.recordAudit }))

function withHeaders(init: Record<string, string>) {
  h.headers.mockResolvedValue(new Headers(init))
}

/** Fresh module per call so the once-per-host warn set starts empty. */
async function load() {
  vi.resetModules()
  return await import("@/lib/tenancy/public")
}

let warn: MockInstance
let error: MockInstance

beforeEach(() => {
  h.headers.mockReset()
  h.find.mockReset()
  h.recordAudit.mockClear()
  h.platform.mockClear()
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  error = vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe("normalizeHost", () => {
  it.each([
    ["Coach.Example.COM", "coach.example.com"],
    ["coach.example.com:3050", "coach.example.com"],
    ["LOCALHOST:3050", "localhost"],
    ["[::1]:3050", "[::1]"],
    ["a.test, b.test", "a.test"],
    ["  spaced.test  ", "spaced.test"],
  ])("%s -> %s", async (raw, expected) => {
    const { normalizeHost } = await load()
    expect(normalizeHost(raw)).toBe(expected)
  })

  it.each([[null], [undefined], [""], ["   "], [":3050"]])("%s -> null", async (raw) => {
    const { normalizeHost } = await load()
    expect(normalizeHost(raw as string | null | undefined)).toBeNull()
  })
})

describe("resolvePublicTenant", () => {
  it("returns the matching row's business, looked up by the NORMALISED host, and touches neither the seam nor the log", async () => {
    withHeaders({ host: "Coach.Example.COM:3050" })
    h.find.mockResolvedValue("biz-42")
    const { resolvePublicTenant } = await load()
    await expect(resolvePublicTenant()).resolves.toBe("biz-42")
    expect(h.find).toHaveBeenCalledWith("coach.example.com")
    expect(h.platform).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it("prefers x-forwarded-host over host", async () => {
    withHeaders({ host: "internal.test", "x-forwarded-host": "Public.Test" })
    h.find.mockResolvedValue("biz-public")
    const { resolvePublicTenant } = await load()
    await expect(resolvePublicTenant()).resolves.toBe("biz-public")
    expect(h.find).toHaveBeenCalledWith("public.test")
    expect(h.find).not.toHaveBeenCalledWith("internal.test")
  })

  it("serves the platform for a host no row claims, and warns naming the host", async () => {
    withHeaders({ host: "unknown.test" })
    h.find.mockResolvedValue(null)
    const { resolvePublicTenant } = await load()
    await expect(resolvePublicTenant()).resolves.toBe("platform-biz")
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('"unknown.test"')
    expect(error).not.toHaveBeenCalled()
    expect(h.recordAudit).not.toHaveBeenCalled()
  })

  it("warns ONCE per host per process, and again for a different host", async () => {
    h.find.mockResolvedValue(null)
    const { resolvePublicTenant } = await load()
    withHeaders({ host: "preview-a.vercel.app" })
    await resolvePublicTenant()
    await resolvePublicTenant()
    expect(warn).toHaveBeenCalledTimes(1)
    withHeaders({ host: "preview-b.vercel.app" })
    await resolvePublicTenant()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(String(warn.mock.calls[1][0])).toContain('"preview-b.vercel.app"')
  })

  it("serves the platform when the request carries no Host at all, and says so", async () => {
    withHeaders({})
    const { resolvePublicTenant } = await load()
    await expect(resolvePublicTenant()).resolves.toBe("platform-biz")
    expect(h.find).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/no Host/i)
  })

  it.each([["42P01"], ["PGRST205"]])(
    "treats %s as 'the table is not there yet': platform, a warn naming the code, NO error and NO audit row",
    async (code) => {
      withHeaders({ host: "www.darrenjpaul.com" })
      h.find.mockRejectedValue(new h.BusinessDomainReadError(code, "relation does not exist"))
      const { resolvePublicTenant } = await load()
      await expect(resolvePublicTenant()).resolves.toBe("platform-biz")
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain(code)
      expect(error).not.toHaveBeenCalled()
      expect(h.recordAudit).not.toHaveBeenCalled()
    },
  )

  it("on any OTHER read failure: platform, console.error with code and message, and an audit row with outcome failure", async () => {
    withHeaders({ host: "www.darrenjpaul.com" })
    h.find.mockRejectedValue(new h.BusinessDomainReadError("57014", "canceling statement due to statement timeout"))
    const { resolvePublicTenant } = await load()
    await expect(resolvePublicTenant()).resolves.toBe("platform-biz")
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0][0])).toContain("57014")
    expect(String(error.mock.calls[0][0])).toContain("statement timeout")
    expect(h.recordAudit).toHaveBeenCalledTimes(1)
    // Cast: h.recordAudit's inferred parameter tuple is `[]` (its
    // vi.fn(async () => {}) implementation takes no args), so `.mock.calls[0][0]`
    // does not type-check without it — same pattern as
    // __tests__/app/sms-consent-page.test.ts:535.
    expect((h.recordAudit as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      action: "tenancy.public_host_lookup_failed",
      category: "system",
      outcome: "failure",
      actor: { role: "system" },
      error: { code: "57014" },
      metadata: { host: "www.darrenjpaul.com" },
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it("logs the read failure EVERY time — each one is an incident, unlike the once-per-host warn", async () => {
    withHeaders({ host: "www.darrenjpaul.com" })
    h.find.mockRejectedValue(new h.BusinessDomainReadError("57014", "timeout"))
    const { resolvePublicTenant } = await load()
    await resolvePublicTenant()
    await resolvePublicTenant()
    expect(error).toHaveBeenCalledTimes(2)
    expect(h.recordAudit).toHaveBeenCalledTimes(2)
  })

  it("lets a throwing headers() PROPAGATE — the prerender bail-out must reach Next", async () => {
    const bailout = new Error("Dynamic server usage: headers")
    h.headers.mockRejectedValue(bailout)
    const { resolvePublicTenant } = await load()
    await expect(resolvePublicTenant()).rejects.toBe(bailout)
    expect(h.find).not.toHaveBeenCalled()
    expect(h.platform).not.toHaveBeenCalled()
  })
})

describe("the audit taxonomy", () => {
  it("knows the slug the boundary files, so the admin UI can describe it", async () => {
    const { getActionDef } = await import("@/lib/audit/actions")
    expect(getActionDef("tenancy.public_host_lookup_failed")).toMatchObject({ category: "system" })
  })
})
