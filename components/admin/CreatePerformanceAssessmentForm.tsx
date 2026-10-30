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
  const [isTemplate, setIsTemplate] = useState(false)
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [rows, setRows] = useState<ExerciseRow[]>([
    { key: crypto.randomUUID(), exercise_id: null, custom_name: "", youtube_url: "", admin_notes: "", result_unit: "" },
  ])
  const [submitting, setSubmitting] = useState(false)

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

  // One name box per exercise. Assessments mostly use the coach's own names (2026-10-30), so any
  // text is a custom name; text that matches a library exercise exactly links that exercise.
  const nameOf = (row: ExerciseRow) =>
    row.exercise_id ? (exercises.find((e) => e.id === row.exercise_id)?.name ?? "") : row.custom_name

  function setName(key: string, value: string) {
    const match = exercises.find((e) => e.name.toLowerCase() === value.trim().toLowerCase())
    updateRow(key, match ? { exercise_id: match.id, custom_name: "" } : { exercise_id: null, custom_name: value })
  }

  const selectedClient = clients.find((c) => c.id === clientId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!title.trim() || rows.length === 0) {
      toast.error("Please add a title and at least one exercise")
      return
    }
    if (!isTemplate && !clientId) {
      toast.error("Select a client, or tick “Save as a reusable template”")
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
          client_user_id: isTemplate ? null : clientId,
          is_template: isTemplate,
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
      if (isTemplate) {
        toast.success("Template saved! Assign it to athletes from the Templates list.")
        router.push("/admin/performance-assessments")
      } else {
        toast.success("Assessment created!")
        router.push(`/admin/performance-assessments/${assessment.id}`)
      }
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
          {/* Reusable template toggle */}
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-surface/40 p-3">
            <input
              type="checkbox"
              checked={isTemplate}
              onChange={(e) => setIsTemplate(e.target.checked)}
              className="mt-0.5 rounded border-border"
            />
            <span className="text-sm">
              <span className="font-medium text-foreground">Save as a reusable template</span>
              <span className="block text-xs text-muted-foreground">
                Build it once with no client, then assign it to any athlete (or many) from the Templates list.
              </span>
            </span>
          </label>

          {/* Client & Title row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <User className="size-3.5 text-muted-foreground" />
                Client{" "}
                {isTemplate ? (
                  <span className="text-xs font-normal text-muted-foreground">(not needed for a template)</span>
                ) : (
                  "*"
                )}
              </Label>
              <Select value={clientId} onValueChange={setClientId} disabled={isTemplate}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder={isTemplate ? "—" : "Select a client..."} />
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
          {/* The browser's own suggestion list: it filters as you type and scrolls the whole library. */}
          <datalist id="assessment-exercise-library">
            {exercises.map((e) => (
              <option key={e.id} value={e.name} />
            ))}
          </datalist>
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
                {/* Exercise name: any name, with the library as suggestions */}
                <div className="space-y-2">
                  <Label htmlFor={`exercise-name-${row.key}`} className="text-xs font-medium">
                    Exercise name
                  </Label>
                  <Input
                    id={`exercise-name-${row.key}`}
                    list="assessment-exercise-library"
                    value={nameOf(row)}
                    onChange={(e) => setName(row.key, e.target.value)}
                    placeholder="e.g. Single Leg RDL"
                    maxLength={200}
                    autoComplete="off"
                    className="h-10"
                  />
                  <p className="text-xs text-muted-foreground">
                    Type any name. Exercises from your library show as you type; pick one to link it to your library.
                  </p>
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
