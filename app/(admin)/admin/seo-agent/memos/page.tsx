import type { ReactNode } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { FileText, HelpCircle, Lightbulb, Link2, RefreshCw } from "lucide-react"
import { auth } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { DataTableBadge, type DataTableBadgeTone } from "@/components/ui/data-table"
import { MarkHandledButton, WriteDraftButton } from "@/components/admin/seo-agent/MemoActionButtons"
import { listMemos } from "@/lib/db/seo-agent-memos"
import { getBlogPostTitles } from "@/lib/db/blog-posts"
import { getCalendarDraftRefs } from "@/lib/db/content-calendar"
import { getNotificationReadStates } from "@/lib/db/notifications"
import { getAiJobSnapshots, type AiJobSnapshot } from "@/lib/ai-jobs"
import type { SeoAgentMemo, SeoAgentMemoAction, SeoAgentMemoOutcomeMetric } from "@/types/database"

export const dynamic = "force-dynamic"

/** What the page looked up about the things each action created. */
interface Lookups {
  posts: Record<string, { title: string; slug: string }>
  /** content_calendar id → draft post id (null = no draft yet). */
  drafts: Record<string, string | null>
  /** ai_jobs id → job. Null when Firestore could not be read. */
  jobs: Record<string, AiJobSnapshot> | null
  flags: Record<string, { user_id: string; is_read: boolean }>
  viewerId: string
}

interface Status {
  tone: DataTableBadgeTone
  label: string
}

const RESULTS_AFTER_DAYS = 14 // MEASUREMENT_AGE_DAYS in the outcome tracker

const NOTE_TEXT: Record<string, string> = {
  topic_suggestion_not_yet_picked_up: "The post was never written, so there is nothing to measure.",
  post_not_yet_published: "The post is not published yet, so there is nothing to measure.",
}

const str = (v: unknown) => (typeof v === "string" ? v : "")
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

function formatDate(ymd: string, addDays = 0): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + addDays)
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

function confidenceStatus(c: number | null): Status | null {
  if (c == null) return null
  if (c >= 7) return { tone: "success", label: `Agent is confident (${c}/10)` }
  if (c >= 5) return { tone: "info", label: `Agent is fairly sure (${c}/10)` }
  return { tone: "warning", label: `Agent is unsure (${c}/10)` }
}

function outcomeStatus(memo: SeoAgentMemo): Status {
  if (memo.outcome_status === "measured") return { tone: "success", label: "Results are in" }
  if (memo.outcome_status === "rolled_back") return { tone: "warning", label: "Undone" }
  return { tone: "neutral", label: `Results on ${formatDate(memo.run_date, RESULTS_AFTER_DAYS)}` }
}

function postIdsOf(a: SeoAgentMemoAction): string[] {
  return [str(a.args.target_blog_post_id), str(a.args.blog_post_id), ...strs(a.args.candidate_anchor_post_ids)].filter(
    Boolean,
  )
}

function postName(id: string, lk: Lookups): string {
  const p = lk.posts[id]
  return p ? `“${p.title}”` : "a post that no longer exists"
}

/** Status of an action that ran as a background job (link sweep, refresh). */
function jobStatus(action: SeoAgentMemoAction, lk: Lookups, done: (job: AiJobSnapshot) => Status): Status {
  const job = action.execution_target_id ? lk.jobs?.[action.execution_target_id] : undefined
  if (!job) return { tone: "neutral", label: "Started" }
  if (job.status === "completed") return done(job)
  if (job.status === "failed" || job.status === "cancelled") return { tone: "danger", label: "Failed" }
  return { tone: "info", label: "Working on it" }
}

function OpenLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild size="sm" variant="outline">
      <Link href={href}>
        <FileText />
        {children}
      </Link>
    </Button>
  )
}

