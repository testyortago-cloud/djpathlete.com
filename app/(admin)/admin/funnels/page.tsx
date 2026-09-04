// The funnels screen. Multi-step sequences only — single landing pages live at
// /admin/pages and render the same board with kind="page".

import Link from "next/link"
import { Workflow } from "lucide-react"
import { listFunnels, listSteps, getSubmissionCountsByFunnel } from "@/lib/db/funnels"
import { getQuizAttemptCounts, getQuizzesByIds } from "@/lib/db/quizzes"
import { quizIdByStep } from "@/lib/funnels/quiz-refs"
import { FunnelList, type FunnelWithSteps } from "@/components/admin/funnels/FunnelList"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"

export const metadata = { title: "Funnels" }

export default async function FunnelsScreen() {
  const { businessId } = await resolveAdminTenant()
  const funnels = await listFunnels({ kind: "funnel" })

  const [leadCounts, stepsPerFunnel] = await Promise.all([
    getSubmissionCountsByFunnel().catch(() => ({}) as Record<string, number>),
    Promise.all(funnels.map((funnel) => listSteps(funnel.id).catch(() => []))),
  ])

  // ONE CARD PER FUNNEL, and its steps are a list inside that card.
  //
  // This used to flatten to one card per PAGE, with the funnel demoted to a
  // filter chip above them. The owner's report: "why connected funnels is not
  // compiled, and also the category filter is wrong its filtering the name."
  // Both halves were that one decision — a three-step funnel was three loose
  // cards, the funnel had no card of its own, and the chips were funnel NAMES
  // doing duty as categories.
  //
  // It also left this screen contradicting the model underneath it: publishing
  // and background drafting are both funnel-level operations now.
  const withSteps: FunnelWithSteps[] = funnels.map((funnel, index) => ({
    funnel,
    steps: stepsPerFunnel[index],
  }))

  // THE QUIZ EACH FUNNEL RUNS, so it is reached from the funnel that runs it.
  //
  // THERE IS NO QUIZZES SCREEN. A quiz is not a sibling of a funnel; it is
  // something a funnel can run, the way a funnel can take a payment. That is a
  // white-label requirement as much as a tidiness one -- a customer whose work
  // has no quizzes must never meet the word -- so the only quiz surface is a
  // control on the card of a funnel that actually has one.
  //
  // Read from the steps ALREADY LOADED above: `project_data` holds the pointer,
  // so no extra query answers this. A FAILED quiz read degrades to no button
  // rather than taking the board down -- losing the whole funnels screen
  // because the quizzes table was unreachable would trade the screen for a
  // button. Same rule the landing-pages board follows.
  // PER STEP, NOT `quizUsesInSteps`. That helper dedupes across everything it
  // is given, so two funnels sharing one quiz yield ONE entry and the second
  // card loses its Quiz button and its delete warning. Demonstrated against the
  // running app, not guessed.
  const quizByStep = quizIdByStep(stepsPerFunnel.flat())
  const quizIds = [...new Set(quizByStep.values())]
  const quizRows = quizIds.length > 0 ? await getQuizzesByIds(businessId, quizIds).catch(() => []) : []
  // HOW MANY PEOPLE HAVE ANSWERED IT, for the delete confirmation. Deleting a
  // quiz cascades `quiz_attempts`, and that is the last copy of those answers --
  // `funnel_submissions` cascades away with the funnel itself. The owner is
  // told the number before the irreversible part, so a failed count degrades to
  // no number rather than to a wrong one.
  const attemptCounts: Awaited<ReturnType<typeof getQuizAttemptCounts>> =
    quizIds.length > 0
      ? await getQuizAttemptCounts(businessId).catch(() => ({}) as Awaited<ReturnType<typeof getQuizAttemptCounts>>)
      : {}
  const quizByStepId: Record<string, { id: string; name: string; attempts?: number }> = {}
  for (const [stepId, quizId] of quizByStep) {
    const quiz = quizRows.find((row) => row.id === quizId)
    // A block pointing at a deleted quiz offers no button: there is nothing to
    // open, and a dead link is worse than no link.
    if (quiz) {
      quizByStepId[stepId] = { id: quiz.id, name: quiz.name, attempts: attemptCounts[quiz.id]?.total }
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Funnels</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {/* NO "ALL QUIZZES" LINK, AND NO SCREEN BEHIND IT. It used to sit
                here so that a quiz no funnel used yet was not reachable only by
                URL. That was solving the wrong problem: a quiz cannot come into
                existence without a funnel — `POST /api/admin/funnels` with the
                quiz template creates the pair in one call, and deletes the quiz
                if the funnel insert fails — so "a quiz no funnel uses" is not a
                state the product can reach forwards. It is reachable BACKWARDS,
                by deleting a funnel, because `deleteFunnel` leaves the quiz
                behind. That is a real hole and it is tracked; a list screen was
                a signpost to it, not a fix, and it cost every customer a
                permanent top-level concept they may have no use for. */}
            Multi-step sequences sharing one address.{" "}
            <Link href="/admin/funnels/guide" className="underline underline-offset-2 hover:text-primary">
              How funnels work
            </Link>
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <Workflow className="size-5 text-accent" />
        </div>
      </div>

      <FunnelList funnels={withSteps} leadCounts={leadCounts} quizByStepId={quizByStepId} />
    </div>
  )
}
