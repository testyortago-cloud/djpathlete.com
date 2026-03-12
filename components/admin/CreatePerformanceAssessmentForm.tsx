"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus, X, Loader2, GripVertical, Youtube } from "lucide-react"
import { toast } from "sonner"

interface Client {
  id: string
  first_name: string
  last_name: string
  email: string
}

interface Exercise {
  id: string
  name: string
}

interface ExerciseRow {
  key: string
  exercise_id: string | null
  custom_name: string
  youtube_url: string
  admin_notes: string
}

interface CreatePerformanceAssessmentFormProps {
  clients: Client[]
  exercises: Exercise[]
}

export function CreatePerformanceAssessmentForm({
  clients,
  exercises,
}: CreatePerformanceAssessmentFormProps) {
  const router = useRouter()
  const [clientId, setClientId] = useState("")
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [rows, setRows] = useState<ExerciseRow[]>([
    { key: crypto.randomUUID(), exercise_id: null, custom_name: "", youtube_url: "", admin_notes: "" },
  ])
  const [submitting, setSubmitting] = useState(false)
  const [exerciseSearch, setExerciseSearch] = useState<Record<string, string>>({})

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: crypto.randomUUID(), exercise_id: null, custom_name: "", youtube_url: "", admin_notes: "" },
    ])
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }

  function updateRow(key: string, updates: Partial<ExerciseRow>) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...updates } : r))
    )
  }

  function getFilteredExercises(searchKey: string) {
    const search = (exerciseSearch[searchKey] ?? "").toLowerCase()
    if (!search) return exercises.slice(0, 20)
    return exercises.filter((e) => e.name.toLowerCase().includes(search)).slice(0, 20)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!clientId || !title.trim() || rows.length === 0) {
      toast.error("Please fill in all required fields and add at least one exercise")
      return
    }

    // Validate each row has either exercise_id or custom_name
    for (const row of rows) {
      if (!row.exercise_id && !row.custom_name.trim()) {
        toast.error("Each exercise must have a name or be selected from the library")
        return
      }
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/performance-assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_user_id: clientId,
          title: title.trim(),
          notes: notes.trim() || null,
          exercises: rows.map((row) => ({
            exercise_id: row.exercise_id,
            custom_name: row.exercise_id ? null : row.custom_name.trim(),
            youtube_url: row.youtube_url.trim() || null,
            admin_notes: row.admin_notes.trim() || null,
          })),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to create assessment")
      }

      const assessment = await res.json()
      toast.success("Assessment created!")
      router.push(`/admin/performance-assessments/${assessment.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create assessment")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      {/* Client */}
      <div className="space-y-2">
        <Label>Client *</Label>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger>
            <SelectValue placeholder="Select a client" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.first_name} {c.last_name} ({c.email})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">Title *</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. March 2026 Movement Assessment"
          maxLength={200}
        />
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any overall instructions for the client..."
          maxLength={5000}
          rows={3}
        />
      </div>

      {/* Exercises */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Exercises *</Label>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="size-3.5 mr-1" />
            Add Exercise
          </Button>
        </div>

        <div className="space-y-3">
          {rows.map((row, index) => (
            <div
              key={row.key}
              className="bg-white rounded-xl border border-border p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <GripVertical className="size-4" />
                  <span className="font-medium">Exercise {index + 1}</span>
                </div>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>

              {/* Exercise selection or custom name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">From Library</Label>
                  <Select
                    value={row.exercise_id ?? ""}
                    onValueChange={(val) =>
                      updateRow(row.key, {
                        exercise_id: val || null,
                        custom_name: val ? "" : row.custom_name,
                      })
                    }
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Select exercise..." />
                    </SelectTrigger>
                    <SelectContent>
                      <div className="px-2 pb-2">
                        <Input
                          placeholder="Search exercises..."
                          value={exerciseSearch[row.key] ?? ""}
                          onChange={(e) =>
                            setExerciseSearch((prev) => ({ ...prev, [row.key]: e.target.value }))
                          }
                          className="h-8 text-sm"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      {getFilteredExercises(row.key).map((ex) => (
                        <SelectItem key={ex.id} value={ex.id}>
                          {ex.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Or Custom Name</Label>
                  <Input
                    value={row.custom_name}
                    onChange={(e) =>
                      updateRow(row.key, {
                        custom_name: e.target.value,
                        exercise_id: e.target.value ? null : row.exercise_id,
                      })
                    }
                    placeholder="e.g. Single Leg RDL"
                    maxLength={200}
                    disabled={!!row.exercise_id}
                    className="text-sm"
                  />
                </div>
              </div>

              {/* YouTube URL */}
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Youtube className="size-3.5 text-red-500" />
                  YouTube Example (optional)
                </Label>
                <Input
                  value={row.youtube_url}
                  onChange={(e) => updateRow(row.key, { youtube_url: e.target.value })}
                  placeholder="https://youtube.com/watch?v=..."
                  className="text-sm"
                />
              </div>

              {/* Admin notes */}
              <div className="space-y-1.5">
                <Label className="text-xs">Coach Notes (optional)</Label>
                <Textarea
                  value={row.admin_notes}
                  onChange={(e) => updateRow(row.key, { admin_notes: e.target.value })}
                  placeholder="What to focus on, cues, etc."
                  maxLength={2000}
                  rows={2}
                  className="text-sm"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Submit */}
      <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
        {submitting ? (
          <>
            <Loader2 className="size-4 mr-2 animate-spin" />
            Creating...
          </>
        ) : (
          "Create Assessment"
        )}
      </Button>
    </form>
  )
}
