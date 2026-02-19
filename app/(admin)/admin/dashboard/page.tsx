import { LayoutDashboard } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"

export const metadata = { title: "Dashboard" }

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Dashboard</h1>
      <EmptyState
        icon={LayoutDashboard}
        heading="Dashboard coming soon"
        description="Analytics, recent activity, and key metrics will appear here once the platform is fully connected."
      />
    </div>
  )
}
