// @vitest-environment node
//
// Structure of migration 00272. The COPY is measured separately, through the
// project's own segment counter, in
// __tests__/lib/lead-engine/sequence-sms-copy.test.ts.
//
// Comment lines are stripped before the statement assertions — whole-line and
// trailing both — because the header discusses `sms_repermission`, branch
// pointers, `{{name}}` and the daily cap in prose, and the negative assertions
// would otherwise match the explanation rather than the code. Trailing
// comments are only stripped from lines with no single quote, so a `--` inside
// a string literal can never be cut out from under a statement.
//
// ASSERTIONS ARE SCOPED TO THEIR OWN LOOP wherever the value differs between
// loops. An earlier version checked that the strings `current_position >= 1`,
// `>= 7` and `>= 5` appeared SOMEWHERE in the file — which stayed green if the
// bounds were swapped between two families, a mistake that would have texted
// people after their run had already ended.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const RAW = readFileSync(join(process.cwd(), "supabase/migrations/00272_sequence_text_steps.sql"), "utf8")
const SQL = RAW.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .map((line) => (line.includes("'") ? line : line.replace(/--.*$/, "")))
  .join("\n")

/**
 * The body of one `FOR seq IN ... LOOP ... END LOOP;` block, picked by a
 * string that appears only inside it. This is what makes the per-family
 * assertions below actually per-family.
 */
function loopContaining(marker: string): string {
  const blocks = SQL.split(/FOR seq IN/).slice(1)
  const hit = blocks.filter((b) => b.includes(marker))
  expect(hit.length, `expected exactly one loop containing ${marker}, found ${hit.length}`).toBe(1)
  return hit[0].split("END LOOP;")[0]
}

const QUIZ = () => loopContaining("'quiz_aspiring_pro', 'quiz_ceiling_breaker'")
const CAMP = () => loopContaining("s.key = 'camp_clinic_deadline'")
const APPLICATION = () => loopContaining("s.key = 'service_application_received'")

