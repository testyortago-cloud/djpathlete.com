// @vitest-environment node
//
// G17. The text bodies migration 00272 seeds, measured the way Twilio bills
// them — through this project's OWN counter, not an estimate in a comment.
//
// THE BODIES ARE READ OUT OF THE MIGRATION, never retyped here. A copy in the
// test is a copy that can drift: the point is to measure what actually ships,
// so if somebody edits a line in the SQL to add a smart apostrophe, this file
// has to notice.
//
// WHY ANY OF THIS MATTERS, rather than being pedantry about characters:
//
//   * A single non-GSM-7 character anywhere forces the WHOLE message to
//     UCS-2, cutting a segment from 153 characters to 67. One curly
//     apostrophe pasted from a word processor roughly triples what every send
//     of that step costs, silently and forever.
//   * `renderSequenceSms` APPENDS the opt-out sentence to every body. Copy
//     that also contains "Reply STOP" says it twice, and the duplication is
//     invisible until a real handset shows it.
//   * `substituteName` falls back to the EMPTY STRING, so `{{name}}` renders
//     "Hi , your quiz result..." for any contact with no name — on the channel
//     with the least room to look broken.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"
import { renderSequenceSms, SMS_OPT_OUT_SENTENCE, countSmsSegments } from "@/lib/lead-engine/sms"

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/00272_sequence_text_steps.sql"), "utf8")

/**
 * Pulls the `<name>_body CONSTANT text := '...'` literals out of the migration
 * and un-escapes SQL's doubled apostrophe, so what is measured is the string
 * Postgres actually stores.
 */
function seededBodies(): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /(\w+_body)\s+CONSTANT\s+text\s*:=\s*'((?:[^']|'')*)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(SQL)) !== null) out[m[1]] = m[2].replaceAll("''", "'")
  return out
}

const BODIES = seededBodies()
const NAMES = ["quiz_athlete_body", "quiz_parent_body", "camp_body", "application_body"]

/** Every `INSERT ... 'sms', <expr>)` in the migration, as the raw expression. */
function smsInsertExpressions(): string[] {
  return [...SQL.matchAll(/'sms',\s*([\s\S]*?)\);/g)].map((m) => m[1].trim())
}

describe("the text bodies migration 00272 seeds", () => {
  it("finds all four, so the extraction itself cannot silently match nothing", () => {
    // Without this, every assertion below would pass vacuously on an empty
    // object — the failure mode that makes a regex-driven test worthless.
    expect(Object.keys(BODIES).sort()).toEqual([...NAMES].sort())
    for (const n of NAMES) expect(BODIES[n].length).toBeGreaterThan(40)
  })

  it("is measuring what actually gets INSERTED, not four unused constants", () => {
    // Review finding, and the hole that made every other assertion here
    // bypassable: nothing tied a constant to a statement. Swapping an INSERT
    // to a raw literal left all four constants pristine and every check green
    // while the shipped body was something else entirely.
    const exprs = smsInsertExpressions()
    expect(exprs.length).toBe(3) // quiz (a CASE over two), camp, application

    for (const expr of exprs) {
      // No MESSAGE-LENGTH literal may reach an sms INSERT: every body must
      // name a constant this file measures.
      //
      // Length rather than "contains a quote", because the quiz INSERT is a
      // legitimate `CASE WHEN seq.key = 'quiz_parent_coach' THEN ...` — a
      // sequence KEY, not copy. Keys are short; a text body is 100+
      // characters, so 40 separates them with room to spare and still catches
      // anybody pasting a real message in.
      const longLiterals = [...expr.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]).filter((s) => s.length > 40)
      expect(longLiterals, `an sms INSERT carries copy that this file never measures: ${expr}`).toEqual([])
      expect(
        NAMES.some((n) => expr.includes(n)),
        `unrecognised sms body expression: ${expr}`,
      ).toBe(true)
    }

    // And every constant is reachable from some INSERT — an unused one would
    // be measured here and never sent.
    for (const n of NAMES) {
      expect(
        exprs.some((e) => e.includes(n)),
        `${n} is measured but never inserted`,
      ).toBe(true)
    }
  })

  for (const name of NAMES) {
    describe(name, () => {
      it("is one GSM-7 segment WITH the opt-out sentence appended", () => {
        const { text } = renderSequenceSms({ body: BODIES[name], contactName: null })

        // The append is asserted, not assumed. Without this the test name is
        // a claim the body alone would satisfy: all four bodies fit in one
        // segment on their own, so a renderSequenceSms that stopped appending
        // would leave this green.
        expect(text).toContain(SMS_OPT_OUT_SENTENCE)

        const counted = countSmsSegments(text)
        expect(counted.encoding, `${name} is not GSM-7 — something in it forces UCS-2`).toBe("GSM-7")
        expect(counted.segments, `${name} renders to ${counted.characters} chars`).toBe(1)
      })

      it("does not repeat the opt-out sentence the sender already adds", () => {
        expect(BODIES[name]).not.toContain(SMS_OPT_OUT_SENTENCE)
        expect(BODIES[name].toLowerCase()).not.toContain("reply stop")
      })

      it("carries no {{name}}, which would render as a hole for a nameless contact", () => {
        expect(BODIES[name]).not.toContain("{{")
      })

      it("is plain ASCII, so no smart quote can triple the cost later", () => {
        // Stricter than "is GSM-7" on purpose, and it is the assertion that
        // will actually fire: GSM-7 admits £ and é, which are fine to send but
        // are the neighbourhood a pasted em dash arrives in. Failing here
        // names the character; failing the segment count does not.
        const nonAscii = [...BODIES[name]].filter((c) => c.charCodeAt(0) > 127)
        expect(nonAscii, `${name} contains ${JSON.stringify(nonAscii)}`).toEqual([])
      })
    })
  }

  it("the counter really would object to a smart apostrophe — the guard is not vacuous", () => {
    // Every assertion above is a NEGATIVE. This is the presence control: it
    // proves the thing being guarded against is detectable, so a change to
    // `countSmsSegments` that stopped noticing UCS-2 fails here rather than
    // quietly making the whole file meaningless.
    //
    // It APPENDS rather than replacing a word. An earlier version swapped the
    // literal "Cannot", which silently became a no-op the moment the copy was
    // reworded — a control that stops controlling is worse than none.
    const withSmartQuote = `${BODIES.quiz_athlete_body}’`
    const counted = countSmsSegments(renderSequenceSms({ body: withSmartQuote, contactName: null }).text)

    expect(counted.encoding).toBe("UCS-2")
    expect(counted.segments).toBeGreaterThan(1)
  })
})
