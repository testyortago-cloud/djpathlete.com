import { buildComplianceFeedback, unmetCount, type InstructionCheck } from "./instruction-check.js"
import { isAbortError } from "../lib/deadline.js"

export interface ComplianceAttempt {
  /** Wall-clock the attempt took, ms. */
  durationMs: number
}

const NO_TIME_NOTE = "There wasn't time to rebuild, so this is the first attempt."
const REBUILD_FAILED_NOTE = "A rebuild was attempted and failed, so this is the first attempt."

function withNote(check: InstructionCheck, note: string): InstructionCheck {
  return { ...check, note: check.note ? `${check.note} ${note}` : note }
}

/**
 * Build once, check it against the coach's instructions, and — only if
 * something is unmet and there is time — rebuild ONCE with the misses as
 * feedback. Keeps the better attempt (ties go to the rebuild).
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
    if (isAbortError(e) || (e as { name?: unknown } | null)?.name === "DeadlineExceededError") throw e
    log?.(`compliance: rebuild failed, keeping first attempt: ${e instanceof Error ? e.message : String(e)}`)
    return { attempt: attempt1, check: withNote(check1, REBUILD_FAILED_NOTE) }
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
