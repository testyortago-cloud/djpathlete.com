// Post-hoc AI duplicate scan (design: 2026-08-03-ledger-duplicate-scan-design.md).
// Read-only compute: candidates recomputed server-side, dismissals filtered BEFORE
// the AI call (they gate display AND spend), zero candidates = zero spend. The AI
// leg never 500s — timeout/failure degrades to heuristic-only pairs the dialog
// badges honestly. Deletes/dismissals happen through the existing audited routes,
// never here. Admin self-gated (/api/* is NOT in the middleware matcher).
import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { MODEL_SONNET, callAgent } from "@/lib/ai/anthropic"
import { findCandidatePairs, type CandidatePair } from "@/lib/bookkeeping/duplicate-scan"
import { createGenerationLog, updateGenerationLog } from "@/lib/db/ai-generation-log"
import { listDismissedFingerprints, listEntriesForDuplicateScan } from "@/lib/db/bookkeeping"
import { withTimeout } from "@/lib/with-timeout"

// 60s: a full 40-pair verdict set is ~2-3k output tokens, which Sonnet can
// take 35-55s to stream — the original 25s AI budget timed out on a real
// 25-pair scan (2026-08-03) and degraded every large scan to heuristic-only.
export const maxDuration = 60

// candidates_only: fast pairing-only phase (no AI call, no log row) so the
// dialog can show the heuristic list instantly and run the slow AI leg with
// real progress on top of visible content.
const bodySchema = z.object({ book_id: z.string().uuid(), candidates_only: z.boolean().optional() })

const verdictSchema = z.object({
  verdicts: z.array(
    z.object({
      pair_id: z.string(),
      is_duplicate: z.boolean(),
      confidence: z.enum(["low", "medium", "high"]),
      reason: z.string(),
    }),
  ),
})

export interface ScanVerdict {
  is_duplicate: boolean
  confidence: "low" | "medium" | "high"
  reason: string
}
export type ScanResponsePair = CandidatePair & { verdict: ScanVerdict | null }

const SYSTEM_PROMPT = [
  "You judge suspected duplicate entries in a solo athletic-performance coach's bookkeeping ledger.",
  "Each candidate pair has the same direction and exact same amount, a few days apart; all amounts are integer cents.",
  "Two entries are duplicates ONLY if they plausibly record the SAME real-world transaction twice",
  "(classic case: a scanned receipt AND a bank-statement import of the same purchase; or the same statement imported twice).",
  "Recurring same-amount charges like subscriptions or weekly sessions, several days apart with matching memos, are usually NOT duplicates.",
  "Missing memos mean you rely on source, dates and amount; be conservative — is_duplicate true only when a double-record is the best explanation.",
  "Return a verdict for EVERY pair_id you are given, echoing the pair_id exactly.",
  "Your reasons are shown to the coach, labeled AI-generated. Keep each under 25 words.",
].join(" ")

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    }
    const { book_id } = parsed.data

    const [entries, dismissed] = await Promise.all([
      listEntriesForDuplicateScan(book_id),
      listDismissedFingerprints(book_id),
    ])
    const { pairs, truncated } = findCandidatePairs(entries, new Set(dismissed))
    if (pairs.length === 0) {
      return NextResponse.json({ pairs: [], ai: "skipped", truncated })
    }
    if (parsed.data.candidates_only) {
      const heuristic: ScanResponsePair[] = pairs.map((p) => ({ ...p, verdict: null }))
      return NextResponse.json({ pairs: heuristic, ai: "pending", truncated })
    }

    const startTime = Date.now()
    let logId: string | null = null
    try {
      const log = await createGenerationLog({
        program_id: null,
        client_id: null,
        requested_by: session.user.id,
        status: "pending",
        input_params: { feature: "bookkeeping_duplicate_scan", book_id, candidate_pairs: pairs.length },
        output_summary: null,
        error_message: null,
        model_used: MODEL_SONNET,
        tokens_used: null,
        cache_creation_tokens: null,
        cache_read_tokens: null,
        duration_ms: null,
        completed_at: null,
        current_step: 0,
        total_steps: 1,
        // NO generation_trigger — the live ai_generation_log has no such column
        // and PostgREST rejects the whole insert on an unknown key (PGRST204).
      })
      logId = log.id

      const payload = pairs.map((p) => ({
        pair_id: p.pair_id,
        day_gap: p.day_gap,
        same_source: p.same_source,
        memo_similarity: p.memo_similarity,
        a: { date: p.a.occurred_on, amount_cents: p.a.amount_cents, memo: p.a.memo, counterparty: p.a.counterparty, source: p.a.source },
        b: { date: p.b.occurred_on, amount_cents: p.b.amount_cents, memo: p.b.memo, counterparty: p.b.counterparty, source: p.b.source },
      }))

      const { content, tokens_used, cache_creation_tokens, cache_read_tokens } = await withTimeout(
        callAgent(SYSTEM_PROMPT, JSON.stringify({ pairs: payload }), verdictSchema, {
          model: MODEL_SONNET,
          maxTokens: 4000,
        }),
        50_000,
        "Duplicate scan AI verdict timed out",
      )

      const byPairId = new Map(content.verdicts.map((v) => [v.pair_id, v]))
      // Cleared pairs drop; model-omitted pairs stay with verdict null — an
      // omission is "needs human review", never a silent pass.
      const result: ScanResponsePair[] = pairs.flatMap((p) => {
        const v = byPairId.get(p.pair_id)
        if (v && !v.is_duplicate) return []
        return [{ ...p, verdict: v ? { is_duplicate: v.is_duplicate, confidence: v.confidence, reason: v.reason } : null }]
      })

      // Paid verdicts must never be discarded: log update failures are non-fatal.
      await updateGenerationLog(logId, {
        status: "completed",
        output_summary: { candidate_pairs: pairs.length, flagged: result.length },
        tokens_used,
        cache_creation_tokens: cache_creation_tokens ?? null,
        cache_read_tokens: cache_read_tokens ?? null,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
      }).catch((e) => console.error("bookkeeping duplicate scan — log update failed:", e))

      return NextResponse.json({ pairs: result, ai: "ok", truncated })
    } catch (err) {
      console.error("bookkeeping duplicate scan — continuing without AI:", err)
      if (logId) {
        await updateGenerationLog(logId, {
          status: "failed",
          error_message: err instanceof Error ? err.message : "Unknown error",
          duration_ms: Date.now() - startTime,
          completed_at: new Date().toISOString(),
        }).catch(() => {})
      }
      const fallback: ScanResponsePair[] = pairs.map((p) => ({ ...p, verdict: null }))
      return NextResponse.json({ pairs: fallback, ai: "unavailable", truncated })
    }
  } catch (error) {
    console.error("bookkeeping duplicate scan:", error)
    return NextResponse.json({ error: "Failed to scan for duplicates" }, { status: 500 })
  }
}
