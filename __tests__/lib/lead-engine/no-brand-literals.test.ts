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
  // G49 moved that page (it was "app/(marketing)/sms-consent") into its own
  // route group with the unsubscribe page, so this root now sweeps both pages
  // and their layout. The frame both pages wear is swept with them: it is
  // where the business's identity is drawn, so a platform name there would
  // head every business's page.
  "app/(business)",
  "components/public/BusinessFrame.tsx",
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
  // G30 -- the five transactional lead emails, which until 2026-09-23 sent
  // from this platform's own address in this platform's wordmark no matter
  // whose lead they were about. They are swept for the same reason the
  // sequence engine is, and they had to MOVE OUT of lib/email.ts to be
  // sweepable at all: that file is ~2,700 lines of this platform's own
  // athlete-facing mail (password resets, verification, the newsletter),
  // which is correctly branded and can never be pointed at from here.
  //
  // `business-identity.ts` is listed with them because it holds the rule
  // deciding whether a tenant may send and which column addresses their
  // coach. A brand word reaching THAT file would be a default applied to
  // every tenant at once.
  //
  // WHAT THIS SWEEP STILL CANNOT SEE, so that nobody reads a green run as
  // more than it is: it matches operator NAMES, so a platform-owned URL
  // passes it untouched. There is one left, named in lead-alerts.ts --
  // `PLATFORM_BOOKING_LINK`, the booking widget the inquiry auto-reply
  // offers every applicant. It is spelled out in the swept file, rather
  // than imported from outside it, precisely so a reader meets it.
  //
  // lib/email/layout.ts is deliberately NOT swept: it holds the platform's
  // own chrome as the fallback for the ~35 app emails that still want it.
  // What keeps the alerts off that fallback is a type, not a regex --
  // `tenantEmailLayout` cannot be called without a settings row.
  "lib/email/lead-alerts.ts",
  "lib/email/business-identity.ts",
  // The quiz alert's caller. In the sweep because it decides what the
  // operator is told and used to choose the recipient itself.
  "lib/quizzes/alert.ts",
  // G32 -- the starter set of eleven draft sequences every business gets.
  // The eleven JSON literals are the platform's own approved copy, so this
  // migration is exactly where a brand word left in by mistake would reach
  // every future tenant's drafts.
  "supabase/migrations/00279_business_starter_set.sql",
  // G47 -- the built-in quiz, "Athlete Quiz — the original", which any business
  // can clone into its own quiz funnel (`copyFrom: "builtin:rpi"`). Two of its
  // result buttons named the operator until 2026-09-26. The platform's own
  // buttons now live in scripts/seed-athlete-quiz.ts, which is not swept: it
  // seeds only this platform's quiz.
  "lib/quizzes/seed/rpi-athlete-quiz.ts",
  // ...and the page every quiz funnel is created with, whose footer carried the
  // operator's name for every business until the same day.
  "lib/funnels/quiz-funnel-doc.ts",
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

  it("every root still resolves — the guard above only ever covered one of them", () => {
    // THE DEFECT THIS EXISTS FOR. `filesUnder` uses `throwIfNoEntry: false` and
    // returns [] for a path that has moved, and the guard above checked exactly
    // ONE root. So renaming any other file silently removed it from the sweep.
    //
    // Proven, not theorised: renaming components/public/AskCards.tsx to
    // ask-cards.tsx, updating its one import, and planting the operator's real
    // name in visitor-facing copy inside the consult card left all 959 tests
    // green — with the brand literal rendering on the public chat surface.
    //
    // PRE_REGISTERED holds paths deliberately listed before they exist, which
    // the ROOTS comments already do for work not yet landed. Anything else that
    // stops resolving is a file that moved and took its coverage with it.
    const PRE_REGISTERED = new Set(["app/api/webhooks/twilio"])
    const vanished = ROOTS.filter((root) => !PRE_REGISTERED.has(root) && filesUnder(root).length === 0)
    expect(vanished).toEqual([])
  })
})
