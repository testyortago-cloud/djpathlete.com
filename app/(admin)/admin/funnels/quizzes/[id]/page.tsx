import { notFound } from "next/navigation"
import { getAnsweredQuestionIds, getQuizDefinitionForEditor } from "@/lib/db/quizzes"
import { QuizEditor } from "@/components/admin/quizzes/QuizEditor"

export const metadata = { title: "Edit quiz" }

export default async function QuizEditorScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // THE EDITOR'S READ. `getQuizDefinition` filters out inactive questions,
  // which is right for the walk and wrong here: a retired question would be
  // invisible to the person who retired it, with no way to bring it back.
  const quiz = await getQuizDefinitionForEditor(id)
  if (!quiz) notFound()
  // Which inactive questions are RETIRED rather than simply not turned on yet.
  // Both are `is_active = false`; only the answers tell them apart.
  const answered = await getAnsweredQuestionIds(id).catch(() => [] as string[])
  return <QuizEditor initial={quiz} initialAnsweredQuestionIds={answered} />
}
