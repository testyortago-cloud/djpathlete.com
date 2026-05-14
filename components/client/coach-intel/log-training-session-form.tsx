"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  SESSION_TYPES,
  SESSION_TYPE_LABELS,
  trainingSessionFormSchema,
  type TrainingSessionFormData,
} from "@/lib/validators/training-session"

export function LogTrainingSessionForm({
  initial,
  clientUserId,
  onSuccess,
}: {
  initial?: Partial<TrainingSessionFormData>
  clientUserId?: string
  onSuccess?: () => void
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const today = new Date().toISOString().slice(0, 10)

  const form = useForm<TrainingSessionFormData>({
    resolver: zodResolver(trainingSessionFormSchema),
    defaultValues: {
      date: today,
      session_type: "gym",
      rpe: 6,
      duration_min: 60,
      notes: null,
      program_assignment_id: null,
      ...initial,
    },
  })

  async function onSubmit(values: TrainingSessionFormData) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/training-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(clientUserId ? { ...values, client_user_id: clientUserId } : values),
      })
      if (!res.ok) throw new Error("Save failed")
      toast.success("Session logged")
      router.refresh()
      onSuccess?.()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Date</Label>
          <Input type="date" {...form.register("date")} />
        </div>
        <div className="grid gap-2">
          <Label>Session type</Label>
          <Select
            value={form.watch("session_type")}
            onValueChange={(v) => form.setValue("session_type", v as TrainingSessionFormData["session_type"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SESSION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {SESSION_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>
          RPE <span className="text-muted-foreground">{form.watch("rpe")}/10</span>
        </Label>
        <Slider
          min={1}
          max={10}
          step={1}
          value={[form.watch("rpe")]}
          onValueChange={([v]) => form.setValue("rpe", v)}
        />
      </div>

      <div className="grid gap-2">
        <Label>Duration (minutes)</Label>
        <Input type="number" step="1" {...form.register("duration_min", { valueAsNumber: true })} />
      </div>

      <div className="grid gap-2">
        <Label>Notes</Label>
        <Textarea rows={3} {...form.register("notes", { setValueAs: (v) => (v === "" ? null : v) })} />
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Saving..." : "Save session"}
      </Button>
    </form>
  )
}