describe("00272 — a wait + text for the sequences that should have one", () => {
  it("inserts a WAIT before every text, which is the whole daily-cap argument", () => {
    // business_settings.daily_message_cap is 1 on production. A text placed
    // straight after an email is deferred by dailyCapDefer to local midnight
    // and then by quiet hours to 08:00 — so it arrives the NEXT MORNING. Every
    // seeded SMS already in the product sits after a wait for this reason.
    for (const [name, loop] of [
      ["quiz", QUIZ()],
      ["camp", CAMP()],
      ["application", APPLICATION()],
    ] as const) {
      expect(loop, `${name} inserts no wait`).toMatch(/'wait', 1440\)/)
      expect(loop, `${name} inserts no text`).toMatch(/'sms'/)
    }
    // Three wait inserts, three text inserts — not one shared.
    expect((SQL.match(/'wait', 1440\)/g) ?? []).length).toBe(3)
    // And the migration verifies it at run time rather than trusting these
    // INSERT pairs to stay in step.
    expect(SQL).toMatch(/prev\.kind = 'wait'/)
    expect(SQL).toMatch(/does not follow a wait/)
  })

  it("EXCLUDES sms_repermission, and asserts the exclusion rather than relying on silence", () => {
    // THE SAFETY-CRITICAL ONE. That sequence is a one-time EMAIL to people
    // whose phone carries no recorded consent, and its own body promises "we
    // won't text you unless you tell us to". A text step in it messages
    // exactly the people who have not agreed.
    //
    // Asserted as the exact SET of keys the three CONVERSION loops select,
    // rather than by scanning every `s.key` predicate in the file — the
    // verification block legitimately names `sms_repermission` in order to
    // check it stayed clean, and a blanket scan flags that as a violation.
    //
    // An exact set is also stronger than "does not contain": it fails both if
    // sms_repermission is added AND if one of the six is quietly dropped.
    const convertedKeys = new Set<string>()
    for (const loop of [QUIZ(), CAMP(), APPLICATION()]) {
      const selector = loop.match(/s\.key (?:IN \(([^)]*)\)|= ('[^']*'))/)
      expect(selector, "a conversion loop selects no sequence key").not.toBeNull()
      for (const q of (selector?.[1] ?? selector?.[2] ?? "").matchAll(/'([^']+)'/g)) convertedKeys.add(q[1])
    }
    expect([...convertedKeys].sort()).toEqual(
      [
        "camp_clinic_deadline",
        "quiz_aspiring_pro",
        "quiz_ceiling_breaker",
        "quiz_parent_coach",
        "quiz_rebuilder",
        "service_application_received",
      ].sort(),
    )
    expect(SQL).toMatch(/s\.key = 'sms_repermission' AND st\.kind = 'sms'/)
    expect(SQL).toMatch(/RAISE EXCEPTION[\s\S]{0,140}sms_repermission has a text step/)
  })

  it("repoints BOTH quiz branch targets, and refuses to touch a branch a coach has re-aimed", () => {
    // on_true/on_false are POSITION NUMBERS. Inserting two steps at 1 moves
    // 6 -> 8 and 4 -> 6. A renumber that left them alone would send the wrong
    // arm with nothing to show for it.
    expect(QUIZ()).toMatch(/SET on_true_position = 8, on_false_position = 6/)
    // The guard asserts what they WERE, so a coach who swapped the arms in the
    // editor does not have that edit silently reverted.
    expect(QUIZ()).toMatch(/on_true_position = 6 AND on_false_position = 4/)
    // And the result is verified.
    expect(SQL).toMatch(/st\.position <> 5 OR st\.on_true_position <> 8 OR st\.on_false_position <> 6/)
  })

  it("moves in-flight runs by TWO, from the right boundary in each family", () => {
    // `sequence_runs.current_position` names the NEXT step to execute. Each
    // boundary is the insertion point for THAT family, asserted inside its own
    // loop so swapping two of them fails here.
    expect(QUIZ()).toMatch(/current_position = current_position \+ 2[\s\S]*current_position >= 1;/)
    expect(CAMP()).toMatch(/current_position = current_position \+ 2[\s\S]*current_position >= 5;/)
    expect(APPLICATION()).toMatch(/current_position = current_position \+ 2[\s\S]*current_position >= 5;/)
    // Only active runs: claim_sequence_runs never claims anything else.
    expect((SQL.match(/status = 'active' AND current_position >=/g) ?? []).length).toBe(3)
  })

  it("renumbers through a temporary range, because (sequence_id, position) is unique", () => {
    expect(SQL).toMatch(/position = position \+ 1000/)
    // Every quiz slot pinned individually, inside the quiz loop: a single
    // regex like /position = 100[0-7]/ matches if only ONE survives.
    for (const [from, to] of [
      [1000, 0],
      [1001, 3],
      [1002, 4],
      [1003, 5],
      [1004, 6],
      [1005, 7],
      [1006, 8],
      [1007, 9],
    ]) {
      expect(QUIZ(), `quiz renumber ${from} -> ${to} is missing`).toMatch(
        new RegExp(`SET position = ${to} WHERE sequence_id = seq\\.id AND position = ${from}`),
      )
    }
  })

  it("is re-runnable: a sequence that already has a text is skipped", () => {
    expect(
      (SQL.match(/AND kind = 'sms'\) THEN CONTINUE; END IF;|AND kind = 'sms'\) THEN\s+CONTINUE;/g) ?? []).length,
    ).toBe(3)
  })

  it("skips a tenant whose shape it does not recognise, rather than failing everyone", () => {
    // `[\s\S]{0,120}` rather than `[^;]*`: the notice text itself contains a
    // semicolon, so a not-a-semicolon match stops before the word it seeks.
    expect((SQL.match(/RAISE NOTICE[\s\S]{0,120}skipping/g) ?? []).length).toBe(3)
  })

  it("verifies only what it CONVERTED, so a skipped tenant cannot abort the deploy", () => {
    // Review finding. The verification used to select every sequence with one
    // of the six keys that had a text — precisely the set the re-run guards
    // skip. One coach who appended an sms step by hand would have raised, and
    // the whole DO block rolls back, denying every other tenant the change.
    expect(SQL).toMatch(/converted_ids uuid\[\]/)
    expect((SQL.match(/s\.id = ANY \(converted_ids\)/g) ?? []).length).toBe(3)
  })

  it("raises when it converted NOTHING, which a row-exists check cannot see", () => {
    // The shape guards are exact. If every copy has been edited — one extra
    // step is two clicks in the editor — all three loops CONTINUE, the
    // GROUP BY verifications group over zero rows and raise nothing, and the
    // migration finishes green having done nothing. G17 would stay open,
    // silently, in exactly the way the header says it must not.
    expect(SQL).toMatch(/IF cardinality\(converted_ids\) = 0 THEN/)
    expect(SQL).toMatch(/RAISE EXCEPTION[\s\S]{0,120}converted nothing/)
  })

  it("verifies positions stay CONTIGUOUS from 0, not merely that a step was added", () => {
    expect(SQL).toMatch(/min\(st\.position\) <> 0/)
    expect(SQL).toMatch(/max\(st\.position\) <> count\(\*\) - 1/)
  })

  it("changes no existing wording and deletes nothing", () => {
    expect(SQL).not.toMatch(/\bDELETE\b/i)
    expect(SQL).not.toMatch(/\bDROP\b/i)
    // Any assignment to subject/body, not only one immediately after SET.
    expect(SQL).not.toMatch(/\bsubject\s*=/i)
    expect(SQL).not.toMatch(/\bbody\s*=/i)
  })

  it("hard-codes no id at all, not even the platform business", () => {
    expect(SQL).not.toMatch(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i)
  })
})
