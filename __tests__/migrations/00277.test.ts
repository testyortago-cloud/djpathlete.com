// @vitest-environment node
//
// Live dev-clone test for migration 00277 — the `to_stage_id` cross-check
// added to `save_pipeline_stages` by the whole-branch review (Important 1).
//
// WHY THIS NEEDS ITS OWN BOARD, unlike every test in 00276.test.ts, which
// works against the seeded `coaching` and `assessment` boards. The mutant this
// file exists to kill RELOCATES REAL CARDS: without the cross-check, a
// `to_stage_id` naming another board's stage moves opportunities there and the
// call SUCCEEDS. Run that against `coaching` on a clone four other sessions
// share and the test itself becomes the incident. So everything here is built
// in `beforeAll` and torn down in `afterAll`, and the only pre-existing row it
// touches is a contact it reads (never writes) to satisfy
// `opportunities.contact_id NOT NULL`.
//
// WHY AN ERROR ALONE CANNOT BE THE ASSERTION. The "destination is also being
// removed" case raises either way — with the fix, step 2's DELETE hits the FK
// because the cards never moved; without it, step 2's DELETE hits the FK
// because the cards moved ONTO the doomed stage. Same error, opposite
// meaning. The cross-BOARD case is the one that discriminates: unfixed it
// answers success and the cards are gone from both boards; fixed it refuses
// and nothing moves. That is what the main test below drives.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// ---------------------------------------------------------------------------
// THE STATIC HALF, WHICH ALWAYS RUNS (re-review, small item 2).
//
// Everything below the `describeIf` needs `NEXT_PUBLIC_SUPABASE_URL` and
// `SUPABASE_SERVICE_ROLE_KEY`; without them vitest SKIPS the whole block, and
// a skipped suite reads as a green suite — this repo has already been caught
// by exactly that (`playwright.config.ts` never loaded `.env.local`, and the
// e2e lane guarded deleted UI for weeks). In this worktree `.env.local` is
// symlinked so the live half does run; on CI or a fresh clone it would report
// success while checking nothing at all.
//
// So the predicate itself is also asserted against the migration TEXT, which
// needs no database and cannot be skipped. This is the convention 00272,
// 00274 and 00257 already follow. It proves the file says the right thing; the
// live half below proves the database DOES the right thing. Neither replaces
// the other.
//
// Comment lines are stripped first — this migration's header discusses
// `to_stage_id` and `v_submitted_ids` at length in prose, so an unstripped
// search would match the explanation rather than the code, and would stay
// green if the predicate itself were deleted.
// ---------------------------------------------------------------------------

const MIGRATION = "supabase/migrations/00277_save_pipeline_stages_checks_the_destination.sql"
const RAW = readFileSync(join(process.cwd(), MIGRATION), "utf8")
const SQL = RAW.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .map((line) => (line.includes("'") ? line : line.replace(/--.*$/, "")))
  .join("\n")

/** The body of step 1's card-move UPDATE, on its own. */
function moveCardsUpdate(): string {
  const after = SQL.split("UPDATE public.opportunities o")
  expect(after.length, "expected exactly one card-move UPDATE in this migration").toBe(2)
  return after[1].split(";")[0]
}

