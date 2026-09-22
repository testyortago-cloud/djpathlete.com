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
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

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
