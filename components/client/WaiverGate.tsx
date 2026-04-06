import { hasActiveWaiver } from "@/lib/db/consents"
import { getActiveDocument } from "@/lib/db/legal-documents"
import { LiabilityWaiverModal } from "@/components/client/LiabilityWaiverModal"

interface ProgramAssignment {
  id: string
  program_id: string
  programs: { id: string; name: string } | null
}

interface WaiverGateProps {
  userId: string
  assignments: ProgramAssignment[]
  children: React.ReactNode
}

export async function WaiverGate({ userId, assignments, children }: WaiverGateProps) {
  // Find the first assignment that lacks a waiver
  let missingWaiver: ProgramAssignment | null = null

  for (const assignment of assignments) {
    if (!assignment.programs) continue
    try {
      const hasWaiver = await hasActiveWaiver(userId, assignment.program_id)
      if (!hasWaiver) {
        missingWaiver = assignment
        break
      }
    } catch {
      // If waiver check fails, don't block — let the user through
    }
  }

  if (!missingWaiver || !missingWaiver.programs) {
    return <>{children}</>
  }

  // Fetch the waiver content to display
  const waiverDoc = await getActiveDocument("liability_waiver")
  const waiverContent = waiverDoc?.content || "Liability waiver content is being prepared. Please contact support."

  return (
    <LiabilityWaiverModal
      programId={missingWaiver.program_id}
      programName={missingWaiver.programs.name}
      waiverContent={waiverContent}
    />
  )
}
