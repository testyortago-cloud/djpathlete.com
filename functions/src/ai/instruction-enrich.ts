import { z } from "zod"
import { callAgent, MODEL_OPUS_5_5 } from "./anthropic.js"
import { isAbortError } from "../lib/deadline.js"

/**
 * Rewrites a coach's free-text instructions into the shape the program
 * architect reads best, before a week/day generation. Owner's request,
 * 2026-09-30, after "12 exercises … some back and chest but mainly shoulder"
 * produced a one-exercise Monday: the architect and selector each had to guess
 * what "some" and "mainly" meant, and the instruction parser read "back" and
 * "chest" as exercise names.
 *
 * WHAT THE REWRITE MAY TOUCH. It goes to the AGENTS that plan the day and pick
 * exercises. It must never reach extractInstructionIntent — the parser that
 * turns named exercises and equipment into unlock/ban sets — which keeps
 * reading the coach's original words. A rewrite can therefore never unlock an
 * exercise past the equipment filter or ban one the coach did not ban.
 *
 * IT CAN NEVER BLOCK A GENERATION. Every failure — the model, its own time
 * limit, a rewrite that dropped a number the coach wrote — returns the
 * original with a note saying why, and generation carries on. The one
 * exception is the caller's own deadline expiring, which is rethrown: that is
 * the whole generation running out of time, not enrichment's to swallow.
 *
 * The result is shown to the coach ("How the AI read your instructions"), so a
 * misreading is visible instead of silent.
 */

export interface InstructionsUsed {
  /** Exactly what the coach typed. */
  original: string
  /** What the agents were given. null when the original was used as written. */
  enriched: string | null
  /** Model that wrote `enriched`; null when it was not used. */
  model: string | null
  /** Why the original was used as written; null on success. */
  note: string | null
}

export interface EnrichmentContext {
  scope: "day" | "week"
  /** Where this is going, as the coach would say it: "Monday, Week 2" / "Week 5". */
  targetLabel: string
  splitType: string
}

const DEFAULT_TIMEOUT_MS = 60_000

const enrichmentSchema = z.object({ enriched_instructions: z.string() })

const ENRICH_PROMPT = `You rewrite a strength coach's instructions for ONE training day or week so that a program-design AI follows them exactly. You do not design the session yourself.

The program-design AI builds a list of exercise SLOTS. Each slot has a role (warm_up, activation, power, primary_compound, secondary_compound, accessory, isolation, conditioning, cool_down), a movement pattern (push, pull, squat, hinge, lunge, carry, rotation, isometric, locomotion), target muscles, sets, reps, rest, tempo and technique. It reads a line like "3 upper-back pulling" as THREE slots, and it sums per-area lines into the total.

Rewrite rules:
1. Keep every number, range and tempo the coach wrote EXACTLY as written ("2-4 sets", "4-8 reps", "30-90 sec rest", "4-2-4 tempo", "12 exercises"). Never change, round or drop one.
2. When the coach gives a total exercise count AND describes the focus in words ("mainly shoulders, some back and chest"), turn the description into per-area counts that add up to EXACTLY that total. "Mainly" gets at least half; "some" gets a smaller share. Write the total first, then one line per area.
3. When the coach gives no total count, do not invent one.
4. Describe areas by muscles and movement patterns (e.g. "shoulders — overhead pushing and lateral/rear delt work", "upper back — horizontal pulling"). NEVER name specific exercises and NEVER mention equipment the coach did not mention: the client's equipment is decided elsewhere.
5. Never add restrictions, preferences, techniques or goals the coach did not state.
6. Put the prescription on its own line: "Every exercise: <sets>, <reps>, <rest>, <tempo>" using the coach's exact values.
7. If a phrase is ambiguous and none of the rules above resolves it, keep the coach's phrase verbatim rather than guessing.
8. If the instructions are already precise, return them nearly unchanged.

Output only the rewritten instructions: short plain lines, no preamble, no commentary, no markdown headings.`

/** Numbers and ranges ("12", "2-4", "4-2-4", "30-90"), with any dash style. */
const NUMBER_TOKEN = /\d+(?:\s*[-–—]\s*\d+)*/g

const normalizeToken = (t: string) => t.replace(/\s*[-–—]\s*/g, "-")

/**
 * Every number or range in `original` that does not survive into `rewrite`.
 * A range must survive AS a range: "4-8 reps" is not kept by "4 sets of 8".
 */
export function findDroppedNumbers(original: string, rewrite: string): string[] {
  const present = new Set((rewrite.match(NUMBER_TOKEN) ?? []).map(normalizeToken))
  const dropped: string[] = []
  for (const token of (original.match(NUMBER_TOKEN) ?? []).map(normalizeToken)) {
    if (!present.has(token) && !dropped.includes(token)) dropped.push(token)
  }
  return dropped
}

function usedAsWritten(original: string, note: string): InstructionsUsed {
  return { original, enriched: null, model: null, note }
}

export async function enrichCoachInstructions(
  original: string | undefined,
  ctx: EnrichmentContext,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<InstructionsUsed | null> {
  if (!original || original.trim().length === 0) return null

  const own = new AbortController()
  const timer = setTimeout(() => own.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const onOuterAbort = () => own.abort()
  opts.signal?.addEventListener("abort", onOuterAbort)

  const userMessage =
    `This is for ${ctx.scope === "day" ? "a single training day" : "a whole training week"}: ${ctx.targetLabel}. ` +
    `Program split: ${ctx.splitType}.\n\nCoach's instructions:\n${original}`

  try {
    const result = await callAgent(ENRICH_PROMPT, userMessage, enrichmentSchema, {
      model: MODEL_OPUS_5_5,
      maxTokens: 2000,
      effort: "low",
      signal: own.signal,
      allowHaikuFallback: false,
    })
    const enriched = result.content.enriched_instructions.trim()
    if (enriched.length === 0) {
      return usedAsWritten(
        original,
        "The AI rewrite came back empty, so your instructions were used exactly as written.",
      )
    }
    const dropped = findDroppedNumbers(original, enriched)
    if (dropped.length > 0) {
      console.warn(`[instruction-enrich] rewrite dropped ${dropped.join(", ")} — using the original`)
      return usedAsWritten(
        original,
        `The AI rewrite left out ${dropped.join(", ")}, so your instructions were used exactly as written.`,
      )
    }
    return { original, enriched, model: MODEL_OPUS_5_5, note: null }
  } catch (error) {
    // The generation's own deadline, not ours: not enrichment's to swallow.
    if (opts.signal?.aborted) throw error
    const timedOut = own.signal.aborted && isAbortError(error)
    console.warn(
      `[instruction-enrich] ${timedOut ? "timed out" : "failed"} — using the original:`,
      error instanceof Error ? error.message : error,
    )
    return usedAsWritten(
      original,
      timedOut
        ? "The AI rewrite took too long, so your instructions were used exactly as written."
        : "The AI rewrite failed, so your instructions were used exactly as written.",
    )
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener("abort", onOuterAbort)
  }
}
