"use client"

import { useState } from "react"
import { toast } from "sonner"

const SUGGESTIONS = [
  "What's the biggest leak in the funnel right now?",
  "Which campaigns should I cut spend on?",
  "Are there any pending recommendations I should approve today?",
  "Is the Customer Match audience large enough yet?",
]

export function AskAgentBox() {
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function ask(q: string) {
    if (pending) return
    const trimmed = q.trim()
    if (!trimmed) return
    setQuestion(trimmed)
    setAnswer(null)
    setPending(true)
    try {
      const res = await fetch("/api/admin/ads/agent/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      })
      const body = (await res.json().catch(() => ({}))) as { answer?: string; error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setAnswer(body.answer ?? "(empty response)")
    } catch (err) {
      toast.error(`Ask failed: ${(err as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="border border-border rounded-xl bg-card p-4">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about the campaigns, funnel, or pending recs…"
          rows={3}
          disabled={pending}
          className="w-full text-sm resize-none focus:outline-none bg-transparent placeholder:text-muted-foreground/60"
        />
        <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/40">
          <p className="text-[11px] text-muted-foreground">
            Grounded in the live 28-day account snapshot.
          </p>
          <button
            type="button"
            onClick={() => ask(question)}
            disabled={pending || !question.trim()}
            className="text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {pending ? "Thinking..." : "Ask"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => ask(s)}
            disabled={pending}
            className="text-[11px] px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:border-accent/50 hover:text-accent disabled:opacity-50 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>

      {answer ? (
        <div className="border border-border rounded-xl bg-card p-5">
          <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
            ─ Agent
          </p>
          <div className="text-sm text-primary whitespace-pre-wrap leading-relaxed">{answer}</div>
        </div>
      ) : null}
    </div>
  )
}
