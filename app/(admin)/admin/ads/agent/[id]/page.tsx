import Link from "next/link"
import { notFound } from "next/navigation"
import { AgentMemoTabs } from "@/components/admin/ads/agent-memo-tabs"
import { getAgentMemoById } from "@/lib/db/google-ads-agent-memos"

export const metadata = { title: "Google Ads — Strategist Memo" }
export const dynamic = "force-dynamic"

function fmtWeekOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
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
      <div>
        <Link
          href="/admin/ads/agent"
          className="text-xs text-muted-foreground hover:text-accent inline-flex items-center"
        >
          ← All memos
        </Link>
        <h1 className="text-2xl font-heading text-primary mt-2">{memo.subject}</h1>
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mt-1">
          Week of {fmtWeekOf(memo.week_of)} · {memo.source}
          {memo.email_recipient ? ` · sent to ${memo.email_recipient}` : ""}
        </p>
      </div>

      <AgentMemoTabs memo={memo} />

      <p className="text-xs text-muted-foreground">
        Generated {new Date(memo.created_at).toLocaleString()} · {memo.tokens_used.toLocaleString()} tokens
      </p>
    </div>
  )
}
