import { Dumbbell } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"

export const metadata = { title: "Exercises" }

export default function ExercisesPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Exercises</h1>
      <EmptyState
        icon={Dumbbell}
        heading="No exercises yet"
        description="Create your exercise library to build training programs. Add exercises with descriptions, videos, and difficulty levels."
        ctaLabel="Add Exercise"
        ctaHref="/admin/exercises/new"
      />
    </div>
  )
}