function ActionCard({
  action,
  metric,
  lk,
}: {
  action: SeoAgentMemoAction
  metric?: SeoAgentMemoOutcomeMetric
  lk: Lookups
}) {
  const id = action.execution_target_id
  let icon = <FileText />
  let title = action.tool as string
  let body: ReactNode = null
  let status: Status = { tone: "neutral", label: "Done" }
  let buttons: ReactNode = null
  let problem: string | null = null
  let note: string | null = null

  if (action.tool === "queue_new_post") {
    icon = <Lightbulb />
    title = "Suggested a new blog post"
    body = (
      <>
        <p>
          Topic: <span className="font-medium">{str(action.args.keyword)}</span>
        </p>
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">What it should cover: </span>
          {str(action.args.angle)}
        </p>
      </>
    )
    const draft = id ? lk.drafts[id] : undefined
    if (draft) {
      status = { tone: "success", label: "Draft written" }
      buttons = <OpenLink href={`/admin/blog/${draft}`}>Open the draft</OpenLink>
    } else if (draft === null && id) {
      status = { tone: "warning", label: "Waiting for you" }
      buttons = (
        <>
          <WriteDraftButton calendarId={id} />
          <OpenLink href="/admin/topic-suggestions">See all topic ideas</OpenLink>
        </>
      )
    } else {
      status = { tone: "neutral", label: "Topic was removed" }
    }
  } else if (action.tool === "queue_internal_link_sweep") {
    icon = <Link2 />
    title = "Linked your posts together"
    const target = str(action.args.target_blog_post_id)
    const anchors = strs(action.args.candidate_anchor_post_ids).map((p) => postName(p, lk))
    body = (
      <p>
        Adds a link inside {anchors.join(", ")} that points to {postName(target, lk)}. Links between your posts help
        Google find and rank them.
      </p>
    )
    status = jobStatus(action, lk, (job) => {
      const n = typeof job.result?.insertions === "number" ? job.result.insertions : 0
      return n > 0
        ? { tone: "success", label: `Done: added ${n} link${n === 1 ? "" : "s"}` }
        : { tone: "warning", label: "No link added: no good spot found" }
    })
    if (lk.posts[target]) buttons = <OpenLink href={`/admin/blog/${target}`}>Open {postName(target, lk)}</OpenLink>
  } else if (action.tool === "queue_refresh") {
    icon = <RefreshCw />
    title = "Updated an older post"
    const post = str(action.args.blog_post_id)
    body = (
      <>
        <p>Post: {postName(post, lk)}</p>
        <p className="text-muted-foreground">{str(action.args.reason)}</p>
      </>
    )
    status = jobStatus(action, lk, () => ({ tone: "success", label: "Done: post updated" }))
    if (lk.posts[post]) buttons = <OpenLink href={`/admin/blog/${post}`}>Open the post</OpenLink>
  } else if (action.tool === "flag_for_human") {
    icon = <HelpCircle />
    title = "Has a question for you"
    body = (
      <>
        <p className="font-medium">{str(action.args.issue)}</p>
        <details>
          <summary className="cursor-pointer text-muted-foreground hover:text-primary">Why it is asking</summary>
          <p className="mt-1 text-muted-foreground">{str(action.args.context)}</p>
        </details>
      </>
    )
    const flag = id ? lk.flags[id] : undefined
    if (flag?.is_read) {
      status = { tone: "success", label: "Handled" }
    } else {
      status = { tone: "warning", label: "Waiting for you" }
      buttons = (
        <>
          {flag && id && flag.user_id === lk.viewerId ? (
            <MarkHandledButton notificationId={id} />
          ) : (
            <p className="text-xs text-muted-foreground">Sent to the business owner. Only they can mark it handled.</p>
          )}
          <OpenLink href="/admin/blog">Open your blog posts</OpenLink>
        </>
      )
    }
  }

  const refusal = action.rejection_reason ?? ""
  if (!action.executed && refusal.startsWith("repeat_sweep:")) {
    status = { tone: "neutral", label: "Skipped: done recently" }
    buttons = null
    note = "This post already had a link job in the last 14 days, so it was not repeated."
  } else if (!action.executed && refusal.startsWith("brief_dont_do:")) {
    status = { tone: "neutral", label: "Skipped: against this week's plan" }
    buttons = null
    note = `This week's plan says not to do “${refusal.slice("brief_dont_do:".length)}”.`
  } else if (!action.executed) {
    status = { tone: "danger", label: "Not done" }
    buttons = null
    problem = "The agent tried to do this but it did not go through."
  } else if (status.tone === "danger") {
    const job = id ? lk.jobs?.[id] : undefined
    problem = job?.error ? `It stopped with this message: ${job.error}` : null
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface/40 p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 font-medium text-primary [&_svg]:size-4">
          {icon}
          <span>
            {action.rank}. {title}
          </span>
        </div>
        <DataTableBadge tone={status.tone} className="shrink-0">
          {status.label}
        </DataTableBadge>
      </div>
      <div className="space-y-2 leading-relaxed">{body}</div>
      {problem && <p className="text-xs text-error">{problem}</p>}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {metric && <ResultLines metric={metric} />}
      {buttons && <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">{buttons}</div>}
    </div>
  )
}

function ResultLines({ metric }: { metric: SeoAgentMemoOutcomeMetric }) {
  if (metric.error) return <p className="text-xs text-muted-foreground">The result could not be measured.</p>
  if (metric.note) return <p className="text-xs text-muted-foreground">{NOTE_TEXT[metric.note] ?? metric.note}</p>
  const lines: string[] = []
  if (typeof metric.clicks_before === "number") {
    lines.push(`Visits from Google: ${metric.clicks_before} before, ${metric.clicks_after ?? "unknown"} after`)
  }
  if (typeof metric.position_before === "number" || typeof metric.position_after === "number") {
    const f = (v: number | null | undefined) => (typeof v === "number" ? v.toFixed(1) : "unknown")
    lines.push(
      `Place in Google results: ${f(metric.position_before)} before, ${f(metric.position_after)} after (lower is better)`,
    )
  }
  if (typeof metric.acknowledged === "boolean") {
    lines.push(metric.acknowledged ? "You marked the question handled." : "The question was never marked handled.")
  }
  if (lines.length === 0) return null
  return (
    <ul className="space-y-0.5 rounded-md bg-white p-2 text-xs">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  )
}

function MemoCard({ memo, lk }: { memo: SeoAgentMemo; lk: Lookups }) {
  const confidence = confidenceStatus(memo.agent_confidence)
  const outcome = outcomeStatus(memo)
  return (
    <article className="space-y-4 rounded-xl border border-border bg-white p-5 shadow-sm">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-heading text-lg text-primary">{formatDate(memo.run_date)}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {confidence && (
            <DataTableBadge
              tone={confidence.tone}
              title="How sure the agent is about this week's choices. 4 or lower: read its reasons before trusting it."
            >
              {confidence.label}
            </DataTableBadge>
          )}
          {memo.dissents_from_brief && (
            <DataTableBadge tone="warning">Went against this week&apos;s plan</DataTableBadge>
          )}
          <DataTableBadge
            tone={outcome.tone}
            title={`${RESULTS_AFTER_DAYS} days after each run, the agent checks whether its changes helped.`}
          >
            {outcome.label}
          </DataTableBadge>
        </div>
      </header>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What it did</h3>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {memo.actions.map((a, i) => (
            <ActionCard key={i} action={a} metric={memo.outcome_metrics?.find((m) => m.action_index === i)} lk={lk} />
          ))}
        </div>
      </section>

      {/* The agent writes this itself, in SEO terms, so it sits behind a click rather than leading the card. */}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-primary hover:underline">
          Why it chose these (the agent&apos;s own words)
        </summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p>{memo.rationale}</p>
          {memo.dissents_from_brief && memo.dissent_reason && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Why it went against the plan: </span>
              {memo.dissent_reason}
            </p>
          )}
        </div>
      </details>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-primary">
          Technical details (for support)
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted/30 p-3">
          {JSON.stringify({ job: memo.ai_job_id, actions: memo.actions, signals: memo.signals_summary }, null, 2)}
        </pre>
      </details>
    </article>
  )
}

