// POST /api/quiz/submit — the turn that scores.
//
// THE BROWSER'S NUMBER IS NEVER CONSULTED. The route re-reads the quiz from
// the database and recomputes everything through `scoreQuiz`. A `score` key in
// the request body is not rejected, not sanitised, and not read — there is
// nowhere in this file that reads one, which is why a forged one cannot
// matter. A test sends `score: 100` with worst-case answers and asserts both
// the response and the stored row carry the computed value.
//
// ORDER OF WRITES, AND IT MATTERS (spec §4.3):
//   1. score (pure, no I/O)
//   2. complete the attempt row
//   3. createSubmission — the lead on the funnel, so a completion appears
//      under that funnel's Leads beside its form fills
//   4. recordContactEvent — creates/merges the contact, writes the timeline
//      row, and calls enrollIfTriggered itself
//   5. recordConsent, if a tick was shown and ticked
//   6. pipeline + operator alert, both non-fatally
//   7. return the result
//
// THE VISITOR'S RESULT IS RETURNED EVEN IF 3-6 THROW. They answered twelve
// questions; a failure in our marketing plumbing is not their problem.
//
// NEVER LOG A RAW POSTGREST ERROR. `error.details` embeds the literal email
// address on a unique violation, and the house DAL convention rethrows a raw
// object that is not `instanceof Error` — which the standard cron shell writes
// out as the literal string "[object Object]".
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §4.3

import { NextResponse } from "next/server"
import { z } from "zod"
import { completeAttempt, getAttempt, getQuizDefinition, setAttemptAlert } from "@/lib/db/quizzes"
import { createSubmission } from "@/lib/db/funnels"
import { quizAnswerPayload } from "@/lib/quizzes/answer-payload"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { recordAudit } from "@/lib/audit/record"
import { applyPipelineEvent } from "@/lib/db/pipeline"
import { sendQuizAlert, shouldAlert } from "@/lib/quizzes/alert"
import { recordContactEvent } from "@/lib/db/contacts"
import { recordConsent } from "@/lib/db/contact-consents"
import { getBusinessSettings } from "@/lib/db/businesses"
import { hasSmsConsentDisplayName, renderSmsConsentWording } from "@/lib/lead-engine/sms-consent-wording"
import { sanitiseAnswers, scoreQuiz } from "@/lib/quizzes/score"
import type { QuizDefinition } from "@/lib/quizzes/types"

export const runtime = "nodejs"

/** Bots submit instantly; a person cannot read and answer a quiz this fast. */
const MIN_ELAPSED_MS = 1500

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 5
const recentByIp = new Map<string, number[]>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (recentByIp.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  hits.push(now)
  recentByIp.set(ip, hits)
  if (recentByIp.size > 5000) recentByIp.clear()
  return hits.length > RATE_LIMIT_MAX
}

/** `code` and `message` only. Never the raw object — see the header. */
function logFailure(step: string, error: unknown, correlation: Record<string, string | null>): void {
  const shaped =
    error instanceof Error
      ? { message: error.message }
      : { code: (error as { code?: string })?.code ?? null, message: (error as { message?: string })?.message ?? null }
  console.error(`[quiz/submit] ${step} failed`, { ...correlation, ...shaped })
}

const answerSchema = z.object({ questionId: z.string().uuid(), optionId: z.string().uuid() })

