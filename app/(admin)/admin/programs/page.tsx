import { BarChart3, Brain, ClipboardCheck, CheckCircle } from "lucide-react"
import { getPrograms } from "@/lib/db/programs"
import { getAssignments, getAssignmentCountsByProgram } from "@/lib/db/assignments"
import { ProgramList } from "@/components/admin/ProgramList"
import type { Program, ProgramAssignment } from "@/types/database"

export const metadata = { title: "Programs" }

export default async function ProgramsPage() {
  const [programs, athleteCounts, assignments] = await Promise.all([
    getPrograms(),
    getAssignmentCountsByProgram(),
    getAssignments(),
  ])

  const progList = programs as Program[]
  const asgList = assignments as ProgramAssignment[]

  const totalPrograms = progList.length
  const aiGenerated = progList.filter((p) => p.is_ai_generated).length
  const activeAssignments = asgList.filter((a) => a.status === "active").length

  // Completion rate
  const completed = asgList.filter((a) => a.status === "completed").length
  const cancelled = asgList.filter((a) => a.status === "cancelled").length
  const completionRate = completed + cancelled > 0 ? Math.round((completed / (completed + cancelled)) * 100) : 0

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Programs</h1>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <BarChart3 className="size-3.5 sm:size-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Programs</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{totalPrograms}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Brain className="size-3.5 sm:size-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">AI-Generated</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{aiGenerated}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-success/10">
            <ClipboardCheck className="size-3.5 sm:size-4 text-success" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Active</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{activeAssignments}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <CheckCircle className="size-3.5 sm:size-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Completion</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{completionRate}%</p>
          </div>
        </div>
      </div>

      <ProgramList programs={programs} athleteCounts={athleteCounts} />
    </div>
  )
}
