import { User } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"

export const metadata = { title: "Client Detail" }

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Client Detail</h1>
      <EmptyState
        icon={User}
        heading="Client profile coming soon"
        description={`Detailed profile, training history, and progress for client ${id} will be displayed here.`}
        ctaLabel="Back to Clients"
        ctaHref="/admin/clients"
      />
    </div>
  )
}
