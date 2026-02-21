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
  Clock,
  ThumbsUp,
  Moon,
  Brain,
  Briefcase,
  Zap,
} from "lucide-react"
import { getUserById } from "@/lib/db/users"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { getAssignments } from "@/lib/db/assignments"
import { getPayments } from "@/lib/db/payments"
import { getProgress, getWorkoutStreak } from "@/lib/db/progress"
import { getAchievements } from "@/lib/db/achievements"
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
import {
  parseProfileSummary,
  hasQuestionnaireData,
} from "@/lib/profile-utils"
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


function SectionHeader({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className="size-4 text-muted-foreground" />
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
        {label}
      </p>
    </div>
  )
}

function QuestionnaireSection({ profile }: { profile: ClientProfile | null }) {
  if (!profile || !hasQuestionnaireData(profile)) return null

  const summary = parseProfileSummary(profile)

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <h2 className="text-lg font-semibold text-primary mb-6">
        Questionnaire Responses
      </h2>
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
              value={summary.experienceLevel ? (LEVEL_LABELS[summary.experienceLevel] ?? summary.experienceLevel) : null}
            />
            <InfoRow
              icon={Brain}
              label="Movement Confidence"
              value={summary.movementConfidence ? (MOVEMENT_CONFIDENCE_LABELS[summary.movementConfidence] ?? summary.movementConfidence) : null}
            />
            <InfoRow
              icon={Clock}
              label="Training Experience"
              value={summary.trainingYears !== null ? `${summary.trainingYears} year${summary.trainingYears !== 1 ? "s" : ""}` : null}
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
                value={summary.occupationActivityLevel ? (OCCUPATION_LABELS[summary.occupationActivityLevel] ?? summary.occupationActivityLevel) : null}
              />
            </div>
          </div>
        )}

        {/* Injuries */}
        {(summary.injuries || summary.injuryDetails.length > 0) && (
          <div>
            <SectionHeader icon={AlertTriangle} label="Injuries & Limitations" />
            {summary.injuries && (
              <p className="text-sm text-foreground mb-2">{summary.injuries}</p>
            )}
            {summary.injuryDetails.length > 0 && (
              <div className="space-y-1.5">
                {summary.injuryDetails.map((injury, i) => (
                  <div
                    key={i}
                    className="text-sm text-foreground bg-surface/50 rounded-lg px-3 py-2"
                  >
                    <span className="font-medium">{injury.area}</span>
                    {injury.side && (
                      <span className="text-muted-foreground"> ({injury.side})</span>
                    )}
                    {injury.severity && (
                      <span className="text-muted-foreground"> &mdash; {injury.severity}</span>
                    )}
                    {injury.notes && (
                      <span className="text-muted-foreground">: {injury.notes}</span>
                    )}
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
              value={summary.preferredTrainingDays !== null ? `${summary.preferredTrainingDays} day${summary.preferredTrainingDays !== 1 ? "s" : ""}` : null}
            />
            <InfoRow
              icon={Clock}
              label="Session Duration"
              value={summary.preferredSessionMinutes !== null ? `${summary.preferredSessionMinutes} minutes` : null}
            />
            <InfoRow
              icon={Zap}
              label="Time Efficiency"
              value={summary.timeEfficiencyPreference ? (TIME_EFFICIENCY_LABELS[summary.timeEfficiencyPreference] ?? summary.timeEfficiencyPreference) : null}
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

  const [profile, assignments, payments, progressData, achievements, workoutStreak] =
    await Promise.all([
      getProfileByUserId(id),
      getAssignments(id),
      getPayments(id),
      getProgress(id),
      getAchievements(id),
      getWorkoutStreak(id),
    ])

  // Build progress stats and shape data for the progress view
  type ProgressWithExercise = ExerciseProgress & { exercises?: Exercise | null }
  const allProgress = (progressData ?? []) as ProgressWithExercise[]

  const totalWorkouts = new Set(
    allProgress.map((p) =>
      new Date(p.completed_at).toISOString().slice(0, 10)
    )
  ).size
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
        <QuestionnaireSection profile={profile} />
        <ProgramsSection
          assignments={assignments as AssignmentWithProgram[]}
        />
        <ClientProgressView
          userId={id}
          achievements={formattedAchievements}
          recentProgress={recentProgress}
          stats={progressStats}
        />
        <PaymentsSection payments={payments} />
      </div>
    </div>
  )
}
