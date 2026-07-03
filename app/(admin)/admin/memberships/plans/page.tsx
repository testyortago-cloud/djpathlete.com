import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { sessionMembershipsEnabled } from "@/lib/packs/flags"
import { listAllMembershipPlans } from "@/lib/db/membership-plans"
import { MembershipPlansManager } from "@/components/admin/billing/MembershipPlansManager"

export const metadata = { title: "Membership Plans" }

export default async function MembershipPlansPage() {
  const session = await auth()
  if (session?.user?.role !== "admin") redirect("/login")
  if (!(await sessionMembershipsEnabled())) redirect("/admin/dashboard")
  const plans = await listAllMembershipPlans()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Membership Plans</h1>
        <p className="text-sm text-muted-foreground">
          Recurring auto-withdrawal plans for in-person training. Clients are billed weekly or monthly.
        </p>
      </div>
      <MembershipPlansManager initialPlans={plans} />
    </div>
  )
}
