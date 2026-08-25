// The quizzes screen. A quiz is a database entity the funnel's `quiz` block
// references by id, so editing one takes effect on every page showing it with
// no re-publish.
//
// THAT INDIRECTION IS WHY THIS PAGE READS THE FUNNELS AT ALL. A quiz has no
// page of its own, so the only thing its card can preview is the funnel page
// running it — and nothing on the quiz row says which page that is. The answer
// lives inside `funnel_steps.project_data`, which Postgres cannot index for
// this question, so the documents are walked once and inverted in memory.

import Link from "next/link"
import { ListChecks } from "lucide-react"
import { getQuizAttemptCounts, listQuizzes } from "@/lib/db/quizzes"
import { listFunnels, listStepsWithDocuments } from "@/lib/db/funnels"
import { quizPlacements } from "@/lib/funnels/quiz-refs"
import { QuizList, type QuizListItem, type QuizPlacementView } from "@/components/admin/quizzes/QuizList"

export const metadata = { title: "Quizzes" }

export default async function QuizzesScreen() {
  const [quizzes, counts, placements] = await Promise.all([
    listQuizzes(),
    // A failed count must not take the page down: the list is still useful
    // without the numbers, and zeroes are visibly different from a blank page.
    getQuizAttemptCounts().catch(() => ({}) as Awaited<ReturnType<typeof getQuizAttemptCounts>>),
    // A FAILED READ IS REPORTED, NOT SWALLOWED INTO "no page shows this". Both
    // render as a card with no placement, and only one of them is true — see
    // `placementsKnown`. `null` is the failure; a Map is the answer.
    readPlacements(),
  ])

  const items: QuizListItem[] = quizzes.map((quiz) => ({
    ...quiz,
    attempts: counts[quiz.id] ?? { total: 0, completed: 0 },
    placement: placements?.get(quiz.id) ?? null,
  }))

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Quizzes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scored, branching quizzes.{" "}
            <Link href="/admin/funnels" className="underline underline-offset-2 hover:text-primary">
              Back to funnels
            </Link>
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <ListChecks className="size-5 text-accent" />
        </div>
      </div>

      <QuizList quizzes={items} placementsKnown={placements !== null} />
    </div>
  )
}

/**
 * Quiz id -> the page showing it, or `null` when that could not be worked out.
 *
 * Two reads rather than a PostgREST embed, for the reason `lib/db/quizzes.ts`
 * states at the top of the file: an embed answers a refused child read with an
 * empty array, which here would be indistinguishable from "this step has no
 * document" — and that is exactly the confusion this function exists to avoid.
 */
async function readPlacements(): Promise<Map<string, QuizPlacementView> | null> {
  try {
    const [steps, funnels] = await Promise.all([listStepsWithDocuments(), listFunnels()])
    const funnelById = new Map(funnels.map((funnel) => [funnel.id, funnel]))

    const view = new Map<string, QuizPlacementView>()
    for (const [quizId, placement] of quizPlacements(steps)) {
      const funnel = funnelById.get(placement.funnelId)
      // A step whose funnel is missing is dropped rather than rendered with a
      // blank name: the slug is what the preview URL is built from, and there
      // is no honest URL to build without it.
      if (!funnel) continue
      view.set(quizId, {
        funnelId: funnel.id,
        funnelName: funnel.name,
        funnelSlug: funnel.slug,
        funnelKind: funnel.kind,
        funnelStatus: funnel.status,
        stepId: placement.stepId,
        stepName: placement.stepName,
        stepSlug: placement.stepSlug,
        isEntry: placement.isEntry,
        published: placement.published,
      })
    }
    return view
  } catch (error) {
    console.error("[admin/funnels/quizzes] could not read quiz placements", error)
    return null
  }
}
