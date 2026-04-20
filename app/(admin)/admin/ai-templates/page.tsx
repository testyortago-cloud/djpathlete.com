import { requireAdmin } from "@/lib/auth-helpers"
import { TemplatesTable } from "@/components/admin/ai-templates/templates-table"

export const metadata = { title: "AI Templates | Admin | DJP Athlete" }

export default async function AiTemplatesPage() {
  await requireAdmin()

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary">AI Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage coach-instruction templates used by the AI Generate Week/Day dialogs.
          </p>
        </div>
      </div>

      <TemplatesTable />
    </div>
  )
}
