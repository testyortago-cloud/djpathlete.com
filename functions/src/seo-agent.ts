// functions/src/seo-agent.ts
// The SEO agent handler. Runs gather → reason → execute → remember once per
// week (Sunday 14:00 UTC). Subject to the data warm-up gate: skip silently
// when gsc_query_daily has fewer than 28 distinct dates.

import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getSupabase } from "./lib/supabase.js"
import { gatherSeoSignals } from "./seo/signals.js"
import { reasonAboutWeek } from "./seo/reason.js"
import { executeAction, type ExecutionResult } from "./seo/execute.js"

const WARM_UP_MIN_DISTINCT_DATES = 28

export async function handleSeoAgent(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) return

  const job = jobSnap.data()!
  if (job.status !== "pending") return

  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

  const input = job.input as { userId: string }
  const userId = input.userId

  const startTime = Date.now()

  try {
    const supabase = getSupabase()

    // Step 1: gather
    const signals = await gatherSeoSignals(supabase)

    if (signals.gsc_distinct_dates < WARM_UP_MIN_DISTINCT_DATES) {
      console.log(
        `[seo-agent] data warm-up incomplete (${signals.gsc_distinct_dates}/${WARM_UP_MIN_DISTINCT_DATES} distinct dates) — skipping silently`,
      )
      await jobRef.update({
        status: "completed",
        result: {
          skipped: "warm_up",
          gsc_distinct_dates: signals.gsc_distinct_dates,
          required: WARM_UP_MIN_DISTINCT_DATES,
        },
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }

    // Step 2: reason
    const { decision } = await reasonAboutWeek(signals)

    // Step 3a: insert the memo first (we need its id to pass to executors).
    // outcome_status starts as 'pending'.
    const runDate = new Date().toISOString().slice(0, 10)
    const { data: memoInsert, error: memoInsertErr } = await supabase
      .from("seo_agent_memos")
      .insert({
        run_date: runDate,
        ai_job_id: jobId,
        signals_summary: signals,
        rationale: decision.rationale,
        actions: decision.actions.map((a) => ({
          rank: a.rank,
          tool: a.tool,
          args: a.args,
          executed: false,
          execution_target_id: null,
          complementary_to_rank_1: a.complementary_to_rank_1,
        })),
        outcome_status: "pending",
        brief_id: signals.brief_context?.brief_id ?? null,
        brief_alignment_score: decision.brief_alignment_score ?? null,
        ran_without_brief: signals.brief_context === null,
        agent_confidence: decision.agent_confidence,
        dissents_from_brief: decision.dissent_from_upstream.dissents,
        dissent_reason: decision.dissent_from_upstream.reason,
      })
      .select("id")
      .single()
    if (memoInsertErr || !memoInsert) {
      throw new Error(`memo insert failed: ${memoInsertErr?.message ?? "unknown"}`)
    }
    const memoId = (memoInsert as { id: string }).id

    // Step 3b: execute each action in order, writing back the result to the memo.
    const ctx = { memoId, userId }
    const results: ExecutionResult[] = []
    for (const action of decision.actions) {
      const r = await executeAction(action, ctx, signals)
      results.push(r)
      console.log(
        `[seo-agent] action rank=${action.rank} tool=${action.tool} executed=${r.executed} target=${r.execution_target_id ?? "null"}`,
      )
    }

    // Step 4: update the memo's actions[] with executed flags + target ids.
    const finalActions = decision.actions.map((a, i) => ({
      rank: a.rank,
      tool: a.tool,
      args: a.args,
      executed: results[i].executed,
      execution_target_id: results[i].execution_target_id,
      complementary_to_rank_1: a.complementary_to_rank_1,
    }))
    await supabase
      .from("seo_agent_memos")
      .update({ actions: finalActions })
      .eq("id", memoId)

    await jobRef.update({
      status: "completed",
      result: {
        memoId,
        rationale: decision.rationale,
        actions_executed: results.filter((r) => r.executed).length,
        duration_ms: Date.now() - startTime,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[seo-agent] Job ${jobId} failed:`, errorMessage)
    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}
