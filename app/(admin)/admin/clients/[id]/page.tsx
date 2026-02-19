import Link from "next/link"
import { notFound } from "next/navigation"
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  Calendar,
  Dumbbell,
  CreditCard,
  Target,
  AlertTriangle,
  Ruler,
  Weight,
  Heart,
} from "lucide-react"
import { getUserById } from "@/lib/db/users"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { getAssignments } from "@/lib/db/assignments"
import { getPayments } from "@/lib/db/payments"
import { EmptyState } from "@/components/ui/empty-state"
import type {
  Program,
  ProgramAssignment,
  Payment,
  ClientProfile,
} from "@/types/database"

export const metadata = { title: "Client Detail" }

type AssignmentWithProgram = ProgramAssignment & {
  programs: Program | null
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-success/10 text-success",
  inactive: "bg-muted text-muted-foreground",
  suspended: "bg-destructive/10 text-destructive",
  paused: "bg-warning/10 text-warning",
  completed: "bg-primary/10 text-primary",
  cancelled: "bg-muted text-muted-foreground",
}

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  succeeded: "bg-success/10 text-success",
  pending: "bg-warning/10 text-warning",
  failed: "bg-destructive/10 text-destructive",
  refunded: "bg-muted text-muted-foreground",
}

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-primary/10 text-primary",
  client: "bg-accent/10 text-accent-foreground",
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | null | undefined
}) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="size-4 text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm text-foreground">{value}</p>
      </div>
    </div>
  )
}

function ProfileSection({ profile }: { profile: ClientProfile | null }) {
  if (!profile) {
    return (
      <div className="bg-white rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold text-primary mb-4">Profile</h2>
        <p className="text-sm text-muted-foreground">
          No profile yet. The client has not completed their profile information.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <h2 className="text-lg font-semibold text-primary mb-4">Profile</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
        <InfoRow icon={Dumbbell} label="Sport" value={profile.sport} />
        <InfoRow icon={Target} label="Position" value={profile.position} />
        <InfoRow
          icon={Target}
          label="Experience Level"
          value={
            profile.experience_level
              ? profile.experience_level.charAt(0).toUpperCase() +
                profile.experience_level.slice(1)
              : null
          }
        />
        <InfoRow
          icon={Calendar}
          label="Date of Birth"
          value={profile.date_of_birth ? formatDate(profile.date_of_birth) : null}
        />
        <InfoRow
          icon={User}
          label="Gender"
          value={
            profile.gender
              ? profile.gender === "prefer_not_to_say"
                ? "Prefer not to say"
                : profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1)
              : null
          }
        />
        <InfoRow
          icon={Ruler}
          label="Height"
          value={profile.height_cm ? `${profile.height_cm} cm` : null}
        />
        <InfoRow
          icon={Weight}
          label="Weight"
          value={profile.weight_kg ? `${profile.weight_kg} kg` : null}
        />
        <InfoRow icon={Target} label="Goals" value={profile.goals} />
        <InfoRow
          icon={AlertTriangle}
          label="Injuries"
          value={profile.injuries}
        />
        <InfoRow
          icon={Heart}
          label="Emergency Contact"
          value={
            profile.emergency_contact_name
              ? `${profile.emergency_contact_name}${
                  profile.emergency_contact_phone
                    ? ` (${profile.emergency_contact_phone})`
                    : ""
                }`
              : null
          }
        />
      </div>
      {/* Show fallback if all profile fields are null */}
      {!profile.sport &&
        !profile.position &&
        !profile.experience_level &&
        !profile.date_of_birth &&
        !profile.gender &&
        !profile.height_cm &&
        !profile.weight_kg &&
        !profile.goals &&
        !profile.injuries &&
        !profile.emergency_contact_name && (
          <p className="text-sm text-muted-foreground">
            Profile exists but no details have been filled in yet.
          </p>
        )}
    </div>
  )
}

function ProgramsSection({
  assignments,
}: {
  assignments: AssignmentWithProgram[]
}) {
  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <h2 className="text-lg font-semibold text-primary mb-4">
        Program Assignments
      </h2>
      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No programs assigned to this client yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Program
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Status
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">
                  Start Date
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">
                  End Date
                </th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr
                  key={assignment.id}
                  className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {assignment.programs?.name ?? "Unknown Program"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                        STATUS_COLORS[assignment.status] ??
                        "bg-muted text-muted-foreground"
                      }`}
                    >
                      {assignment.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {formatDate(assignment.start_date)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {assignment.end_date
                      ? formatDate(assignment.end_date)
                      : "Ongoing"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PaymentsSection({ payments }: { payments: Payment[] }) {
  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <h2 className="text-lg font-semibold text-primary mb-4">
        Payment History
      </h2>
      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No payment records for this client yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Date
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Description
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Amount
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr
                  key={payment.id}
                  className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                >
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(payment.created_at)}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {payment.description ?? "Payment"}
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">
                    {formatCurrency(payment.amount_cents)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                        PAYMENT_STATUS_COLORS[payment.status] ??
                        "bg-muted text-muted-foreground"
                      }`}
                    >
                      {payment.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let user
  try {
    user = await getUserById(id)
  } catch {
    notFound()
  }

  const [profile, assignments, payments] = await Promise.all([
    getProfileByUserId(id),
    getAssignments(id),
    getPayments(id),
  ])

  return (
    <div>
      {/* Back link */}
      <Link
        href="/admin/clients"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeft className="size-4" />
        Back to Clients
      </Link>

      {/* Client Header */}
      <div className="bg-white rounded-xl border border-border p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Avatar placeholder */}
          <div className="flex items-center justify-center size-14 rounded-full bg-primary/10 shrink-0">
            <User className="size-7 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-2xl font-semibold text-primary">
                {user.first_name} {user.last_name}
              </h1>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                  STATUS_COLORS[user.status] ?? "bg-muted text-muted-foreground"
                }`}
              >
                {user.status}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                  ROLE_COLORS[user.role] ?? "bg-muted text-muted-foreground"
                }`}
              >
                {user.role}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Mail className="size-3.5" />
                {user.email}
              </span>
              {user.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5" />
                  {user.phone}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="size-3.5" />
                Joined {formatDate(user.created_at)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-6">
        <ProfileSection profile={profile} />
        <ProgramsSection
          assignments={assignments as AssignmentWithProgram[]}
        />
        <PaymentsSection payments={payments} />
      </div>
    </div>
  )
}
