// @vitest-environment node
//
// Reads the migration off disk and checks its structure, modelled on
// __tests__/migrations/00255_sequence_content_and_branching.test.ts.
// __tests__/lib/lead-engine/seed-sequences.test.ts is scoped to 00218 by a
// HARDCODED path and does NOT cover this file.
//
// A caution about text assertions, same as 00255's own: this migration's
// header comment quotes `attempts = attempts + 1`, discusses "paused" vs
// "active", and explains the negative-parking trick and the exit-reason
// wording IN PROSE, precisely because those are the things it is warning
// about. A `SQL.includes(...)` run over the WHOLE file would match that
// prose and pass for the wrong reason. Every assertion below is scoped to
// one function's own body -- extracted between its
// `CREATE OR REPLACE FUNCTION public.<name>(` marker and the matching
// closing `$function$;` -- never the whole file.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/00256_sequence_management.sql"), "utf8")

/**
 * Slices out `CREATE OR REPLACE FUNCTION public.<name>(...) ... $function$;`
 * -- the whole statement, body included -- so assertions below see only what
 * that one function actually does, not the header comment above it.
 */
function extractFunction(sql: string, name: string): string {
  const startMarker = `CREATE OR REPLACE FUNCTION public.${name}(`
  const start = sql.indexOf(startMarker)
  if (start === -1) throw new Error(`could not find "CREATE OR REPLACE FUNCTION public.${name}(" in the file`)
  const bodyOpen = sql.indexOf("$function$", start)
  if (bodyOpen === -1) throw new Error(`could not find the opening $function$ for ${name}`)
  const bodyClose = sql.indexOf("$function$;", bodyOpen + "$function$".length)
  if (bodyClose === -1) throw new Error(`could not find the closing $function$; for ${name}`)
  return sql.slice(start, bodyClose + "$function$;".length)
}

const CLAIM_FN = extractFunction(SQL, "claim_sequence_runs")
const SAVE_FN = extractFunction(SQL, "save_sequence_steps")

describe("parser sanity", () => {
  it("extracted both function bodies, and they don't overlap", () => {
    expect(CLAIM_FN.length).toBeGreaterThan(200)
    expect(SAVE_FN.length).toBeGreaterThan(200)
    expect(SAVE_FN).not.toContain("claim_sequence_runs")
    expect(CLAIM_FN).not.toContain("save_sequence_steps")
  })
})

// ---------------------------------------------------------------------------
// claim_sequence_runs: the gate is inside the RPC, before the claim.
// ---------------------------------------------------------------------------

describe("claim_sequence_runs stops claiming runs whose sequence is off", () => {
  it("joins public.sequences", () => {
    expect(CLAIM_FN).toContain("JOIN public.sequences")
  })

  it("gates on the SEQUENCE's own status being active, not just the run's", () => {
    expect(CLAIM_FN).toContain("q.status      = 'active'")
    // The run's own status filter must still be present too -- the gate is
    // additive, not a replacement.
    expect(CLAIM_FN).toContain("s.status      = 'active'")
  })

  it("still increments attempts on claim -- the gate must not have been implemented by removing the claim", () => {
    expect(CLAIM_FN).toContain("attempts   = r.attempts + 1")
  })

  it("locks only the run (FOR UPDATE OF s SKIP LOCKED), never a bare FOR UPDATE", () => {
    expect(CLAIM_FN).toContain("FOR UPDATE OF s SKIP LOCKED")
    // A bare `FOR UPDATE` (no "OF s") would lock sequences too, once
    // `sequences` sits in the FROM/JOIN list, and block the on/off switch
    // behind every tick.
    expect(CLAIM_FN).not.toMatch(/\bFOR UPDATE\s+SKIP LOCKED/)
  })

  it("joins sequences on both id and business_id, so a run can never see another tenant's sequence", () => {
    expect(CLAIM_FN).toMatch(/ON q\.id = s\.sequence_id\s*\n\s*AND q\.business_id = s\.business_id/)
  })
})

// ---------------------------------------------------------------------------
// save_sequence_steps: tenancy.
// ---------------------------------------------------------------------------

describe("save_sequence_steps refuses a cross-tenant sequence", () => {
  it("raises an exception naming 'business' when the sequence does not belong to p_business_id", () => {
    expect(SAVE_FN).toMatch(/RAISE EXCEPTION 'sequence % does not belong to business %'/)
  })

  it("checks ownership by matching both id and business_id before anything else runs", () => {
    const ownershipIdx = SAVE_FN.indexOf("WHERE id = p_sequence_id AND business_id = p_business_id")
    const deleteIdx = SAVE_FN.indexOf("DELETE FROM public.sequence_steps")
    expect(ownershipIdx).toBeGreaterThan(-1)
    expect(ownershipIdx).toBeLessThan(deleteIdx)
  })
})

