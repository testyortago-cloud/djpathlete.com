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
//
// G35 added a shelf of NON-callers: UNTENANTED BY SCHEMA, readers of a table
// with no `business_id` column. It is the last block of the comment, and the
// caller checks read the comment WITHOUT it (`inventoryParts`): a reader named
// there is not claimed to call anything, and a caller named only there has
// not been put on a caller shelf. The shelf has its own checks, in the second
// describe below, over the list in __tests__/helpers/untenanted-by-schema.ts.
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { callersOf } from "../../helpers/seam-callers"
import {
  UNTENANTED_BY_SCHEMA,
  functionBody,
  hasInPlaceNote,
  migrationsAddingBusinessId,
  staleReasons,
  statementsAddingBusinessId,
  type UntenantedRead,
} from "../../helpers/untenanted-by-schema"

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
  // "calling `listPlatformIncome` in lib/db/bookkeeping.ts" — the DAL
  // function the bookkeeping income-sync cron's businessId reaches, named so
  // the seam's caller (the ROUTE, not the DAL) is greppable. The DAL file
  // itself takes businessId as a parameter and never calls this seam.
  "lib/db/bookkeeping.ts",
]

/**
 * Paths the UNTENANTED BY SCHEMA shelf names in its preamble PRECISELY TO SAY
 * they are not entries. The shelf's own reverse check allows these and the
 * entries' own paths, and nothing else.
 */
const SHELF_CARVE_OUTS = [
  // "its `marketing_attribution` read is by session ids taken from rows
  //  already filtered on `business_id`, so it is correct by construction"
  "lib/automation/campaign-revenue.ts",
  // "the platform's own digests and content pipeline: content attribution
  //  (…) and the weekly report (…)"
  "lib/db/content-attribution.ts",
  "lib/analytics/weekly-report.ts",
]

const SHELF_HEADER = "UNTENANTED BY SCHEMA --"

/**
 * The inventory in two parts: the UNTENANTED BY SCHEMA shelf (from its header
 * to the end of the doc comment, which is where it sits) and everything else.
 * Throws unless the header appears exactly once and the comment closes after
 * it — a second copy, or a shelf moved out of the comment, would make this
 * split lie.
 */
function inventoryParts(): { shelf: string; rest: string } {
  const text = readFileSync(join(ROOT, INVENTORY), "utf8")
  const start = text.indexOf(SHELF_HEADER)
  const end = start === -1 ? -1 : text.indexOf("*/", start)
  if (start === -1 || end === -1 || text.indexOf(SHELF_HEADER, start + 1) !== -1) {
    throw new Error(`${INVENTORY} must carry the "${SHELF_HEADER}" shelf exactly once, inside its doc comment`)
  }
  return { shelf: text.slice(start, end), rest: text.slice(0, start) + text.slice(end) }
}

/** Every path-like token in `text`, deduped, the inventory file itself excluded. */
function pathsIn(text: string): string[] {
  const found = text.match(/(?:app|lib|components)\/[\w.\-()[\]/]+\.tsx?/g) ?? []
  return [...new Set(found)].filter((p) => p !== INVENTORY).sort()
}

/** Every path the inventory names OUTSIDE the UNTENANTED BY SCHEMA shelf. */
function inventoryPaths(): string[] {
  return pathsIn(inventoryParts().rest)
}