describe("00277 — the migration text itself", () => {
  it("replaces save_pipeline_stages rather than creating a second function", () => {
    expect(SQL).toContain("CREATE OR REPLACE FUNCTION public.save_pipeline_stages(")
    expect(SQL.match(/CREATE OR REPLACE FUNCTION/g) ?? []).toHaveLength(1)
  })

  // THE WHOLE POINT OF THE MIGRATION, asserted inside the ONE statement it
  // belongs to. A file-wide `toContain` would pass if the predicate were
  // moved to the DELETE, where it would silently do nothing.
  it("cross-checks to_stage_id against the submitted ids, inside the card-move UPDATE", () => {
    const update = moveCardsUpdate()
    expect(update).toContain("(m->>'to_stage_id')::uuid = ANY(v_submitted_ids)")
    expect(update).toContain("v_submitted_ids IS NOT NULL")
  })

  // The mirror it is the mirror OF. Losing this one would reopen review
  // finding 1 of the first round (a move off a SURVIVING stage), which 00276
  // closed — a `CREATE OR REPLACE` that forgot it would be a silent
  // regression, because the function would still compile and still run.
  it("keeps 00276's from_stage_id cross-check, which this one is the mirror of", () => {
    expect(moveCardsUpdate()).toContain("NOT ((m->>'from_stage_id')::uuid = ANY(v_submitted_ids))")
  })

  // PRESENCE CONTROL for the three above: the stripper must not have eaten
  // the file. Without this, a bad regex that reduced SQL to "" would make
  // every `toContain` above fail loudly — but a bad `moveCardsUpdate` split
  // returning the whole file would make them all pass vacuously.
  it("reads a real function body, not an empty string or the whole file", () => {
    expect(SQL.length).toBeGreaterThan(1000)
    const update = moveCardsUpdate()
    expect(update.length).toBeGreaterThan(100)
    expect(update).not.toContain("DELETE FROM public.pipeline_stages")
  })

  // Re-review, small item 5: the hazard this function does NOT close is
  // written down rather than fixed, so the next reader does not have to
  // rediscover it. If somebody ever adds the predicate, delete this test with
  // the comment — do not leave it asserting the absence of a fix.
  it("says out loud that from_stage_id carries no pipeline_id predicate", () => {
    expect(RAW).toMatch(/no `?pipeline_id`? predicate/i)
  })
})

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const describeIf = url && key ? describe : describe.skip

/** The dev clone. This file writes, so it refuses to run anywhere else. */
const DEV_REF = "anjvztjiokcgiyhobknq"
const BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

type Stage = { id: string; key: string; name: string; kind: string; position: number }

