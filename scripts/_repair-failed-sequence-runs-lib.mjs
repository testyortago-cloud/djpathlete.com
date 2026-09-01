/**
 * The pure half of the repair, split out so the predicate deciding WHICH rows
 * get rewritten can be tested without a database in front of it.
 *
 * A repair script's danger is never the write. It is the SELECTION: a filter
 * that quietly widens rewrites rows nobody inspected, and the write itself
 * looks identical either way.
 */

/**
 * The three predicates, all required.
 *
 * A run with no recorded error is SKIPPED rather than assumed to match. "We
 * do not know why this failed" is a different answer from "it failed for the
 * reason we are repairing", and conflating the two is exactly how a repair
 * reaches a run it was never pointed at.
 */
export function selectRepairable(runs, { sequenceKey, errorPattern }) {
  if (!sequenceKey) throw new Error("selectRepairable: sequenceKey is required")
  if (!errorPattern) throw new Error("selectRepairable: errorPattern is required")

  return runs.filter(
    (run) =>
      run.status === "failed" &&
      run.sequence_key === sequenceKey &&
      typeof run.last_error === "string" &&
      run.last_error.includes(errorPattern),
  )
}
