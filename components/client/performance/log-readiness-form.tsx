"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { READINESS_FIELDS, readinessFormSchema, type ReadinessFormData } from "@/lib/validators/daily-readiness"

export function LogReadinessForm({ initial }: { initial?: Partial<ReadinessFormData> }) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const form = useForm<ReadinessFormData>({
    resolver: zodResolver(readinessFormSchema),
    defaultValues: {
      date: today,
      sleep_hours: 7.5,
      sleep_quality: 3,
      soreness_overall: 3,
      soreness_by_region: {},
      fatigue: 3,
      mood: 3,
      stress: 3,
      hydration: 3,
      resting_hr: null,
      hrv_ms: null,
      notes: null,
      ...initial,
    },
  })

  async function onSubmit(values: ReadinessFormData) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/readiness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      })
      if (!res.ok) throw new Error("Save failed")
      toast.success("Readiness logged")
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid gap-2">
        <Label>Date</Label>
        <Input type="date" {...form.register("date")} />
      </div>

      <div className="grid gap-2">
        <Label>Sleep hours</Label>
        <Input
          type="number"
          step="0.25"
          {...form.register("sleep_hours", {
            setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
          })}
        />
      </div>

      {READINESS_FIELDS.map((f) => {
        const value = form.watch(f.key as keyof ReadinessFormData) as number
        return (
          <div key={f.key} className="grid gap-2">
            <Label>
              {f.label} <span className="text-muted-foreground">{value}/5</span>
            </Label>
            <Slider
              min={1}
              max={5}
              step={1}
              value={[value]}
              onValueChange={([v]) => form.setValue(f.key as keyof ReadinessFormData, v as never)}
            />
          </div>
        )
      })}

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Resting HR (bpm)</Label>
          <Input
            type="number"
            {...form.register("resting_hr", {
              setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
            })}
          />
        </div>
        <div className="grid gap-2">
          <Label>HRV (ms)</Label>
          <Input
            type="number"
            {...form.register("hrv_ms", {
              setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
            })}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Notes</Label>
        <Textarea rows={3} {...form.register("notes", { setValueAs: (v) => (v === "" ? null : v) })} />
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Saving..." : "Save readiness"}
      </Button>
    </form>
  )
}