const bodySchema = z.object({
  quizId: z.string().uuid(),
  attemptId: z.string().uuid(),
  answers: z.array(answerSchema).max(200),
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(40).optional(),
  smsConsent: z.boolean().optional().default(false),
  website: z.string().optional(),
  elapsedMs: z.number().optional(),
  attributionSessionId: z.string().max(120).nullish(),
  /**
   * WHERE THE QUIZ WAS TAKEN. `FunnelRenderContext` has carried these to every
   * island since the registry existed; `QuizIsland` passes them to the runner
   * and the runner posts them.
   *
   * BOTH OPTIONAL. A quiz island can stand on a page that is not a funnel
   * step, and a page published before this shipped posts neither. Absent means
   * no submission is written -- see the handoff.
   */
  funnelId: z.string().uuid().optional(),
  stepId: z.string().uuid().optional(),
})

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>
  try {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid submission." }, { status: 400 })
    body = parsed.data
  } catch {
    return NextResponse.json({ error: "Invalid submission." }, { status: 400 })
  }

  // Honeypot. 200 so the bot has no signal it was caught.
  if (body.website && body.website.length > 0) return NextResponse.json({ ok: true })
  if (typeof body.elapsedMs === "number" && body.elapsedMs < MIN_ELAPSED_MS) {
    return NextResponse.json({ ok: true })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many submissions. Please try again shortly." }, { status: 429 })
  }

  const definition = await getQuizDefinition(body.quizId)
  if (!definition || definition.status !== "active") {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  const attempt = await getAttempt(body.attemptId)
  if (!attempt || attempt.quizId !== body.quizId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  // 1. SCORE. Pure, no I/O, and the only source of the numbers below.
  const answers = sanitiseAnswers(definition, body.answers)
  const result = scoreQuiz(definition, answers)

  // 2. COMPLETE THE ATTEMPT. Before the contact write, so a visitor who
  // reloads cannot be scored twice into the pipeline.
  try {
    await completeAttempt({
      attemptId: body.attemptId,
      branchId: result.branchId,
      answers,
      rawScore: result.rawScore,
      maxScore: result.maxScore,
      score: result.score,
      tierKey: result.tierKey,
      profileKey: result.profileKey,
      contactId: null,
    })
  } catch (error) {
    logFailure("completeAttempt", error, { attemptId: body.attemptId, quizId: body.quizId })
    return NextResponse.json({ error: "Could not save your answers." }, { status: 500 })
  }

  // 3-5. EVERYTHING BELOW IS NON-FATAL.
  await handoff({ body, definition, result, answers, ip, request }).catch((error: unknown) => {
    logFailure("handoff", error, { attemptId: body.attemptId, quizId: body.quizId })
  })

  return NextResponse.json(presentResult(definition, result))
}

/**
 * Everything after the score is saved. Detached, and every step inside it is
 * individually guarded, so no single marketing failure costs the visitor the
 * result they spent three minutes earning.
 */
async function handoff(input: {
  body: z.infer<typeof bodySchema>
  definition: QuizDefinition
  result: ReturnType<typeof scoreQuiz>
  answers: { questionId: string; optionId: string }[]
  ip: string
  request: Request
}): Promise<void> {
  const { body, definition, result, ip, request } = input
  const correlation = { attemptId: body.attemptId, quizId: body.quizId }

  // ONE ANSWER TO "WHICH VISIT WAS THIS", shared by the lead and the contact
  // below. The client may send it explicitly; otherwise it is read from the
  // same cookie /api/funnels/submit reads, so a quiz taken on a funnel page
  // joins first-touch reporting exactly as a form fill on that page does.
  const sessionId = body.attributionSessionId ?? parseAttrCookie(request.headers.get("cookie")) ?? null

  // 3. THE LEAD ON THE FUNNEL.
  //
  // The Leads screen reads `funnel_submissions`, and until this existed a
  // finished quiz wrote a contact, a consent row, a timeline event and a
  // pipeline card but no submission -- so somebody who answered every question
  // never appeared under the funnel that asked them.
  //
  // FIRST IN THE HANDOFF, and individually guarded like everything else here:
  // the lead is the thing this route exists to capture, and it should not be
  // lost because the contact spine or the mailer had a bad minute.
  //
  // NO FUNNEL, NO ROW. `funnel_submissions.funnel_id` is NOT NULL and there is
  // no honest value to invent for a quiz that was not taken on a funnel page.
  //
  // `lead_user_id` STAYS NULL, and is not passed at all. The form path mints a
  // `users` row with status 'lead'; the quiz feeds the newer contact spine
  // through `recordContactEvent` below. Minting a second identity from a
  // second path is a merge problem, not a feature.
  if (body.funnelId && body.stepId) {
    try {
      await createSubmission({
        funnel_id: body.funnelId,
        step_id: body.stepId,
        // WHICH quiz, in the column that answers "which form". As far as the
        // inbox is concerned the quiz IS the form on that page; `kind` is what
        // says it was a quiz rather than one.
        form_key: definition.key,
        kind: "quiz",
        quiz_attempt_id: body.attemptId,
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        // WHAT THEY WERE ASKED AND WHAT THEY PICKED. Not the score: that is on
        // the attempt this row points at, and 00204 defines `payload` as the
        // visitor's own answers.
        payload: quizAnswerPayload(definition, input.answers),
        attribution_session_id: sessionId,
        ip_address: ip === "unknown" ? null : ip,
        user_agent: request.headers.get("user-agent"),
      })
      recordAudit({
        action: "funnel.submission_received",
        category: "marketing",
        actor: { id: null, email: body.email, role: "anonymous" },
        metadata: { funnel_id: body.funnelId, form_key: definition.key, kind: "quiz" },
      })
    } catch (error) {
      // A DUPLICATE IS NOT A FAILURE. The partial unique index on
      // `quiz_attempt_id` is what makes one completion one lead, so a
      // resubmitted attempt reaching it means the row is already there.
      if ((error as { code?: string }).code === "23505") {
        console.info("[quiz/submit] lead already recorded for this attempt", correlation)
      } else {
        logFailure("createSubmission", error, correlation)
      }
    }
  }

  let contactId: string | null = null
  try {
    const contact = await recordContactEvent({
      email: body.email,
      phone: body.phone ?? null,
      name: body.name,
      source: "quiz",
      attributionSessionId: sessionId,
      // The shape four sequences filter on. `branch` is the contract — see
      // quiz_branches.key — so renaming it silently stops enrolment.
      metadata: {
        quiz_key: definition.key,
        branch: result.branchKey,
        tier: result.tierKey,
        profile: result.profileKey,
        score: result.score,
        attempt_id: body.attemptId,
      },
    })
    contactId = contact.contactId
  } catch (error) {
    logFailure("recordContactEvent", error, correlation)
  }

  // 5a. THE PIPELINE. Red and Orange open a card; Green and Yellow do not.
  // `decideMove` owns that rule — this route only reports what happened.
  if (contactId) {
    try {
      await applyPipelineEvent({
        contactId,
        event: { kind: "quiz_result", tier: result.tierKey ?? "", occurredAt: new Date() },
        // Carries the attempt id so a replay of the same completion cannot
        // open a second card — `SOURCE_EVENT_ID_KEYS` reads this key.
        metadata: { quiz_attempt_id: body.attemptId, quiz_key: definition.key, tier: result.tierKey },
      })
    } catch (error) {
      logFailure("applyPipelineEvent", error, correlation)
    }
  }

  // 5b. THE OPERATOR ALERT, and the honest record of whether it went.
  if (shouldAlert(result.tierKey)) {
    try {
      const settings = await getBusinessSettings()
      const { delivered } = await sendQuizAlert({
        to: settings.reply_to ?? "",
        definition,
        attemptId: body.attemptId,
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        score: result.score,
        tierKey: result.tierKey,
        profileKey: result.profileKey,
        branchKey: result.branchKey,
      })
      // "The send did not throw" is not "somebody was told". The flag the
      // mailer returns is what lands on the attempt, so /admin/quizzes can
      // show an alert that never left the building as exactly that.
      await setAttemptAlert({ attemptId: body.attemptId, status: delivered ? "sent" : "failed" })
    } catch (error) {
      logFailure("sendQuizAlert", error, correlation)
      await setAttemptAlert({ attemptId: body.attemptId, status: "failed" }).catch(() => {})
    }
  }

  if (contactId && body.smsConsent && body.phone) {
    try {
      const settings = await getBusinessSettings()
      // MIRRORS THE ISLAND'S OWN GATE. A blank display name means the checkbox
      // was never shown, so filing a row would misrepresent what the visitor
      // saw. Skipped and logged, never thrown — the lead is already captured.
      if (!hasSmsConsentDisplayName(settings.display_name)) {
        console.warn("[quiz/submit] sms consent skipped: business_settings.display_name is blank")
      } else {
        await recordConsent({
          contactId,
          channel: "sms",
          granted: true,
          source: "quiz",
          // Re-rendered here from the same function the island used, never
          // relayed from the client: evidence of consent is what was SHOWN.
          wordingShown: renderSmsConsentWording(settings.display_name),
          ip,
          userAgent: request.headers.get("user-agent"),
        })
      }
    } catch (error) {
      logFailure("recordConsent", error, correlation)
    }
  }
}

/** The visitor-facing shape. Carries no weight and no raw total. */
function presentResult(definition: QuizDefinition, result: ReturnType<typeof scoreQuiz>) {
  const tier = definition.tiers.find((candidate) => candidate.key === result.tierKey) ?? null
  const profile = definition.profiles.find((candidate) => candidate.key === result.profileKey) ?? null
  const branch = definition.branches.find((candidate) => candidate.key === result.branchKey) ?? null
  return {
    score: result.score,
    tier: tier
      ? { key: tier.key, headline: tier.headline, body: tier.body, ctaLabel: tier.ctaLabel, ctaHref: tier.ctaHref }
      : null,
    profile: profile ? { key: profile.key, name: profile.name, description: profile.description } : null,
    branch: branch ? { key: branch.key, name: branch.name } : null,
  }
}
