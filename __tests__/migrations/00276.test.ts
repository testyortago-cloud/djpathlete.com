import { beforeAll, describe, expect, it } from "vitest"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// Live dev-clone test. Skipped when the env is absent so a laptop with no
// .env.local does not report a false failure.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const describeIf = url && key ? describe : describe.skip

describeIf("save_pipeline_stages (00276)", () => {
  let db: SupabaseClient
  let pipelineId: string
  let businessId: string

  beforeAll(async () => {
    db = createClient(url!, key!)
    // The dev clone now carries a "coaching" pipeline per test tenant (multi-
    // tenant seed data added after this brief was written), so `.eq("key",
    // "coaching")` alone is no longer unique and `.single()` throws. Pin to
    // the singleton business explicitly -- it is the "coaching (has cards)"
    // board the task's context names.
    const { data } = await db
      .from("pipelines")
      .select("id, business_id")
      .eq("key", "coaching")
      .eq("business_id", "00000000-0000-0000-0000-000000000001")
      .single()
    pipelineId = data!.id
    businessId = data!.business_id
  })

  it("renumbers the whole board from the submitted order, which a pairwise swap could not", async () => {
    // Threshold columns are read here too (not just id/key/position) so the
    // "put it back" step below can restore the REAL values instead of
    // hard-coding null -- the brief's own version of this test nulled out
    // consult_booked/consulted's amber_after_days/red_after_days permanently
    // on every run, which is not "left as it was found" on a dev clone
    // shared with four other sessions.
    const { data: before } = await db
      .from("pipeline_stages")
      .select("id, key, position, amber_after_days, red_after_days")
      .eq("pipeline_id", pipelineId)
      .order("position")

    const reversed = [...before!].reverse().map((s, i) => ({
      id: s.id, key: s.key, name: s.key, kind: null, amber_after_days: null, red_after_days: null, position: i + 1,
    }))
    // kind must be preserved; read it rather than inventing it.
    const { data: kinds } = await db.from("pipeline_stages").select("id, kind, name").eq("pipeline_id", pipelineId)
    const kindOf = new Map(kinds!.map((k) => [k.id, k]))
    for (const s of reversed) {
      s.kind = kindOf.get(s.id)!.kind
      s.name = kindOf.get(s.id)!.name
    }

    const { error } = await db.rpc("save_pipeline_stages", {
      p_business_id: businessId, p_pipeline_id: pipelineId, p_stages: reversed, p_move_cards: [],
    })
    expect(error).toBeNull()

    const { data: after } = await db
      .from("pipeline_stages").select("id, position").eq("pipeline_id", pipelineId).order("position")
    expect(after!.map((s) => s.id)).toEqual(reversed.map((s) => s.id))

    // Put it back, so the shared dev clone is left as it was found --
    // thresholds included.
    const restored = before!.map((s, i) => ({
      id: s.id, key: s.key, name: kindOf.get(s.id)!.name, kind: kindOf.get(s.id)!.kind,
      amber_after_days: s.amber_after_days, red_after_days: s.red_after_days, position: i + 1,
    }))
    await db.rpc("save_pipeline_stages", {
      p_business_id: businessId, p_pipeline_id: pipelineId, p_stages: restored, p_move_cards: [],
    })
  })

  it("RAISEs when a submitted stage id does not belong to this board", async () => {
    const { data: stages } = await db.from("pipeline_stages").select("id, key, name, kind").eq("pipeline_id", pipelineId)
    const foreign = [
      ...stages!.map((s, i) => ({ ...s, amber_after_days: null, red_after_days: null, position: i + 1 })),
      { id: "00000000-0000-0000-0000-0000000000ff", key: "ghost", name: "Ghost", kind: "open",
        amber_after_days: null, red_after_days: null, position: stages!.length + 1 },
    ]
    const { error } = await db.rpc("save_pipeline_stages", {
      p_business_id: businessId, p_pipeline_id: pipelineId, p_stages: foreign, p_move_cards: [],
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/does not belong to this board/i)
  })

  it("leaves the board untouched when it raises", async () => {
    const { data: after } = await db.from("pipeline_stages").select("id").eq("pipeline_id", pipelineId)
    expect(after!.length).toBe(4)
  })

  // Controller ruling R5: an empty p_stages makes array_agg() return NULL,
  // which makes the step-2 DELETE's "v_submitted_ids IS NULL OR NOT (...)"
  // match every row on the board.
  //
  // Controller ruling R6: the board choice here is load-bearing, and it must
  // be `assessment`, not `camps_clinics` or `coaching`. Under mutation
  // testing (guard deleted), `camps_clinics` (3 opportunities on the dev
  // clone) and `coaching` (13) both still raise an error and still leave the
  // board untouched -- but for the WRONG reason: the FK on
  // opportunities.stage_id blocks the DELETE before it can wipe the board,
  // not the guard. That version of this test goes green on a build with the
  // guard removed, which defeats the entire point of writing it. `assessment`
  // has ZERO opportunities on the dev clone (measured directly, not assumed
  // -- production and dev have diverged on this), so the FK cannot be the
  // reason this test passes; only the guard can be. Do not "tidy" this back
  // to camps_clinics or coaching.
  it("refuses to empty a board's stage list, and leaves the board untouched", async () => {
    const { data: board } = await db
      .from("pipelines")
      .select("id")
      .eq("key", "assessment")
      .eq("business_id", "00000000-0000-0000-0000-000000000001")
      .single()
    const emptyBoardId = board!.id

    const { error } = await db.rpc("save_pipeline_stages", {
      p_business_id: "00000000-0000-0000-0000-000000000001",
      p_pipeline_id: emptyBoardId,
      p_stages: [],
      p_move_cards: [],
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/needs at least one stage/i)

    const { data: after } = await db.from("pipeline_stages").select("id").eq("pipeline_id", emptyBoardId)
    expect(after!.length).toBe(4)
  })

  // Mutation-3 companion: step 4's survivor UPDATE deliberately omits `key`
  // from its SET list -- it is immutable once created, because stored
  // opportunity_stage_events rows and routeToPipeline's return value
  // reference it. A submission that tries to rename the key must be
  // silently ignored for that column while every other edited field lands.
  it("keeps a stage's key immutable, even when the submission asks to rename it", async () => {
    const { data: stages } = await db
      .from("pipeline_stages")
      .select("id, key, name, kind, amber_after_days, red_after_days, position")
      .eq("pipeline_id", pipelineId)
      .order("position")
    const target = stages![0]

    const renamed = stages!.map((s) => ({
      id: s.id,
      key: s.id === target.id ? "attempted_new_key" : s.key,
      name: s.id === target.id ? "Renamed For Key Immutability Test" : s.name,
      kind: s.kind,
      amber_after_days: s.amber_after_days,
      red_after_days: s.red_after_days,
      position: s.position,
    }))
    const { error } = await db.rpc("save_pipeline_stages", {
      p_business_id: businessId, p_pipeline_id: pipelineId, p_stages: renamed, p_move_cards: [],
    })
    expect(error).toBeNull()

    const { data: afterRename } = await db.from("pipeline_stages").select("key, name").eq("id", target.id).single()
    expect(afterRename!.key).toBe(target.key)
    expect(afterRename!.name).toBe("Renamed For Key Immutability Test")

    // Put the name back, so the board is left as it was found.
    const original = stages!.map((s) => ({
      id: s.id, key: s.key, name: s.name, kind: s.kind,
      amber_after_days: s.amber_after_days, red_after_days: s.red_after_days, position: s.position,
    }))
    await db.rpc("save_pipeline_stages", {
      p_business_id: businessId, p_pipeline_id: pipelineId, p_stages: original, p_move_cards: [],
    })
  })

  // Mutation-4 companion: the ownership PERFORM checks BOTH id and
  // business_id. A caller with the right pipeline id but the wrong tenant
  // must be refused -- this is the one line standing between a caller with
  // the wrong business_id and another tenant's board.
  it("RAISEs when the business_id does not own the board", async () => {
    const { data: stages } = await db
      .from("pipeline_stages")
      .select("id, key, name, kind, amber_after_days, red_after_days, position")
      .eq("pipeline_id", pipelineId)
      .order("position")

    const { error } = await db.rpc("save_pipeline_stages", {
      p_business_id: "00000000-0000-0000-0000-000000000099",
      p_pipeline_id: pipelineId,
      p_stages: stages,
      p_move_cards: [],
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/does not belong to business/i)

    const { data: after } = await db
      .from("pipeline_stages").select("id, position, name").eq("pipeline_id", pipelineId).order("position")
    expect(after!.map((s) => s.name)).toEqual(stages!.map((s) => s.name))
  })
})
