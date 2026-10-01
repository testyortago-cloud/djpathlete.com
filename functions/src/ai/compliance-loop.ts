import {
  buildComplianceFeedback,
  checkInstructions,
  codeOnlyCheck,
  unmetCount,
  NO_TIME_FOR_AI_NOTE,
  type CheckInput,
  type InstructionCheck,
} from "./instruction-check.js"
import { isAbortError } from "../lib/deadline.js"

export interface ComplianceAttempt {
  /** Wall-clock the attempt took, ms. */
  durationMs: number
}

/**
 * Time held back for saving the kept attempt. Neither the AI judge nor a
 * rebuild may spend it: running out of time must never throw away a finished
 * day that could still have been saved.
 */
export const SAVE_RESERVE_MS = 30_000
/** The AI judge's own ceiling. */
export const JUDGE_TIMEOUT_MS = 30_000
/** Below this, the judge is not worth starting — code checks only. */
export const MIN_JUDGE_MS = 5_000

const NO_TIME_NOTE = "There wasn't time to rebuild, so this is the first attempt."
const REBUILD_FAILED_NOTE = "A rebuild was attempted and failed, so this is the first attempt."
const REBUILD_OUT_OF_TIME_NOTE = "There wasn't time to finish the rebuild, so this is the first attempt."

function withNote(check: InstructionCheck, note: string): InstructionCheck {
  return { ...check, note: check.note ? `${check.note} ${note}` : note }
}

function isOutOfTime(e: unknown): boolean {
  return isAbortError(e) || (e as { name?: unknown } | null)?.name === "DeadlineExceededError"
}

/**
 * Build once, check it against the coach's instructions, and — only if
 * something is unmet and there is time — rebuild ONCE with the misses as
 * feedback. Keeps the better attempt (ties go to the rebuild). If the rebuild
 * or its check runs out of time, the first attempt is kept: a finished day is
 * never thrown away for want of a second one.
 */
export async function runWithComplianceCheck<A extends ComplianceAttempt>(args: {
  build: (feedback: string | null) => Promise<A>
  check: (attempt: A) => Promise<InstructionCheck>
  remainingMs: () => number | null // null = no deadline
  isCancelled: () => Promise<boolean>
  log?: (msg: string) => void
}): Promise<{ attempt: A; check: InstructionCheck }> {
  const { build, check, remainingMs, isCancelled, log } = args

  const attempt1 = await build(null)
  const check1 = await check(attempt1)
  if (check1.status !== "failed") return { attempt: attempt1, check: check1 }

  if (await isCancelled()) return { attempt: attempt1, check: check1 }

  const remaining = remainingMs()
  if (remaining !== null && remaining < 1.3 * attempt1.durationMs) {
    log?.(`compliance: no time to rebuild (${remaining}ms left, first attempt took ${attempt1.durationMs}ms)`)
    return { attempt: attempt1, check: withNote(check1, NO_TIME_NOTE) }
  }

  const rebuildReason = check1.items
    .filter((i) => !i.met)
    .map((i) => `${i.instruction}: ${i.detail}`)
    .join("; ")

  let attempt2: A
  let check2: InstructionCheck
  try {
    attempt2 = await build(buildComplianceFeedback(check1.items))
    check2 = await check(attempt2)
  } catch (e) {
    const outOfTime = isOutOfTime(e)
    log?.(
      `compliance: rebuild ${outOfTime ? "ran out of time" : "failed"}, keeping first attempt: ${e instanceof Error ? e.message : String(e)}`,
    )
    return { attempt: attempt1, check: withNote(check1, outOfTime ? REBUILD_OUT_OF_TIME_NOTE : REBUILD_FAILED_NOTE) }
  }

  const keepSecond = unmetCount(check2) <= unmetCount(check1)
  const kept = keepSecond ? check2 : check1
  log?.(
    `compliance: rebuilt; unmet ${unmetCount(check1)} -> ${unmetCount(check2)}, keeping attempt ${keepSecond ? 2 : 1}`,
  )
  return {
    attempt: keepSecond ? attempt2 : attempt1,
    check: { ...kept, rebuilt: true, rebuild_reason: rebuildReason },
  }
}

/**
 * Check one attempt without eating the save's time. The judge gets at most
 * JUDGE_TIMEOUT_MS and never the last SAVE_RESERVE_MS; with under MIN_JUDGE_MS
 * left for it, only the exact checks run.
 *
 * `keepOnTimeout` is for the FIRST attempt's check: if the deadline still fires
 * mid-judge, the exact checks are returned so that attempt can be saved. A later
 * check rethrows instead, and runWithComplianceCheck keeps the first attempt.
 */
export async function checkWithinBudget(
  input: CheckInput,
  deadline: { signal: AbortSignal; remainingMs(): number } | undefined,
  opts: { keepOnTimeout: boolean },
  run: typeof checkInstructions = checkInstructions,
): Promise<InstructionCheck> {
  const budget = deadline ? Math.min(JUDGE_TIMEOUT_MS, deadline.remainingMs() - SAVE_RESERVE_MS) : JUDGE_TIMEOUT_MS
  if (budget < MIN_JUDGE_MS) return run(input, { skipAi: true })
  try {
    return await run(input, { signal: deadline?.signal, timeoutMs: budget })
  } catch (e) {
    if (opts.keepOnTimeout && (isOutOfTime(e) || deadline?.signal.aborted)) {
      return codeOnlyCheck(input, NO_TIME_FOR_AI_NOTE)
    }
    throw e
  }
}
