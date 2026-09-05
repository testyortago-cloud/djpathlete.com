# Tenancy Phase 4 — Host-header resolution: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every public, unauthenticated surface on the CANNOT RESOLVE YET shelf of `lib/tenancy/platform.ts` resolves its tenant from the request's Host through one new function, `resolvePublicTenant()` in `lib/tenancy/public.ts`, backed by the `business_domains` table, falling back to `platformBusinessId()` only when no row claims the host.

**Architecture:** A new DAL reader (`lib/db/business-domains.ts`) that throws on a failed read and returns null only for "no row"; a new Host boundary (`lib/tenancy/public.ts`) that reads `x-forwarded-host` then `host`, normalises, looks the host up, and applies the spec's decision table (unmatched → platform + warn once; table absent → platform + warn once; read failure → platform + error + audit row); a seed migration for the platform's two hosts; 17 call sites converted one wave at a time with `lib/tenancy/platform.ts`'s shelf shrinking in the same commit so the inventory test stays green; every touched suite asserts WHICH tenant reached the DAL.

**Tech Stack:** Next.js 16 App Router (`next/headers`), Supabase PostgREST via `createServiceRoleClient`, vitest 4 (node is the default environment; DOM suites carry `// @vitest-environment jsdom` on line 1), Playwright for the end-to-end capture.

**Spec:** `docs/superpowers/specs/2026-09-05-tenancy-phase4-host-resolution-design.md` — read §3 (design), §6 (error table) and §10 (traps) before any task.

## Global Constraints

- Node: run everything under the version in `.nvmrc` (24). Every shell: `source ~/.nvm/nvm.sh && nvm use` first. `vitest.config.ts` refuses to run on an older Node — that refusal is correct, not a bug.
- Never add a `SINGLETON_BUSINESS_ID` reference anywhere. The count is 5; it must stay 5.
- `lib/tenancy/resolve.ts` is the ONLY session boundary; `lib/tenancy/public.ts` is the ONLY Host boundary. Neither imports the other.
- `users.role` stays `admin|client|editor|staff`. No permission changes, no switcher, no ads scoping.
- Do NOT wrap `await headers()` in try/catch (spec §10). Only the `business_domains` read is caught.
- Every converted file resolves ONCE at the top of its handler/render and threads the value.
- Tests assert WHICH tenant (`"host-biz"` / `"platform-biz"` sentinels), never that a value came back. Every run must show a non-zero test count per file.
- Node pragma (`// @vitest-environment node`) on line 1 of every new test file that does not render.
- Commit messages: no Claude attribution of any kind. Do not push.
- 12 repo files already fail `prettier --check` at the branch point; do not reformat any file you did not otherwise change, and check a changed file against `git show HEAD:<file> | npx prettier --check --stdin-filepath <file>` before blaming yourself.
- The tsc baseline is EXACTLY the 251 lines at `/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/tsc-base-full-singleton-removal-2026-09-05.txt` (outside the repo; it exists — do not regenerate it). Compare the SET with `(line,col)` stripped: `sed -E 's/\([0-9]+,[0-9]+\)//'` on both sides, then `diff`.
- zsh: `for x in $LIST` runs ONCE; use literal lists or `${=VAR}`.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/db/business-domains.ts` (new) | the ONE reader of `business_domains`: `findBusinessIdByHost` + `BusinessDomainReadError` |
| `lib/tenancy/public.ts` (new) | the Host boundary: `normalizeHost`, `resolvePublicTenant`; its doc comment inventories its callers |
| `lib/audit/actions.ts` | one new row: `tenancy.public_host_lookup_failed` |
| `supabase/migrations/00251_business_domains_platform_seed.sql` (new) | the platform's two hosts as rows |
| `lib/tenancy/platform.ts` | the CANNOT RESOLVE YET shelf shrinks to one public entry |
| 17 callers (spec §1) | seam line + import + comment |
| `__tests__/helpers/seam-callers.ts` (new) | `callersOf(identifier, excludeFile)` — the walker both inventory tests share |
| `__tests__/lib/tenancy/platform-inventory.test.ts` | uses the shared walker (no behaviour change) |
| `__tests__/lib/tenancy/public-inventory.test.ts` (new) | forward/reverse/presence pins on `public.ts`'s inventory |
| `__tests__/lib/db/business-domains.test.ts`, `__tests__/lib/tenancy/public.test.ts` (new) | unit suites |
| ~20 existing suites | retargeted: mock `@/lib/tenancy/public`, assert `"host-biz"` |
| `screenshots/tenancy-phase4/` (new) | the end-to-end proof: curl transcript + annotated captures + index |

---

### Task 1: The reader — `lib/db/business-domains.ts`

**Files:**
- Create: `lib/db/business-domains.ts`
- Test: `__tests__/lib/db/business-domains.test.ts`

**Interfaces:**
- Consumes: `createServiceRoleClient` from `@/lib/supabase`.
- Produces: `findBusinessIdByHost(host: string): Promise<string | null>` (throws `BusinessDomainReadError`); `class BusinessDomainReadError extends Error { readonly code: string }`. Task 2 depends on both names exactly.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
//
// business_domains has had ZERO readers since migration 00240; this is the
// first. Two claims are pinned that a "convenient" implementation gets wrong:
// the lookup is by the EXACT host it was handed (no lowercasing here — the
// boundary normalises), and a failed read THROWS. Returning null on a failed
// read would make "could not look" indistinguishable from "nobody owns this
// host", and lib/tenancy/public.ts would then serve the platform silently
// for what is really an outage. null and [] are different answers.
import { describe, it, expect, vi, beforeEach } from "vitest"

const state = {
  result: { data: null as unknown, error: null as null | { code: string; message: string } },
  calls: [] as Array<[string, string]>,
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      state.calls.push(["from", table])
      const builder = {
        select: (cols: string) => {
          state.calls.push(["select", cols])
          return builder
        },
        eq: (col: string, val: unknown) => {
          state.calls.push(["eq", `${col}=${String(val)}`])
          return builder
        },
        maybeSingle: async () => state.result,
      }
      return builder
    },
  }),
}))

import { findBusinessIdByHost, BusinessDomainReadError } from "@/lib/db/business-domains"

beforeEach(() => {
  state.calls.length = 0
  state.result = { data: null, error: null }
})

describe("findBusinessIdByHost", () => {
  it("reads business_domains by the EXACT host it was given and returns that row's business", async () => {
    state.result = { data: { business_id: "biz-42" }, error: null }
    await expect(findBusinessIdByHost("coach.example.com")).resolves.toBe("biz-42")
    expect(state.calls).toEqual([
      ["from", "business_domains"],
      ["select", "business_id"],
      ["eq", "host=coach.example.com"],
    ])
  })

  it("does not lowercase on the way in — normalisation is the boundary's job, and a wrong-case host finds nothing", async () => {
    await findBusinessIdByHost("Coach.Example.COM")
    expect(state.calls).toContainEqual(["eq", "host=Coach.Example.COM"])
  })

  it("returns null when no row claims the host", async () => {
    await expect(findBusinessIdByHost("nobody.test")).resolves.toBeNull()
  })

  it("THROWS on a failed read, carrying PostgREST's code — null is reserved for 'no row'", async () => {
    state.result = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.business_domains'" } }
    const attempt = findBusinessIdByHost("x.test")
    await expect(attempt).rejects.toBeInstanceOf(BusinessDomainReadError)
    await expect(findBusinessIdByHost("x.test")).rejects.toMatchObject({ code: "PGRST205" })
    // The message names the code and the reason: a raw PostgREST object logs as [object Object].
    await expect(findBusinessIdByHost("x.test")).rejects.toThrow(/PGRST205.*Could not find the table/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use >/dev/null && npx vitest run __tests__/lib/db/business-domains.test.ts`
