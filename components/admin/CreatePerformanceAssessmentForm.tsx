"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, X, Loader2, GripVertical, Youtube, User, FileText, Dumbbell, Ruler } from "lucide-react"
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
  result_unit: string
}

interface CreatePerformanceAssessmentFormProps {
  clients: Client[]
  exercises: Exercise[]
}

export function CreatePerformanceAssessmentForm({ clients, exercises }: CreatePerformanceAssessmentFormProps) {
  const router = useRouter()
  const [clientId, setClientId] = useState("")
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [rows, setRows] = useState<ExerciseRow[]>([
    { key: crypto.randomUUID(), exercise_id: null, custom_name: "", youtube_url: "", admin_notes: "", result_unit: "" },
  ])
  const [submitting, setSubmitting] = useState(false)
  const [exerciseSearch, setExerciseSearch] = useState<Record<string, string>>({})

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        exercise_id: null,
        custom_name: "",
        youtube_url: "",
        admin_notes: "",
        result_unit: "",
      },
    ])
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }

  function updateRow(key: string, updates: Partial<ExerciseRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...updates } : r)))
  }

  function getFilteredExercises(searchKey: string) {
    const search = (exerciseSearch[searchKey] ?? "").toLowerCase()
    if (!search) return exercises.slice(0, 20)
    return exercises.filter((e) => e.name.toLowerCase().includes(search)).slice(0, 20)
  }

  const selectedClient = clients.find((c) => c.id === clientId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!clientId || !title.trim() || rows.length === 0) {
      toast.error("Please fill in all required fields and add at least one exercise")
      return
    }

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
            result_unit: row.result_unit.trim() || null,
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
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Assessment Details Card */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-surface/30">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-primary">Assessment Details</h2>
          </div>
        </div>
        <div className="p-6 space-y-5">
          {/* Client & Title row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <User className="size-3.5 text-muted-foreground" />
                Client *
              </Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Select a client..." />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.first_name} {c.last_name} ({c.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedClient && <p className="text-xs text-muted-foreground">{selectedClient.email}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. March 2026 Movement Assessment"
                maxLength={200}
                className="h-11"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes for Client (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any overall instructions for the client — what to prepare, what to focus on..."
              maxLength={5000}
              rows={3}
            />
          </div>
        </div>
      </div>

      {/* Exercises Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Dumbbell className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-primary">Exercises ({rows.length})</h2>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="size-3.5 mr-1.5" />
            Add Exercise
          </Button>
        </div>

        <div className="space-y-4">
          {rows.map((row, index) => (
            <div key={row.key} className="bg-white rounded-xl border border-border overflow-hidden">
              {/* Exercise header */}
              <div className="px-5 py-3 border-b border-border bg-surface/30 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <GripVertical className="size-4 text-muted-foreground/50" />
                  <span className="text-sm font-medium text-primary">Exercise {index + 1}</span>
                  {row.exercise_id && (
                    <span className="text-xs text-muted-foreground bg-primary/5 px-2 py-0.5 rounded-full">
                      From Library
                    </span>
                  )}
                  {!row.exercise_id && row.custom_name && (
                    <span className="text-xs text-muted-foreground bg-accent/10 px-2 py-0.5 rounded-full">Custom</span>
                  )}
                </div>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>

              <div className="p-5 space-y-4">
                {/* Exercise selection */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Select from Library</Label>
                    <Select
                      value={row.exercise_id ?? ""}
                      onValueChange={(val) =>
                        updateRow(row.key, {
                          exercise_id: val || null,
                          custom_name: val ? "" : row.custom_name,
                        })
                      }
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Search and select exercise..." />
                      </SelectTrigger>
                      <SelectContent>
                        <div className="px-2 pb-2">
                          <Input
                            placeholder="Type to search..."
                            value={exerciseSearch[row.key] ?? ""}
                            onChange={(e) => setExerciseSearch((prev) => ({ ...prev, [row.key]: e.target.value }))}
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
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Or Enter Custom Name</Label>
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
                      className="h-10"
                    />
                  </div>
                </div>

                {/* YouTube, Notes & Unit row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-medium flex items-center gap-1.5">
                      <Youtube className="size-3.5 text-red-500" />
                      YouTube Example (optional)
                    </Label>
                    <Input
                      value={row.youtube_url}
                      onChange={(e) => updateRow(row.key, { youtube_url: e.target.value })}
                      placeholder="https://youtube.com/watch?v=..."
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-medium flex items-center gap-1.5">
                      <Ruler className="size-3.5" />
                      Result Unit (optional)
                    </Label>
                    <Input
                      value={row.result_unit}
                      onChange={(e) => updateRow(row.key, { result_unit: e.target.value })}
                      placeholder="e.g. inches, seconds, cm"
                      maxLength={50}
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Coach Notes (optional)</Label>
                    <Textarea
                      value={row.admin_notes}
                      onChange={(e) => updateRow(row.key, { admin_notes: e.target.value })}
                      placeholder="What to focus on, cues, form reminders..."
                      maxLength={2000}
                      rows={2}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Add more button at bottom */}
        <button
          type="button"
          onClick={addRow}
          className="w-full py-3 border-2 border-dashed border-border rounded-xl text-sm text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="size-4" />
          Add Another Exercise
        </button>
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={submitting} size="lg">
          {submitting ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Creating Assessment...
            </>
          ) : (
            "Create Assessment"
          )}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
