"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Loader2, Search, Save, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

export function BlogTopicControls({ initialQueries }: { initialQueries: string[] }) {
  const router = useRouter()

  // Custom topic
  const [topic, setTopic] = useState("")
  const [adding, setAdding] = useState(false)

  // Scan queries
  const [queriesText, setQueriesText] = useState(initialQueries.join("\n"))
  const [savingQueries, setSavingQueries] = useState(false)
  const [scanning, setScanning] = useState(false)

  function parsedQueries(): string[] {
    return queriesText
      .split(/\r?\n/)
      .map((q) => q.trim())
      .filter(Boolean)
  }

  async function addTopic() {
    const title = topic.trim()
    if (title.length < 5) {
      toast.error("Give the topic a few more words")
      return
    }
    setAdding(true)
    try {
      const res = await fetch("/api/admin/topic-suggestions/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Failed to add topic")
      }
      toast.success("Topic added — find it below and click “Draft blog”.")
      setTopic("")
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add topic")
    } finally {
      setAdding(false)
    }
  }

  async function saveQueries() {
    const queries = parsedQueries()
    if (queries.length === 0) {
      toast.error("Add at least one search topic")
      return
    }
    setSavingQueries(true)
    try {
      const res = await fetch("/api/admin/topic-suggestions/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to save")
      setQueriesText((data.queries as string[]).join("\n"))
      toast.success("Saved. The next weekly scan will use these topics.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save topics")
    } finally {
      setSavingQueries(false)
    }
  }

  // Override the weekly schedule: save the current topics, then run the scan now.
  async function runScanNow() {
    const queries = parsedQueries()
    if (queries.length === 0) {
      toast.error("Add at least one search topic first")
      return
    }
    setScanning(true)
    try {
      // Save current topics first so the scan uses exactly what's shown.
      const saveRes = await fetch("/api/admin/topic-suggestions/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries }),
      })
      if (!saveRes.ok) {
        const d = await saveRes.json().catch(() => ({}))
        throw new Error(d.error ?? "Failed to save topics")
      }
      const scanRes = await fetch("/api/admin/topic-suggestions/scan", { method: "POST" })
      if (!scanRes.ok) {
        const d = await scanRes.json().catch(() => ({}))
        throw new Error(d.error ?? "Failed to start scan")
      }
      toast.success("Scan started — fresh topics will appear here in a minute or two.")
      // Surface the results without a manual reload once the job has had time to finish.
      window.setTimeout(() => router.refresh(), 75000)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start scan")
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      {/* Suggest your own topic */}
      <div className="rounded-xl border border-border bg-white p-4">
        <div className="mb-1 flex items-center gap-2">
          <Plus className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-primary">Suggest your own topic</h2>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Add any topic you want written about — it appears in the list below, ready to draft.
        </p>
        <div className="flex gap-2">
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void addTopic()
              }
            }}
            placeholder="e.g. Rotational power for golfers — medicine-ball protocols"
            maxLength={200}
          />
          <Button onClick={addTopic} disabled={adding}>
            {adding ? <Loader2 className="size-4 animate-spin" /> : "Add"}
          </Button>
        </div>
      </div>

      {/* Weekly auto-scan topics */}
      <div className="rounded-xl border border-border bg-white p-4">
        <div className="mb-1 flex items-center gap-2">
          <Search className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-primary">Weekly auto-scan topics</h2>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          One search topic per line. These drive the automatic suggestions — broaden or replace them to steer the
          content away from any single theme. Save applies to the next weekly scan, or hit{" "}
          <span className="font-medium">Run scan now</span> to pull fresh topics immediately.
        </p>
        <Label htmlFor="scan-queries" className="sr-only">
          Scan topics
        </Label>
        <Textarea
          id="scan-queries"
          value={queriesText}
          onChange={(e) => setQueriesText(e.target.value)}
          rows={6}
          className="font-mono text-xs"
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={saveQueries} disabled={savingQueries || scanning}>
            {savingQueries ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Save className="mr-1.5 size-4" />}
            Save topics
          </Button>
          <Button size="sm" onClick={runScanNow} disabled={scanning || savingQueries}>
            {scanning ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Sparkles className="mr-1.5 size-4" />}
            Run scan now
          </Button>
        </div>
      </div>
    </div>
  )
}
