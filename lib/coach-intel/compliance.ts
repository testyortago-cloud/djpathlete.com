export interface ScheduledAssignmentInput {
  id: string
  scheduled_date: string
}

export interface CompletedSessionInput {
  program_assignment_id: string | null
}

export interface ComplianceResult {
  scheduledCount: number
  completedCount: number
  pct: number // 0-100
}

export function compliance(
  scheduled: ScheduledAssignmentInput[],
  completed: CompletedSessionInput[],
  from: string,
  to: string,
): ComplianceResult {
  const inWindow = scheduled.filter((a) => a.scheduled_date >= from && a.scheduled_date <= to)
  const completedIds = new Set(completed.map((s) => s.program_assignment_id).filter((id): id is string => Boolean(id)))
  const completedCount = inWindow.filter((a) => completedIds.has(a.id)).length
  const scheduledCount = inWindow.length
  const pct = scheduledCount === 0 ? 100 : Math.round((completedCount / scheduledCount) * 100)
  return { scheduledCount, completedCount, pct }
}
