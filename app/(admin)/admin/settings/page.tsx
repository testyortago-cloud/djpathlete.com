import { Settings } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"

export const metadata = { title: "Settings" }

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Settings</h1>
      <EmptyState
        icon={Settings}
        heading="Settings coming soon"
        description="Account settings, notification preferences, integrations, and platform configuration will be available here."
      />
    </div>
  )
}
