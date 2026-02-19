import { ClipboardList } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"

export const metadata = { title: "Programs" }

export default function ProgramsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Programs</h1>
      <EmptyState
        icon={ClipboardList}
        heading="No programs yet"
        description="Build structured training programs by combining exercises into weekly schedules. Assign programs to clients to track their progress."
        ctaLabel="Create Program"
        ctaHref="/admin/programs/new"
      />
    </div>
  )
}
