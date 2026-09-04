// The landing pages screen. Its twin at /admin/funnels renders THE SAME
// COMPONENT with kind="funnel"; the differences are the filter, the title and
// the vocabulary the board picks up from `kind`.
//
// It used to render `FunnelBoard`, a second board that drew one card per PAGE
// while /admin/funnels drew one per FUNNEL. Two components meant two places for
// a control to live, and a control could exist on one and not the other -- the
// quiz button did exactly that for a day. A landing page holds exactly one
// step, so per-page and per-funnel are the same card here and nothing is lost
// by standardising on the one that serves both.
//
// NOTE: this path is new, so it needed an entry in lib/permissions/registry.ts.
// Unmapped admin paths are denied by default — a screen added without its
// prefix bounces staff who legitimately hold the permission.

import Link from "next/link"
import { LayoutTemplate } from "lucide-react"
import { listFunnels, listSteps, getSubmissionCountsByFunnel } from "@/lib/db/funnels"
import { getQuizAttemptCounts, getQuizzesByIds } from "@/lib/db/quizzes"
import { quizIdByStep } from "@/lib/funnels/quiz-refs"
import { FunnelList, type FunnelWithSteps } from "@/components/admin/funnels/FunnelList"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"

export const metadata = { title: "Landing pages" }

export default async function LandingPagesScreen() {
  const { businessId } = await resolveAdminTenant()
  const funnels = await listFunnels({ kind: "page" })

  const [leadCounts, stepsPerFunnel] = await Promise.all([
    getSubmissionCountsByFunnel().catch(() => ({}) as Record<string, number>),
    Promise.all(funnels.map((funnel) => listSteps(funnel.id).catch(() => []))),
  ])

  const withSteps: FunnelWithSteps[] = funnels.map((funnel, index) => ({
    funnel,
    steps: stepsPerFunnel[index],
  }))

  // THE QUIZ EACH PAGE RUNS, so it can be opened from the page that runs it.
  //
  // A LANDING PAGE HAS NO DETAIL SCREEN -- `/admin/pages/<id>` redirects here
  // by design -- so the funnel settings screen's quiz panel cannot reach a
  // page's quiz. This board IS the screen for a page, which is why go-live,
  // convert and delete all live on the card too.
  //
  // FAILS SOFT. The list of pages is the reason this screen exists; losing it
  // because the quizzes table was unreachable would trade the screen for a
  // button.
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
    // open, and a link to a 404 is worse than no link.
    if (quiz) {
      quizByStepId[stepId] = { id: quiz.id, name: quiz.name, attempts: attemptCounts[quiz.id]?.total }
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Landing pages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One focused page each, published at /go/&lt;slug&gt;.{" "}
            <Link href="/admin/funnels/guide" className="underline underline-offset-2 hover:text-primary">
              How landing pages work
            </Link>
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <LayoutTemplate className="size-5 text-accent" />
        </div>
      </div>

      <FunnelList kind="page" funnels={withSteps} leadCounts={leadCounts} quizByStepId={quizByStepId} />
    </div>
  )
}
