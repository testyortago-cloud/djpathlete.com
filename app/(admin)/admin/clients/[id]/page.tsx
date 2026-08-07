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
  ClipboardList,
  ClipboardCheck,
  Clock,
  ThumbsUp,
  Moon,
  Brain,
  Briefcase,
  Zap,
  Ticket,
  LayoutDashboard,
} from "lucide-react"
import { requirePermission } from "@/lib/permissions/guard"
import { canViewClient } from "@/lib/permissions/client-scope"
import { getUserById, getUsers } from "@/lib/db/users"
import { getBillingPayer } from "@/lib/db/client-billing-payers"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { getAssignments } from "@/lib/db/assignments"
import { getPayments } from "@/lib/db/payments"
import { getProgress, getWorkoutStreak } from "@/lib/db/progress"
import { getAchievements } from "@/lib/db/achievements"
import { AdminWeightDisplay } from "@/components/admin/AdminWeightDisplay"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { EmptyState } from "@/components/ui/empty-state"
import { ClientProgressView } from "@/components/admin/ClientProgressView"
import {
  GOAL_LABELS,
  EQUIPMENT_LABELS,
  LEVEL_LABELS,
  DAY_NAMES,
  GENDER_LABELS,
  MOVEMENT_CONFIDENCE_LABELS,
  SLEEP_LABELS,
  STRESS_LABELS,
  OCCUPATION_LABELS,
  TIME_EFFICIENCY_LABELS,
  TECHNIQUE_LABELS,
} from "@/lib/validators/questionnaire"
import { parseProfileSummary, hasQuestionnaireData } from "@/lib/profile-utils"
import { UnassignButton } from "@/components/admin/UnassignButton"
import { EditAssignmentButton } from "@/components/admin/EditAssignmentButton"
import { ClientSessionsPanel } from "@/components/admin/clients/ClientSessionsPanel"
import { ClientCheckinButton } from "@/components/admin/packs/ClientCheckinButton"
import { loadClientPacksView, summarizeClientPacks } from "@/lib/services/client-packs-view"
import { getLeadInquiryByUserId } from "@/lib/db/lead-inquiries"
import QRCode from "qrcode"
import { signPersonalCheckinToken } from "@/lib/qr/checkin-token"
import {
  clientPersonalCheckinEnabled,
  recurringSessionsEnabled,
  cardOnFileEnabled,
  sessionMembershipsEnabled,
} from "@/lib/packs/flags"
import { PersonalCheckinLinkDialog } from "@/components/admin/packs/PersonalCheckinLinkDialog"
import { signAthleteProfileToken } from "@/lib/profile-share/token"
import { listByUser as listPerformanceTests } from "@/lib/db/performance-tests"
import { AthleteProfileLinkDialog } from "@/components/admin/profile-share/AthleteProfileLinkDialog"
import { listRecurringForClient } from "@/lib/db/recurring-sessions"
import { getDefaultPaymentMethod } from "@/lib/db/payment-methods"
import { getActiveMembershipForUser } from "@/lib/db/client-memberships"
import { listActiveMembershipPlans } from "@/lib/db/membership-plans"
import type { RecurringSession, UserPaymentMethod, ClientMembership, MembershipPlan } from "@/types/database"
import { listFavoritesByClient } from "@/lib/db/exercise-favorites"
import { getExercises } from "@/lib/db/exercises"
import { ClientFavoriteExercisesPanel } from "@/components/admin/favorites/ClientFavoriteExercisesPanel"
import { LeadInquiryPanel } from "@/components/admin/clients/LeadInquiryPanel"
import { ClientDetailHeader } from "./ClientDetailHeader"
import type {
  Program,
  ProgramAssignment,
  Payment,
  ClientProfile,
  ExerciseProgress,
  Exercise,
  SetDetail,
} from "@/types/database"

export const metadata = { title: "Client Detail" }