// ---------------------------------------------------------------------------
// save_sequence_steps: order of operations. This order is what avoids the
// unique-index collision on (sequence_id, position) -- see §4.7 of the
// design doc -- and what stops the sent-message guard from checking an
// already-empty table.
// ---------------------------------------------------------------------------

describe("save_sequence_steps: operations run in the order that avoids the collision", () => {
  const sentGuardIdx = SAVE_FN.indexOf("FROM public.sequence_messages m")
  const raiseSentIdx = SAVE_FN.indexOf("RAISE EXCEPTION 'refusing to remove a step")
  const deleteIdx = SAVE_FN.indexOf("DELETE FROM public.sequence_steps")
  const parkIdx = SAVE_FN.indexOf("SET position = -1 - position")
  const insertIdx = SAVE_FN.indexOf("INSERT INTO public.sequence_steps")
  const survivorUpdateIdx = SAVE_FN.indexOf("SET position          = (e.ord - 1)::int")
  const repointIdx = SAVE_FN.indexOf("SET current_position = (e.value->>'to_position')::int")
  const exitIdx = SAVE_FN.indexOf("SET status = 'exited'")

  it("finds every marker (a parser that comes back empty checks nothing)", () => {
    const markers: Array<[string, number]> = [
      ["sent-message guard SELECT", sentGuardIdx],
      ["sent-message guard RAISE", raiseSentIdx],
      ["DELETE", deleteIdx],
      ["negative parking UPDATE", parkIdx],
      ["INSERT of new steps", insertIdx],
      ["survivor UPDATE", survivorUpdateIdx],
      ["run re-point UPDATE", repointIdx],
      ["run exit UPDATE", exitIdx],
    ]
    for (const [label, idx] of markers) {
      expect(idx, `could not find: ${label}`).toBeGreaterThan(-1)
    }
  })

  it("the sequence_messages guard (and its RAISE) run before the DELETE", () => {
    expect(sentGuardIdx).toBeLessThan(deleteIdx)
    expect(raiseSentIdx).toBeLessThan(deleteIdx)
  })

  it("the DELETE runs before the negative parking UPDATE", () => {
    // Deleting first means the parking UPDATE only ever touches survivors --
    // the removed steps are already gone.
    expect(deleteIdx).toBeLessThan(parkIdx)
  })

  it("the negative parking UPDATE runs before the INSERT of new steps", () => {
    expect(parkIdx).toBeLessThan(insertIdx)
  })

  it("the negative parking UPDATE runs before the survivor UPDATE", () => {
    expect(parkIdx).toBeLessThan(survivorUpdateIdx)
  })

  it("both step writes (INSERT, survivor UPDATE) finish before runs are re-pointed", () => {
    expect(insertIdx).toBeLessThan(repointIdx)
    expect(survivorUpdateIdx).toBeLessThan(repointIdx)
  })

  it("runs are re-pointed before the ones without a home are exited", () => {
    expect(repointIdx).toBeLessThan(exitIdx)
  })
})

// ---------------------------------------------------------------------------
// Exiting a run must never read as having reached the end.
// ---------------------------------------------------------------------------

describe("an exited run is never recorded as completed", () => {
  it("writes exit_reason = 'sequence_edited' in the same UPDATE as status = 'exited'", () => {
    const exitStart = SAVE_FN.indexOf("SET status = 'exited'")
    expect(exitStart).toBeGreaterThan(-1)
    // The next statement terminator after this SET starts is this same
    // UPDATE's own WHERE clause / semicolon -- scope the check to that one
    // statement rather than the rest of the function.
    const exitStatement = SAVE_FN.slice(exitStart, SAVE_FN.indexOf(";", exitStart) + 1)
    expect(exitStatement).toContain("status = 'exited'")
    expect(exitStatement).toContain("exit_reason = 'sequence_edited'")
  })

  it("never sets status = 'completed' anywhere in the file", () => {
    // Scoped to the SQL literal, not the header prose -- the header never
    // uses this exact literal, but if a future edit added a completion path
    // here it would use precisely this string.
    expect(SQL).not.toContain("status = 'completed'")
  })
})
