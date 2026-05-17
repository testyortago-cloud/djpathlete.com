import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Clock, FileText, Hash } from "lucide-react"
import { AgentMemoTabs } from "@/components/admin/ads/agent-memo-tabs"
import {
  AgentConfidenceChip,
  AgentDissentBadge,
} from "@/components/admin/AgentConfidenceChip"
import { getAgentMemoById } from "@/lib/db/google-ads-agent-memos"

export const metadata = { title: "Google Ads — Strategist Memo" }
export const dynamic = "force-dynamic"

function fmtWeekOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function MemoDetailPage({ params }: PageProps) {
  const { id } = await params
  const memo = await getAgentMemoById(id)
  if (!memo) notFound()

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <Link
        href="/admin/ads/agent"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-accent transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        All memos
      </Link>

      {/* Hero header */}
      <header className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/[0.04] via-card to-accent/[0.04] p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-accent">
            Strategist memo
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            Week of {fmtWeekOf(memo.week_of)}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-muted text-muted-foreground">
            {memo.source}
          </span>
        </div>

        <h1 className="font-heading text-3xl sm:text-4xl text-primary leading-tight tracking-tight">
          {memo.subject}
        </h1>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <AgentConfidenceChip confidence={memo.agent_confidence} />
          <AgentDissentBadge
            dissents={memo.dissents_from_brief}
            reason={memo.dissent_reason}
          />
          {memo.email_recipient ? (
            <span className="inline-flex items-center gap-1.5 rounded bg-surface/80 px-2 py-0.5 text-xs text-muted-foreground border border-border">
              <FileText className="size-3" />
              sent to {memo.email_recipient}
            </span>
          ) : null}
        </div>
      </header>

      <AgentMemoTabs memo={memo} />

      {/* Footer meta */}
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 border-t border-border/60 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-3" />
          Generated {new Date(memo.created_at).toLocaleString()}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Hash className="size-3" />
          {memo.tokens_used.toLocaleString()} tokens
        </span>
      </footer>
    </div>
  )
}
