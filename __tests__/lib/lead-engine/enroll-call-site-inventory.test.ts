// @vitest-environment node
//
// `enrollIfTriggered` HAS EXACTLY ONE CALL SITE, AND THAT IS A PROMISE THIS
// PRODUCT MAKES TO REAL PEOPLE.
//
// G29's central invariant — controller ruling R20 — is that a card a coach
// makes by hand NEVER enrols anybody in a sequence. You already spoke to this
// person; that is why you are filing them. Filing ten old leads onto a board
// on a Sunday must not send ten emails on Sunday.
//
// The spec (docs/superpowers/specs/2026-09-21-g29-pipeline-editor-design.md
// §4.1) enforces that STRUCTURALLY rather than with a flag: enrolment lives
// inside `recordContactEvent` (lib/db/contacts.ts), which is the only thing
// that calls `enrollIfTriggered`, and `createOpportunityManually` simply does
// not call it. A flag can be passed wrong and the next caller inherits a
// default. Not calling the enrolling function cannot be passed wrong.
//
// WHY THAT NEEDS A TEST OF ITS OWN, though G29's own suite already asserts
// "the hand-made card enrolled nobody". That assertion is about ONE code
// path. The invariant it stands on — that there is a single place enrolment
// can happen, so a non-enrolling path is non-enrolling by construction — is
// held up by nothing but the habit of whoever writes the next feature. The
// obvious next feature is literally the spec's opening scenario: bulk-import
// a coach's old leads onto a board. An author reaching for the more familiar
// `recordContactEvent` there would send that whole list an email, and not one
// test in this repo would go red.
//
// So this file pins the shape, not the behaviour. It is the same instrument
// __tests__/lib/tenancy/platform-inventory.test.ts already points at
// SINGLETON_BUSINESS_ID, and it uses the same walker
// (__tests__/helpers/seam-callers.ts): code lines only, imports and comments
// skipped, so prose ABOUT enrolment is never mistaken for a use of it.
//
// IF THIS TEST FAILS, DO NOT JUST ADD THE NEW FILE TO THE LIST. Read what the
// new caller does first. A second caller of `enrollIfTriggered` is a second
// place a person can be enrolled, and every non-enrolling path in the app
// (`importGhlContact`, `createOpportunityManually`) is safe only because
// there is one.
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { callersOf, isCommentLine } from "../../helpers/seam-callers"

const ROOT = process.cwd()

/** Where `enrollIfTriggered` is defined. Excluded from the caller walk. */
const DEFINITION = "lib/lead-engine/enroll.ts"

/**
 * The ONE file allowed to call it, and the ONE function inside that file.
 *
 * `recordContactEvent` is the "a lead arrived" path: a form submission, a
 * checkout, a newsletter signup. Everything that is history arriving today
 * rather than a lead arriving today goes through `upsertContactIdentity` +
 * `recordEventForExistingContact` instead, which touch neither.
 */
const ONLY_CALLER_FILE = "lib/db/contacts.ts"
const ONLY_CALLER_FUNCTION = "recordContactEvent"

/**
 * Every OCCURRENCE of the identifier on a code line — not every line holding
 * one.
 *
 * Counted per match rather than per line because a line-count check has a
 * hole a mutation walked straight through: two calls on the SAME line read as
 * one. That is not a contrived mutant either — a `Promise.all([...])` over two
 * enrolments is exactly the shape somebody would write.
 */
function references(relativePath: string): string[] {
  return readFileSync(join(ROOT, relativePath), "utf8")
    .split("\n")
    .filter((line) => !isCommentLine(line) && !line.trim().startsWith("import "))
    .flatMap((line) => line.match(/\benrollIfTriggered\b/g) ?? [])
}