async function loadLookups(memos: SeoAgentMemo[], viewerId: string): Promise<Lookups> {
  const actions = memos.flatMap((m) => m.actions)
  const targets = (tools: string[]) =>
    actions.filter((a) => tools.includes(a.tool) && a.execution_target_id).map((a) => a.execution_target_id as string)

  const [posts, drafts, flags, jobs] = await Promise.all([
    getBlogPostTitles([...new Set(actions.flatMap(postIdsOf))]),
    getCalendarDraftRefs(targets(["queue_new_post"])),
    getNotificationReadStates(targets(["flag_for_human"])),
    // Firestore down must not take the page with it; job statuses then read "Started".
    getAiJobSnapshots(targets(["queue_internal_link_sweep", "queue_refresh"])).catch((err) => {
      console.error("[seo-agent/memos] could not read ai_jobs:", err)
      return null
    }),
  ])
  return { posts, drafts, flags, jobs, viewerId }
}

export default async function SeoAgentMemosPage() {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    redirect("/login?callbackUrl=/admin/seo-agent/memos")
  }
  const memos = await listMemos(25)
  const lk = await loadLookups(memos, session.user.id)

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="font-heading text-3xl text-primary">SEO Agent: Weekly Notes</h1>
        <p className="max-w-3xl text-muted-foreground">
          Every Sunday the SEO agent looks at how your blog is doing on Google and picks up to two things to do. Most of
          them happen on their own. When something needs you, it says &ldquo;Waiting for you&rdquo; and has a button.
        </p>
      </header>

      {memos.length === 0 ? (
        <div className="rounded-xl border border-border bg-white p-6 text-center text-muted-foreground shadow-sm">
          No notes yet. The agent runs every Sunday once it is switched on in{" "}
          <Link className="text-primary underline" href="/admin/automation">
            Automation
          </Link>
          .
        </div>
      ) : (
        <div className="space-y-4">
          {memos.map((m) => (
            <MemoCard key={m.id} memo={m} lk={lk} />
          ))}
        </div>
      )}
    </div>
  )
}
