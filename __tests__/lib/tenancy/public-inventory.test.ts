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
  // "Pinned by __tests__/lib/tenancy/public.test.ts." — the path-matching
  // regex has no `__tests__/` alternative, so it starts the match at "lib/"
  // and drops the prefix; the file this fragment actually names is a test,
  // which the walker excludes from callersOf on purpose (__tests__ is never
  // walked). Cited here for what it tests, not as a production surface.
  "lib/tenancy/public.test.ts",
  // "__tests__/lib/tenancy/public-inventory.test.ts fails if a caller is
  // missing from this list or a listed file stops calling." — same
  // truncation, naming this very test file, which is likewise never walked.
  "lib/tenancy/public-inventory.test.ts",
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