describe("enrollIfTriggered's call-site inventory", () => {
  // THE PRESENCE CONTROL. Without it, a walker that silently returned []
  // — a renamed helper, a moved directory, a typo in the identifier —
  // would make every assertion below pass while checking nothing at all.
  it("finds the one file that does call it", () => {
    expect(callersOf("enrollIfTriggered", DEFINITION)).toContain(ONLY_CALLER_FILE)
  })

  it("is called from that file and no other, so a non-enrolling path stays non-enrolling by construction", () => {
    const callers = callersOf("enrollIfTriggered", DEFINITION)
    expect(
      callers,
      "A SECOND caller of enrollIfTriggered has appeared. G29's promise — a card a coach files by hand " +
        "never sends that person anything — holds ONLY because enrolment has one home, and every " +
        "non-enrolling path (createOpportunityManually, importGhlContact) is safe by not calling it. " +
        "Read what the new caller does before adding it here: if it runs on a bulk import or a backfill, " +
        "it will email everybody on the list.",
    ).toEqual([ONLY_CALLER_FILE])
  })

  // The file-level check above cannot see a SECOND call added inside
  // lib/db/contacts.ts itself — which is the likelier accident, because that
  // is where somebody adding an enrolment would already be working.
  it("appears exactly once inside that file, and inside recordContactEvent", () => {
    const hits = references(ONLY_CALLER_FILE)
    expect(
      hits,
      "enrollIfTriggered is referenced more than once in lib/db/contacts.ts. Enrolment must have exactly " +
        "one home; see this file's header.",
    ).toHaveLength(1)

    const source = readFileSync(join(ROOT, ONLY_CALLER_FILE), "utf8")
    const callAt = source.indexOf("await enrollIfTriggered(")
    const functionAt = source.indexOf(`export async function ${ONLY_CALLER_FUNCTION}(`)
    // The next top-level export after it — the end of that function's body
    // for this purpose.
    const nextExportAt = source.indexOf("\nexport ", functionAt + 1)

    expect(functionAt).toBeGreaterThan(-1)
    expect(callAt).toBeGreaterThan(functionAt)
    expect(
      callAt,
      `The call to enrollIfTriggered has moved out of ${ONLY_CALLER_FUNCTION}. Every caller in the app ` +
        "reasons about enrolment by asking whether it goes through that function.",
    ).toBeLessThan(nextExportAt)
  })

  // The two functions G29 is built on, named here so a future author moving
  // enrolment INTO either of them fails this file rather than the one suite
  // that happens to drive a board.
  it.each(["upsertContactIdentity", "recordEventForExistingContact"])(
    "keeps enrolment out of %s, the two non-enrolling identity paths",
    (fn) => {
      const source = readFileSync(join(ROOT, ONLY_CALLER_FILE), "utf8")
      const start = source.indexOf(`export async function ${fn}(`)
      expect(start).toBeGreaterThan(-1)
      const end = source.indexOf("\nexport ", start + 1)
      const body = source.slice(start, end === -1 ? undefined : end)
      const offending = body
        .split("\n")
        .filter((line) => !isCommentLine(line) && line.includes("enrollIfTriggered"))
      expect(
        offending,
        `${fn} now references enrollIfTriggered. createOpportunityManually (lib/db/pipeline.ts) resolves ` +
          "contacts through these two precisely because they do not enrol — see its doc comment.",
      ).toEqual([])
    },
  )

  // The last link in the chain, and the one a file-shape test cannot infer:
  // the hand-made card path must not reach `recordContactEvent` either.
  it("keeps createOpportunityManually away from recordContactEvent, the function that does enrol", () => {
    const source = readFileSync(join(ROOT, "lib/db/pipeline.ts"), "utf8")
    const offending = source
      .split("\n")
      .filter((line) => !isCommentLine(line) && !line.trim().startsWith("import ") && line.includes("recordContactEvent"))
    expect(
      offending,
      "lib/db/pipeline.ts now references recordContactEvent on a code line. That is the one function that " +
        "calls enrollIfTriggered, so a hand-made card would start sending people sequences.",
    ).toEqual([])
  })
})