Expected: FAIL — cannot resolve `@/lib/db/business-domains`.

- [ ] **Step 3: Write the reader**

```ts
import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

/**
 * A failed read of `business_domains`. Carries PostgREST's code so the Host
 * boundary (lib/tenancy/public.ts) can tell "the table is not there yet" —
 * the deploy window between the migration applying and the build finishing —
 * from every other failure. The message names the code and the reason
 * because a raw PostgREST error object logs as `[object Object]`.
 */
export class BusinessDomainReadError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(`business_domains read failed (${code}): ${message}`)
    this.name = "BusinessDomainReadError"
    this.code = code
  }
}

/**
 * The business that owns `host`, or null when no row claims it.
 *
 * `host` must already be normalised — lowercase, no scheme, no port, the way
 * the column is stored (see `normalizeHost` in lib/tenancy/public.ts). This
 * does not lowercase on the way in; an un-normalised value simply finds
 * nothing, which is the honest answer to a question asked in the wrong shape.
 *
 * THROWS on a failed read. null means "no row", never "could not look" —
 * conflating the two would make an outage indistinguishable from an unknown
 * host, and the caller would serve the platform for both without a trace.
 *
 * No `kind` filter: an `alias` row resolves exactly like a `primary` one. The
 * distinction is for the domain-management surface that does not exist yet.
 */
export async function findBusinessIdByHost(host: string): Promise<string | null> {
  const { data, error } = await getClient()
    .from("business_domains")
    .select("business_id")
    .eq("host", host)
    .maybeSingle()
  if (error) throw new BusinessDomainReadError(error.code ?? "unknown", error.message ?? String(error))
  return (data as { business_id: string } | null)?.business_id ?? null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/db/business-domains.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Mutation check — the throw is load-bearing**

Temporarily change the `if (error) throw …` line to `if (error) return null`, run the suite, confirm the fourth test FAILS, then restore the throw and confirm 4/4 again. Record the result in your report.

- [ ] **Step 6: tsc gate for the new file**

Run: `npx tsc --noEmit 2>&1 | grep -E "error TS" | grep -E "lib/db/business-domains|__tests__/lib/db/business-domains"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add lib/db/business-domains.ts __tests__/lib/db/business-domains.test.ts
git commit -m "feat(tenancy): business_domains gets its first reader, and a failed read throws"
```

---

### Task 2: The Host boundary — `lib/tenancy/public.ts` + the audit slug

**Files:**
- Create: `lib/tenancy/public.ts`
- Modify: `lib/audit/actions.ts` (the `// business -- multi-coach tenants` block, near line 585)
- Test: `__tests__/lib/tenancy/public.test.ts`

**Interfaces:**
- Consumes: `findBusinessIdByHost`, `BusinessDomainReadError` (Task 1); `platformBusinessId()` from `@/lib/tenancy/platform`; `recordAudit` from `@/lib/audit/record`; `headers` from `next/headers`.
- Produces: `resolvePublicTenant(): Promise<string>` and `normalizeHost(raw: string | null | undefined): string | null`. Every later task calls `resolvePublicTenant()` with no arguments.

- [ ] **Step 1: Write the failing test**

```ts
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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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

let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

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
    expect(h.recordAudit.mock.calls[0][0]).toMatchObject({
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/tenancy/public.test.ts`
Expected: FAIL — cannot resolve `@/lib/tenancy/public`.

- [ ] **Step 3: Add the audit row**

In `lib/audit/actions.ts`, directly after the `business.created` row inside the `// business -- multi-coach tenants` block, add:

```ts
  {
    slug: "tenancy.public_host_lookup_failed",
    category: "system",
    description: "A public request's Host could not be looked up in business_domains; the platform was served",
  },
```

- [ ] **Step 4: Write the boundary**

```ts
import { headers } from "next/headers"
import { findBusinessIdByHost, BusinessDomainReadError } from "@/lib/db/business-domains"
import { platformBusinessId } from "@/lib/tenancy/platform"
import { recordAudit } from "@/lib/audit/record"

/**
 * THE HOST BOUNDARY — the one place a public, unauthenticated request's tenant
 * is decided. lib/tenancy/resolve.ts is the session boundary and stays the
 * only one; this file never imports it, and it never imports this.
 *
 * `resolvePublicTenant()` takes no arguments and reads `await headers()`, so
 * one call works in a route handler and in a server component alike. It reads
 * `x-forwarded-host` first (the value a proxy in front of the app carries;
 * Vercel sets it from the real request) and `host` second, normalises
 * (lowercase, no port), and looks the host up in `business_domains`. A row
 * wins. Otherwise the platform's own business is served, through
 * `platformBusinessId()` — which is why lib/tenancy/platform.ts lists THIS
 * file, and only this file, as the public surfaces' remaining caller.
 *
 * Three ways to reach the platform, three different log lines (spec §6):
 *   - no row claims the host (every dev and preview host lands here): warn,
 *     ONCE per host per process. "Never silent" means the host is named, not
 *     that the log is flooded with one line per request.
 *   - the table is not there yet (PostgREST 42P01 / PGRST205): the window
 *     between the migration applying on push and the Vercel build finishing.
 *     Warn once, naming the code. Self-heals; not an incident.
 *   - any other failed read: error EVERY time with code and message (never
 *     the raw object — it logs as [object Object]), plus an audit row with
 *     outcome "failure" so the 24h strip on /admin/audit-logs sees it. A
 *     public page 500ing on a transient read is worse than serving the
 *     platform; that is the recorded decision, not a default.
 *
 * `await headers()` is deliberately OUTSIDE the try. During a static
 * prerender Next throws from it to bail the route out to dynamic rendering;
 * swallowing that would prerender the page with the platform tenant and keep
 * it static forever. Pinned by __tests__/lib/tenancy/public.test.ts.
 *
 * Security: a client controls its own Host. The worst it can do is file its
 * OWN submission under a business whose host it names — which it could do
 * by sending the request to that host. An unknown host resolves to the
 * platform, never to "any"; no other tenant's rows become readable.
 *
 * CALLERS — every public surface that used to sit on platform.ts's CANNOT
 * RESOLVE YET shelf. __tests__/lib/tenancy/public-inventory.test.ts fails if
 * a caller is missing from this list or a listed file stops calling.
 *
 *   The §5.1 lead-capture routes, each resolving once at the top and
 *   threading into every write (contact, settings read, consent row):
 *     app/api/contact/route.ts
 *     app/api/shop/leads/route.ts
 *     app/api/newsletter/route.ts
 *     app/api/inquiry/route.ts
 *     app/api/events/[id]/signup/route.ts
 *     app/api/events/[id]/checkout/route.ts
 *     app/api/funnels/submit/route.ts
 *     app/api/ask/config/route.ts
 *   The two places a row's tenant is DECIDED, after which the row carries it:
 *     app/api/quiz/progress/route.ts   (createAttempt; quiz/submit inherits)
 *     app/api/ask/route.ts             (createConversation; the rest of that
 *                                       route threads conversation.business_id)
 *   The pages and server components that render the consent wording those
 *   routes file, which must read the SAME business the route resolves —
 *   under Host resolution both read the same header:
 *     app/(marketing)/ask/page.tsx
 *     app/(marketing)/camps/[slug]/page.tsx
 *     app/(marketing)/clinics/[slug]/page.tsx
 *     components/public/InquiryForm.tsx
 *     components/public/StepUpInquiryForm.tsx
 *     components/funnels/islands/FormIsland.tsx
 *     components/funnels/islands/QuizIsland.tsx
 */

/** PostgREST codes meaning "the table is not there yet": undefined_table, and "not in the schema cache". */
const TABLE_NOT_THERE_YET = new Set(["42P01", "PGRST205"])

/**
 * Lowercase, no port, first value of a comma list, trimmed. Null for absent
 * or blank. Exported for its own tests; the DAL expects exactly this shape.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null
  const first = raw.split(",")[0]?.trim().toLowerCase() ?? ""
  if (first === "") return null
  // An IPv6 literal keeps its brackets and loses only the port: "[::1]:3050" -> "[::1]".
  const noPort = first.startsWith("[") ? first.replace(/^(\[[^\]]*\]).*$/, "$1") : first.replace(/:.*$/, "")
  return noPort === "" ? null : noPort
}

const warnedHosts = new Set<string>()

function warnOnce(host: string, message: string): void {
  if (warnedHosts.has(host)) return
  warnedHosts.add(host)
  console.warn(message)
}

/** The business this public request belongs to. Never throws for a tenancy reason. */
export async function resolvePublicTenant(): Promise<string> {
  const h = await headers()
  const host = normalizeHost(h.get("x-forwarded-host") ?? h.get("host"))

  if (host === null) {
    warnOnce("(none)", "[tenancy] request carried no Host header; serving the platform")
    return platformBusinessId()
  }

  try {
    const businessId = await findBusinessIdByHost(host)
    if (businessId !== null) return businessId
    warnOnce(host, `[tenancy] no business_domains row for host "${host}"; serving the platform`)
    return platformBusinessId()
  } catch (err) {
    const code = err instanceof BusinessDomainReadError ? err.code : "unknown"
    const message = err instanceof Error ? err.message : String(err)
    if (TABLE_NOT_THERE_YET.has(code)) {
      warnOnce(host, `[tenancy] business_domains is not there yet (${code}) for host "${host}"; serving the platform`)
      return platformBusinessId()
    }
    console.error(`[tenancy] business_domains read failed for host "${host}" (${code} ${message}); serving the platform`)
    // Awaited, not fire-and-forget: a serverless function may end the moment
    // the response does, and this row is the only durable trace. recordAudit
    // never throws. `actor` is passed so it does not call auth() on a public
    // request.
    await recordAudit({
      action: "tenancy.public_host_lookup_failed",
      category: "system",
      outcome: "failure",
      actor: { role: "system" },
      error: { code, message },
      metadata: { host },
    })
    return platformBusinessId()
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/tenancy/public.test.ts`
Expected: PASS — 11 tests in `normalizeHost` (6 + 5), 9 in `resolvePublicTenant`, 1 taxonomy.

