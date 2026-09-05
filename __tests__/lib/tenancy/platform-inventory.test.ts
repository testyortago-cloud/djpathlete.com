// @vitest-environment node
//
// lib/tenancy/platform.ts is a TRUTHFUL INVENTORY: every caller of
// platformBusinessId() is listed there under the shelf that names WHY it
// cannot (or need not) resolve a tenant. Nothing else enforces that the list
// is complete, and a seam whose inventory silently goes stale is worse than
// no inventory — phase 4's sweep is "the CANNOT RESOLVE YET shelf", and a
// caller missing from it is a caller phase 4 will not convert.
//
// This is deliberately a prose assertion on a comment. The callers are found
// on CODE lines only — a comment that mentions platformBusinessId is not a
// caller, and neither is a bare `import` line — and platform.ts itself is
// excluded.
//
// The match is on the IDENTIFIER, not on the literal call `platformBusinessId()`.
// lib/bookings/calendly-tenant.ts:88 reaches the seam as
// `(deps.platformBusinessId ?? platformBusinessId)()`, so it passes the
// function as a VALUE and the `()` never sits against the name. A literal-call
// match reported that file as a non-caller — a real caller invisible to the
// check that exists to find them.
//
// Four failure modes, four tests below the presence control:
//   - a file that references the seam missing from the inventory (the
//     forward check);
//   - the inventory's strongest single claim — that app/api/quiz/submit does
//     NOT call the seam — being reverted in code;
//   - the matcher narrowing back to the literal call, which would drop
//     lib/bookings/calendly-tenant.ts from the forward check silently;
//   - the inventory naming a file that has stopped touching the seam (the
//     reverse check).
// The forward check alone cannot see the second or the fourth: it is a
// substring test over the whole comment, and the comment names quiz/submit
// in the very sentence that says it is not a caller.
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { callersOf } from "../../helpers/seam-callers"

const ROOT = process.cwd()
const INVENTORY = "lib/tenancy/platform.ts"

// The walker and the identifier-not-call rule live in __tests__/helpers/seam-callers.ts.
function callers(): string[] {
  return callersOf("platformBusinessId", INVENTORY)
}

/**
 * Paths the inventory names PRECISELY IN ORDER TO SAY they are not callers.
 * Each sentence naming one says so in as many words; if a sentence stops
 * saying it, the entry belongs out of this list and in the inventory proper.
 */
const NAMED_BUT_NOT_CALLERS = [
  // "NOT on this list, deliberately: app/api/quiz/submit/route.ts."
  "app/api/quiz/submit/route.ts",
  // "lib/tenancy/resolve.ts also names the constant, in a history comment
  //  about the fallback migration 00246 removed — not a use."
  "lib/tenancy/resolve.ts",
  // "TWINS THAT CANNOT CALL THIS: functions/src/lib/tenancy-constants.ts …"
  // The regex below has no `functions/` alternative, so it matches the tail
  // of that path only.
  "lib/tenancy-constants.ts",
]

/**
 * Paths the inventory names as CONTEXT — callers of a DIFFERENT function, or
 * a file the seam used to live in. None of them is claimed to call this seam,
 * so none of them going stale would make the inventory wrong about tenancy.
 * Kept apart from the list above because the distinction is the point: those
 * sentences say "not a caller", these ones are simply about something else.
 */
const NAMED_AS_CONTEXT = [
  // "its five no-argument callers" — of getActiveGoogleAdsAccounts, not of
  // this seam.
  "lib/ads/agent.ts",
  "lib/ads/ga4-audiences.ts",
  "lib/ads/conversions.ts",
  "app/api/admin/ads/diagnose/route.ts",
  // "This was `singletonHostId` in lib/db/bookings.ts until phase 2" —
  // history, on platformHostId's own doc comment.
  "lib/db/bookings.ts",
  // "same as the business_members fan-out read in lib/bookings/ingest.ts" —
  // a comparison, also on platformHostId's doc comment.
  "lib/bookings/ingest.ts",
  // "see `findContactWithBusinessByIdentifiers` in lib/db/contacts.ts" — the
  // lookup the Stripe webhook makes BEFORE reaching this seam, named so the
  // "oldest row wins" tiebreak is greppable. That module never calls this.
  "lib/db/contacts.ts",
]

/** Every path-like token the inventory file names, deduped. */
function inventoryPaths(): string[] {
  const text = readFileSync(join(ROOT, INVENTORY), "utf8")
  const found = text.match(/(?:app|lib|components)\/[\w.\-()[\]/]+\.tsx?/g) ?? []
  return [...new Set(found)].filter((p) => p !== INVENTORY).sort()
}

describe("lib/tenancy/platform.ts inventory", () => {
  it("has files referencing the seam at all (presence control for the test below)", () => {
    expect(callers().length).toBeGreaterThan(10)
  })

  it("names every file that references platformBusinessId, so the seam list cannot silently go stale", () => {
    const inventory = readFileSync(join(ROOT, INVENTORY), "utf8")
    const missing = callers().filter((file) => !inventory.includes(file))
    expect(missing).toEqual([])
  })

  // The inventory's strongest single claim, pinned directly rather than left
  // to the substring check above — which cannot see it reverted, because the
  // sentence that DENIES quiz/submit is a caller contains the path, so
  // `inventory.includes(file)` is satisfied either way.
  //
  // The claim: app/api/quiz/submit/route.ts inherits `attempt.businessId`
  // (the attempt that app/api/quiz/progress/route.ts created under the seam),
  // so its four writes stay on one tenant BY CONSTRUCTION. A call to the seam
  // in that route would be a real regression — the submit route would stop
  // following the attempt — and would silently make the inventory false.
  it("keeps app/api/quiz/submit/route.ts off the reference list, as the inventory claims", () => {
    expect(callers()).not.toContain("app/api/quiz/submit/route.ts")
  })

  // The case that motivated matching the identifier rather than the call.
  // lib/bookings/calendly-tenant.ts:88 reads
  //
  //     businessId: (deps.platformBusinessId ?? platformBusinessId)(),
  //
  // — the seam is passed as a VALUE, so a test injecting a fake can replace
  // it, and the `()` sits against the closing paren rather than the name.
  // A `platformBusinessId()` substring match reported this file as a
  // non-caller, which meant the forward check above could not see it dropped
  // from the inventory. Pinned here so the matcher cannot narrow back.
  it("counts a file that passes the seam as a value, not only one that calls it inline", () => {
    expect(callers()).toContain("lib/bookings/calendly-tenant.ts")
  })

  // The reverse direction. The forward check only proves every caller is
  // named; a line naming a file that STOPPED calling the seam is invisible to
  // it, and a stale entry is precisely what makes phase 4 convert the wrong
  // set of routes. Every path the inventory names must therefore still touch
  // the seam, unless it is on one of the two explicit lists above — both of
  // which carry, per entry, the sentence that puts it there.
  it("names no file that has stopped referencing the seam", () => {
    const excluded = new Set([...NAMED_BUT_NOT_CALLERS, ...NAMED_AS_CONTEXT])
    const referenced = new Set(callers())
    const stale = inventoryPaths().filter((p) => !excluded.has(p) && !referenced.has(p))
    expect(stale).toEqual([])
  })
})
