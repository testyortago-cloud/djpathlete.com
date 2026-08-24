import { notFound } from "next/navigation"
import { getQuizDefinition } from "@/lib/db/quizzes"
import { QuizEditor } from "@/components/admin/quizzes/QuizEditor"

export const metadata = { title: "Edit quiz" }

export default async function QuizEditorScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const quiz = await getQuizDefinition(id)
  if (!quiz) notFound()
  return <QuizEditor initial={quiz} />
}
