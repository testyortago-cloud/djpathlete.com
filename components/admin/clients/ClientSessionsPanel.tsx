import type React from "react"
import { CalendarClock } from "lucide-react"
import { StandingSlotsPanel } from "@/components/admin/schedule/StandingSlotsPanel"
import { ClientPackagesPanel } from "@/components/admin/packs/ClientPackagesPanel"
import { AttendanceArrangementPanel } from "@/components/admin/attendance/AttendanceArrangementPanel"
import { MembershipPanel } from "@/components/admin/billing/MembershipPanel"
import { SavedCardPanel } from "@/components/admin/billing/SavedCardPanel"
import { BillingPayerControl, type PayerCandidate } from "@/components/admin/billing/BillingPayerControl"
import type { PackWithCheckins } from "@/lib/services/client-packs-view"
import type {
  RecurringSession,
  UserPaymentMethod,
  ClientMembership,
  MembershipPlan,
  AttendanceArrangement,
  SessionCheckin,
} from "@/types/database"

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
  slotAssignments,
  showMemberships,
  membership,
  membershipPlans,
  showCardOnFile,
  savedCard,
  currentPayerId,
  payerCandidates,
  payer,
  arrangement,
  arrangementCheckins,
  sessionsThisMonth,
}: {
  clientUserId: string
  packs: PackWithCheckins[]
  showStandingSlots: boolean
  standingSlots: RecurringSession[]
  /** Active assignments for the per-slot "Advances program" link. */
  slotAssignments?: { id: string; label: string }[]
  showMemberships: boolean
  membership: ClientMembership | null
  membershipPlans: MembershipPlan[]
  showCardOnFile: boolean
  savedCard: UserPaymentMethod | null
  currentPayerId: string | null
  payerCandidates: PayerCandidate[]
  payer: { name: string; card: UserPaymentMethod | null } | null
  /** Non-null when this client is coached here but billed by a partner facility. */
  arrangement: AttendanceArrangement | null
  arrangementCheckins: SessionCheckin[]
  sessionsThisMonth: number
}) {
  const sections: React.ReactNode[] = []
  if (showStandingSlots) {
    sections.push(
      <StandingSlotsPanel
        key="schedule"
        clientUserId={clientUserId}
        slots={standingSlots}
        assignments={slotAssignments}
        bare
      />,
    )
  }
  // Session packs are always available.
  sections.push(<ClientPackagesPanel key="packs" clientUserId={clientUserId} initialPacks={packs} bare />)
  // Directly under packs, because it answers the same question the coach came
  // here to ask — "how does this client pay?" — with the other answer: they
  // don't, someone else bills them. Always rendered, so the option to start one
  // is discoverable rather than hidden behind a client who already has one.
  sections.push(
    <AttendanceArrangementPanel
      key="attendance"
      clientUserId={clientUserId}
      arrangement={arrangement}
      checkins={arrangementCheckins}
      sessionsThisMonth={sessionsThisMonth}
      bare
    />,
  )
  if (showMemberships) {
    sections.push(
      <MembershipPanel key="membership" clientUserId={clientUserId} membership={membership} plans={membershipPlans} bare />,
    )
  }
  if (showCardOnFile) {
    sections.push(
      <div key="card" className="space-y-3">
        <SavedCardPanel clientUserId={clientUserId} card={savedCard} payer={payer} bare />
        <BillingPayerControl clientUserId={clientUserId} currentPayerId={currentPayerId} candidates={payerCandidates} />
      </div>,
    )
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
