import { CreditCard } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"

export const metadata = { title: "Payments" }

export default function PaymentsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Payments</h1>
      <EmptyState
        icon={CreditCard}
        heading="No payments yet"
        description="Payment history and Stripe integration will be available here once billing is connected."
      />
    </div>
  )
}
