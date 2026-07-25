import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

/**
 * Cron budget contract: a functions/ delegator is a PURE fetch wrapper around an
 * internal route, so it must outlive the route it awaits. If the delegator's
 * `timeoutSeconds` is shorter than the route's `maxDuration`, Cloud Functions
 * kills the delegator while the (correctly budgeted) route is still working —
 * the run is reported as a Firebase timeout, and if the platform tears the
 * invocation down on client disconnect the route's `logCronStart` row never
 * gets its `logCronEnd`, leaving a permanently "running" cron_runs row and no
 * `last_success` for the automation-health SLA.
 *
 * Source-text contract rather than a runtime test: `functions/src/index.ts` is a
 * side-effectful registration module (importing it registers ~40 Firebase
 * triggers) and no test imports it, so the only way to pin these two numbers to
 * each other is to read them. No import crosses the functions/ ↔ lib/ boundary.
 */

const repoRoot = path.resolve(__dirname, "../..")

type Pair = {
  cron: string
  timeoutSeconds: number | null
  routeFile: string
  maxDuration: number | null
}

function delegatorRoutePairs(): Pair[] {
  const src = readFileSync(path.join(repoRoot, "functions/src/index.ts"), "utf8")

  // Block boundaries: each `export const X = onSchedule(` up to the next one.
  const starts: { name: string; idx: number }[] = []
  const re = /export const (\w+) = onSchedule\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) starts.push({ name: m[1], idx: m.index })

  const pairs: Pair[] = []
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].idx : src.length
    const block = src.slice(starts[i].idx, end)

    // Only delegators — blocks that POST at an /api/admin/internal/* route.
    const posted = block.match(/\/api\/admin\/internal\/([A-Za-z0-9/_-]+)`/)
    if (!posted) continue

    const routeFile = `app/api/admin/internal/${posted[1]}/route.ts`
    const abs = path.join(repoRoot, routeFile)
    if (!existsSync(abs)) continue

    const timeout = block.match(/timeoutSeconds:\s*(\d+)/)
    const duration = readFileSync(abs, "utf8").match(/export const maxDuration\s*=\s*(\d+)/)

    pairs.push({
      cron: starts[i].name,
      timeoutSeconds: timeout ? Number(timeout[1]) : null,
      routeFile,
      maxDuration: duration ? Number(duration[1]) : null,
    })
  }
  return pairs
}

describe("functions delegator timeoutSeconds >= its route maxDuration", () => {
  const pairs = delegatorRoutePairs()

  it("finds the delegator/route pairs at all (guards the parser itself)", () => {
    expect(pairs.length).toBeGreaterThan(20)
    expect(pairs.map((p) => p.cron)).toContain("bookkeepingPayoutSyncCron")
  })

  it("budgets bookkeepingPayoutSyncCron for the route's full 300s backlog window", () => {
    const pair = pairs.find((p) => p.cron === "bookkeepingPayoutSyncCron")!
    // A cold start has no arrival_date lower bound (Decision A-4) and may walk
    // up to MAX_PAYOUTS_PER_RUN = 200 payouts, each costing an auto-paged
    // balanceTransactions.list plus two upserts — the route is sized at 300s
    // for exactly that, so the delegator must be too.
    expect(pair.maxDuration).toBe(300)
    expect(pair.timeoutSeconds).toBe(300)
  })

  it("holds for every delegator/route pair in functions/src/index.ts", () => {
    const violations = pairs
      .filter(
        (p) =>
          p.timeoutSeconds !== null &&
          p.maxDuration !== null &&
          p.timeoutSeconds < p.maxDuration,
      )
      .map((p) => `${p.cron} timeoutSeconds=${p.timeoutSeconds} < ${p.routeFile} maxDuration=${p.maxDuration}`)

    expect(violations).toEqual([])
  })
})
