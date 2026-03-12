import { requireAdmin } from "@/lib/auth-helpers"
import {
  getAllPerformanceAssessments,
  getPerformanceAssessmentCounts,
} from "@/lib/db/performance-assessments"
import { PerformanceAssessmentList } from "@/components/admin/PerformanceAssessmentList"

export const metadata = { title: "Performance Assessments | Admin | DJP Athlete" }

export default async function AdminPerformanceAssessmentsPage() {
  await requireAdmin()

  let assessments: Awaited<ReturnType<typeof getAllPerformanceAssessments>> = []
  let counts = { draft: 0, in_progress: 0, completed: 0, total: 0 }

  try {
    ;[assessments, counts] = await Promise.all([
      getAllPerformanceAssessments(),
      getPerformanceAssessmentCounts(),
    ])
  } catch {
    // Tables may not exist yet
  }

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-semibold text-primary mb-5">
        Performance Assessments
      </h1>
      <PerformanceAssessmentList assessments={assessments} counts={counts} />
    </div>
  )
}
