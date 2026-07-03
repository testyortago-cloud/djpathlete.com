import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { recurringSessionsEnabled, noShowFeeCents, lateCancelFeeCents, cancelWindowHours } from "@/lib/packs/flags"
import { listFeeCharges } from "@/lib/db/session-fee-charges"
import { FeesManager } from "@/components/admin/billing/FeesManager"

export const metadata = { title: "Session Fees" }

export default async function SessionFeesPage() {
  const session = await auth()
  if (session?.user?.role !== "admin") redirect("/login")
  if (!(await recurringSessionsEnabled())) redirect("/admin/dashboard")

  const [noShow, late, windowH, charges] = await Promise.all([
    noShowFeeCents(),
    lateCancelFeeCents(),
    cancelWindowHours(),
    listFeeCharges(100),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Session Fees</h1>
        <p className="text-sm text-muted-foreground">
          No-show and late-cancellation fees. Charges only fire when the Session fees flag is enabled.
        </p>
      </div>
      <FeesManager
        config={{ noShowFeeCents: noShow, lateCancelFeeCents: late, cancelWindowHours: windowH }}
        charges={charges}
      />
    </div>
  )
}
