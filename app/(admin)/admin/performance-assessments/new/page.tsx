import { requireAdmin } from "@/lib/auth-helpers"
import { getClients } from "@/lib/db/users"
import { getExercises } from "@/lib/db/exercises"
import { CreatePerformanceAssessmentForm } from "@/components/admin/CreatePerformanceAssessmentForm"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export const metadata = { title: "New Assessment | Admin | DJP Athlete" }

export default async function NewPerformanceAssessmentPage() {
  await requireAdmin()

  const [clients, exercises] = await Promise.all([getClients(), getExercises()])

  return (
    <div>
      <Link
        href="/admin/performance-assessments"
        className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeft className="size-3.5" />
        Back to Assessments
      </Link>

      <h1 className="text-xl sm:text-2xl font-semibold text-primary mb-5">New Performance Assessment</h1>

      <CreatePerformanceAssessmentForm
        clients={clients.map((c) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
        }))}
        exercises={exercises.map((e) => ({ id: e.id, name: e.name }))}
      />
    </div>
  )
}
