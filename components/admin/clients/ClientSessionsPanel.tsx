import type React from "react"
import { CalendarClock } from "lucide-react"
import { StandingSlotsPanel } from "@/components/admin/schedule/StandingSlotsPanel"
import { ClientPackagesPanel } from "@/components/admin/packs/ClientPackagesPanel"
import { MembershipPanel } from "@/components/admin/billing/MembershipPanel"
import { SavedCardPanel } from "@/components/admin/billing/SavedCardPanel"
import type { PackWithCheckins } from "@/lib/services/client-packs-view"
import type { RecurringSession, UserPaymentMethod, ClientMembership, MembershipPlan } from "@/types/database"

/**
 * One "Sessions & Billing" card that gathers everything session/money-related for
 * a client into a single place with labeled subsections, instead of four
 * scattered boxes: the schedule (standing slots), prepaid packs, membership
 * (auto-withdrawal), and card on file. Each sub-panel renders `bare` (no card
 * chrome of its own) so they read as sections of one panel.
 */
export function ClientSessionsPanel({
  clientUserId,
  packs,
  showStandingSlots,
  standingSlots,
  showMemberships,
  membership,
  membershipPlans,
  showCardOnFile,
  savedCard,
}: {
  clientUserId: string
  packs: PackWithCheckins[]
  showStandingSlots: boolean
  standingSlots: RecurringSession[]
  showMemberships: boolean
  membership: ClientMembership | null
  membershipPlans: MembershipPlan[]
  showCardOnFile: boolean
  savedCard: UserPaymentMethod | null
}) {
  const sections: React.ReactNode[] = []
  if (showStandingSlots) {
    sections.push(<StandingSlotsPanel key="schedule" clientUserId={clientUserId} slots={standingSlots} bare />)
  }
  // Session packs are always available.
  sections.push(<ClientPackagesPanel key="packs" clientUserId={clientUserId} initialPacks={packs} bare />)
  if (showMemberships) {
    sections.push(
      <MembershipPanel key="membership" clientUserId={clientUserId} membership={membership} plans={membershipPlans} bare />,
    )
  }
  if (showCardOnFile) {
    sections.push(<SavedCardPanel key="card" clientUserId={clientUserId} card={savedCard} bare />)
  }

  return (
    <div className="rounded-xl border border-border bg-white p-6">
      <div className="mb-5 flex items-center gap-2">
        <CalendarClock className="size-5 text-primary" strokeWidth={1.5} />
        <h2 className="text-lg font-semibold text-primary">Sessions &amp; Billing</h2>
      </div>
      <div className="space-y-6">
        {sections.map((section, i) => (
          <div key={i} className={i === 0 ? "" : "border-t border-border pt-6"}>
            {section}
          </div>
        ))}
      </div>
    </div>
  )
}