- [ ] **Step 6: Mutation check — the dedupe is load-bearing**

Temporarily make `warnOnce` call `console.warn` unconditionally (skip the `Set`), run the suite, confirm "warns ONCE per host" FAILS, restore, confirm green. Record it.

- [ ] **Step 7: The inventory test sees the new caller of the seam**

Run: `npx vitest run __tests__/lib/tenancy/platform-inventory.test.ts`
Expected: FAIL on "names every file that references platformBusinessId" — `lib/tenancy/public.ts` calls the seam and platform.ts does not name it yet. That is the test working. Fix it now, minimally: in `lib/tenancy/platform.ts`, inside the CANNOT RESOLVE A TENANT YET shelf, add this entry directly BEFORE the `- the public lead-capture surfaces, converted 2026-09-05…` bullet (the 17-path list stays for now; later tasks remove paths as they convert):

```
 *   - the Host boundary's own fallback (lib/tenancy/public.ts). Since phase 4
 *     every public surface resolves through `resolvePublicTenant()`, which
 *     reads `business_domains` by the request's Host and reaches this only
 *     when no row claims the host, when the table is not there yet (the
 *     deploy window), or when the read failed. Its callers are inventoried in
 *     that file, not here.
```

Re-run the inventory test: PASS, 5 tests.

- [ ] **Step 8: tsc gate**

Run: `npx tsc --noEmit 2>&1 | grep -E "error TS" | grep -E "lib/tenancy/public|lib/audit/actions|__tests__/lib/tenancy/public\.test"`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add lib/tenancy/public.ts lib/audit/actions.ts lib/tenancy/platform.ts __tests__/lib/tenancy/public.test.ts
git commit -m "feat(tenancy): the Host boundary — resolvePublicTenant() reads business_domains and falls back to the platform, loudly"
```

---

### Task 3: Migration 00251 — the platform's own hosts

**Files:**
- Create: `supabase/migrations/00251_business_domains_platform_seed.sql`

**Interfaces:**
- Consumes: `business_domains` from 00240; the platform business row `00000000-0000-0000-0000-000000000001`.
- Produces: two rows. No code depends on their presence (Task 2 serves the platform without them).

- [ ] **Step 1: Confirm the number is free**

Run: `ls supabase/migrations | tail -1` (expect `00250_…`) and `git log --all --oneline -- 'supabase/migrations/00251*'` (expect nothing).

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/00251_business_domains_platform_seed.sql
-- Tenancy phase 4: the platform's own hosts become rows.
--
-- business_domains (00240) has had no reader and no rows. lib/tenancy/public.ts
-- now reads it by the request's Host, so the two hosts production answers on
-- are seeded here for the platform business. `host` is a plain UNIQUE
-- constraint, so ON CONFLICT (host) is inferable and a re-run is a no-op.
--
-- THE RACE. On push to main this applies while Vercel is still building. Old
-- code + these rows: ignored. New code + no rows yet: lib/tenancy/public.ts
-- warns once and serves the platform. Both orders serve the platform, because
-- the platform is the only business; there is no window with a different answer.
--
-- verified_at is set: both hosts are live on Vercel today (darrenjpaul.com
-- answers 307 to www; www answers 200). vercel_domain_id stays null — it has
-- no reader, and a value nothing reads is a labelling gap, not data.

insert into public.business_domains (business_id, host, kind, verified_at)
values
  ('00000000-0000-0000-0000-000000000001', 'www.darrenjpaul.com', 'primary', now()),
  ('00000000-0000-0000-0000-000000000001', 'darrenjpaul.com',     'alias',   now())
on conflict (host) do nothing;
```

- [ ] **Step 3: Sanity-check the SQL parses against the real schema**

