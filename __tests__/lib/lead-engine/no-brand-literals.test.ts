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
  // Stage 2 SMS — Task 8's seeded sms copy for the three draft sequences,
  // plus the new_lead_nurture comment block (the sweep scans raw file text,
  // comments included, so a brand word hiding in the runbook comment is
  // caught the same as one in a live INSERT).
  "supabase/migrations/00222_lead_engine_seed_sms_steps.sql",
  // Stage 4, Task 9 — the sms_repermission draft sequence's single email ask.
  "supabase/migrations/00223_lead_engine_repermission_sequence.sql",
  // The same ask, rewritten to offer the consent link 00223 could not offer,
  // plus the public page that link lands on. The page is copy a contact
  // reads while deciding whether to trust this business with their phone
  // number — the last place a hardcoded operator brand belongs.
  "supabase/migrations/00226_repermission_consent_link.sql",
  "app/(marketing)/sms-consent",
  // Stage 1c (pipeline board) — flagged as a gap by both Task 1 and Task 2,
  // left for Task 8 to close.
  "supabase/migrations/00219_lead_engine_pipeline.sql",
  "supabase/migrations/00220_lead_engine_pipeline_merge.sql",
  "lib/db/pipeline.ts",
  "lib/lead-engine/pipeline-move.ts",
  "lib/automation/pipeline-reconcile.ts",
  "lib/automation/campaign-revenue.ts",
  "app/(admin)/admin/pipeline/page.tsx",
  "components/admin/pipeline-board.tsx",
  "app/api/admin/pipeline/move/route.ts",
  // Task 9 — the campaign-to-revenue surface.
  "app/(admin)/admin/insights/campaign-revenue/page.tsx",
  // Stage 2 SMS — the Twilio webhooks (Tasks 4-5) don't exist yet; listed
  // now so they're swept the moment they land. `filesUnder` tolerates a
  // missing path (`throwIfNoEntry: false`), so this is a no-op until then.
  "app/api/webhooks/twilio",
  // Stage 3 — the chat assistant. `lib/lead-engine/chat/*` is already covered
  // recursively by the `lib/lead-engine` root at the top; these are the
  // surfaces that live OUTSIDE it. They are swept for the same reason the
  // rest of the Lead Engine is: this feature answers strangers in the
  // business's own voice, and a hardcoded operator name here would be a
  // second, un-migratable copy of an identity that `getBusinessSettings()`
  // already owns. The two API routes and the migration are included because
  // the sweep reads raw file text — a brand word in a route's comment block
  // or in a seeded SQL string is caught exactly like one in live copy.
  "app/api/ask",
  "app/(marketing)/ask",
  "components/public/AskPanel.tsx",
  "components/public/AskCards.tsx",
  "supabase/migrations/00227_lead_engine_chat.sql",
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
