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
//   0. verify the funnel/step pairing, if one was posted — a VERDICT, not a
//      refusal; see the block in POST for why this route diverges there from
//      /api/funnels/submit
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
// THE VISITOR'S RESULT IS RETURNED EVEN IF 3-6 THROW, AND EVEN IF STEP 0
// REFUSES TO VOUCH FOR THE PAGE. They answered twelve questions; neither a
// failure in our marketing plumbing nor a funnel the coach took offline
// mid-quiz is their problem. Steps 3-6 are the only things a step-0 VERDICT
// can cost — a step-0 READ THAT THROWS is a different answer and 500s before
// step 2, costing them the result as well.
//
// NEVER LOG A RAW POSTGREST ERROR. `error.details` embeds the literal email
// address on a unique violation, and the house DAL convention rethrows a raw
// object that is not `instanceof Error` — which the standard cron shell writes
// out as the literal string "[object Object]".
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §4.3

import { NextResponse } from "next/server"
import { submittedTimezone } from "@/lib/validators/timezone"
import { z } from "zod"
import { completeAttempt, getAttempt, getQuizDefinition, setAttemptAlert } from "@/lib/db/quizzes"
import { createSubmission, getFunnelById, getStep } from "@/lib/db/funnels"
import { quizAnswerPayload } from "@/lib/quizzes/answer-payload"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { recordAudit } from "@/lib/audit/record"
import { applyPipelineEvent } from "@/lib/db/pipeline"
import { routeToPipeline } from "@/lib/lead-engine/pipeline-route"
import { sendQuizAlert, shouldAlert } from "@/lib/quizzes/alert"
import { recordContactEvent } from "@/lib/db/contacts"
import { recordConsent } from "@/lib/db/contact-consents"
import { getBusinessSettings } from "@/lib/db/businesses"
import { hasSmsConsentDisplayName, renderSmsConsentWording } from "@/lib/lead-engine/sms-consent-wording"
import { sanitiseAnswers, scoreQuiz } from "@/lib/quizzes/score"
import { quizSubmitterRole } from "@/lib/quizzes/submitter-role"
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
  // G06: see lib/validators/timezone.ts.
  timezone: submittedTimezone,
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

  // THE TENANT IS THE ATTEMPT'S. `quiz_attempts.business_id` was stamped when
  // /api/quiz/progress created the attempt, so every write below — the step
  // and funnel reads just below, the contact, the pipeline card, the settings
  // read, the consent row — lands on the business the attempt belongs to, by
  // construction rather than by several defaults happening to agree. A public
  // route, but NOT a caller of platformBusinessId(): it has a row to inherit
  // from. Resolved here, ahead of the funnel-link check below, rather than
  // where it used to sit (just before `handoff`) — that check reads
  // `lib/db/funnels` too and needs the same value.
  const businessId = attempt.businessId

  // THE PAGE THIS QUIZ CLAIMS TO BE ON HAS TO BE REAL, AND LIVE —
  // BUT THE VISITOR IS NOT THE ONE WHO PAYS FOR IT NOT BEING.
  //
  // The same two checks `/api/funnels/submit` runs (audit 2026-09-13 §3.6):
  // prove the step belongs to the funnel it was posted with, then prove that
  // funnel is published. Without them a direct POST here captured and enrolled
  // a lead for a funnel whose `/go` URL was already 404ing, and could pair one
  // funnel's real stepId with a DIFFERENT, currently-published funnel's
  // funnelId. This route writes the same submission, contact, consent row and
  // pipeline card the form path does, so it needs the same proof.
  //
  // ---------------------------------------------------------------------
  // A VERDICT, NOT A REFUSAL — AND THAT IS WHERE THIS DELIBERATELY DIVERGES
  // FROM `/api/funnels/submit`. DO NOT "FIX" THE ASYMMETRY BACK.
  // ---------------------------------------------------------------------
  // The two routes are not symmetric in what a refusal costs. On the form
  // path the only thing at stake is the coach's lead: the visitor typed a
  // name and an email, and a 404 costs them nothing they wanted. Here the
  // visitor has answered a series of questions and `presentResult` at the
  // bottom of this file IS their output — the readout is the thing they came
  // for, not a by-product of capturing them. Refusing would punish the
  // visitor for something the COACH did (unpublishing the funnel) while they
  // were halfway through.
  //
  // So a failed check records a PROBLEM rather than returning: the attempt
  // still completes, the result still goes back, and what the verdict gates
  // is the funnel-linked lead work in `handoff` — the `funnel_submissions`
  // row, the contact and consent writes, the pipeline card and the enrolment
  // that rides along inside `recordContactEvent`. That is the whole of the
  // §3.6 hazard, and none of it is the visitor's readout.
  //
  // ONLY WHEN BOTH IDS ARE PRESENT. Both are optional on the wire (see the
  // schema above): a quiz island can stand on a page that is not a funnel
  // step, and a page published before those ids shipped posts neither. NO
  // LINK IS NOT A BAD LINK — a standalone submission has nothing to verify,
  // leaves `funnelLinkProblem` null, and reaches the contact spine exactly as
  // it did before this branch. Checking unconditionally would strip every
  // such visitor of their contact record and their enrolment.
  //
  // SAME ORDER AS THE FORM PATH: step read → cross-check → funnel read →
  // published check, with the funnel read skipped entirely once the
  // cross-check has already failed.
  //
  // A THROWN READ IS STILL A 500, and that is not an inconsistency. A throw
  // is an infrastructure fault, not a verdict: it says we do not KNOW whether
  // the link is good, and guessing it either way is wrong in a different
  // direction each time (guess good → the §3.6 hazard is back; guess bad →
  // a real lead on a real live page is silently dropped). Answering 500 lets
  // the client retry the whole submission, which is the only honest move.
  let funnelLinkProblem: string | null = null
  if (body.funnelId && body.stepId) {
    let step: Awaited<ReturnType<typeof getStep>>
    try {
      step = await getStep(businessId, body.stepId)
    } catch (error) {
      logFailure("step read", error, { attemptId: body.attemptId, quizId: body.quizId })
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 })
    }
    if (!step || step.funnel_id !== body.funnelId) {
      funnelLinkProblem = "the step posted with this quiz does not belong to the funnel posted with it"
    } else {
      // Read by `step.funnel_id` — just proven to match `body.funnelId` —
      // rather than trusting the request body's id a second time. The step's
      // `published_version_id` survives an unpublish; only the funnel row
      // says whether the page is live.
      let funnel: Awaited<ReturnType<typeof getFunnelById>>
      try {
        funnel = await getFunnelById(businessId, step.funnel_id)
      } catch (error) {
        logFailure("funnel read", error, { attemptId: body.attemptId, quizId: body.quizId })
        return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 })
      }
      if (!funnel || funnel.status !== "published") {
        funnelLinkProblem = "the funnel this quiz was posted against is not published"
      }
    }
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
  await handoff({ body, definition, result, answers, ip, request, businessId, funnelLinkProblem }).catch(
    (error: unknown) => {
      logFailure("handoff", error, { attemptId: body.attemptId, quizId: body.quizId })
    },
  )

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
  businessId: string
  /** `null` when the funnel link checked out, or when there was none to check. */
  funnelLinkProblem: string | null
}): Promise<void> {
  const { body, definition, result, ip, request, businessId } = input
  const correlation = { attemptId: body.attemptId, quizId: body.quizId }

  // THE VERDICT FROM `POST` GATES EVERYTHING BELOW IT, AND IT IS LOUD.
  //
  // This function IS the lead work — the submission row, the contact and
  // consent writes, the pipeline card, the enrolment inside
  // `recordContactEvent`, and the operator alert that carries the visitor's
  // name, email and phone to the coach. A pairing that could not be trusted
  // withholds ALL of it; that is the whole of audit §3.6. Note the writes
  // below are not funnel-ONLY: for a quiz posted with no funnel ids at all
  // the verdict is null, and everything except the submission row (which has
  // no funnel to file under) runs exactly as it always did.
  //
  // LOGGED, NEVER SILENT. A genuinely misconfigured client — one posting a
  // stale stepId from a cached page, say — would otherwise lose every lead it
  // sends with no signal anywhere that it was happening, which is the same
  // `silent_gate_reads_as_broken` failure this branch exists to remove. The
  // line says which check failed AND that the visitor still got their result,
  // so whoever reads it is not hunting a visitor-facing outage that is not
  // there. `logFailure` rather than a bare console.error: this file's rule is
  // that nothing here ever prints a raw PostgREST object.
  if (input.funnelLinkProblem) {
    logFailure(
      "funnel link check",
      new Error(
        `${input.funnelLinkProblem} — the quiz result was returned to the visitor, and no lead, ` +
          `contact, consent row, pipeline card or alert was recorded`,
      ),
      correlation,
    )
    return
  }

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
      await createSubmission(businessId, {
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

  // G10. Read from THIS quiz's own branch list, not from a constant assumed
  // to apply to every quiz — see lib/quizzes/submitter-role.ts.
  const submitterRole = quizSubmitterRole(
    definition.branches.map((branch) => branch.key),
    result.branchKey,
  )

  let contactId: string | null = null
  try {
    const contact = await recordContactEvent({
      businessId,
      email: body.email,
      phone: body.phone ?? null,
      name: body.name,
      source: "quiz",
      attributionSessionId: sessionId,
      timezone: body.timezone ?? null,
      // The shape four sequences filter on. `branch` is the contract — see
      // quiz_branches.key — so renaming it silently stops enrolment.
      metadata: {
        quiz_key: definition.key,
        branch: result.branchKey,
        tier: result.tierKey,
        profile: result.profileKey,
        score: result.score,
        attempt_id: body.attemptId,
        // G10. Who is filling this in — but ONLY FROM A QUIZ THAT ASKED, and
        // the key is spread in rather than set, so a quiz that did not ask
        // records nothing at all. `quizSubmitterRole` owns that judgement;
        // its header explains why "not the parent branch, therefore an
        // athlete" is false for the Rotational Performance Index, whose
        // branches are sports.
        //
        // `quiz_key`, `branch` and `tier` above were already allow-listed
        // keys before this row; they now reach
        // `sequence_runs.enrolment_metadata` as well as the trigger filter,
        // with no change here. `profile`, `score` and `attempt_id` are not
        // on the allow-list and stay on the timeline row only.
        ...(submitterRole === null ? {} : { role: submitterRole }),
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
      // Task 3 (spec §3.2): a quiz result always routes to Coaching — this
      // route carries no checkoutType/serviceType to route on — but it still
      // goes through the same routing table as every other event rather than
      // a bare hardcoded key.
      const routing = routeToPipeline({ event: "quiz_result" })
      await applyPipelineEvent({
        businessId,
        contactId,
        event: { kind: "quiz_result", tier: result.tierKey ?? "", occurredAt: new Date() },
        pipelineKey: routing.kind === "routed" ? routing.pipelineKey : undefined,
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
      const { delivered } = await sendQuizAlert({
        // The tenant, not an address. Since G30 the mailer reads this
        // business's own `reply_to`, sender identity and wordmark for itself,
        // so a settings read here would only be a second lookup of the same
        // row -- and a second place that could disagree about which column
        // addresses the coach.
        businessId,
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
      const settings = await getBusinessSettings(businessId)
      // MIRRORS THE ISLAND'S OWN GATE. A blank display name means the checkbox
      // was never shown, so filing a row would misrepresent what the visitor
      // saw. Skipped and logged, never thrown — the lead is already captured.
      if (!hasSmsConsentDisplayName(settings.display_name)) {
        console.warn("[quiz/submit] sms consent skipped: business_settings.display_name is blank")
      } else {
        await recordConsent({
          businessId,
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
