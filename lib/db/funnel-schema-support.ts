// lib/db/funnel-schema-support.ts — does this database have migration 00210?
//
// WHY THIS EXISTS. `.github/workflows/apply-migrations.yml` documents the
// constraint in its own words:
//
//   "Vercel also builds on push to main, and nothing sequences the two. A push
//    whose code reads a column its own migration adds can deploy before the
//    column exists. Keep migrations additive and let code tolerate the old
//    schema for one deploy."
//
// 00210 is additive. This is the other half — the tolerating.
//
// The deploy race is not even the common case. `.env.local` points at a stale
// CLONE that has never seen 00210 and never will until someone applies it
// there, so without this every funnel AND landing page create fails locally.
// The blast radius is wider than the feature: `CreatePageDialog` calls the same
// `createFunnel`.
//
// The degraded path is not a special mode — it is EXACTLY the insert this
// function performed before 00210, so a funnel created during the window is a
// pre-template funnel and behaves like every other one.

/**
 * The column probed for. Any column 00210 adds would do; `template` is chosen
 * because it is the one whose absence changes behaviour most visibly (no
 * template means no lazy per-step drafting), so a probe that is somehow wrong
 * about it is wrong about the thing most likely to be noticed.
 *
 * One probe covers `funnel_steps.goal` too: the same migration adds both, and
 * the ledger applies a migration as one transaction, so they cannot land apart.
 */
export const INTAKE_PROBE_COLUMN = "template"

/** How long a NEGATIVE answer is trusted before re-probing. */
const RECHECK_MS = 30_000

let present: boolean | null = null
let lastProbeAt = 0

/** Test seam. Never called by application code. */
export function __resetIntakeColumnCache(): void {
  present = null
  lastProbeAt = 0
}

interface ProbeOptions {
  /** Injectable clock, so the re-probe window is testable without waiting. */
  now?: number
}

/**
 * True when this database has the 00210 intake columns.
 *
 * CACHING IS ASYMMETRIC, ON PURPOSE:
 *
 * - `true` is cached forever. A column cannot disappear, and probing per create
 *   would put an extra round trip on every funnel for the rest of time.
 * - `false` is cached for `RECHECK_MS` only. The migration lands roughly 15
 *   seconds after the deploy that races it, and a warm serverless instance can
 *   live for hours — so caching "absent" permanently would strand that instance
 *   serving degraded funnels long after the schema caught up.
 *
 * IT NEVER THROWS, AND IT FAILS TOWARDS "ABSENT". A transient error resolving
 * to "present" would mean a 500 on the next insert; resolving to "absent" means
 * the pre-00210 insert, which works against either schema. The cost of being
 * wrong is asymmetric, so the default is.
 */
export async function hasIntakeColumns(
  supabase: { from: (table: string) => { select: (columns: string) => { limit: (n: number) => unknown } } },
  options: ProbeOptions = {},
): Promise<boolean> {
  const now = options.now ?? Date.now()
  if (present === true) return true
  if (present === false && now - lastProbeAt < RECHECK_MS) return false

  lastProbeAt = now
  try {
    const result = (await supabase.from("funnels").select(INTAKE_PROBE_COLUMN).limit(1)) as {
      error: { code?: string; message?: string } | null
    }
    present = !result?.error
    if (!present) {
      console.warn(
        `[funnels] migration 00210 not applied to this database (${result?.error?.message ?? "unknown"}). ` +
          "Creating funnels without template/intake columns until it lands.",
      )
    }
  } catch (error) {
    console.warn("[funnels] could not probe for migration 00210 — assuming absent:", error)
    present = false
  }
  return present
}
