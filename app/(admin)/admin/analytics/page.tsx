import { BarChart3 } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"

export const metadata = { title: "Analytics" }

export default function AnalyticsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Analytics</h1>
      <EmptyState
        icon={BarChart3}
        heading="Analytics coming soon"
        description="Client progress charts, revenue metrics, and engagement analytics will be displayed here."
      />
    </div>
  )
}