The dev clone is applied by the ORCHESTRATOR (it needs the Supabase MCP), not by this task. Your check is static: `grep -n "unique" supabase/migrations/00240_booking_tenancy_tables.sql | grep host` must show `host text not null unique` (a plain constraint — ON CONFLICT can infer it; a partial index could not).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00251_business_domains_platform_seed.sql
git commit -m "feat(tenancy): seed the platform's two hosts into business_domains"
```

---

### Task 4: The shared seam walker — `__tests__/helpers/seam-callers.ts`

**Files:**
- Create: `__tests__/helpers/seam-callers.ts`
- Modify: `__tests__/lib/tenancy/platform-inventory.test.ts` (replace the local `walk`, `isCommentLine`, `callers` with the helper; keep every test and comment)

**Interfaces:**
- Produces: `callersOf(identifier: string, excludeFile: string, root?: string): string[]` — sorted repo-relative paths under `app/`, `lib/`, `components/` (skipping `node_modules` and `__tests__`) whose files reference `identifier` on a line that is neither a comment nor a bare `import`. Task 10 depends on this exact signature.

- [ ] **Step 1: Write the helper**

```ts
// Shared by the seam-inventory tests. A "seam" here is a function whose doc
// comment is a TRUTHFUL INVENTORY of its callers (lib/tenancy/platform.ts,
// lib/tenancy/public.ts); the tests over it need one walker, so the forward
// check ("every caller is named") and the reverse check ("every named path
// still calls") read the same relation each way.
//
// The match is on the IDENTIFIER, not on the literal call `name()`.
// lib/bookings/calendly-tenant.ts reaches platformBusinessId as
// `(deps.platformBusinessId ?? platformBusinessId)()` — the function passed as
// a VALUE, with no `()` against the name. A literal-call match reported that
// file as a non-caller: a real caller invisible to the check that exists to
// find them. A bare `import` line is skipped because importing a symbol is
// not using it; every real caller has the identifier on at least one other
// line, so the skip costs nothing and stops a leftover import from being
// reported as a caller. Comment lines are skipped so prose ABOUT a seam is
// never mistaken for a use of it.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

export const SEAM_ROOTS = ["app", "lib", "components"] as const

export function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

export function isCommentLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")
}

/**
 * Repo-relative paths of every file under app/, lib/ and components/ that
 * references `identifier` on a code line, excluding `excludeFile` (the seam's
 * own file, which defines it). Sorted.
 */
export function callersOf(identifier: string, excludeFile: string, root: string = process.cwd()): string[] {
  const hits: string[] = []
  for (const seamRoot of SEAM_ROOTS) {
    for (const file of walk(join(root, seamRoot))) {
      const rel = relative(root, file)
      if (rel === excludeFile) continue
      const refs = readFileSync(file, "utf8")
        .split("\n")
        .some((line) => {
          if (isCommentLine(line)) return false
          if (line.trim().startsWith("import ")) return false
          return line.includes(identifier)
        })
      if (refs) hits.push(rel)
    }
  }
  return hits.sort()
}
```

- [ ] **Step 2: Retarget the platform inventory test to it**

In `__tests__/lib/tenancy/platform-inventory.test.ts`: delete the local `walk`, `isCommentLine` and `callers` functions and the `readdirSync, statSync` / `join, relative` imports they needed (keep `readFileSync` and `join` — `inventoryPaths()` still uses them); add `import { callersOf } from "../../helpers/seam-callers"`; add `function callers(): string[] { return callersOf("platformBusinessId", INVENTORY) }` in their place. Move the paragraph explaining identifier-vs-call from the deleted `callers` doc comment into a one-line pointer: `// The walker and the identifier-not-call rule live in __tests__/helpers/seam-callers.ts.` Every `it(...)` stays byte-identical.

- [ ] **Step 3: Run the test — same 5 tests, same verdicts**

Run: `npx vitest run __tests__/lib/tenancy/platform-inventory.test.ts`
Expected: PASS, 5 tests. Then prove the helper still sees the value-passing caller: `node -e` is not needed — the fourth test ("counts a file that passes the seam as a value") is that proof.

- [ ] **Step 4: tsc gate**

Run: `npx tsc --noEmit 2>&1 | grep -E "error TS" | grep -E "__tests__/helpers/seam-callers|platform-inventory"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add __tests__/helpers/seam-callers.ts __tests__/lib/tenancy/platform-inventory.test.ts
git commit -m "test(tenancy): the seam walker is shared, so the Host boundary can have an inventory test too"
```

---

### Task 5: Wave 1 — contact, shop/leads, newsletter, inquiry

**Files:**
- Modify: `app/api/contact/route.ts:8,24-28`, `app/api/shop/leads/route.ts:12,30-34`, `app/api/newsletter/route.ts:14,59-63`, `app/api/inquiry/route.ts:19,59-63`
- Modify: `lib/tenancy/platform.ts` (remove those four paths from the shelf list)
- Test (retarget): `__tests__/api/spine/contact-spine.test.ts`, `__tests__/api/spine/shop-leads-spine.test.ts`, `__tests__/integration/api/shop/leads.test.ts`, `__tests__/api/newsletter/tenant.test.ts`, `__tests__/api/spine/newsletter-spine.test.ts`, `__tests__/api/newsletter/attribution-capture.test.ts`, `__tests__/api/spine/inquiry-spine.test.ts`, `__tests__/api/inquiry/attribution-capture.test.ts`

**Interfaces:**
- Consumes: `resolvePublicTenant()` (Task 2).
- Produces: nothing new; the four routes thread `businessId` exactly as before.

- [ ] **Step 1: Retarget the suites first (they must go red for the right reason)**

In each suite that has `vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))` for one of these four routes (`contact-spine`, `shop-leads-spine`, `inquiry-spine`; `newsletter/tenant` mocks it through its `h` object — read the file and swap that member), replace it with:

```ts
// The route resolves its tenant from the request's Host through the ONE Host
// boundary (lib/tenancy/public.ts). Mocked to a sentinel that is not the
// platform's, so a route that hard-codes platformBusinessId() cannot pass.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))
```

and change every `"platform-biz"` expectation in that suite to `"host-biz"`. In the suites that mock NO seam today (`newsletter-spine`, both `attribution-capture` files), add the same `vi.mock` (the real boundary calls `headers()`, which throws outside a request scope — a suite that forgets this fails loudly with that message) and add ONE which-tenant assertion on a DAL mock the suite already holds, e.g. in `newsletter/attribution-capture.test.ts`:

```ts
expect(captureLead).toHaveBeenCalledWith(expect.objectContaining({ businessId: "host-biz" }))
```

(read each suite to find which of `captureLead`, `recordConsent`, `getBusinessSettings`, `createInquiry` it mocks; assert on the one that receives `businessId`). In `__tests__/integration/api/shop/leads.test.ts` (the integration lane; it writes to the real dev clone under the platform business), mock the boundary to the real seam instead of a sentinel:

```ts
vi.mock("@/lib/tenancy/public", async () => {
  const { platformBusinessId } = await import("@/lib/tenancy/platform")
  return { resolvePublicTenant: async () => platformBusinessId() }
})
```

