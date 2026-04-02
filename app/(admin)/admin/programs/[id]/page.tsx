import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Sparkles, CheckCircle2, AlertTriangle, XCircle } from "lucide-react"
import { getProgramById } from "@/lib/db/programs"
import { getProgramExercises } from "@/lib/db/program-exercises"
import { getExercises } from "@/lib/db/exercises"
import { getClients } from "@/lib/db/users"
import { getActiveAssignmentsForProgram, getFirstActiveAssignmentForProgram } from "@/lib/db/assignments"
import { Badge } from "@/components/ui/badge"
import { ProgramHeader } from "@/components/admin/ProgramHeader"
import { ProgramBuilder } from "@/components/admin/ProgramBuilder"
import { ProgramFeedbackForm } from "@/components/admin/ProgramFeedbackForm"
import { WeekAccessPanel } from "@/components/admin/WeekAccessPanel"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const program = await getProgramById(id)
    return { title: `${program.name} - Program Builder` }
  } catch {
    return { title: "Program Not Found" }
  }
}

export default async function ProgramBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let program
  try {
    program = await getProgramById(id)
  } catch {
    notFound()
  }

  const [programExercises, exercises, clients, activeAssignments, activeAssignment] = await Promise.all([
    getProgramExercises(id),
    getExercises(),
    getClients(),
    getActiveAssignmentsForProgram(id),
    getFirstActiveAssignmentForProgram(id),
  ])

  const assignedUserIds = activeAssignments.map((a) => a.user_id)
  const assignmentMap = Object.fromEntries(activeAssignments.map((a) => [a.user_id, a.id]))
  const assignmentDetails = Object.fromEntries(
    activeAssignments.map((a) => [a.user_id, { id: a.id, start_date: a.start_date, notes: a.notes, payment_status: a.payment_status as import("@/types/database").AssignmentPaymentStatus, expires_at: a.expires_at }])
  )

  const assignmentInfo = activeAssignment
    ? { assignmentId: activeAssignment.id, clientId: activeAssignment.user_id }
    : null

  return (
    <div className="space-y-6">
      <Link
        href="/admin/programs"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" />
        Back to Programs
      </Link>

      <ProgramHeader program={program} clients={clients} assignedUserIds={assignedUserIds} assignmentMap={assignmentMap} assignmentDetails={assignmentDetails} />

      {program.is_ai_generated && program.ai_generation_params && (
        <AiGenerationSummary params={program.ai_generation_params} />
      )}

      <ProgramBuilder
        programId={program.id}
        totalWeeks={program.duration_weeks}
        programExercises={programExercises}
        exercises={exercises}
        assignmentInfo={assignmentInfo}
      />

      {activeAssignments.length > 0 && (
        <WeekAccessPanel
          programId={program.id}
          totalWeeks={program.duration_weeks}
          clientNames={Object.fromEntries(
            clients.map((c) => [c.id, `${c.first_name} ${c.last_name}`.trim()])
          )}
        />
      )}

      {program.is_ai_generated && (
        <div className="bg-white rounded-xl border-2 border-accent/30 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex items-center justify-center size-8 rounded-lg bg-accent/10">
              <Sparkles className="size-4 text-accent" />
            </div>
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground">
                Rate AI-Generated Program
              </h3>
              <p className="text-xs text-muted-foreground">
                Your feedback helps improve future AI generations
              </p>
            </div>
          </div>
          <ProgramFeedbackForm programId={program.id} />
        </div>
      )}
    </div>
  )
}

// ─── AI Generation Summary Card ──────────────────────────────────────────────

function AiGenerationSummary({
  params,
}: {
  params: Record<string, unknown>
}) {
  const validation = params.validation as
    | { pass?: boolean; warnings?: number; errors?: number; issues?: { type: string; category: string; message: string; slot_ref?: string }[] }
    | undefined
  const tokenUsage = params.token_usage as
    | { total?: number; agent1?: number; agent2?: number; agent3?: number; agent4?: number }
    | undefined
  const analysisSummary = params.analysis_summary as
    | { split?: string; periodization?: string; training_age?: string; constraints_count?: number }
    | undefined

  if (!validation) return null

  const isPassing = validation.pass !== false
  const warningCount = validation.warnings ?? 0
  const errorCount = validation.errors ?? 0
  const issues = validation.issues ?? []
  const errors = issues.filter((i) => i.type === "error")
  const warnings = issues.filter((i) => i.type === "warning")

  return (
    <div className="bg-white rounded-xl border border-border p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="size-4 text-accent" />
        <h3 className="text-sm font-heading font-semibold text-foreground">
          AI Generation Details
        </h3>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isPassing ? (
          <Badge className="bg-success/10 text-success border-success/20 gap-1">
            <CheckCircle2 className="size-3" />
            Validation Passed
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="size-3" />
            Validation Failed
          </Badge>
        )}

        {warningCount > 0 && (
          <Badge variant="outline" className="gap-1 text-warning">
            <AlertTriangle className="size-3" />
            {warningCount} warning{warningCount !== 1 ? "s" : ""}
          </Badge>
        )}

        {errorCount > 0 && (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="size-3" />
            {errorCount} error{errorCount !== 1 ? "s" : ""}
          </Badge>
        )}

        {tokenUsage?.total != null && (
          <Badge variant="outline" className="gap-1">
            {tokenUsage.total.toLocaleString()} tokens
          </Badge>
        )}

        {analysisSummary?.training_age && (
          <Badge variant="outline" className="capitalize">
            {analysisSummary.training_age} athlete
          </Badge>
        )}

        {analysisSummary?.constraints_count != null &&
          analysisSummary.constraints_count > 0 && (
            <Badge variant="outline">
              {analysisSummary.constraints_count} constraint{analysisSummary.constraints_count !== 1 ? "s" : ""} applied
            </Badge>
          )}
      </div>

      {issues.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none">
            View {issues.length} validation issue{issues.length !== 1 ? "s" : ""}
          </summary>
          <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
            {errors.map((issue, idx) => (
              <div
                key={`err-${idx}`}
                className="flex items-start gap-1.5 text-xs"
              >
                <XCircle className="size-3 text-destructive shrink-0 mt-0.5" />
                <span>
                  <span className="font-medium text-destructive">{issue.category}</span>
                  <span className="text-muted-foreground"> — {issue.message}</span>
                </span>
              </div>
            ))}
            {warnings.map((issue, idx) => (
              <div
                key={`warn-${idx}`}
                className="flex items-start gap-1.5 text-xs"
              >
                <AlertTriangle className="size-3 text-warning shrink-0 mt-0.5" />
                <span>
                  <span className="font-medium text-warning">{issue.category}</span>
                  <span className="text-muted-foreground"> — {issue.message}</span>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
