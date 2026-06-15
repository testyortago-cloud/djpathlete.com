import { requireAdmin } from "@/lib/auth-helpers"
import {
  getAllPerformanceAssessments,
  getPerformanceAssessmentCounts,
  listAssessmentTemplates,
} from "@/lib/db/performance-assessments"
import { getUsers } from "@/lib/db/users"
import { PerformanceAssessmentList } from "@/components/admin/PerformanceAssessmentList"
import {
  AssessmentTemplatesPanel,
  type TemplateItem,
  type TemplateClient,
} from "@/components/admin/AssessmentTemplatesPanel"
import type { User } from "@/types/database"

export const metadata = { title: "Performance Assessments | Admin | DJP Athlete" }

export default async function AdminPerformanceAssessmentsPage() {
  await requireAdmin()

  let assessments: Awaited<ReturnType<typeof getAllPerformanceAssessments>> = []
  let counts = { draft: 0, in_progress: 0, completed: 0, total: 0 }
  let templates: TemplateItem[] = []
  let clients: TemplateClient[] = []

  try {
    const [a, c, t, users] = await Promise.all([
      getAllPerformanceAssessments(),
      getPerformanceAssessmentCounts(),
      listAssessmentTemplates(),
      getUsers(),
    ])
    assessments = a
    counts = c
    templates = (t as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      template_name: (row.template_name as string | null) ?? null,
      exerciseCount:
        (row.performance_assessment_exercises as Array<{ count: number }> | undefined)?.[0]?.count ?? 0,
    }))
    clients = (users as User[])
      .filter((u) => u.role === "client")
      .map((u) => ({ id: u.id, first_name: u.first_name, last_name: u.last_name, email: u.email }))
  } catch {
    // Tables may not exist yet
  }

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-semibold text-primary mb-5">Performance Assessments</h1>
      <AssessmentTemplatesPanel templates={templates} clients={clients} />
      <PerformanceAssessmentList assessments={assessments} counts={counts} />
    </div>
  )
}
