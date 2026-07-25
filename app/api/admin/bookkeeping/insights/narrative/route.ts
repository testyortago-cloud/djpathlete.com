// AI narrative tail (5b, decision B-5): explicit-button Sonnet spend over the
// RECOMPUTED findings — the server never trusts client-posted numbers.
// Dismissed findings are filtered BEFORE compaction: dismissals gate display,
// and the narrative IS display. AI failure/timeout never 500s — honest
// fallback with observations:null; the live numbers on the page are computed
// separately and unaffected. Unaudited like the insights GET (D10 read
// surface); ai_generation_log is the spend record (inquiry-route precedent).
import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { MODEL_SONNET, callAgent } from "@/lib/ai/anthropic"
import { deductionFindings } from "@/lib/bookkeeping/deduction-finder"
import { findingFingerprint } from "@/lib/bookkeeping/finding-fingerprint"
import { loadInsightsBundle } from "@/lib/bookkeeping/insight-data"
import { serviceLineProfit } from "@/lib/bookkeeping/service-line-profit"
import { vendorSweep } from "@/lib/bookkeeping/vendor-sweep"
import { createGenerationLog, updateGenerationLog } from "@/lib/db/ai-generation-log"
import { listDismissedFingerprints } from "@/lib/db/bookkeeping"
import { reportQuerySchema } from "@/lib/validators/bookkeeping"
import { withTimeout } from "@/lib/with-timeout"

export const maxDuration = 45

const FALLBACK = "AI summary unavailable — the live numbers above are unaffected."

const narrativeSchema = z.object({ observations: z.array(z.string()).min(3).max(5) })

const SYSTEM_PROMPT = [
  "You are a plain-English bookkeeping explainer for a solo athletic-performance coach.",
  "You receive a compact JSON summary of ledger findings for one or more books; all amounts are integer cents.",
  "Write 3-5 short observations in plain words. Cite the real numbers, converted to dollars.",
  "Never give tax or legal advice — every finding is a candidate the accountant confirms.",
  "Do not invent trends the data does not show; if the ledger is nearly empty, say so plainly.",
  "Your output is labeled AI-generated in the UI.",
].join(" ")

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const body = await request.json().catch(() => null)
    const parsed = reportQuerySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    }
    const { from, to } = parsed.data

    const bundle = await loadInsightsBundle(from, to)
    const summaries = await Promise.all(
      bundle.books.map(async (book) => {
        const dismissed = new Set(await listDismissedFingerprints(book.id))
        const bookEntries = bundle.entries.filter((e) => e.book_id === book.id)
        const deductions = deductionFindings(book.id, bundle.entries, bundle.accounts)
        const profit = serviceLineProfit(bookEntries, bundle.accounts)
        const vendors = vendorSweep(bookEntries, bundle.accounts)
        const watchlist = deductions.watchlist.filter(
          (w) => !dismissed.has(findingFingerprint("watchlist", w.account_id)),
        )
        const gaps = deductions.substantiation_gaps.filter(
          (g) => !dismissed.has(findingFingerprint("substantiation_gap", g.entry_id)),
        )
        const uncategorized = deductions.uncategorized.entries.filter(
          (u) => !dismissed.has(findingFingerprint("uncategorized", u.entry_id)),
        )
        const recurring = vendors.recurring.filter((v) => !dismissed.has(findingFingerprint("vendor", v.key)))
        return {
          book: book.name,
          kind: book.book_kind,
          watchlist: watchlist.map((w) => ({ name: w.name, total_cents: w.total_cents, entries: w.entry_count })),
          substantiation_gap_count: gaps.length,
          substantiation_gap_cents: gaps.reduce((s, g) => s + g.amount_cents, 0),
          uncategorized_count: uncategorized.length,
          uncategorized_cents: uncategorized.reduce((s, u) => s + u.amount_cents, 0),
          profit: {
            income_total_cents: profit.income_total_cents,
            shared_cost_cents: profit.shared_cost_cents,
            rows: profit.rows.map((r) => ({
              label: r.label,
              income_cents: r.income_cents,
              net_estimate_cents: r.net_estimate_cents,
            })),
          },
          recurring_vendors: recurring.slice(0, 10).map((v) => ({
            name: v.display_name,
            cadence: v.cadence,
            annualized_cents: v.annualized_cents,
          })),
        }
      }),
    )

    const startTime = Date.now()
    let logId: string | null = null
    try {
      const log = await createGenerationLog({
        program_id: null,
        client_id: null,
        requested_by: session.user.id,
        status: "pending",
        input_params: { feature: "bookkeeping_insights_narrative", from, to },
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
        generation_trigger: "bookkeeping_insights_narrative",
      })
      logId = log.id

      const { content, tokens_used, cache_creation_tokens, cache_read_tokens } = await withTimeout(
        callAgent(SYSTEM_PROMPT, JSON.stringify({ from, to, books: summaries }), narrativeSchema, {
          model: MODEL_SONNET,
          maxTokens: 1200,
        }),
        20_000,
        "Insights narrative generation timed out",
      )

      await updateGenerationLog(logId, {
        status: "completed",
        output_summary: { observation_count: content.observations.length },
        tokens_used,
        cache_creation_tokens: cache_creation_tokens ?? null,
        cache_read_tokens: cache_read_tokens ?? null,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
      })

      return NextResponse.json({ observations: content.observations, fallback: null })
    } catch (err) {
      console.error("bookkeeping insights narrative — continuing without AI:", err)
      if (logId) {
        await updateGenerationLog(logId, {
          status: "failed",
          error_message: err instanceof Error ? err.message : "Unknown error",
          duration_ms: Date.now() - startTime,
          completed_at: new Date().toISOString(),
        }).catch(() => {})
      }
      return NextResponse.json({ observations: null, fallback: FALLBACK })
    }
  } catch (error) {
    console.error("bookkeeping insights narrative:", error)
    return NextResponse.json({ error: "Failed to build the narrative" }, { status: 500 })
  }
}