describe("lib/tenancy/platform.ts inventory", () => {
  it("has files referencing the seam at all (presence control for the test below)", () => {
    expect(callers().length).toBeGreaterThan(10)
  })

  // Read WITHOUT the UNTENANTED BY SCHEMA shelf: a caller named only there has
  // not been given a caller shelf. The overlap test below is why that matters.
  it("names every file that references platformBusinessId, so the seam list cannot silently go stale", () => {
    const { rest } = inventoryParts()
    const missing = callers().filter((file) => !rest.includes(file))
    expect(missing).toEqual([])
  })

  // Some files ARE named on both: the Stripe webhook is an attribution surface
  // on the UNTENANTED BY SCHEMA shelf and a caller on the NARROWER VARIANT
  // shelf. The first expectation is the presence control that makes reading
  // `rest` above load-bearing; the second is the property a whole-comment
  // forward check would lose, since the shelf's mention alone satisfied it.
  it("still names on a caller shelf every caller the UNTENANTED BY SCHEMA shelf also names (MUTANT: forward check over the whole comment)", () => {
    const { shelf, rest } = inventoryParts()
    const onBoth = callers().filter((file) => pathsIn(shelf).includes(file))
    expect(onBoth.length).toBeGreaterThan(0)
    expect(onBoth.filter((file) => !rest.includes(file))).toEqual([])
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
  //
  // `inventoryPaths()` leaves out the UNTENANTED BY SCHEMA shelf: every path on
  // it names a reader that does NOT touch the seam, which is the shelf's whole
  // point. It gets its own reverse check in the describe below.
  it("names no file that has stopped referencing the seam", () => {
    const excluded = new Set([...NAMED_BUT_NOT_CALLERS, ...NAMED_AS_CONTEXT])
    const referenced = new Set(callers())
    const stale = inventoryPaths().filter((p) => !excluded.has(p) && !referenced.has(p))
    expect(stale).toEqual([])
  })
})

// G35 §D1-§D2. The shelf names readers of tables with NO `business_id`
// column, on surfaces more than one business can reach. The list is in
// __tests__/helpers/untenanted-by-schema.ts, shared with the live select
// contract, which probes each table for the column on the dev clone.
describe("lib/tenancy/platform.ts — the UNTENANTED BY SCHEMA shelf", () => {
  // Presence control for every "nothing is stale" check below: an emptied or
  // truncated list would pass all of them vacuously. Twelve is the design's
  // count of readers (S1-S12); the list has one row per table each reads.
  it("lists at least the twelve readers the design names", () => {
    expect(new Set(UNTENANTED_BY_SCHEMA.map((e) => e.file)).size).toBeGreaterThanOrEqual(12)
  })

  // (a) The prose names each entry — on the SHELF, not merely somewhere in
  // the comment, where a caller shelf's mention of the same file would do.
  it("names every entry's file, function, surfaces and ledger row on the shelf itself", () => {
    const { shelf } = inventoryParts()
    const named = new Set(pathsIn(shelf))
    const missing = UNTENANTED_BY_SCHEMA.flatMap((e) => [
      ...[e.file, ...(e.surfaces ?? [])].filter((p) => !named.has(p)).map((p) => `${e.fn}: path ${p}`),
      ...(shelf.includes(e.fn) ? [] : [`${e.file}: function ${e.fn}`]),
      ...(new RegExp(`\\b${e.row}\\b`).test(shelf) ? [] : [`${e.file}: ledger row ${e.row}`]),
    ])
    expect(missing).toEqual([])
  })

  // (b) and (c). Each entry is still TRUE: its read is inside the function it
  // names, and no migration has given its table a `business_id`. Converting a
  // reader, deleting it, or adding the column fails here until the entry
  // leaves the shelf.
  it("describes the code as it is: every read is inside its function, and no migration adds business_id to its table", () => {
    expect(UNTENANTED_BY_SCHEMA.flatMap((e) => staleReasons(e))).toEqual([])
  })

  // (d) The shelf's own reverse check. The caller checks above skip the shelf
  // entirely, so without this a path could sit on it describing nothing.
  it("names no path that is not an entry's file, an entry's surface or a stated carve-out", () => {
    const { shelf } = inventoryParts()
    const allowed = new Set([
      ...UNTENANTED_BY_SCHEMA.flatMap((e) => [e.file, ...(e.surfaces ?? [])]),
      ...SHELF_CARVE_OUTS,
    ])
    expect(pathsIn(shelf).filter((p) => !allowed.has(p))).toEqual([])
    expect(SHELF_CARVE_OUTS.filter((p) => !existsSync(join(ROOT, p)))).toEqual([])
  })

  // §D3. The shelf is one place to look; the read is where someone about to
  // "just add a predicate" will be standing. Every entry's function says, in
  // place, that its table has no `business_id` and which row owns that.
  it("has an in-place note at every read: its table has no business_id, and the ledger row that owns it", () => {
    const missing = UNTENANTED_BY_SCHEMA.filter((e) => !hasInPlaceNote(e)).map(
      (e) => `${e.file} · ${e.fn} · ${e.table} (${e.row})`,
    )
    expect(missing).toEqual([])
  })

  // (e) The checks above CAN fail. Each fixture goes through the same
  // `staleReasons` the real list does.
  describe("controls", () => {
    it("an entry for a table that HAS business_id is stale, and for that reason alone (MUTANT: the migration scan never matches)", () => {
      const fixture: UntenantedRead = { file: "lib/db/events.ts", fn: "getEvents", table: "events", row: "G35" }
      const reasons = staleReasons(fixture)
      expect(reasons.some((r) => r.includes("00252_events_business_id.sql"))).toBe(true)
      expect(reasons.filter((r) => !r.includes("a migration gives events a business_id"))).toEqual([])
    })

    it("an entry whose read sits in a SIBLING function is stale (MUTANT: search the whole file, or slice to its end)", () => {
      // lib/db/programs.ts reads `programs` eight times; `getClient` is not one of them.
      expect(staleReasons({ file: "lib/db/programs.ts", fn: "getClient", table: "programs", row: "G37" })).toEqual([
        'lib/db/programs.ts · getClient · programs: getClient no longer contains .from("programs")',
      ])
    })

    it("an entry naming a function that does not exist is stale", () => {
      expect(
        staleReasons({ file: "lib/db/programs.ts", fn: "getProgramsNobodyWrote", table: "programs", row: "G37" }),
      ).toEqual([
        "lib/db/programs.ts · getProgramsNobodyWrote · programs: no top-level function getProgramsNobodyWrote",
      ])
    })

    it("finds a function by its whole name, not a prefix (MUTANT: no boundary after the name)", () => {
      const src = [
        "export async function getProgramsCount() {",
        "  return 1",
        "}",
        "export async function getPrograms() {",
        "  return 2",
        "}",
        "",
      ].join("\n")
      expect(functionBody(src, "getPrograms")).toBe("export async function getPrograms() {\n  return 2\n}")
    })

    // createProgram sits directly under getProgramById, whose note is the
    // nearest one above it. It must not borrow it.
    it("does not credit a function with the note on the function above it (MUTANT: the region reaches back past the previous block)", () => {
      expect(hasInPlaceNote({ file: "lib/db/programs.ts", fn: "getProgramById", table: "programs", row: "G37" })).toBe(
        true,
      )
      expect(hasInPlaceNote({ file: "lib/db/programs.ts", fn: "createProgram", table: "programs", row: "G37" })).toBe(
        false,
      )
    })

    // findAttributionForContact is shaped exactly like this, and the first
    // version of the slice returned its signature without its body.
    it("does not end a function at the column-0 brace of a multi-line parameter type (MUTANT: stop at any column-0 `}`)", () => {
      const src = [
        "export async function find(args: {",
        "  userId: string",
        "}): Promise<void> {",
        "  read()",
        "}",
        "",
      ].join("\n")
      expect(functionBody(src, "find")).toContain("read()")
    })

    describe("the migration scan", () => {
      it("matches each of the three shapes that give a table the column", () => {
        expect(
          statementsAddingBusinessId(
            "alter table public.programs add column if not exists business_id uuid;",
            "programs",
          ),
        ).toHaveLength(1)
        expect(
          statementsAddingBusinessId('ALTER TABLE "programs" RENAME COLUMN tenant_id TO business_id;', "programs"),
        ).toHaveLength(1)
        expect(
          statementsAddingBusinessId(
            "create table programs (\n  id uuid primary key,\n  business_id uuid\n);",
            "programs",
          ),
        ).toHaveLength(1)
      })

      it("ignores a commented-out statement (MUTANT: comments not stripped)", () => {
        const sql =
          "-- alter table programs add column business_id uuid;\n/* alter table programs add column business_id uuid; */"
        expect(statementsAddingBusinessId(sql, "programs")).toEqual([])
      })

      it("ignores business_id in the NEXT statement, about another table (MUTANT: no split on ;)", () => {
        const sql = "alter table programs add column note text;\nalter table events add column business_id uuid;"
        expect(statementsAddingBusinessId(sql, "programs")).toEqual([])
        // Control: the same text does match the table it is about.
        expect(statementsAddingBusinessId(sql, "events")).toHaveLength(1)
      })

      it("ignores a table whose name only STARTS with the entry's (MUTANT: no boundary after the table name)", () => {
        expect(
          statementsAddingBusinessId("alter table programs_archive add column business_id uuid;", "programs"),
        ).toEqual([])
      })

      it("ignores a constraint over an existing business_id, which adds no column (MUTANT: any `add` before business_id)", () => {
        const sql =
          "alter table programs add constraint programs_business_fk foreign key (business_id) references businesses (id);"
        expect(statementsAddingBusinessId(sql, "programs")).toEqual([])
      })

      it("reads the real migrations: events (00252) and business_members (created with it) are found, `event` is not", () => {
        expect(migrationsAddingBusinessId("events").some((h) => h.startsWith("00252_events_business_id.sql"))).toBe(
          true,
        )
        expect(migrationsAddingBusinessId("business_members").length).toBeGreaterThan(0)
        expect(migrationsAddingBusinessId("event")).toEqual([])
      })
    })
  })
})

// G35 §D3. Four comments described a world that no longer exists, each in a
// way that would talk a reader out of the shelf above. Each test pins the
// false sentence gone AND the code it sat on still there, so deleting the
// read (or the file) cannot pass for correcting the comment.
describe("comments the UNTENANTED BY SCHEMA shelf contradicted are corrected", () => {
  const source = (path: string) => readFileSync(join(ROOT, path), "utf8")

  it("the pipeline page no longer calls its programme list 'nothing to scope'", () => {
    const page = source("app/(admin)/admin/pipeline/page.tsx")
    expect(page).toContain("listGrantablePrograms()")
    expect(page).not.toContain("there is nothing to scope")
    expect(page).toContain("G37")
  })

  // The corrected docstring QUOTES both old claims in order to retire them,
  // so the needles are the claims as they were asserted, not the quotes.
  it("findAttributionForContact no longer argues from phase 4 or from user_id being per-business", () => {
    const dal = source("lib/db/marketing-attribution.ts")
    expect(dal).toContain("export async function findAttributionForContact(")
    expect(dal).not.toContain("where the tenant is not resolved until")
    expect(dal).not.toContain("never shared across businesses the way")
    expect(dal).toContain("linkContactsToUser")
  })

  it("the booking ingest no longer says nothing writes contacts.user_id", () => {
    const ingest = source("lib/bookings/ingest.ts")
    expect(ingest).toContain("findAttributionForContact({ userId })")
    expect(ingest).not.toContain("WHICH NOTHING WRITES FOR A BOOKING")
    expect(ingest).toContain("linkContactsToUser")
  })

  // The shelf's preamble names this file as NOT an entry; the read says why
  // where it happens, so the next reader does not "fix" a correct read.
  it("campaign revenue's attribution read says in place why it is not on the shelf", () => {
    const revenue = source("lib/automation/campaign-revenue.ts")
    expect(revenue).toContain('.in("session_id", chunk)')
    expect(revenue).toContain("NOT on the UNTENANTED BY SCHEMA shelf")
  })
})
