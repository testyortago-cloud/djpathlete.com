import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { assessmentSubmitSchema } from "@/lib/validators/assessment"
import { getActiveQuestions, getLatestAssessmentResult, createAssessmentResult } from "@/lib/db/assessments"
import { computeAssessmentScores } from "@/lib/assessment-scoring"
import { recordAudit } from "@/lib/audit/record"
import { findContactByIdentifiers, recordEventForExistingContact } from "@/lib/db/contacts"
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

    // Gap #14: record this on the person's timeline, but ONLY onto a contact
    // that already exists. This route 401s without a session, so everyone
    // who submits is already a registered client, not a lead -- minting a
    // contact row for them (what recordContactEvent would do unconditionally)
    // is a product decision this task does not make. A contact write must
    // never fail an assessment submission, so this is isolated in its own
    // try/catch, the same shape as the Stripe webhook's
    // tryCaptureLeadFromCheckout: catch, log, keep going.
    try {
      const businessId = platformBusinessId()
      // EMAIL, NOT JUST userId: `contacts.user_id` has no originating writer
      // anywhere in this repo -- recordContactEvent's create path never sets
      // it, no route sets it, and the only SQL writes (migrations 00217,
      // 00220, 00238) are merge carry-over of a value nothing could have set
      // in the first place. A userId-only lookup finds nobody, ever (0 of
      // 170 production contacts have a user_id). The contact this ruling
      // relies on -- "a paying client already has a contact row, their
      // Stripe checkout wrote a purchase event" (spec §2.3) -- is keyed by
      // EMAIL. Do not "simplify" this back to userId alone.
      const contactId = await findContactByIdentifiers({
        userId: session.user.id,
        email: session.user.email,
        businessId,
      })
      if (contactId) {
        await recordEventForExistingContact({
          contactId,
          businessId,
          source: "assessment",
          metadata: { assessment_result_id: result.id },
        })
      }
    } catch (err) {
      console.error("[assessment-submit] contact event failed", (err as Error).message)
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
