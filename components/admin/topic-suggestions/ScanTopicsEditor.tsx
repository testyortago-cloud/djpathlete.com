"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Loader2, Pencil, Plus, Search, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { MAX_SCAN_SEARCHES, scanQueriesFrom, searchesFor, type ScanTopic } from "@/lib/blog/scan-topics"

const ORIGIN_LABEL = { research: "From research", manual: "Your topic" } as const

/** "deceleration, cutting" → ["deceleration", "cutting"]. */
function parseKeywords(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ]
}

/** Why a topic as typed cannot be kept, or null. Mirrors scanTopicSchema's limits. */
function topicProblem(name: string, keywords: string[]): string | null {
  if (name.trim().length < 3) return "Give the topic a name of at least 3 letters"
  if (keywords.length > 8) return "At most 8 keywords per topic"
  if (keywords.some((k) => k.length < 2 || k.length > 80)) return "Each keyword needs 2 to 80 letters"
  return null
}

/**
 * The weekly scan topics as boxes (Darren: "separate boxes… cross them out"). A topic switched off is kept,
 * crossed out, so it can come back any week without being typed again. Every change saves straight away.
 */
export function ScanTopicsEditor({ initialTopics }: { initialTopics: ScanTopic[] }) {
  const router = useRouter()
  const [topics, setTopics] = useState(initialTopics)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string; keywords: string } | null>(null)
  const [newName, setNewName] = useState("")
  const [newKeywords, setNewKeywords] = useState("")

  const searches = scanQueriesFrom(topics).length
  const onCount = topics.filter((t) => t.active).length

  /** Shows `next` at once and saves it; puts the list back if the save is refused. */
  async function save(next: ScanTopic[], done?: string): Promise<boolean> {
    const before = topics
    setTopics(next)
    setSaving(true)
    try {
      const res = await fetch("/api/admin/topic-suggestions/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Could not save the topics")
      if (done) toast.success(done)
      return true
    } catch (e) {
      setTopics(before)
      toast.error(e instanceof Error ? e.message : "Could not save the topics")
      return false
    } finally {
      setSaving(false)
    }
  }

  function toggle(topic: ScanTopic, active: boolean) {
    void save(topics.map((t) => (t.id === topic.id ? { ...t, active } : t)))
  }

  function remove(topic: ScanTopic) {
    const before = topics
    void save(topics.filter((t) => t.id !== topic.id)).then((ok) => {
      if (ok) toast(`Removed "${topic.name}"`, { action: { label: "Undo", onClick: () => void save(before) } })
    })
  }

  async function saveEdit() {
    if (!editing) return
    const keywords = parseKeywords(editing.keywords)
    const problem = topicProblem(editing.name, keywords)
    if (problem) return toast.error(problem)
    const next = topics.map((t) => (t.id === editing.id ? { ...t, name: editing.name.trim(), keywords } : t))
    if (await save(next)) setEditing(null)
  }

  async function add() {
    const keywords = parseKeywords(newKeywords)
    const problem = topicProblem(newName, keywords)
    if (problem) return toast.error(problem)
    const topic: ScanTopic = { id: crypto.randomUUID(), name: newName.trim(), keywords, active: true }
    if (await save([...topics, topic], "Added. The next weekly scan will search it.")) {
      setNewName("")
      setNewKeywords("")
    }
  }

  async function runScanNow() {
    setScanning(true)
    try {
      const res = await fetch("/api/admin/topic-suggestions/scan", { method: "POST" })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
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
    <section
      aria-labelledby="scan-topics-heading"
      className="rounded-xl border border-border bg-white p-4 lg:col-span-2"
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Search className="size-4 text-primary" />
        <h2 id="scan-topics-heading" className="text-sm font-semibold text-primary">
          Weekly scan topics
        </h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {onCount} on · {searches} of {MAX_SCAN_SEARCHES} searches
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Every Monday the scan searches each topic that is on. Switch a topic off to leave it out: it stays here, crossed
        out, so you can switch it back on any week. Add keywords to dig deeper into a topic: each keyword is its own
        search. Topics you research or suggest above are added here too.
      </p>

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {topics.map((t) =>
          editing?.id === t.id ? (
            <li key={t.id} className="space-y-2 rounded-lg border border-primary/40 bg-white p-3">
              <Input
                aria-label="Topic name"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                maxLength={300}
              />
              <Input
                aria-label="Keywords, comma-separated"
                placeholder="Keywords, comma-separated (optional)"
                value={editing.keywords}
                onChange={(e) => setEditing({ ...editing, keywords: e.target.value })}
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={saveEdit} disabled={saving}>
                  <Check className="mr-1 size-4" />
                  Done
                </Button>
              </div>
            </li>
          ) : (
            <li
              key={t.id}
              className={cn(
                "flex flex-col gap-2 rounded-lg border p-3",
                t.active ? "border-border bg-white" : "border-dashed border-border bg-surface/40",
              )}
            >
              <div className="flex items-start gap-2">
                <Switch
                  className="mt-0.5"
                  checked={t.active}
                  onCheckedChange={(on) => toggle(t, on)}
                  disabled={saving}
                  aria-label={`Search "${t.name}" in the weekly scan`}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 text-sm leading-snug break-words",
                    t.active ? "font-medium text-foreground" : "text-muted-foreground line-through",
                  )}
                >
                  {t.name}
                </span>
                <button
                  type="button"
                  onClick={() => setEditing({ id: t.id, name: t.name, keywords: t.keywords.join(", ") })}
                  disabled={saving}
                  className="rounded p-1 text-muted-foreground hover:bg-surface hover:text-primary"
                >
                  <Pencil className="size-3.5" />
                  <span className="sr-only">Edit &quot;{t.name}&quot;</span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(t)}
                  disabled={saving}
                  className="rounded p-1 text-muted-foreground hover:bg-surface hover:text-destructive"
                >
                  <X className="size-3.5" />
                  <span className="sr-only">Remove &quot;{t.name}&quot;</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pl-10">
                {t.keywords.map((k) => (
                  <span key={k} className="rounded-full bg-primary/5 px-2 py-0.5 text-[11px] text-primary">
                    {k}
                  </span>
                ))}
                {t.origin && (
                  <span className="rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 text-[11px] text-foreground">
                    {ORIGIN_LABEL[t.origin]}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {t.active
                    ? `${searchesFor(t).length} ${searchesFor(t).length === 1 ? "search" : "searches"}`
                    : "Off this week"}
                </span>
              </div>
            </li>
          ),
        )}
      </ul>

      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row">
        <Input
          aria-label="New topic"
          placeholder="New topic, e.g. Agility and change of direction"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={300}
          className="sm:flex-1"
        />
        <Input
          aria-label="Keywords for the new topic, comma-separated"
          placeholder="Keywords (optional): deceleration, cutting"
          value={newKeywords}
          onChange={(e) => setNewKeywords(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void add()
            }
          }}
          className="sm:flex-1"
        />
        <Button onClick={add} disabled={saving} variant="outline">
          <Plus className="mr-1.5 size-4" />
          Add topic
        </Button>
        <Button onClick={runScanNow} disabled={scanning || saving}>
          {scanning ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Sparkles className="mr-1.5 size-4" />}
          Run scan now
        </Button>
      </div>
    </section>
  )
}
