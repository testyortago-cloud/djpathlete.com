/**
 * The pure half of scripts/exit-sequence-run.mjs, split out so the decision
 * of WHETHER a run may be ended by hand — and exactly WHAT is written when it
 * is — can be tested without a database in front of it.
 *
 * A repair script's danger is never the write. It is the selection: this one
 * touches exactly one run, named by id, and only while it is still active.
 */

/**
 * @param {{ run: { id: string, status: string } | null, reason: string, now: string }} args
 * @returns {{ ok: false, why: "not_found" } | { ok: false, why: "not_active", status: string } | { ok: false, why: "no_reason" } | { ok: true, update: Record<string, unknown>, guard: { id: string, status: "active" } }}
 */
export function planExit({ run, reason, now }) {
  // A typo'd id must not read as a no-op success.
  if (!run) return { ok: false, why: "not_found" }

  // Completed, exited and failed runs are left exactly as they are. Only a
  // run the tick could still pick up is worth ending by hand.
  if (run.status !== "active") return { ok: false, why: "not_active", status: run.status }

  const trimmed = typeof reason === "string" ? reason.trim() : ""
  if (!trimmed) return { ok: false, why: "no_reason" }

  // Field for field what `exitRun` (lib/db/sequences.ts) writes, so a run
  // ended here is indistinguishable from one the engine ended — the claim
  // fields are cleared, `completed_at` and `updated_at` are stamped, and the
  // reason lands in `exit_reason` where the reporting screen reads it.
  return {
    ok: true,
    update: {
      status: "exited",
      exit_reason: trimmed,
      completed_at: now,
      claimed_at: null,
      claimed_by: null,
      updated_at: now,
    },
    // The write is guarded on the run STILL being active, so a run that
    // changed underneath the script between the read and the write is
    // skipped, never clobbered.
    guard: { id: run.id, status: "active" },
  }
}
