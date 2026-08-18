// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"

const FORBIDDEN = [/DJP\s*Athlete/i, /\bDarren\b/i, /darrenjpaul\.com/i]

const ROOTS = [
  "lib/lead-engine",
  "lib/automation/sequence-tick.ts",
  "lib/automation/sequence-tick-runner.ts",
  "lib/db/sequences.ts",
  "supabase/migrations/00218_lead_engine_seed_sequences.sql",
]

function filesUnder(p: string): string[] {
  const st = statSync(p, { throwIfNoEntry: false })
  if (!st) return []
  if (st.isFile()) return [p]
  return readdirSync(p).flatMap((child) => filesUnder(join(p, child)))
}

describe("the Lead Engine carries no brand literal", () => {
  it("scans every Lead Engine source file", () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of filesUnder(root)) {
        const text = readFileSync(file, "utf8")
        for (const re of FORBIDDEN) {
          if (re.test(text)) offenders.push(`${file} matched ${re}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("is actually scanning files — a guard against a silently empty sweep", () => {
    // If ROOTS ever stops resolving, the test above passes vacuously. This
    // is the null-vs-empty distinction: "found nothing" and "looked at
    // nothing" must not be the same result.
    expect(filesUnder("lib/lead-engine").length).toBeGreaterThan(3)
  })
})
