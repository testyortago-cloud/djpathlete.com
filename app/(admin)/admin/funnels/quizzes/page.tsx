// The quizzes screen. A quiz is a database entity the funnel's `quiz` block
// references by id, so editing one takes effect on every page showing it with
// no re-publish.

import Link from "next/link"
import { ListChecks } from "lucide-react"
import { getQuizAttemptCounts, listQuizzes } from "@/lib/db/quizzes"
import { QuizList, type QuizListItem } from "@/components/admin/quizzes/QuizList"

export const metadata = { title: "Quizzes" }

export default async function QuizzesScreen() {
  const [quizzes, counts] = await Promise.all([
    listQuizzes(),
    // A failed count must not take the page down: the list is still useful
    // without the numbers, and zeroes are visibly different from a blank page.
    getQuizAttemptCounts().catch(() => ({}) as Awaited<ReturnType<typeof getQuizAttemptCounts>>),
  ])

  const items: QuizListItem[] = quizzes.map((quiz) => ({
    ...quiz,
    attempts: counts[quiz.id] ?? { total: 0, completed: 0 },
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

      <QuizList quizzes={items} />
    </div>
  )
}
