import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { listMemos } from "@/lib/db/seo-agent-memos"
import type { SeoAgentMemo, SeoAgentMemoAction } from "@/types/database"

export const dynamic = "force-dynamic"

const TOOL_LABELS: Record<string, string> = {
  queue_new_post: "New post",
  queue_refresh: "Refresh post",
  queue_internal_link_sweep: "Link sweep",
  flag_for_human: "Human flag",
}

function ActionRow({ action }: { action: SeoAgentMemoAction }) {
  const label = TOOL_LABELS[action.tool] ?? action.tool
  return (
    <div className="rounded-md border bg-surface p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="font-mono text-xs text-muted-foreground">#{action.rank}</span>{" "}
          <span className="font-medium text-primary">{label}</span>
        </div>
        <div className="text-xs">
          {action.executed ? (
            <span className="text-success">executed</span>
          ) : (
            <span className="text-error">not executed</span>
          )}
        </div>
      </div>
      <pre className="mt-2 overflow-auto rounded bg-background p-2 text-xs">
        {JSON.stringify(action.args, null, 2)}
      </pre>
      {action.complementary_to_rank_1 && (
        <p className="mt-2 text-xs italic text-muted-foreground">
          Complementary: {action.complementary_to_rank_1}
        </p>
      )}
      {action.execution_target_id && (
        <p className="mt-1 text-xs text-muted-foreground">
          Target id: <code>{action.execution_target_id}</code>
        </p>
      )}
    </div>
  )
}

function MemoCard({ memo }: { memo: SeoAgentMemo }) {
  return (
    <article className="rounded-xl border border-border bg-white p-5 space-y-4">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="font-heading text-xl text-primary">{memo.run_date}</h2>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
            {memo.outcome_status}
          </span>
          <span className="text-muted-foreground">job:</span>
          <code className="text-muted-foreground">{memo.ai_job_id}</code>
        </div>
      </header>

      <p className="text-sm leading-relaxed">{memo.rationale}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {memo.actions.map((a, i) => (
          <ActionRow key={i} action={a} />
        ))}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-primary">
          Signals snapshot
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted/30 p-3">
          {JSON.stringify(memo.signals_summary, null, 2)}
        </pre>
      </details>
    </article>
  )
}

export default async function SeoAgentMemosPage() {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    redirect("/login?callbackUrl=/admin/seo-agent/memos")
  }
  const memos = await listMemos(25)

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="font-heading text-3xl text-primary">SEO Agent — Memos</h1>
        <p className="text-muted-foreground">
          One row per weekly run. Each shows the rationale and the two ranked actions the agent chose.
        </p>
      </header>

      {memos.length === 0 ? (
        <div className="rounded-md border bg-surface p-6 text-center text-muted-foreground">
          No memos yet. The agent runs Sundays at 14:00 UTC once enabled in{" "}
          <a className="text-primary underline" href="/admin/automation">
            /admin/automation
          </a>
          .
        </div>
      ) : (
        <div className="space-y-4">
          {memos.map((m) => (
            <MemoCard key={m.id} memo={m} />
          ))}
        </div>
      )}
    </div>
  )
}
