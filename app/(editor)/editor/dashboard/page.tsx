import Link from "next/link"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listSubmissionsForEditor } from "@/lib/db/team-video-submissions"
import { Button } from "@/components/ui/button"
import { ArrowRight, Upload, Clock, AlertCircle, CheckCircle2, FilmIcon } from "lucide-react"
import type { TeamVideoSubmission, TeamVideoSubmissionStatus } from "@/types/database"

export const metadata = { title: "Dashboard" }

const STATUS_LABEL: Record<TeamVideoSubmissionStatus, string> = {
  draft: "Draft",
  submitted: "Awaiting Darren",
  in_review: "In review",
  revision_requested: "Needs your action",
  approved: "Approved",
  locked: "Sent to Content Studio",
}

const STATUS_PILL: Record<TeamVideoSubmissionStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-warning/10 text-warning",
  in_review: "bg-warning/10 text-warning",
  revision_requested: "bg-error/10 text-error",
  approved: "bg-success/10 text-success",
  locked: "bg-muted text-muted-foreground",
}

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString("en-US")
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default async function EditorDashboardPage() {
  const session = await auth()
  if (!session?.user) redirect("/login?callbackUrl=/editor/dashboard")

  const submissions = await listSubmissionsForEditor(session.user.id)

  const counts = {
    revisionRequested: submissions.filter((s) => s.status === "revision_requested").length,
    awaiting: submissions.filter((s) => s.status === "submitted" || s.status === "in_review").length,
    approved: submissions.filter((s) => s.status === "approved" || s.status === "locked").length,
    drafts: submissions.filter((s) => s.status === "draft").length,
  }

  const recent = submissions.slice(0, 5)

  // First name from session.user.name "First Last"
  const firstName = (session.user.name ?? "Editor").split(" ")[0] || "Editor"
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Greeting + slate */}
      <header className="flex items-end justify-between gap-4 border-b border-border pb-4">
        <div className="space-y-1">
          <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
            {today}
          </p>
          <h1 className="font-heading text-3xl text-primary">
            Welcome back, {firstName}.
          </h1>
          <p className="font-body text-sm text-muted-foreground">
            Here&apos;s what&apos;s on the cutting board today.
          </p>
        </div>
        <div className="hidden md:flex flex-col items-end gap-1 font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
          <span>Total submissions</span>
          <span className="text-primary text-2xl tabular-nums leading-none">
            {String(submissions.length).padStart(2, "0")}
          </span>
        </div>
      </header>

      {/* Cockpit counter tiles */}
      <section
        aria-label="Status summary"
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
      >
        <CounterTile
          label="Needs your action"
          value={counts.revisionRequested}
          tone="error"
          icon={<AlertCircle className="size-4" />}
          href="/editor/submissions"
          slot="A1"
        />
        <CounterTile
          label="Awaiting Darren"
          value={counts.awaiting}
          tone="warning"
          icon={<Clock className="size-4" />}
          href="/editor/submissions"
          slot="A2"
        />
        <CounterTile
          label="Approved"
          value={counts.approved}
          tone="success"
          icon={<CheckCircle2 className="size-4" />}
          href="/editor/submissions"
          slot="A3"
        />
      </section>

      {/* Recent activity + Upload CTA */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-md border bg-card">
          <header className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <FilmIcon className="size-4 text-primary" strokeWidth={1.5} />
              <h2 className="font-heading text-sm font-medium text-primary">
                Recent activity
              </h2>
              <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
                Last {recent.length}
              </span>
            </div>
            <Link
              href="/editor/submissions"
              className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground hover:text-primary inline-flex items-center gap-1 transition-colors"
            >
              View all
              <ArrowRight className="size-3" />
            </Link>
          </header>

          {recent.length === 0 ? (
            <EmptyActivity />
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((s) => (
                <ActivityRow key={s.id} submission={s} />
              ))}
            </ul>
          )}
        </div>

        <UploadCard draftCount={counts.drafts} />
      </section>
    </div>
  )
}

function CounterTile({
  label,
  value,
  tone,
  icon,
  href,
  slot,
}: {
  label: string
  value: number
  tone: "error" | "warning" | "success"
  icon: React.ReactNode
  href: string
  slot: string
}) {
  // Color the left "rail" based on tone — like a clip indicator on a mixing board
  const railClass =
    tone === "error"
      ? "bg-error"
      : tone === "warning"
        ? "bg-warning"
        : "bg-success"
  const valueClass =
    tone === "error"
      ? "text-error"
      : tone === "warning"
        ? "text-warning"
        : "text-success"

  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-md border bg-card p-5 transition-colors hover:bg-muted/30"
    >
      <span className={`absolute left-0 top-0 h-full w-1 ${railClass}`} aria-hidden />
      <div className="flex items-center justify-between text-muted-foreground">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase">{label}</span>
        </div>
        <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/50">
          {slot}
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <span className={`font-mono text-5xl leading-none tabular-nums ${valueClass}`}>
          {String(value).padStart(2, "0")}
        </span>
        <ArrowRight className="size-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-1 transition-all" />
      </div>
    </Link>
  )
}

function ActivityRow({ submission: s }: { submission: TeamVideoSubmission }) {
  return (
    <li>
      <Link
        href={`/editor/videos/${s.id}`}
        className="flex items-center gap-4 px-5 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-primary truncate">{s.title}</p>
          <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
            Updated {timeAgo(s.updated_at)} · Created {shortDate(s.created_at)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[10px] tracking-wide uppercase ${STATUS_PILL[s.status]}`}>
          {STATUS_LABEL[s.status]}
        </span>
        <ArrowRight className="size-4 text-muted-foreground/40 shrink-0" />
      </Link>
    </li>
  )
}

function EmptyActivity() {
  return (
    <div className="px-5 py-10 text-center space-y-2">
      <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
        No recordings on file
      </p>
      <p className="font-body text-sm text-muted-foreground">
        Your activity feed will appear here once you upload your first video.
      </p>
    </div>
  )
}

function UploadCard({ draftCount }: { draftCount: number }) {
  return (
    <div className="rounded-md border bg-primary text-primary-foreground p-5 flex flex-col">
      <div className="flex items-center gap-2 text-white/70">
        <Upload className="size-4" strokeWidth={1.5} />
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase">
          Quick action
        </span>
      </div>
      <h3 className="mt-3 font-heading text-xl leading-tight">
        Drop a new edit.
      </h3>
      <p className="mt-1 font-body text-sm text-white/70">
        Upload your latest cut and Darren will get a notification to review.
      </p>
      <div className="mt-auto pt-4 flex items-center justify-between">
        <Button
          asChild
          size="sm"
          variant="secondary"
          className="bg-accent text-accent-foreground hover:bg-accent/90"
        >
          <Link href="/editor/upload">
            <Upload className="mr-1.5 size-4" />
            Start upload
          </Link>
        </Button>
        {draftCount > 0 && (
          <span className="font-mono text-[10px] tracking-widest uppercase text-white/50">
            {draftCount} draft{draftCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  )
}