type AssignmentWithProgram = ProgramAssignment & {
  programs: Program | null
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-success/10 text-success",
  lead: "bg-accent/15 text-accent",
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
  client: "bg-accent/15 text-accent",
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
              ? profile.experience_level.charAt(0).toUpperCase() + profile.experience_level.slice(1)
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
        <InfoRow icon={Ruler} label="Height" value={profile.height_cm ? `${profile.height_cm} cm` : null} />
        {profile.weight_kg && (
          <div className="flex items-start gap-3 py-2">
            <Weight className="size-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Weight</p>
              <p className="text-sm text-foreground">
                <AdminWeightDisplay weightKg={profile.weight_kg} />
              </p>
            </div>
          </div>
        )}
        <InfoRow icon={Target} label="Goals" value={profile.goals} />
        <InfoRow icon={AlertTriangle} label="Injuries" value={profile.injuries} />
        <InfoRow
          icon={Heart}
          label="Emergency Contact"
          value={
            profile.emergency_contact_name
              ? `${profile.emergency_contact_name}${
                  profile.emergency_contact_phone ? ` (${profile.emergency_contact_phone})` : ""
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
          <p className="text-sm text-muted-foreground">Profile exists but no details have been filled in yet.</p>
        )}
    </div>
  )
}

function ProgramsSection({
  assignments,
  clientName,
  packByAssignment,
}: {
  assignments: AssignmentWithProgram[]
  clientName: string
  packByAssignment: Map<string, { remaining: number; total: number }>
}) {
  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <h2 className="text-lg font-semibold text-primary mb-4">Program Assignments</h2>
      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No programs assigned to this client yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Program</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">
                  Start Date
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">End Date</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr
                  key={assignment.id}
                  className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    <div className="flex flex-col">
                      <span>{assignment.programs?.name ?? "Unknown Program"}</span>
                      {assignment.status === "active" && packByAssignment.get(assignment.id) && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs font-normal text-accent">
                          <Ticket className="size-3" strokeWidth={1.5} />
                          {packByAssignment.get(assignment.id)!.remaining} / {packByAssignment.get(assignment.id)!.total}{" "}
                          sessions · advances on check-in
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                        STATUS_COLORS[assignment.status] ?? "bg-muted text-muted-foreground"
                      }`}
                    >
                      {assignment.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {formatDate(assignment.start_date)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {assignment.end_date ? formatDate(assignment.end_date) : "Ongoing"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {assignment.status === "active" && (
                      <div className="flex items-center justify-end gap-1">
                        <EditAssignmentButton
                          assignmentId={assignment.id}
                          clientName={clientName}
                          currentStartDate={assignment.start_date}
                          currentNotes={assignment.notes}
                          currentPaymentStatus={assignment.payment_status}
                          currentExpiresAt={assignment.expires_at}
                        />
                        <UnassignButton
                          assignmentId={assignment.id}
                          programName={assignment.programs?.name ?? "this program"}
                        />
                      </div>
                    )}
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

function SectionHeader({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className="size-4 text-muted-foreground" />
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
    </div>
  )
}

function QuestionnaireSection({ profile }: { profile: ClientProfile | null }) {
  if (!profile || !hasQuestionnaireData(profile)) return null

  const summary = parseProfileSummary(profile)

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <h2 className="text-lg font-semibold text-primary mb-6">Questionnaire Responses</h2>
      <div className="space-y-6">
        {/* Goals */}
        {summary.goals.length > 0 && (
          <div>
            <SectionHeader icon={Target} label="Fitness Goals" />
            <div className="flex flex-wrap gap-2">
              {summary.goals.map((goal) => (
                <span
                  key={goal}
                  className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium"
                >
                  {GOAL_LABELS[goal] ?? goal}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* About You */}
        {(summary.dateOfBirth || summary.gender || summary.sport || summary.position) && (
          <div>
            <SectionHeader icon={User} label="About" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
              <InfoRow
                icon={Calendar}
                label="Birth Year"
                value={summary.dateOfBirth ? summary.dateOfBirth.slice(0, 4) : null}
              />
              <InfoRow
                icon={User}
                label="Gender"
                value={summary.gender ? (GENDER_LABELS[summary.gender] ?? summary.gender) : null}
              />
              <InfoRow icon={Dumbbell} label="Sport" value={summary.sport} />
              <InfoRow icon={Target} label="Position" value={summary.position} />
            </div>
          </div>
        )}

        {/* Fitness Level & Training History */}
        <div>
          <SectionHeader icon={Target} label="Fitness Level & History" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
            <InfoRow
              icon={Target}
              label="Experience Level"
              value={
                summary.experienceLevel ? (LEVEL_LABELS[summary.experienceLevel] ?? summary.experienceLevel) : null
              }
            />
            <InfoRow
              icon={Brain}
              label="Movement Confidence"
              value={
                summary.movementConfidence
                  ? (MOVEMENT_CONFIDENCE_LABELS[summary.movementConfidence] ?? summary.movementConfidence)
                  : null
              }
            />
            <InfoRow
              icon={Clock}
              label="Training Experience"
              value={
                summary.trainingYears !== null
                  ? `${summary.trainingYears} year${summary.trainingYears !== 1 ? "s" : ""}`
                  : null
              }
            />
          </div>
          {summary.trainingBackground && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-0.5">Training Background</p>
              <p className="text-sm text-foreground">{summary.trainingBackground}</p>
            </div>
          )}
        </div>

        {/* Recovery & Lifestyle */}
        {(summary.sleepHours || summary.stressLevel || summary.occupationActivityLevel) && (
          <div>
            <SectionHeader icon={Moon} label="Recovery & Lifestyle" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
              <InfoRow
                icon={Moon}
                label="Sleep"
                value={summary.sleepHours ? (SLEEP_LABELS[summary.sleepHours] ?? summary.sleepHours) : null}
              />
              <InfoRow
                icon={Brain}
                label="Stress Level"
                value={summary.stressLevel ? (STRESS_LABELS[summary.stressLevel] ?? summary.stressLevel) : null}
              />
              <InfoRow
                icon={Briefcase}
                label="Occupation Activity"
                value={
                  summary.occupationActivityLevel
                    ? (OCCUPATION_LABELS[summary.occupationActivityLevel] ?? summary.occupationActivityLevel)
                    : null
                }
              />
            </div>
          </div>
        )}

        {/* Injuries */}
        {(summary.injuries || summary.injuryDetails.length > 0) && (
          <div>
            <SectionHeader icon={AlertTriangle} label="Injuries & Limitations" />
            {summary.injuries && <p className="text-sm text-foreground mb-2">{summary.injuries}</p>}
            {summary.injuryDetails.length > 0 && (
              <div className="space-y-1.5">
                {summary.injuryDetails.map((injury, i) => (
                  <div key={i} className="text-sm text-foreground bg-surface/50 rounded-lg px-3 py-2">
                    <span className="font-medium">{injury.area}</span>
                    {injury.side && <span className="text-muted-foreground"> ({injury.side})</span>}
                    {injury.severity && <span className="text-muted-foreground"> &mdash; {injury.severity}</span>}
                    {injury.notes && <span className="text-muted-foreground">: {injury.notes}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Schedule */}
        <div>
          <SectionHeader icon={Calendar} label="Training Schedule" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
            <InfoRow
              icon={Calendar}
              label="Sessions per Week"
              value={
                summary.preferredTrainingDays !== null
                  ? `${summary.preferredTrainingDays} day${summary.preferredTrainingDays !== 1 ? "s" : ""}`
                  : null
              }
            />
            <InfoRow
              icon={Clock}
              label="Session Duration"
              value={summary.preferredSessionMinutes !== null ? `${summary.preferredSessionMinutes} minutes` : null}
            />
            <InfoRow
              icon={Zap}
              label="Time Efficiency"
              value={
                summary.timeEfficiencyPreference
                  ? (TIME_EFFICIENCY_LABELS[summary.timeEfficiencyPreference] ?? summary.timeEfficiencyPreference)
                  : null
              }
            />
          </div>
          {summary.preferredDayNames.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-1.5">Preferred Days</p>
              <div className="flex flex-wrap gap-1.5">
                {summary.preferredDayNames.map((dayNum) => (
                  <span
                    key={dayNum}
                    className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium"
                  >
                    {DAY_NAMES[dayNum - 1] ?? `Day ${dayNum}`}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Equipment */}
        {summary.availableEquipment.length > 0 && (
          <div>
            <SectionHeader icon={Dumbbell} label="Available Equipment" />
            <div className="flex flex-wrap gap-1.5">
              {summary.availableEquipment.map((eq) => (
                <span
                  key={eq}
                  className="inline-flex items-center rounded-full border border-border text-foreground px-2 py-0.5 text-xs"
                >
                  {EQUIPMENT_LABELS[eq] ?? eq}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Exercise Preferences */}
        {(summary.preferredTechniques.length > 0 || summary.likes || summary.dislikes) && (
          <div>
            <SectionHeader icon={ThumbsUp} label="Exercise Preferences" />
            {summary.preferredTechniques.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-muted-foreground mb-1.5">Preferred Techniques</p>
                <div className="flex flex-wrap gap-1.5">
                  {summary.preferredTechniques.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center rounded-full border border-border text-foreground px-2 py-0.5 text-xs"
                    >
                      {TECHNIQUE_LABELS[t] ?? t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              {summary.likes && (
                <p className="text-sm text-foreground">
                  <span className="text-muted-foreground font-medium">Likes:</span> {summary.likes}
                </p>
              )}
              {summary.dislikes && (
                <p className="text-sm text-foreground">
                  <span className="text-muted-foreground font-medium">Dislikes:</span> {summary.dislikes}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Additional Notes */}
        {summary.notes && (
          <div>
            <SectionHeader icon={ClipboardList} label="Additional Notes" />
            <p className="text-sm text-foreground">{summary.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function PaymentsSection({ payments }: { payments: Payment[] }) {
  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <h2 className="text-lg font-semibold text-primary mb-4">Payment History</h2>
      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payment records for this client yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr
                  key={payment.id}
                  className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                >
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(payment.created_at)}</td>
                  <td className="px-4 py-3 text-foreground">{payment.description ?? "Payment"}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{formatCurrency(payment.amount_cents)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                        PAYMENT_STATUS_COLORS[payment.status] ?? "bg-muted text-muted-foreground"
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

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requirePermission("clients")

  // A staff member reaching an unassigned client gets the same 404 as a client
  // that doesn't exist — confirming "this id is real, you just can't see it"
  // would leak the roster one guess at a time.
  const visible = await canViewClient(
    { id: session.user.id, role: session.user.role, permissions: session.user.permissions ?? {} },
    id,
  )
  if (!visible) notFound()

  let user
  try {
    user = await getUserById(id)
  } catch {
    notFound()
  }

  const [profile, assignments, payments, progressData, achievements, workoutStreak, packs, favorites, allExercises, leadInquiry] = await Promise.all([
    getProfileByUserId(id),
    getAssignments(id),
    getPayments(id),
    getProgress(id),
    getAchievements(id),
    getWorkoutStreak(id),
    loadClientPacksView(id),
    listFavoritesByClient(id).catch(() => []),
    getExercises().catch(() => []),
    getLeadInquiryByUserId(id).catch(() => null),
  ])

  const packSummary = summarizeClientPacks(packs, new Date())

  // Personal (stable) check-in link + QR for this client — no daily QR to print.
  let personalCheckinUrl: string | null = null
  let personalCheckinQr: string | null = null
  if (await clientPersonalCheckinEnabled()) {
    try {
      const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "https://www.darrenjpaul.com"
      personalCheckinUrl = `${base}/checkin/me?token=${encodeURIComponent(signPersonalCheckinToken(id))}`
      personalCheckinQr = await QRCode.toDataURL(personalCheckinUrl, { width: 320, margin: 1 })
    } catch (err) {
      console.error("Personal check-in QR generation failed:", err)
      personalCheckinUrl = null
      personalCheckinQr = null
    }
  }

  // Public test-report share link + QR (permanent HMAC). Mirrors the public
  // page's only gate — an active client; no client_profiles row required.
  let athleteProfileUrl: string | null = null
  let athleteProfileQr: string | null = null
  if (user.role === "client" && user.status === "active") {
    try {
      const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "https://www.darrenjpaul.com"
      athleteProfileUrl = `${base}/athlete/${signAthleteProfileToken(id)}`
      athleteProfileQr = await QRCode.toDataURL(athleteProfileUrl, { width: 320, margin: 1 })
    } catch (err) {
      console.error("Athlete profile link generation failed:", err)
      athleteProfileUrl = null
      athleteProfileQr = null
    }
  }

  // Drives the share dialog's "this report will look thin" warning.
  const performanceTestCount = (await listPerformanceTests(id).catch(() => [])).length

  const showStandingSlots = await recurringSessionsEnabled()
  let standingSlots: RecurringSession[] = []
  if (showStandingSlots) {
    standingSlots = await listRecurringForClient(id).catch(() => [])
  }

  const showCardOnFile = await cardOnFileEnabled()
  let savedCard: UserPaymentMethod | null = null
  if (showCardOnFile) {
    savedCard = await getDefaultPaymentMethod(id).catch(() => null)
  }

  const showMemberships = await sessionMembershipsEnabled()
  let membership: ClientMembership | null = null
  let membershipPlans: MembershipPlan[] = []
  if (showMemberships) {
    ;[membership, membershipPlans] = await Promise.all([
      getActiveMembershipForUser(id).catch(() => null),
      listActiveMembershipPlans().catch(() => []),
    ])
  }

  // Household billing payer + candidate clients (shown with the card section).
  let currentPayerId: string | null = null
  let payerCandidates: { id: string; name: string }[] = []
  let payer: { name: string; card: UserPaymentMethod | null } | null = null
  if (showCardOnFile) {
    const nameOf = (u: { first_name?: string | null; last_name?: string | null; email: string }) =>
      `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email
    const [link, allUsers] = await Promise.all([
      getBillingPayer(id).catch(() => null),
      getUsers().catch(() => []),
    ])
    payerCandidates = allUsers
      .filter((u) => u.role === "client" && u.id !== id)
      .map((u) => ({ id: u.id, name: nameOf(u) }))
    currentPayerId = link?.payer_user_id ?? null
    if (currentPayerId) {
      const [payerUser, payerCard] = await Promise.all([
        getUserById(currentPayerId).catch(() => null),
        getDefaultPaymentMethod(currentPayerId).catch(() => null),
      ])
      payer = payerUser ? { name: nameOf(payerUser), card: payerCard } : null
    }
  }

  const exerciseOptions = allExercises.map((e) => ({ value: e.id, label: e.name }))

  // Build progress stats and shape data for the progress view
  type ProgressWithExercise = ExerciseProgress & { exercises?: Exercise | null }
  const allProgress = (progressData ?? []) as ProgressWithExercise[]

  const totalWorkouts = new Set(allProgress.map((p) => new Date(p.completed_at).toISOString().slice(0, 10))).size
  const totalPRs = allProgress.filter((p) => p.is_pr).length
  const uniqueExercises = new Set(allProgress.map((p) => p.exercise_id)).size

  const recentProgress = allProgress.slice(0, 50).map((p) => ({
    id: p.id,
    exercise_name: p.exercises?.name ?? "Unknown Exercise",
    weight_kg: p.weight_kg,
    sets_completed: p.sets_completed,
    reps_completed: p.reps_completed,
    rpe: p.rpe,
    is_pr: p.is_pr,
    completed_at: p.completed_at,
    set_details: (p.set_details ?? null) as SetDetail[] | null,
  }))

  const progressStats = {
    totalWorkouts,
    totalPRs,
    currentStreak: workoutStreak,
    uniqueExercises,
  }

  const formattedAchievements = achievements.map((a) => ({
    id: a.id,
    achievement_type: a.achievement_type,
    title: a.title,
    description: a.description,
    metric_value: a.metric_value,
    earned_at: a.earned_at,
    icon: a.icon,
  }))

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
          <Avatar className="size-14 shrink-0">
            {user.avatar_url && <AvatarImage src={user.avatar_url} alt={`${user.first_name} ${user.last_name}`} />}
            <AvatarFallback className="bg-primary/10 text-primary text-lg">
              {user.first_name.charAt(0)}
              {user.last_name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-2xl font-semibold text-primary">
                {user.first_name} {user.last_name}
              </h1>
              <ClientDetailHeader client={user} />
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

      {/* Quick Actions */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <ClientCheckinButton clientUserId={id} hasActiveCredits={packSummary.hasActiveCredits} />
        {personalCheckinQr && personalCheckinUrl && (
          <PersonalCheckinLinkDialog
            qrDataUrl={personalCheckinQr}
            checkinUrl={personalCheckinUrl}
            clientName={`${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email}
          />
        )}
        {athleteProfileQr && athleteProfileUrl && (
          <AthleteProfileLinkDialog
            qrDataUrl={athleteProfileQr}
            profileUrl={athleteProfileUrl}
            clientName={`${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email}
            testCount={performanceTestCount}
            clientUserId={id}
            reportPhotoUrl={profile?.report_photo_url ?? null}
          />
        )}
        <Link
          href={`/admin/clients/${id}/arena`}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface/50 transition-colors"
        >
          <LayoutDashboard className="size-4 text-primary" strokeWidth={1.5} />
          Arena card
        </Link>
        <Link
          href={`/admin/clients/${id}/assessments`}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface/50 transition-colors"
        >
          <ClipboardCheck className="size-4 text-primary" strokeWidth={1.5} />
          View Assessment History
        </Link>
      </div>

      {/* Sections */}
      <div className="space-y-6">
        {leadInquiry && <LeadInquiryPanel leadInquiry={leadInquiry} phone={user.phone ?? leadInquiry.phone} />}
        <ClientSessionsPanel
          clientUserId={id}
          packs={packs}
          showStandingSlots={showStandingSlots}
          standingSlots={standingSlots}
          slotAssignments={(assignments as AssignmentWithProgram[])
            .filter((a) => a.status === "active")
            .map((a) => ({ id: a.id, label: a.programs?.name ?? "Program" }))}
          showMemberships={showMemberships}
          membership={membership}
          membershipPlans={membershipPlans}
          showCardOnFile={showCardOnFile}
          savedCard={savedCard}
          currentPayerId={currentPayerId}
          payerCandidates={payerCandidates}
          payer={payer}
        />
        <ProfileSection profile={profile} />
        <QuestionnaireSection profile={profile} />

        {/* Assessment Results Link */}
        <div className="bg-white rounded-xl border border-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-primary mb-1">Assessment Results</h2>
              <p className="text-sm text-muted-foreground">View movement screen results and computed ability levels.</p>
            </div>
            <Link
              href={`/admin/clients/${id}/assessments`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              View Assessments
              <ArrowLeft className="size-3.5 rotate-180" />
            </Link>
          </div>
        </div>

        <ProgramsSection
          assignments={assignments as AssignmentWithProgram[]}
          clientName={`${user.first_name} ${user.last_name}`}
          packByAssignment={packSummary.byAssignment}
        />
        <ClientFavoriteExercisesPanel clientId={id} initialFavorites={favorites} exerciseOptions={exerciseOptions} />
        <ClientProgressView
          userId={id}
          achievements={formattedAchievements}
          recentProgress={recentProgress}
          stats={progressStats}
          programs={(assignments as AssignmentWithProgram[])
            .filter((a) => a.programs)
            .map((a) => ({
              assignmentId: a.id,
              programName: a.programs!.name,
            }))}
        />
        <PaymentsSection payments={payments} />
      </div>
    </div>
  )
}
