// @vitest-environment node
//
// Reads migration 00270 off disk. Comment lines are stripped before the
// statement assertions: the header QUOTES the old description in full, so a
// whole-file check for the old wording would match it there and prove nothing.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const RAW = readFileSync(
  join(process.cwd(), "supabase/migrations/00270_camp_deadline_description_matches_behaviour.sql"),
  "utf8",
)
const SQL = RAW.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")

/**
 * The new description is written as adjacent SQL string literals across
 * several lines, which Postgres concatenates. `'…the ' \n '…camp'` means no
 * sentence in it is contiguous in the FILE, so a plain `toContain` on any
 * phrase that crosses a line break fails while the shipped text is perfectly
 * correct — which is exactly what happened when this file was first written.
 * Joining the literals here asserts against the string Postgres will actually
 * store. `''` (an escaped apostrophe) has no whitespace around it and is left
 * alone.
 */
const STORED_TEXT = SQL.replace(/'\s+'/g, "")

describe("00270 — camp_clinic_deadline's description matches its behaviour", () => {
  it("updates only the description, and only for that sequence key", () => {
    expect((SQL.match(/UPDATE public\.sequences/gi) ?? []).length).toBe(1)
    expect(SQL).toMatch(/WHERE key = 'camp_clinic_deadline'/)
    // Not the steps, not the status, not the copy of any email.
    expect(SQL).not.toMatch(/sequence_steps/i)
    expect(SQL).not.toMatch(/\bstatus\s*=/i)
    expect(SQL).not.toMatch(/\bINSERT\b|\bDELETE\b|\bDROP\b/i)
  })

  it("is guarded on the old text, so a hand-written description is never overwritten", () => {
    // The whole reason this is safe to run unattended. A coach who has
    // rewritten the description has said something we should not clobber.
    expect(SQL).toMatch(/AND description LIKE/i)
    expect(SQL).toContain("Runs on relative waits from the moment they registered interest")
  })

  it("says the three things the old description got wrong", () => {
    // The old text claimed relative waits, no camp start date, and that a run
    // cannot know its camp. All three became false with 00269 and G10.
    expect(STORED_TEXT).toContain("straight away")
    expect(STORED_TEXT).toContain("14, 7 and 3 days before")
    expect(STORED_TEXT).toContain("skips the reminders whose moment has already gone")
  })

  it("keeps the one clause of the old text that is still true", () => {
    // The emails really do not name a particular camp. Dropping a true
    // sentence while fixing the false ones would lose real information.
    expect(STORED_TEXT).toContain("never names a particular camp")
  })

  it("does not RAISE, because matching nothing is a legitimate outcome here", () => {
    // Unlike 00269, whose shape assertion must fail loudly. A description
    // somebody has already rewritten by hand should simply be left alone.
    expect(SQL).not.toMatch(/RAISE EXCEPTION/i)
  })

  it("records why it is not folded into 00269", () => {
    // Read RAW: editing an applied migration leaves every database that has
    // already run it holding different text from the file.
    expect(RAW).toContain("00269 had already been applied")
  })
})
