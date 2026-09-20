// @vitest-environment node
//
// Reads migration 00271 off disk. Comment lines are stripped before the
// statement assertions: the header describes the before/after shape in prose
// and a whole-file check would match those words for the wrong reason.
//
// The RESULT was rehearsed on the dev clone and read back (wait / alert /
// email / wait / email / stop, both nudge emails' copy byte-identical). What
// this file pins is the properties a later edit could quietly break.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const RAW = readFileSync(
  join(process.cwd(), "supabase/migrations/00271_service_application_alerts_the_coach.sql"),
  "utf8",
)
const SQL = RAW.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  // TRAILING comments are stripped too, not just whole-line ones. The
  // renumbering statements carry `-- "What the first conversation covers"` to
  // say which step each slot is, and the "touches no wording" assertion below
  // would otherwise match that comment and fail on a migration that is
  // perfectly correct. Only lines with NO single quote are stripped, so a
  // `--` inside a string literal can never be cut out from under a statement.
  .map((line) => (line.includes("'") ? line : line.replace(/--.*$/, "")))
  .join("\n")

describe("00271 — the coach hears when an application goes unanswered", () => {
  it("adds exactly one alert step, and nothing else is inserted", () => {
    expect((SQL.match(/INSERT INTO public\.sequence_steps/gi) ?? []).length).toBe(1)
    expect(SQL).toMatch(/'alert'/)
  })

  it("REFUSES to delete a step that has ever sent a message", () => {
    // sequence_messages_step_id_fkey cascades, so deleting a step that has
    // sent anything destroys the record of real messages to real people. This
    // is the guard the sequence editor already enforces; a migration that
    // skipped it would do by hand what the product refuses to do by button.
    expect(SQL).toMatch(/FROM public\.sequence_messages WHERE step_id/i)
    expect(SQL).toMatch(/sent_count > 0/)
    expect((SQL.match(/RAISE EXCEPTION/gi) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it("renumbers through a temporary range, because (sequence_id, position) is unique", () => {
    // sequence_steps_position_uniq. Renumbering in place collides the moment
    // two steps want the same slot mid-statement.
    expect(SQL).toMatch(/position = position \+ 1000/)
    expect(SQL).toMatch(/position = 100[1-5]/)
  })

  it("touches neither nudge email's wording", () => {
    // G03 signed that copy off. This migration re-shapes; it does not rewrite.
    expect(SQL).not.toMatch(/SET\s+subject\s*=/i)
    expect(SQL).not.toMatch(/SET\s+body\s*=/i)
    expect(SQL).not.toMatch(/What the first conversation covers/)
    expect(SQL).not.toMatch(/Still want to talk/)
  })

  it("deletes exactly one step, and only an email at position 0", () => {
    expect((SQL.match(/DELETE FROM public\.sequence_steps/gi) ?? []).length).toBe(1)
    expect(SQL).toMatch(/position = 0 AND kind = 'email'/)
  })

  it("keys on the sequence KEY, never an id read off one database", () => {
    expect(SQL).toMatch(/s\.key = 'service_application_received'/)
    expect(SQL).not.toMatch(/sequence_id\s*=\s*'[0-9a-f-]{36}'/i)
  })

  it("verifies the RESULT, not just that it ran", () => {
    expect(SQL).toMatch(/count\(\*\) FILTER \(WHERE st\.kind = 'alert'\) <> 1/)
    expect(SQL).toMatch(/st\.position = 0 AND st\.kind = 'email'\) <> 0/)
  })

  it("raises when NOTHING matched, which a GROUP BY alone cannot do", () => {
    // Review finding. A `JOIN … GROUP BY … HAVING` over zero matching
    // sequences produces zero groups and therefore raises nothing — so "the
    // migration matched nothing" would read as success in every log, which is
    // the precise failure the block claims to prevent.
    expect(SQL).toMatch(/IF NOT EXISTS \(SELECT 1 FROM public\.sequences WHERE key = 'service_application_received'\)/)
  })

  it("checks the positions are CONTIGUOUS 0..5, not merely six of them", () => {
    // Review finding, and the one with teeth. Drop a single renumber statement
    // and a step is stranded at 1004: the count is still 6, the alert is still
    // one, there is still no email at position 0 — so a count-only check
    // announces success while `decideStep` finds nothing at position 4 and
    // silently completes the run, losing that email forever.
    expect(SQL).toMatch(/min\(st\.position\) <> 0/)
    expect(SQL).toMatch(/max\(st\.position\) <> 5/)
  })

  it("carries all five renumber statements, each pinned on its own", () => {
    // `/position = 100[1-5]/` matches if ANY ONE of the five survives, so the
    // earlier assertion could not see four of them being deleted.
    for (const [from, to] of [
      [1001, 0],
      [1002, 2],
      [1003, 3],
      [1004, 4],
      [1005, 5],
    ]) {
      expect(SQL, `renumber ${from} -> ${to} is missing`).toMatch(
        new RegExp(`SET position = ${to} WHERE sequence_id = seq\\.id AND position = ${from}`),
      )
    }
  })

  it("moves in-flight runs with their steps, instead of leaving them on a changed number", () => {
    // Review finding, and the live-fire one. `sequence_runs.current_position`
    // names the NEXT step to run, and this file renumbers underneath it. Every
    // run sits at position 1 for one tick after its acknowledgement email —
    // and position 1 is now the ALERT, so an untouched run would tell the
    // coach "they applied two days ago" minutes after the application landed.
    expect(SQL).toMatch(/UPDATE public\.sequence_runs/)
    expect(SQL).toMatch(/exit_reason = 'sequence_edited'/)
    expect(SQL).toMatch(/SET current_position = 0,/)
  })

  it("is re-runnable: an already-converted sequence is skipped, not mangled", () => {
    // The second run finds no email at position 0 and CONTINUEs. Without that,
    // a re-run would fail the 6-step guard or delete the wrong step.
    expect(SQL).toMatch(/IF ack_id IS NULL THEN\s+CONTINUE;/)
  })

  it("carries the alert wording, addressed to the coach and naming the lead", () => {
    // {{name}} is the LEAD — the runner passes ctx.contact.name for an alert,
    // which is the change this row required. A subject with no name sends the
    // coach hunting through the contacts list.
    expect(SQL).toContain("{{name}} applied two days ago")
    // A QUESTION, never an assertion. Nothing in this system exits a run
    // because the coach replied — there is no such exit reason — so a subject
    // reading "No reply yet to X's application" would be flatly wrong in
    // exactly the case a diligent coach creates most often, which is how an
    // alert channel gets trained into noise.
    expect(SQL).toContain("have you replied?")
    expect(SQL).not.toContain("No reply yet")
    expect(SQL).toContain("cannot see your inbox")
  })

  it("hard-codes no URL, because the renderer has no {{contact_url}}", () => {
    // Only {{name}}, {{unsubscribe_url}} and {{sms_consent_url}} exist. A
    // literal domain here would bake one tenant into seeded copy.
    expect(SQL).not.toMatch(/https?:\/\//)
    expect(SQL).not.toMatch(/darrenjpaul/i)
  })
})
