import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getPerformanceAssessmentsByClient } from "@/lib/db/performance-assessments"
import Link from "next/link"
import { MessageSquare, CheckCircle2, ClipboardCheck } from "lucide-react"
import { cn } from "@/lib/utils"

export const metadata = { title: "Performance Assessments | DJP Athlete" }

export default async function ClientPerformanceAssessmentsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  let assessments: Awaited<ReturnType<typeof getPerformanceAssessmentsByClient>> = []

  try {
    assessments = await getPerformanceAssessmentsByClient(session.user.id)
  } catch {
    // Tables may not exist yet
  }

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-semibold text-primary mb-5">
        Performance Assessments
      </h1>

      {assessments.length === 0 ? (
        <div className="text-center py-16">
          <ClipboardCheck className="size-12 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            No assessments yet. Your coach will create one for you.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {assessments.map((assessment) => (
            <Link
              key={assessment.id}
              href={`/client/performance-assessments/${assessment.id}`}
              className="flex items-center justify-between p-4 bg-white rounded-xl border border-border hover:border-primary/20 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {assessment.title}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(assessment.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ml-3",
                  assessment.status === "in_progress"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-green-100 text-green-700"
                )}
              >
                {assessment.status === "in_progress" ? (
                  <><MessageSquare className="size-3.5" /> In Progress</>
                ) : (
                  <><CheckCircle2 className="size-3.5" /> Completed</>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
