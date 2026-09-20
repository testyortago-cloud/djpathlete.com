// @vitest-environment node
//
// G08 (ledger 2026-09-19, D15). `POST /api/ghl/contact` was an
// UNAUTHENTICATED public proxy: anyone who found the path could create a GHL
// contact with any email, name, phone and tags, on the business's CRM, for
// free. It had no caller anywhere in the app and no tests.
//
// It is not covered by the proxy matcher either — proxy.ts guards `/admin/*`
// and `/api/admin/*` — so nothing stood in front of it.
//
// Next.js routes by the filesystem, so the absence of the file IS the 404.
// That is what this asserts, with a presence control: a test that only checks
// "this path does not exist" passes just as well when the check itself is
// broken or looking in the wrong place.
import { describe, it, expect } from "vitest"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const repoRoot = resolve(__dirname, "../../..")

describe("the unauthenticated GHL proxies are gone (G08)", () => {
  it("POST /api/ghl/contact has no route file, so the path 404s", () => {
    expect(existsSync(resolve(repoRoot, "app/api/ghl/contact/route.ts"))).toBe(false)
    expect(existsSync(resolve(repoRoot, "app/api/ghl/contact"))).toBe(false)
  })

  it("POST /api/ghl/webhook is gone too — it was an SSRF primitive", () => {
    // Worse than its twin: the CALLER supplied the URL the server then
    // POSTed arbitrary JSON to, with no allowlist, so it would reach an
    // internal address on request. Unauthenticated, no caller anywhere, no
    // tests, and outside the proxy matcher — the same audit line named both.
    expect(existsSync(resolve(repoRoot, "app/api/ghl/webhook/route.ts"))).toBe(false)
    expect(existsSync(resolve(repoRoot, "app/api/ghl"))).toBe(false)
  })

  it("the presence control: routes that SHOULD exist still do", () => {
    // Without this, the assertions above pass if `repoRoot` is wrong, if the
    // app moved, or if `existsSync` is looking at nothing at all. These two
    // are deliberately routes nobody wants deleted — the original control
    // pointed at /api/ghl/webhook, which turned out to be the next thing
    // that needed deleting.
    expect(existsSync(resolve(repoRoot, "app/api/newsletter/unsubscribe/route.ts"))).toBe(true)
    expect(existsSync(resolve(repoRoot, "app/api/newsletter/route.ts"))).toBe(true)
  })
})
