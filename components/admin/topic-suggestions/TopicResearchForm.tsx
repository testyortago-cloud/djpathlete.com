"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Search as SearchIcon, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { useAiJob } from "@/hooks/use-ai-job"

interface ResearchCandidate {
  title: string
  summary: string
  tavily_url: string
  rank: number
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function TopicResearchForm() {
  const router = useRouter()
  const [topic, setTopic] = useState("")
  const [submittedTopic, setSubmittedTopic] = useState("")
  const [jobId, setJobId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [adding, setAdding] = useState(false)
  const aiJob = useAiJob(jobId)

  const candidates = ((aiJob.result as { topics?: ResearchCandidate[] } | null)?.topics) ?? []
  const isLoading = submitting || (jobId !== null && (aiJob.status === "pending" || aiJob.status === "processing"))
  const isError = jobId !== null && aiJob.status === "failed"
  const isDone = jobId !== null && aiJob.status === "completed"

  // Default every fresh batch of candidates to checked.
  useEffect(() => {
    if (jobId && aiJob.status === "completed") {
      const topics = (aiJob.result as { topics?: ResearchCandidate[] } | null)?.topics ?? []
      setSelected(new Set(topics.map((_, i) => i)))
    }
  }, [jobId, aiJob.status, aiJob.result])

  async function runResearch() {
    const trimmed = topic.trim()
    if (trimmed.length < 5) {
      toast.error("Give the topic a few more words")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/topic-suggestions/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Failed to start research")
      setSubmittedTopic(trimmed)
      setJobId(data.jobId)
      setSelected(new Set())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start research")
    } finally {
      setSubmitting(false)
    }
  }

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function reset() {
    setJobId(null)
    setSubmittedTopic("")
    setTopic("")
    setSelected(new Set())
  }

  async function addSelected() {
    const chosen = candidates.filter((_, i) => selected.has(i))
    if (chosen.length === 0) {
      toast.error("Select at least one topic to add")
      return
    }
    setAdding(true)
    try {
      const res = await fetch("/api/admin/topic-suggestions/research/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: chosen }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Failed to add topics")
      toast.success(`Added ${chosen.length} topic${chosen.length === 1 ? "" : "s"} — find ${chosen.length === 1 ? "it" : "them"} below.`)
      reset()
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add topics")
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <SearchIcon className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-primary">Research a topic</h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Type a subject and DJP will pull sources and suggest a few angles — pick which ones to
        add.
      </p>

      {!jobId && (
        <div className="flex gap-2">
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void runResearch()
              }
            }}
            placeholder="e.g. blood flow restriction training for return-to-play"
            maxLength={200}
          />
          <Button onClick={runResearch} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : "Research"}
          </Button>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Researching &ldquo;{submittedTopic}&rdquo;…
        </div>
      )}

      {isError && (
        <div className="space-y-2">
          <p className="text-sm text-error">{aiJob.error ?? "Research failed"}</p>
          <Button size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        </div>
      )}

      {isDone && candidates.length === 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            No strong sources found for &ldquo;{submittedTopic}&rdquo; — try rephrasing or being
            more specific.
          </p>
          <Button size="sm" variant="outline" onClick={reset}>
            Search again
          </Button>
        </div>
      )}

      {isDone && candidates.length > 0 && (
        <div className="space-y-3">
          <ul className="space-y-2">
            {candidates.map((c, i) => (
              <li key={c.tavily_url + i} className="flex items-start gap-2 rounded-md border border-border p-2">
                <Checkbox
                  checked={selected.has(i)}
                  onCheckedChange={() => toggle(i)}
                  className="mt-0.5"
                  aria-label={`Include "${c.title}"`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-primary">{c.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{c.summary}</p>
                  <a
                    href={c.tavily_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                  >
                    <ExternalLink className="size-3" />
                    {hostFromUrl(c.tavily_url)}
                  </a>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={reset} disabled={adding}>
              Search again
            </Button>
            <Button size="sm" onClick={addSelected} disabled={adding}>
              {adding ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              Add {selected.size} selected
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