Run: `npx vitest run __tests__/api/spine/contact-spine.test.ts __tests__/api/spine/shop-leads-spine.test.ts __tests__/api/newsletter/tenant.test.ts __tests__/api/spine/newsletter-spine.test.ts __tests__/api/newsletter/attribution-capture.test.ts __tests__/api/spine/inquiry-spine.test.ts __tests__/api/inquiry/attribution-capture.test.ts`
Expected: the which-tenant assertions FAIL (the routes still return the platform's value, and the platform module is no longer mocked, so they see the real constant).

- [ ] **Step 2: Convert the four routes**

In each file, replace `import { platformBusinessId } from "@/lib/tenancy/platform"` with `import { resolvePublicTenant } from "@/lib/tenancy/public"`, and replace the four-line comment plus seam line with (indentation as in the file):

```ts
    // PUBLIC ROUTE, NO SESSION. The tenant is resolved from the request's Host
    // by lib/tenancy/public.ts (business_domains), and is the platform's own
    // only when no domain row claims the host. Resolved once here and
    // threaded; the DAL does not default it.
    const businessId = await resolvePublicTenant()
```

Every later use of `businessId` in the file is unchanged.

- [ ] **Step 3: Shrink the shelf**

In `lib/tenancy/platform.ts`, delete these four lines from the 17-path list under "the public lead-capture surfaces":
`app/api/contact/route.ts`, `app/api/shop/leads/route.ts`, `app/api/newsletter/route.ts`, `app/api/inquiry/route.ts`.

- [ ] **Step 4: Run the suites and the inventory test**

Run: the Task-5 suite list above plus `__tests__/lib/tenancy/platform-inventory.test.ts`
Expected: all PASS with non-zero counts per file. If the inventory test's reverse check fails, a converted path is still named in platform.ts — remove it; never add it to `NAMED_BUT_NOT_CALLERS`.

- [ ] **Step 5: Mutation check — the retarget pins the tenant**

In `app/api/contact/route.ts`, temporarily replace `await resolvePublicTenant()` with the literal `"00000000-0000-0000-0000-000000000001"`, run `contact-spine`, confirm it FAILS, restore, confirm green. Record it.

- [ ] **Step 6: tsc gate on the touched files**

Run: `npx tsc --noEmit 2>&1 | grep -E "error TS" | grep -E "app/api/(contact|shop/leads|newsletter|inquiry)/|contact-spine|shop-leads-spine|newsletter/|inquiry/"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add app/api/contact/route.ts app/api/shop/leads/route.ts app/api/newsletter/route.ts app/api/inquiry/route.ts lib/tenancy/platform.ts __tests__/api/spine/contact-spine.test.ts __tests__/api/spine/shop-leads-spine.test.ts __tests__/integration/api/shop/leads.test.ts __tests__/api/newsletter/tenant.test.ts __tests__/api/spine/newsletter-spine.test.ts __tests__/api/newsletter/attribution-capture.test.ts __tests__/api/spine/inquiry-spine.test.ts __tests__/api/inquiry/attribution-capture.test.ts
git commit -m "refactor(tenancy): contact, shop-lead, newsletter and inquiry routes resolve their tenant from the Host"
```

---

### Task 6: Wave 2 — events signup, events checkout, funnels/submit

**Files:**
- Modify: `app/api/events/[id]/signup/route.ts:12,50-54`, `app/api/events/[id]/checkout/route.ts:11,41-45`, `app/api/funnels/submit/route.ts:30,123-128`
- Modify: `lib/tenancy/platform.ts` (remove those three paths)
- Test (retarget): `__tests__/api/spine/event-signup-spine.test.ts`, `__tests__/api/events/signup.test.ts`, `__tests__/api/events/checkout.test.ts`, `__tests__/api/funnels/submit-sms-consent.test.ts`, `__tests__/app/api/funnels/submit-checkout.test.ts`

**Interfaces:**
- Consumes: `resolvePublicTenant()` (Task 2).

- [ ] **Step 1: Retarget the suites**

`event-signup-spine` and `submit-sms-consent` mock the platform seam today — replace with the `@/lib/tenancy/public` mock (Task 5 Step 1's exact block) and change `"platform-biz"` → `"host-biz"`. `events/signup`, `events/checkout` and `submit-checkout` mock no seam — add the block and one which-tenant assertion each on a DAL mock they hold (`captureLead`, `recordConsent`, `getBusinessSettings` or `createEventSignup` — read the file; assert on the call that carries `businessId`).

Run those five: expect the which-tenant assertions to FAIL.

- [ ] **Step 2: Convert the three routes**

Same import swap as Task 5. Replace the comment + seam line in `signup` and `checkout` with the Task 5 Step 2 block (indented to match). In `app/api/funnels/submit/route.ts` the comment is longer; replace the whole block from `// PUBLIC ROUTE, NO SESSION TO RESOLVE A TENANT FROM — and no row to inherit` through `const businessId = platformBusinessId()` with:

```ts
  // PUBLIC ROUTE, NO SESSION — and no row to inherit a tenant from either:
  // `funnels`, `funnel_steps` and `funnel_submissions` carry no business_id
  // (no funnel migration mentions the column). The tenant is resolved from the
  // request's Host by lib/tenancy/public.ts (business_domains), and is the
  // platform's own only when no domain row claims the host. Resolved once,
  // threaded.
  const businessId = await resolvePublicTenant()
```

- [ ] **Step 3: Shrink the shelf** — delete `app/api/events/[id]/signup/route.ts`, `app/api/events/[id]/checkout/route.ts`, `app/api/funnels/submit/route.ts` from the list in `lib/tenancy/platform.ts`.

- [ ] **Step 4: Run** the five suites plus `platform-inventory`. Expected: all PASS, non-zero counts.

- [ ] **Step 5: tsc gate**

Run: `npx tsc --noEmit 2>&1 | grep -E "error TS" | grep -E "app/api/(events|funnels/submit)|event-signup-spine|events/(signup|checkout)|submit-(sms-consent|checkout)"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add app/api/events/[id]/signup/route.ts app/api/events/[id]/checkout/route.ts app/api/funnels/submit/route.ts lib/tenancy/platform.ts __tests__/api/spine/event-signup-spine.test.ts __tests__/api/events/signup.test.ts __tests__/api/events/checkout.test.ts __tests__/api/funnels/submit-sms-consent.test.ts __tests__/app/api/funnels/submit-checkout.test.ts
git commit -m "refactor(tenancy): event signup, event checkout and funnel submit resolve their tenant from the Host"
```

---

### Task 7: Wave 3 — the assistant: ask/config, the ask page, the ask route

**Files:**
- Modify: `app/api/ask/config/route.ts:49,63-66`, `app/(marketing)/ask/page.tsx:28,51-54`, `app/api/ask/route.ts:74,375-379,394`
- Modify: `lib/tenancy/platform.ts` (remove `app/api/ask/config/route.ts` and `app/(marketing)/ask/page.tsx` from the list; rewrite the `app/api/ask/route.ts` bullet)
- Test (retarget): `__tests__/app/ask-config-route.test.ts`, `__tests__/app/ask-page.test.tsx`, `__tests__/api/ask.test.ts`, `__tests__/lib/lead-engine/chat-refusals.test.ts`

**Interfaces:**
- Consumes: `resolvePublicTenant()` (Task 2).

- [ ] **Step 1: Retarget the suites**

`ask-config-route` mocks the platform seam — swap to the public mock, `"platform-biz"` → `"host-biz"`. `ask-page`, `ask.test`, `chat-refusals` mock no seam — add the public mock and one which-tenant assertion each: `ask-page` on `getBusinessSettings` (`expect(getBusinessSettings).toHaveBeenCalledWith("host-biz")`); `ask.test` on the `createConversation` mock (`expect.objectContaining({ businessId: "host-biz" })`) in a test that creates a conversation; `chat-refusals` on whichever of those it holds. Run all four: the new assertions FAIL.

- [ ] **Step 2: Convert**

`app/api/ask/config/route.ts` — swap the import; replace the `Promise.all` block so the resolve is a named value:

```ts
export async function GET() {
  try {
    // PUBLIC, NO SESSION. The tenant is resolved from the request's Host by
    // lib/tenancy/public.ts (business_domains); the platform's own only when
    // no domain row claims the host.
    const businessId = await resolvePublicTenant()
    const [flag, settings] = await Promise.all([
      getSetting<boolean>(CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT),
      getBusinessSettings(businessId),
    ])
```

`app/(marketing)/ask/page.tsx` — swap the import; replace the two-line `// PUBLIC, NO SESSION TO RESOLVE A TENANT FROM. …` comment and the `const settings = …` line with:

```tsx
  // PUBLIC, NO SESSION. The tenant is resolved from the request's Host by
  // lib/tenancy/public.ts — the SAME resolution /api/ask/capture makes, so
  // the wording shown and the wording filed name one business.
  const businessId = await resolvePublicTenant()
  const settings = await getBusinessSettings(businessId).catch(() => null)
```

(`resolvePublicTenant()` is NOT inside the `.catch` — a throwing `headers()` must propagate; the page is already `force-dynamic`.)

`app/api/ask/route.ts` — swap the import; replace the `createConversation` call's comment and `businessId:` line:

```ts
    if (!conversation) {
      // PUBLIC ROUTE, NO SESSION. This is the one place a conversation's
      // tenant is DECIDED; it is resolved from the request's Host by
      // lib/tenancy/public.ts (business_domains). Once the row exists, every
      // later call in this route threads `conversation.business_id` instead.
      const businessId = await resolvePublicTenant()
      conversation = await createConversation({
        businessId,
        ipHash,
```

and at line ~394 change the prose `` `conversation.business_id`, not `platformBusinessId()`: `` to `` `conversation.business_id`, not `resolvePublicTenant()`: `` (a comment that names a function this file no longer calls is a stale map).

- [ ] **Step 3: Rewrite the shelf** — in `lib/tenancy/platform.ts` remove `app/api/ask/config/route.ts` and `app/(marketing)/ask/page.tsx` from the list, and replace the bullet beginning `- the public chat assistant (app/api/ask/route.ts), the one place a` … through `route's own comment above \`createConversation\`;` with nothing (the route is now inventoried in public.ts; the "one place a conversation's tenant is decided" sentence lives there).

- [ ] **Step 4: Run** the four suites plus `platform-inventory`. Expected: all PASS, non-zero counts.

- [ ] **Step 5: tsc gate**

Run: `npx tsc --noEmit 2>&1 | grep -E "error TS" | grep -E "app/api/ask|\(marketing\)/ask|ask-config-route|ask-page|api/ask\.test|chat-refusals"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add app/api/ask/config/route.ts "app/(marketing)/ask/page.tsx" app/api/ask/route.ts lib/tenancy/platform.ts __tests__/app/ask-config-route.test.ts __tests__/app/ask-page.test.tsx __tests__/api/ask.test.ts __tests__/lib/lead-engine/chat-refusals.test.ts
git commit -m "refactor(tenancy): the assistant's config, page and conversation creation resolve their tenant from the Host"
```

---

### Task 8: Wave 4 — quiz/progress and QuizIsland, together

**Files:**
- Modify: `app/api/quiz/progress/route.ts:25,99-101`, `components/funnels/islands/QuizIsland.tsx:8,46-47`
- Modify: `lib/tenancy/platform.ts` (remove `components/funnels/islands/QuizIsland.tsx` from the list and the `app/api/quiz/progress/route.ts` bullet; KEEP the sentence that says `app/api/quiz/submit/route.ts` is NOT a caller — the inventory test's presence control pins it)
- Test (retarget): `__tests__/api/quiz-progress.test.ts`, `__tests__/components/funnels/quiz-island-context.test.tsx`

**Interfaces:**
- Consumes: `resolvePublicTenant()` (Task 2).

Why together: the island's consent wording is filed by `quiz/submit`, which inherits the attempt `quiz/progress` created. They agree only because both calls resolve the same value; converting one alone would split the wording shown from the wording filed.

- [ ] **Step 1: Retarget** — both suites mock no seam; add the public mock and a which-tenant assertion: `quiz-progress` on `createAttempt` (`expect(createAttempt).toHaveBeenCalledWith("host-biz", expect.anything())`) in a test that creates an attempt; `quiz-island-context` on `getBusinessSettings("host-biz")`. Run both: FAIL on the new assertions.

- [ ] **Step 2: Convert**

`app/api/quiz/progress/route.ts` — swap the import; replace the two-line comment and the `createAttempt(platformBusinessId(), {` line with:

```ts
  } else {
    // PUBLIC ROUTE, NO SESSION. The attempt's tenant is DECIDED here, from the
    // request's Host via lib/tenancy/public.ts; /api/quiz/submit then inherits
    // it from the attempt row rather than resolving again.
    const businessId = await resolvePublicTenant()
    attemptId = await createAttempt(businessId, {
```

`components/funnels/islands/QuizIsland.tsx` — swap the import; replace `// Same business as /api/quiz/submit's consent write — see lib/tenancy/platform.ts.` and the `const settings = …` line with:

```tsx
  // Same business /api/quiz/submit files the consent row under: the submit
  // route inherits the attempt /api/quiz/progress created, and that route
  // resolves the SAME Host this render reads (lib/tenancy/public.ts).
  const businessId = await resolvePublicTenant()
  const settings = await getBusinessSettings(businessId).catch(() => null)
```

- [ ] **Step 3: Rewrite the shelf** — remove the `- public, unauthenticated quiz-taking routes (e.g. app/api/quiz/progress/route.ts), until phase 4 resolves the Host header;` bullet and the `components/funnels/islands/QuizIsland.tsx` path; rewrite the QuizIsland paragraph (`QuizIsland's partner is NOT one of the §5.1 routes above …`) to:

```
 *     Phase 4 converted app/api/quiz/progress/route.ts and the quiz island
 *     together (both now resolve the Host); app/api/quiz/submit/route.ts is
 *     still NOT on this list, deliberately: it inherits the attempt's
 *     business_id rather than resolving anything.
```

- [ ] **Step 4: Run** both suites plus `platform-inventory` (its `quiz/submit` presence control must still pass). Expected: PASS.

- [ ] **Step 5: tsc gate** — `npx tsc --noEmit 2>&1 | grep -E "error TS" | grep -E "quiz/progress|QuizIsland|quiz-progress|quiz-island-context"` → no output.

- [ ] **Step 6: Commit**

```bash
git add app/api/quiz/progress/route.ts components/funnels/islands/QuizIsland.tsx lib/tenancy/platform.ts __tests__/api/quiz-progress.test.ts __tests__/components/funnels/quiz-island-context.test.tsx
git commit -m "refactor(tenancy): the quiz attempt and the quiz island resolve the Host together; submit still inherits the attempt"
```

---

### Task 9: Wave 5 — camps, clinics, InquiryForm, StepUpInquiryForm, FormIsland; the shelf is done

**Files:**
- Modify: `app/(marketing)/camps/[slug]/page.tsx:22,71-72`, `app/(marketing)/clinics/[slug]/page.tsx:19,62-63`, `components/public/InquiryForm.tsx:19,46-47`, `components/public/StepUpInquiryForm.tsx:11,17-18`, `components/funnels/islands/FormIsland.tsx:8,52-57`
- Modify: `lib/tenancy/platform.ts` (the shelf's final form — spec §3.6)
- Test (retarget): `__tests__/components/public/InquiryForm.test.tsx`, `__tests__/components/public/StepUpInquiryForm.test.tsx`, `__tests__/components/funnels/form-island-sms-consent.test.tsx` (the two pages have no suite)

**Interfaces:**
- Consumes: `resolvePublicTenant()` (Task 2); `BusinessSettings` type from `@/lib/db/businesses`.

- [ ] **Step 1: Retarget** the three component suites: add the public mock and assert `getBusinessSettings` was called with `"host-biz"` (in `form-island-sms-consent`, in a test whose fields include a `tel` field). Run: FAIL on the new assertions.

- [ ] **Step 2: Convert**

Pages and the two inquiry forms — swap the import; replace `// Same business as the route that files the consent row — through the seam in lib/tenancy/platform.ts.` and the `const businessSettings = await getBusinessSettings(platformBusinessId()).catch(() => null)` line with:

```tsx
  // Same business as the route that files the consent row: both resolve it
  // from the request's Host through lib/tenancy/public.ts.
  const businessId = await resolvePublicTenant()
  const businessSettings = await getBusinessSettings(businessId).catch(() => null)
```

`components/funnels/islands/FormIsland.tsx` — swap the import, add `import type { BusinessSettings } from "@/lib/db/businesses"` (extend the existing import from that module if there is one), and replace from `// Read for the SAME business the submit route files the consent row under —` through `: null` with:

```tsx
  // Read for the SAME business the submit route files the consent row under:
  // both resolve it from the request's Host through lib/tenancy/public.ts, so
  // the wording shown and the wording filed cannot name different businesses.
  // Resolved only when there is a phone field — a form with none costs no read.
  let businessSettings: BusinessSettings | null = null
  if (fields.some((field) => field.type === "tel")) {
    const businessId = await resolvePublicTenant()
    businessSettings = await getBusinessSettings(businessId).catch(() => null)
  }
```

- [ ] **Step 3: The shelf's final form**

In `lib/tenancy/platform.ts`, replace everything from `- the public lead-capture surfaces, converted 2026-09-05 when the Lead` through the end of the `NOT on this list, deliberately: app/api/quiz/submit/route.ts …` paragraph with:

```
 *   - the public lead-capture surfaces, the marketing pages and the server
 *     components that render their consent wording all resolve through the
 *     Host boundary above since phase 4 (2026-09-05); none calls this
 *     directly any more. NOT on the boundary's list either, deliberately:
 *     app/api/quiz/submit/route.ts. It is public too, but it has a row to
 *     inherit from — the attempt app/api/quiz/progress/route.ts created —
 *     so it resolves rather than calling anything.
```

The shelf now names, besides the reconciler, exactly one path: `lib/tenancy/public.ts`.

- [ ] **Step 4: Run** the three component suites plus `platform-inventory`. Expected: PASS. Then prove the count: `grep -c "resolvePublicTenant()" app/api/contact/route.ts app/api/shop/leads/route.ts app/api/newsletter/route.ts app/api/inquiry/route.ts "app/api/events/[id]/signup/route.ts" "app/api/events/[id]/checkout/route.ts" app/api/funnels/submit/route.ts app/api/ask/config/route.ts app/api/quiz/progress/route.ts app/api/ask/route.ts "app/(marketing)/ask/page.tsx" "app/(marketing)/camps/[slug]/page.tsx" "app/(marketing)/clinics/[slug]/page.tsx" components/public/InquiryForm.tsx components/public/StepUpInquiryForm.tsx components/funnels/islands/FormIsland.tsx components/funnels/islands/QuizIsland.tsx` — every line ends `:1`. And `git grep -n "platformBusinessId" -- app components lib | grep -v "^lib/tenancy/" | grep -v "^\S*:\s*//\|^\S*:\s*\*"` must list ONLY the other shelves' callers (ghl-booking, invite claim, twilio inbound, calendly-tenant, stripe webhook, funnels/sections/resolve, google-ads-accounts + its callers, pipeline-reconcile).

- [ ] **Step 5: tsc gate** — `npx tsc --noEmit 2>&1 | grep -E "error TS" | grep -E "camps/|clinics/|InquiryForm|StepUpInquiryForm|FormIsland|form-island-sms-consent"` → no output.

- [ ] **Step 6: Commit**

```bash
git add "app/(marketing)/camps/[slug]/page.tsx" "app/(marketing)/clinics/[slug]/page.tsx" components/public/InquiryForm.tsx components/public/StepUpInquiryForm.tsx components/funnels/islands/FormIsland.tsx lib/tenancy/platform.ts __tests__/components/public/InquiryForm.test.tsx __tests__/components/public/StepUpInquiryForm.test.tsx __tests__/components/funnels/form-island-sms-consent.test.tsx
git commit -m "refactor(tenancy): the camps and clinics pages and the inquiry and form islands resolve the Host; the shelf names one caller"
```

---

### Task 10: The Host boundary's own inventory test

**Files:**
- Create: `__tests__/lib/tenancy/public-inventory.test.ts`

**Interfaces:**
- Consumes: `callersOf` (Task 4); the CALLERS list in `lib/tenancy/public.ts`'s doc comment (Task 2).

- [ ] **Step 1: Write the test**

```ts
// @vitest-environment node
//
// lib/tenancy/public.ts is the ONLY Host boundary, and its doc comment is a
// TRUTHFUL INVENTORY of the public surfaces that resolve through it — the
// list a later phase (coach domain onboarding, static-per-host rendering)
// will work from. Same shape as platform-inventory.test.ts: a presence
// control, the forward check, the reverse check.
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { callersOf } from "../../helpers/seam-callers"

const ROOT = process.cwd()
const BOUNDARY = "lib/tenancy/public.ts"

/** Every path-like token the boundary's file names, deduped. */
function inventoryPaths(): string[] {
  const text = readFileSync(join(ROOT, BOUNDARY), "utf8")
  const found = text.match(/(?:app|lib|components)\/[\w.\-()[\]/]+\.tsx?/g) ?? []
  return [...new Set(found)].filter((p) => p !== BOUNDARY).sort()
}

/** Paths the boundary names PRECISELY to say they do not call it. */
const NAMED_BUT_NOT_CALLERS = [
  // "lib/tenancy/resolve.ts is the session boundary and stays the only one"
  "lib/tenancy/resolve.ts",
  // "which is why lib/tenancy/platform.ts lists THIS file" — the seam it falls back to
  "lib/tenancy/platform.ts",
  // "(createAttempt; quiz/submit inherits)" — named to say it does NOT resolve
  "app/api/quiz/submit/route.ts",
]

describe("lib/tenancy/public.ts inventories its callers", () => {
  it("has at least the seventeen surfaces phase 4 converted (presence control)", () => {
    expect(callersOf("resolvePublicTenant", BOUNDARY).length).toBeGreaterThanOrEqual(17)
  })

  it("names every file that references resolvePublicTenant", () => {
    const inventory = readFileSync(join(ROOT, BOUNDARY), "utf8")
    const missing = callersOf("resolvePublicTenant", BOUNDARY).filter((file) => !inventory.includes(file))
    expect(missing).toEqual([])
  })

  it("keeps app/api/quiz/submit/route.ts off the caller list — it inherits the attempt", () => {
    expect(callersOf("resolvePublicTenant", BOUNDARY)).not.toContain("app/api/quiz/submit/route.ts")
  })

  it("names no file that has stopped referencing the boundary", () => {
    const excluded = new Set(NAMED_BUT_NOT_CALLERS)
    const referenced = new Set(callersOf("resolvePublicTenant", BOUNDARY))
    const stale = inventoryPaths().filter((p) => !excluded.has(p) && !referenced.has(p))
    expect(stale).toEqual([])
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run __tests__/lib/tenancy/public-inventory.test.ts`
Expected: PASS, 4 tests. If "names no file that has stopped referencing" fails, the doc comment in `public.ts` names a path that is not a caller — either the comment is wrong (fix the comment) or it names a path to say it is NOT a caller (add it to `NAMED_BUT_NOT_CALLERS` with the quoted sentence, as above). If the boundary's comment mentions `app/api/quiz/submit/route.ts` only as `quiz/submit`, the regex will not match it and the entry is harmless.

- [ ] **Step 3: Mutation check** — temporarily delete the line `*     app/api/inquiry/route.ts` from `public.ts`'s comment; the forward check must FAIL; restore.

- [ ] **Step 4: tsc gate** — `npx tsc --noEmit 2>&1 | grep -E "error TS" | grep public-inventory` → no output.

- [ ] **Step 5: Commit**

```bash
git add __tests__/lib/tenancy/public-inventory.test.ts
git commit -m "test(tenancy): the Host boundary's caller inventory is pinned both ways"
```

---

### Task 11: End to end, in the real app (orchestrator-assisted)

**Files:**
- Create: `screenshots/tenancy-phase4/curl-transcript.txt`, `screenshots/tenancy-phase4/01-contact-coach-host-light.png`, `02-contact-platform-host-light.png`, `03-contact-coach-host-dark.png`, `04-contact-platform-host-dark.png`, `screenshots/tenancy-phase4/index.html`
- Create: `scripts/capture-tenancy-phase4-screenshots.mjs`

**Interfaces:**
- Consumes: the running dev server on 3050; the dev clone with migration 00251 applied (orchestrator) and one extra row: `('82d5b238-1653-4a04-9d2d-2f65e5a8c225', 'phase4-coach.test', 'primary')` for the seeded business "Trailhead Strength & Conditioning" (display_name `Trailhead Strength & Conditioning — Personal Training`). The orchestrator also sets the dev clone's platform `business_settings.display_name` to `DJP Athlete` if it is blank, so the contrast is readable (dev only; production already says DJP Athlete).

- [ ] **Step 1: Start the server** (never pipe it to `head`): `source ~/.nvm/nvm.sh && nvm use >/dev/null && (npm run dev > /tmp/phase4-dev.log 2>&1 &)`; wait for `grep -q "Ready" /tmp/phase4-dev.log` in an `until` loop. Confirm nothing else holds 3050 first (`lsof -i :3050`).

- [ ] **Step 2: The curl transcript** — write the three commands and their responses to `screenshots/tenancy-phase4/curl-transcript.txt`:

```bash
{
  echo '# coach host (row for the seeded business)'; echo '$ curl -s -H "x-forwarded-host: phase4-coach.test" http://localhost:3050/api/ask/config'
  curl -s -H "x-forwarded-host: phase4-coach.test" http://localhost:3050/api/ask/config; echo
  echo '# platform host (the seeded www row)'; echo '$ curl -s -H "x-forwarded-host: www.darrenjpaul.com" http://localhost:3050/api/ask/config'
  curl -s -H "x-forwarded-host: www.darrenjpaul.com" http://localhost:3050/api/ask/config; echo
  echo '# no row: localhost falls back to the platform, and the server log says so ONCE'; echo '$ curl -s http://localhost:3050/api/ask/config'
  curl -s http://localhost:3050/api/ask/config; echo
  curl -s http://localhost:3050/api/ask/config >/dev/null
  echo '# server log lines mentioning [tenancy]:'; grep "\[tenancy\]" /tmp/phase4-dev.log
} > screenshots/tenancy-phase4/curl-transcript.txt
```

Expected: first response `displayName` = the Trailhead name; second and third = `DJP Athlete`; exactly ONE `[tenancy] no business_domains row for host "localhost"` line, and NO line for `www.darrenjpaul.com` or `phase4-coach.test`.

- [ ] **Step 3: The captures** — `scripts/capture-tenancy-phase4-screenshots.mjs`, modelled on `scripts/capture-contact-record-screenshots.mjs` (read it first: `DSF = 2`, `annotate()` takes RAW pixel markers = `boundingBox()` × DSF, and warns loudly on a missing target):

```js
// Tenancy phase 4: the SAME page, two Hosts, two businesses named in the
// consent wording. Chromium refuses a Host override, so x-forwarded-host is
// set instead — the header lib/tenancy/public.ts reads FIRST.
//   node scripts/capture-tenancy-phase4-screenshots.mjs
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const OUT = "screenshots/tenancy-phase4"
const DSF = 2
const BASE = "http://localhost:3050"
const SHOTS = [
  { n: "01", host: "phase4-coach.test", scheme: "light", title: "Coach host — the consent line names the coach" },
  { n: "02", host: "www.darrenjpaul.com", scheme: "light", title: "Platform host — the same page names DJP Athlete" },
  { n: "03", host: "phase4-coach.test", scheme: "dark", title: "Coach host, dark" },
  { n: "04", host: "www.darrenjpaul.com", scheme: "dark", title: "Platform host, dark" },
]
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
for (const s of SHOTS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: DSF, colorScheme: s.scheme, extraHTTPHeaders: { "x-forwarded-host": s.host } })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/contact`, { waitUntil: "networkidle" })
  const consent = page.getByText(/agree to receive text messages from/i).first()
  if ((await consent.count()) === 0) throw new Error(`no consent line rendered for host ${s.host} — is display_name set for that business on the dev clone?`)
  await consent.scrollIntoViewIfNeeded()
  const box = await consent.boundingBox()
  if (!box) throw new Error(`consent line has no box for host ${s.host}`)
  const raw = `${OUT}/${s.n}-raw.png`
  await page.screenshot({ path: raw, fullPage: false })
  await annotate(raw, `${OUT}/${s.n}-contact-${s.host === "phase4-coach.test" ? "coach" : "platform"}-host-${s.scheme}.png`, {
    title: s.title,
    subtitle: `x-forwarded-host: ${s.host} → resolved by business_domains, rendered by components/public/InquiryForm.tsx`,
    markers: [{ x: (box.x + 8) * DSF, y: (box.y + box.height / 2) * DSF, caption: `The consent wording names the business the Host resolved to: "${(await consent.textContent())?.trim().slice(0, 90)}"` }],
  })
  await ctx.close()
}
await browser.close()
```

Run it, delete the `*-raw.png` intermediates, and LOOK at each PNG (Read the file) before claiming anything: the coach shots must say Trailhead, the platform shots DJP Athlete. If the marketing site does not change in dark mode, keep the dark captures and say so in the index.

- [ ] **Step 4: The index** — `screenshots/tenancy-phase4/index.html`: a plain page (no base64; `<img src="01-…png">` siblings) with the four captures, one caption each, and the curl transcript in a `<pre>`.

- [ ] **Step 5: Stop the server** (`kill` the `next dev` pid from `lsof -i :3050`), and commit:

```bash
git add scripts/capture-tenancy-phase4-screenshots.mjs screenshots/tenancy-phase4
git commit -m "docs(tenancy): phase 4 proven end to end — one page, two Hosts, two businesses"
```

---

### Task 12: Gates (orchestrator)

- [ ] tsc: `npx tsc --noEmit 2>&1 | grep -E "error TS" | sort > /tmp/after.txt`; strip `(line,col)` from both sides; `diff` against the baseline → identical.
- [ ] `npm run build` green; diff the route table against the pre-branch build: `● /camps/[slug]` and `● /clinics/[slug]` become `ƒ`; nothing else changes.
- [ ] Targeted suites, every file non-zero: the two new unit suites, both inventory suites, and every retargeted suite from Tasks 5–9.
- [ ] Prettier delta on every changed file against `git show HEAD~N:<file>`; no new failures.
- [ ] `git grep -c SINGLETON_BUSINESS_ID -- '*.ts' '*.tsx' | grep -v '__tests__\|scripts/'` → still the 5 files.
- [ ] Whole-branch review (fable) with the ledger's deferred-minor list, tracing inquiry, quiz and ask end to end.
- [ ] Journal entry; report: shelf before/after, inventory caller counts, the route-table diff, the curl transcript.
