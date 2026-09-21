import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { assessmentSubmitSchema } from "@/lib/validators/assessment"
import { getActiveQuestions, getLatestAssessmentResult, createAssessmentResult } from "@/lib/db/assessments"
import { computeAssessmentScores } from "@/lib/assessment-scoring"
import { recordAudit } from "@/lib/audit/record"
import { captureLead } from "@/lib/lead-engine/capture"
import { platformBusinessId } from "@/lib/tenancy/platform"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = assessmentSubmitSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const { assessment_type, answers, feedback } = parsed.data

    // Fetch active questions for scoring
    const questions = await getActiveQuestions()

    // Compute scores
    const { computed_levels, max_difficulty_score } = computeAssessmentScores({
      answers,
      questions,
    })

    // For reassessments, link to the previous assessment
    let previous_assessment_id: string | null = null
    if (assessment_type === "reassessment") {
      const previous = await getLatestAssessmentResult(session.user.id)
      if (previous) {
        previous_assessment_id = previous.id
      }
    }

    // Save result
    const result = await createAssessmentResult({
      user_id: session.user.id,
      assessment_type,
      answers,
      computed_levels,
      max_difficulty_score,
      triggered_program_id: null,
      previous_assessment_id,
      feedback,
      completed_at: new Date().toISOString(),
    })

    // G21 — join the contact spine, MINTING a contact when none exists.
    // Owner ruled 2026-09-21, reversing the 8 Sept attach-only decision.
    //
    // WHY THE OLD RULING FELL, and why this is not a simplification to
    // revert. It reasoned that everyone reaching this route is a registered
    // client rather than a lead, and leaned on an argument that is now
    // FALSE: "`contacts.user_id` has no originating writer anywhere in this
    // repo … a userId-only lookup finds nobody, ever (0 of 170 production
    // contacts have a user_id)". G04 gave the column a writer and backfilled
    // it -- production is 43 of 170, re-verified 2026-09-21.
    //
    // WHAT THIS TRADE COSTS, stated plainly because the obvious reading of
    // the call below is wrong. `captureLead` -> `recordContactEvent` matches
    // candidates on EMAIL AND PHONE ONLY (`findMatchCandidates`,
    // lib/db/contacts.ts). The `userId` passed here does NOT participate in
    // matching -- it only fills `contacts.user_id` once a row is chosen. The
    // attach-only code this replaced used `findContactByIdentifiers`, which
    // DID match on `user_id` first.
    //
    // So there is one case this handles worse than its predecessor: if a
    // client's account email diverges from their contact email, an
    // assessment submission mints a SECOND contact carrying the same
    // `user_id` rather than appending to the existing row. That divergence
    // is reachable -- `PATCH /api/admin/clients/[id]` updates `users.email`
    // and never touches `contacts` -- but it is unreachable in today's data:
    // 0 of the 43 linked contacts have a mismatched email (production,
    // 2026-09-21). It is the same hazard G05 met on the Stripe path and
    // handled there; here it is accepted and written down rather than
    // silently absorbed, because fixing it properly means teaching
    // `recordContactEvent` to match on `user_id`, which changes behaviour
    // for every `captureLead` caller and is not this row's scope.
    //
    // Matching on userId ALONE would be worse still: only 43 of 170
    // contacts are linked, so it would miss 127 people outright.
    //
    // THIS NOW MATCHES app/api/questionnaire/route.ts (G20), which is
    // equally session-gated and already mints. The two routes deliberately
    // disagreeing was documented in both files, in lib/tenancy/platform.ts
    // and in the ledger; that divergence is resolved, not forgotten.
    //
    // MINTING ENROLS NOBODY TODAY, verified against production 2026-09-21:
    // no sequence has `trigger_source = 'assessment'`, and the two
    // null-trigger sequences (`cold_lead_re_engagement`, `sms_repermission`)
    // cannot match because enrolment filters with `.eq`. A sequence that DID
    // trigger on `assessment` would start messaging every submitter the day
    // it was switched on -- that is the thing to check before adding one.
    //
    // `captureLead` never throws (lib/lead-engine/capture.ts swallows and
    // logs its own failures) and returns null rather than raising when there
    // is no identifier to key on. The try/catch does not rely on that
    // promise: a contact write must never cost a submitter the answers they
    // just filled in. Placed AFTER `createAssessmentResult` so the metadata
    // references a row that actually exists.
    try {
      await captureLead({
        source: "assessment",
        email: session.user.email,
        // The account's name, not something typed on this form -- fills a
        // contact that has none, never replaces a name the same person gave
        // a different surface. See `namePatch` in lib/db/contacts.ts.
        name: session.user.name,
        nameFillOnly: true,
        userId: session.user.id,
        // The session carries a userId only; `users` has no `business_id`
        // and there is no per-coach relationship to resolve a client's own
        // tenant from today. Same seam, for the same reason, as the
        // questionnaire submission -- inventoried in lib/tenancy/platform.ts.
        businessId: platformBusinessId(),
        metadata: { assessment_result_id: result.id },
      })
    } catch (err) {
      console.error("[assessment-submit] contact capture failed", (err as Error).message)
    }

    await recordAudit({
      action: "assessment.submitted",
      category: "client_action",
      target: { type: "assessment", id: result.id },
      metadata: {
        answers_count: Object.keys(answers ?? {}).length,
        type: assessment_type ?? null,
        max_difficulty_score,
      },
      request,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error("Assessment submit error:", error)
    return NextResponse.json({ error: "Failed to submit assessment. Please try again." }, { status: 500 })
  }
}
