/**
 * Wall-clock budgets for the long-running generation handlers, and the platform
 * ceilings they have to sit inside.
 *
 * The budget is NOT a performance preference — it is the thing that has to blow
 * BEFORE the platform kills the container, so the catch path still has live time
 * to write status="failed" to Firestore + RTDB and email the coach. When the
 * platform kill lands first the catch never runs and the job is wedged in
 * "processing" forever, unrecoverable because the trigger guard skips
 * non-"pending" docs. That has already happened once here.
 *
 * Two different ceilings apply, depending on how the handler was triggered, so
 * the budget cannot be a single constant:
 *
 *   onDocumentCreated (Eventarc)   540s  — hard cap, deploy rejects more
 *   onTaskDispatched (Cloud Tasks) 1800s — and see DISPATCH_DEADLINE_SECONDS
 *
 * Passing the wrong one is silent: an EVENT-triggered handler given the task
 * budget looks fine until a long run reaches 540s and wedges. Hence two named
 * constants and a handler parameter rather than a default.
 */

/** Budget for the Eventarc path. 540s ceiling, ~90s left for the catch path. */
export const EVENT_TRIGGER_BUDGET_MS = 450_000 // 7.5 min

/**
 * Budget for the Cloud Tasks path. 1800s ceiling, 300s left for the catch path
 * — deliberately more slack than the Eventarc path, because a run that has
 * already spent 25 minutes has more partial state to record.
 */
export const TASK_TRIGGER_BUDGET_MS = 1_500_000 // 25 min

/**
 * Passed on enqueue, and load-bearing. Cloud Tasks cancels the request at its
 * OWN deadline and marks the attempt DEADLINE_EXCEEDED regardless of the
 * function's `timeoutSeconds` — and that deadline **defaults to 10 minutes**.
 * Leave it at the default and a 1500s budget quietly dies at 600s, which reads
 * as the model hanging rather than as a queue setting.
 *
 * 1800s is the documented maximum (the range is 15s to 30 minutes).
 */
export const DISPATCH_DEADLINE_SECONDS = 1800

/** `timeoutSeconds` for the task-queue functions. Matches the Cloud Tasks cap. */
export const TASK_FUNCTION_TIMEOUT_SECONDS = 1800