describeIf("save_pipeline_stages — the destination cross-check (00277)", () => {
  let db: SupabaseClient
  /** The throwaway board this file builds and destroys. */
  let boardId: string
  let stages: Stage[]
  /** A stage on a DIFFERENT board of the same tenant — the leak's target. */
  let foreignStageId: string
  let opportunityId: string
  let contactId: string

  const submit = (list: Stage[]) =>
    list.map((s, i) => ({
      id: s.id,
      key: s.key,
      name: s.name,
      kind: s.kind,
      amber_after_days: null,
      red_after_days: null,
      position: i + 1,
    }))

  const stageOf = (k: string) => stages.find((s) => s.key === k)!

  beforeAll(async () => {
    expect(url, "refusing to run against anything but the dev clone").toContain(DEV_REF)
    db = createClient(url!, key!)

    // A contact that already exists — READ, never written. `contact_id` is
    // NOT NULL on opportunities and creating a person on a shared clone to
    // prove a SQL predicate would be gratuitous.
    const { data: contact } = await db.from("contacts").select("id").eq("business_id", BUSINESS_ID).limit(1).single()
    contactId = contact!.id

    const suffix = Date.now().toString(36)
    const { data: pipeline, error: pipelineErr } = await db
      .from("pipelines")
      .insert({ business_id: BUSINESS_ID, key: `t_00277_${suffix}`, name: `00277 test ${suffix}`, status: "active" })
      .select("id")
      .single()
    expect(pipelineErr).toBeNull()
    boardId = pipeline!.id

    const { data: inserted, error: stagesErr } = await db
      .from("pipeline_stages")
      .insert([
        { business_id: BUSINESS_ID, pipeline_id: boardId, key: "enquiry", name: "Enquiry", kind: "open", position: 1 },
        { business_id: BUSINESS_ID, pipeline_id: boardId, key: "proposal", name: "Proposal", kind: "open", position: 2 },
        { business_id: BUSINESS_ID, pipeline_id: boardId, key: "won", name: "Won", kind: "won", position: 3 },
        { business_id: BUSINESS_ID, pipeline_id: boardId, key: "lost", name: "Lost", kind: "lost", position: 4 },
      ])
      .select("id, key, name, kind, position")
    expect(stagesErr).toBeNull()
    stages = (inserted as Stage[]).sort((a, b) => a.position - b.position)

    // ONE REAL CARD on the stage that will be removed. A stage with zero
    // cards would pass every assertion below whether or not 00277 exists —
    // the same trap 00276.test.ts calls out for its own move-card test.
    const { data: opp, error: oppErr } = await db
      .from("opportunities")
      .insert({
        business_id: BUSINESS_ID,
        pipeline_id: boardId,
        contact_id: contactId,
        stage_id: stageOf("enquiry").id,
        entered_stage_at: new Date().toISOString(),
      })
      .select("id")
      .single()
    expect(oppErr).toBeNull()
    opportunityId = opp!.id

    // Somebody else's board entirely — `assessment` is seeded for this tenant
    // and has no cards of its own, so nothing there can be disturbed even if
    // an assertion below were to fail.
    const { data: other } = await db
      .from("pipelines")
      .select("id")
      .eq("business_id", BUSINESS_ID)
      .eq("key", "assessment")
      .single()
    const { data: otherStage } = await db
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", other!.id)
      .eq("kind", "open")
      .limit(1)
      .single()
    foreignStageId = otherStage!.id
  })

  afterAll(async () => {
    // Children first: the FK on opportunities.stage_id and the one on
    // pipeline_stages.pipeline_id both refuse the other order.
    if (boardId) {
      await db.from("opportunities").delete().eq("pipeline_id", boardId)
      await db.from("pipeline_stages").delete().eq("pipeline_id", boardId)
      await db.from("pipelines").delete().eq("id", boardId)
    }
  })

  /** Where the one card is sitting right now. */
  async function stageOfCard(): Promise<string> {
    const { data } = await db.from("opportunities").select("stage_id").eq("id", opportunityId).single()
    return data!.stage_id
  }

  it("does not relocate cards onto ANOTHER BOARD's stage, even when told to", async () => {
    const before = await stageOfCard()
    expect(before).toBe(stageOf("enquiry").id)

    const { error } = await db.rpc("save_pipeline_stages", {
      p_business_id: BUSINESS_ID,
      p_pipeline_id: boardId,
      // "enquiry" is dropped from the list, so it is a legitimate
      // from_stage_id; the destination is a stage on a different board.
      p_stages: submit([stageOf("proposal"), stageOf("won"), stageOf("lost")]),
      p_move_cards: [{ from_stage_id: stageOf("enquiry").id, to_stage_id: foreignStageId }],
    })

    // Refused — the move was skipped, so step 2's DELETE met the card still
    // sitting on the stage it was trying to remove. That is the correct
    // fail-closed outcome for a caller that bypassed the DAL's own English
    // refusal (`invalidDestinationProblems`).
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/opportunities_stage_id_fkey|violates foreign key/i)

    // THE ASSERTION THAT DISCRIMINATES. Without 00277 this call SUCCEEDS and
    // the card is sitting on another board, visible on neither.
    expect(await stageOfCard()).toBe(stageOf("enquiry").id)

    // And the board is exactly as it was found.
    const { data: after } = await db
      .from("pipeline_stages")
      .select("key")
      .eq("pipeline_id", boardId)
      .order("position")
    expect(after!.map((s) => s.key)).toEqual(["enquiry", "proposal", "won", "lost"])
  })

  it("does not relocate cards onto a stage the same save is deleting", async () => {
    const { error } = await db.rpc("save_pipeline_stages", {
      p_business_id: BUSINESS_ID,
      p_pipeline_id: boardId,
      // Both open stages go; the cards were pointed at the one that is also
      // going. Reachable in three clicks in the editor.
      p_stages: submit([stageOf("won"), stageOf("lost")]),
      p_move_cards: [{ from_stage_id: stageOf("enquiry").id, to_stage_id: stageOf("proposal").id }],
    })

    expect(error).not.toBeNull()
    // The error is the same with or without 00277 — see this file's header.
    // What differs, and what is asserted, is WHERE the card ends up.
    expect(await stageOfCard()).toBe(stageOf("enquiry").id)
  })

  // THE PRESENCE CONTROL. The identical shape of call with a destination that
  // SURVIVES must still move the card — otherwise a function that simply
  // stopped moving anything would pass both tests above.
  it("control: a destination that stays does receive the cards, and the save lands", async () => {
    const { error } = await db.rpc("save_pipeline_stages", {
      p_business_id: BUSINESS_ID,
      p_pipeline_id: boardId,
      p_stages: submit([stageOf("proposal"), stageOf("won"), stageOf("lost")]),
      p_move_cards: [{ from_stage_id: stageOf("enquiry").id, to_stage_id: stageOf("proposal").id }],
    })

    expect(error).toBeNull()
    expect(await stageOfCard()).toBe(stageOf("proposal").id)

    const { data: after } = await db
      .from("pipeline_stages")
      .select("key")
      .eq("pipeline_id", boardId)
      .order("position")
    expect(after!.map((s) => s.key)).toEqual(["proposal", "won", "lost"])
  })
})
