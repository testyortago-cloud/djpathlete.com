import Link from "next/link"
import { notFound } from "next/navigation"
import { getAgentMemoById } from "@/lib/db/google-ads-agent-memos"

export const metadata = { title: "Google Ads — Strategist Memo" }
export const dynamic = "force-dynamic"

const PRIORITY_TONE: Record<string, string> = {
  high: "bg-error/10 text-error border-error/40",
  medium: "bg-warning/15 text-warning border-warning/40",
  low: "bg-muted/40 text-muted-foreground border-border",
}

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

  const s = memo.sections

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

      <Section title="Executive summary">
        <p className="text-base leading-relaxed text-primary">{s.executive_summary}</p>
      </Section>

      {s.whats_working.length > 0 ? (
        <Section title="What's working">
          <div className="space-y-3">
            {s.whats_working.map((p, i) => (
              <p key={i} className="text-sm text-primary leading-relaxed">{p}</p>
            ))}
          </div>
        </Section>
      ) : null}

      {s.whats_not.length > 0 ? (
        <Section title="What's not">
          <div className="space-y-3">
            {s.whats_not.map((p, i) => (
              <p key={i} className="text-sm text-primary leading-relaxed">{p}</p>
            ))}
          </div>
        </Section>
      ) : null}

      {s.recommended_actions.length > 0 ? (
        <Section title="Recommended actions">
          <div className="space-y-3">
            {s.recommended_actions.map((a, i) => (
              <div
                key={i}
                className={`border rounded-xl p-4 ${PRIORITY_TONE[a.priority] ?? "bg-card border-border"}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider opacity-90">
                    {a.priority}
                  </span>
                  <span className="text-xs opacity-50">·</span>
                  {a.link ? (
                    <Link href={a.link} className="text-sm font-medium hover:underline">
                      {a.title}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium">{a.title}</span>
                  )}
                </div>
                <p className="text-sm leading-relaxed opacity-90">{a.reasoning}</p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Watch next week">
        <p className="text-sm leading-relaxed text-primary">{s.watch_list}</p>
      </Section>

      <p className="text-xs text-muted-foreground">
        Generated {new Date(memo.created_at).toLocaleString()} · {memo.tokens_used.toLocaleString()} tokens
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
        ─ {title}
      </h2>
      {children}
    </section>
  )
}
