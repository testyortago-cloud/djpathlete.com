/**
 * Wall-clock budget for long AI orchestrations.
 *
 * Why this exists: a Cloud Function that exceeds `timeoutSeconds` is HARD-KILLED.
 * The handler's `catch` block never runs, so the ai_jobs doc is never marked
 * "failed" — it stays "processing" forever and the UI spins indefinitely. Worse,
 * the onDocumentCreated guard (`if (job.status !== "pending") return`) means a
 * trigger retry sees "processing" and skips, so the job is unrecoverable.
 *
 * A Deadline gives the orchestration a budget strictly INSIDE the platform
 * timeout. When it blows we abort in-flight Anthropic calls and throw a
 * descriptive error, so the handler's normal catch path writes status="failed"
 * with a real message while the container is still alive.
 *
 * Retry math this defends against (week generation): the selector loop runs 3
 * dedup attempts, each callAgent wraps pRetry({retries: 4}) = 5 tries, and an
 * exhausted primary model falls back to Haiku for another 5 — up to 30 model
 * calls with no upper bound on wall-clock time.
 */

export class DeadlineExceededError extends Error {
  readonly budgetMs: number
  readonly stage: string

  constructor(label: string, stage: string, budgetMs: number) {
    super(
      `${label} exceeded its ${Math.round(budgetMs / 1000)}s time budget${stage ? ` at stage "${stage}"` : ""}. ` +
        `The work was aborted before the platform timeout so the failure could be recorded.`,
    )
    this.name = "DeadlineExceededError"
    this.budgetMs = budgetMs
    this.stage = stage
  }
}

export interface Deadline {
  /** Aborts once the budget is spent. Pass to callAgent so in-flight requests unwind. */
  readonly signal: AbortSignal
  /** Milliseconds left; 0 once blown. */
  remainingMs(): number
  expired(): boolean
  /**
   * Throw if the budget is already spent. Call BEFORE starting an expensive
   * stage so a doomed request is never issued.
   */
  assertLive(stage: string): void
  /** Clear the internal timer. Always call in a finally block. */
  dispose(): void
}

/**
 * @param budgetMs  Wall-clock budget. Must be comfortably below the function's
 *                  `timeoutSeconds` so the catch/notify path has room to run.
 * @param label     Used in the thrown error message (e.g. "Week generation").
 * @param nowFn     Injectable clock for tests.
 */
export function createDeadline(budgetMs: number, label: string, nowFn: () => number = Date.now): Deadline {
  const controller = new AbortController()
  const startedAt = nowFn()

  // The aborted signal wins over the clock. Node can fire the timer a moment
  // before `now - startedAt` reaches the budget (libuv arms timers from its
  // cached loop time), and in that window a clock-only check disagreed with the
  // signal: assertLive did not throw for a request the signal had just killed.
  const remainingMs = () => (controller.signal.aborted ? 0 : Math.max(0, budgetMs - (nowFn() - startedAt)))
  const expired = () => remainingMs() <= 0

  // unref() so a pending timer can never hold the container open past the work.
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), budgetMs)
  ;(timer as unknown as { unref?: () => void }).unref?.()

  return {
    signal: controller.signal,
    remainingMs,
    expired,
    assertLive(stage: string) {
      if (expired()) throw new DeadlineExceededError(label, stage, budgetMs)
    },
    dispose() {
      clearTimeout(timer)
    },
  }
}

/**
 * True for "the caller aborted", from either SDK's APIUserAbortError (the
 * Anthropic one and the OpenAI one OpenRouter calls throw) or a raw
 * fetch/DOMException AbortError.
 *
 * Load-bearing: an aborted request must NEVER be retried and must NEVER trigger
 * the Haiku fallback — both would spend more wall-clock time after the budget is
 * already gone, which is the exact failure this module prevents.
 *
 * WHY THE CONSTRUCTOR NAME. Neither SDK sets `.name` on its error classes, so
 * a real APIUserAbortError reads plain "Error" there. Checking `.name` alone
 * recognised only the fakes this module's tests used to build, and a real
 * abort was retried and fell back past the deadline. The class name is read
 * rather than `instanceof` because `functions/` resolves both SDKs, and an
 * `instanceof` against one module copy is false for an error from another.
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof DeadlineExceededError) return true
  const e = error as { name?: unknown; constructor?: { name?: unknown } } | null
  const name = e?.name
  if (name === "AbortError" || name === "APIUserAbortError" || name === "DeadlineExceededError") return true
  return e?.constructor?.name === "APIUserAbortError"
}
