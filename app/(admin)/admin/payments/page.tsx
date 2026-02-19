import { getPaymentsWithDetails } from "@/lib/db/payments"
import { PaymentList } from "@/components/admin/PaymentList"

export const metadata = { title: "Payments" }

export default async function PaymentsPage() {
  const payments = await getPaymentsWithDetails()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Payments</h1>
      <PaymentList payments={payments} />
    </div>
  )
}
