"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TopicResearchForm } from "@/components/admin/topic-suggestions/TopicResearchForm"
import { ScanTopicsEditor } from "@/components/admin/topic-suggestions/ScanTopicsEditor"
import { scanTopicNote, type ScanTopic } from "@/lib/blog/scan-topics"

export function BlogTopicControls({ initialTopics }: { initialTopics: ScanTopic[] }) {
  const router = useRouter()

  // Custom topic
  const [topic, setTopic] = useState("")
  const [adding, setAdding] = useState(false)

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
      const data = await res.json().catch(() => ({}))
      toast.success(`Added to this week's brief below. ${scanTopicNote(data.scan_topic)}`)
      setTopic("")
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add topic")
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      <TopicResearchForm />

      {/* Suggest your own topic */}
      <div className="rounded-xl border border-border bg-white p-4">
        <div className="mb-1 flex items-center gap-2">
          <Plus className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-primary">Suggest your own topic</h2>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Add any topic you want written about. It goes into this week&apos;s brief below, ready to draft, and into your
          weekly scan topics.
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

      <ScanTopicsEditor initialTopics={initialTopics} />
    </div>
  )
}
