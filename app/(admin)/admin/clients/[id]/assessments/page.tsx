import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ClipboardCheck, Activity, Calendar, Target, Video } from "lucide-react"
import { requireAdmin } from "@/lib/auth-helpers"
import { getUserById } from "@/lib/db/users"
import { getAssessmentResultsByUser } from "@/lib/db/assessments"
import { getPerformanceAssessmentsByClient } from "@/lib/db/performance-assessments"
import type { AbilityLevel } from "@/types/database"

export const metadata = { title: "Client Assessments | Admin | DJP Athlete" }

const LEVEL_COLORS: Record<AbilityLevel, string> = {
  beginner: "bg-warning/10 text-warning",
  intermediate: "bg-primary/10 text-primary",
  advanced: "bg-success/10 text-success",
  elite: "bg-accent/15 text-accent",
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  in_progress: "bg-warning/10 text-warning",
  completed: "bg-success/10 text-success",
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export default async function ClientAssessmentsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params

  let user
  try {
    user = await getUserById(id)
  } catch {
    notFound()
  }

  let assessmentResults: Awaited<ReturnType<typeof getAssessmentResultsByUser>> = []
  let performanceAssessments: Awaited<ReturnType<typeof getPerformanceAssessmentsByClient>> = []

  try {
    ;[assessmentResults, performanceAssessments] = await Promise.all([
      getAssessmentResultsByUser(id),
      getPerformanceAssessmentsByClient(id),
    ])
  } catch {
    // Tables may not exist yet
  }

  return (
    <div>
      {/* Back link */}
      <Link
        href={`/admin/clients/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeft className="size-4" />
        Back to {user.first_name} {user.last_name}
      </Link>

      <h1 className="text-xl sm:text-2xl font-semibold text-primary mb-6">
        Assessments &mdash; {user.first_name} {user.last_name}
      </h1>

      <div className="space-y-6">
        {/* Movement Screen / Ability Level Results */}
        <div className="bg-white rounded-xl border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardCheck className="size-5 text-primary" />
            <h2 className="text-lg font-semibold text-primary">Movement Screen Results</h2>
          </div>

          {assessmentResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">No movement screen results yet.</p>
          ) : (
            <div className="space-y-4">
              {assessmentResults.map((result) => (
                <div key={result.id} className="border border-border rounded-lg p-4">
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Calendar className="size-3.5" />
                      {formatDate(result.completed_at)}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium capitalize">
                      {result.assessment_type}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                        LEVEL_COLORS[result.computed_levels.overall] ?? "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Target className="size-3 mr-1" />
                      Overall: {result.computed_levels.overall}
                    </span>
                  </div>

                  {/* Per-pattern levels */}
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(result.computed_levels)
                      .filter(([key]) => key !== "overall")
                      .map(([pattern, level]) => (
                        <span
                          key={pattern}
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                            LEVEL_COLORS[level] ?? "bg-muted text-muted-foreground"
                          }`}
                        >
                          {pattern.replace(/_/g, " ")}: {level}
                        </span>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Performance Assessments */}
        <div className="bg-white rounded-xl border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="size-5 text-primary" />
            <h2 className="text-lg font-semibold text-primary">Performance Assessments</h2>
          </div>

          {performanceAssessments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No performance assessments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">
                      Notes
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {performanceAssessments.map((pa) => (
                    <tr
                      key={pa.id}
                      className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{pa.title}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                            STATUS_COLORS[pa.status] ?? "bg-muted text-muted-foreground"
                          }`}
                        >
                          {pa.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                        {formatDate(pa.created_at)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell max-w-xs truncate">
                        {pa.notes ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/performance-assessments/${pa.id}`}
                          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                        >
                          <Video className="size-3.5" />
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
