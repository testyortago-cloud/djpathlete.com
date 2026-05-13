"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
import {
  TEST_TYPES,
  TEST_TYPE_LABELS,
  TEST_TYPE_DEFAULTS,
  reduceTrials,
  performanceTestFormSchema,
  type PerformanceTestFormData,
} from "@/lib/validators/performance-test"

export function LogTestDialog({
  clientUserId,
  defaultTestType,
  trigger,
}: {
  clientUserId?: string
  defaultTestType?: PerformanceTestFormData["test_type"]
  trigger: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const startType = defaultTestType ?? "drop_jump"

  const form = useForm<PerformanceTestFormData>({
    resolver: zodResolver(performanceTestFormSchema),
    defaultValues: {
      test_type: startType,
      custom_name: null,
      result_value: 0,
      result_unit: TEST_TYPE_DEFAULTS[startType].unit,
      trial_values: null,
      best_method: TEST_TYPE_DEFAULTS[startType].best_method,
      test_date: today,
      body_weight_kg: null,
      notes: null,
      video_url: null,
    },
  })

  const trials = form.watch("trial_values")
  const method = form.watch("best_method")

  const onChangeTestType = (next: PerformanceTestFormData["test_type"]) => {
    form.setValue("test_type", next)
    form.setValue("result_unit", TEST_TYPE_DEFAULTS[next].unit)
    form.setValue("best_method", TEST_TYPE_DEFAULTS[next].best_method)
  }

  const onTrialsChange = (raw: string) => {
    const arr = raw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n))
    form.setValue("trial_values", arr.length > 0 ? arr : null)
    if (arr.length > 0) {
      form.setValue("result_value", Number(reduceTrials(arr, method).toFixed(3)))
    }
  }

  async function onSubmit(values: PerformanceTestFormData) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/performance-tests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          clientUserId ? { ...values, client_user_id: clientUserId } : values,
        ),
      })
      if (!res.ok) throw new Error("Save failed")
      const data = await res.json()
      toast.success(data.test.is_pr ? "New PR! 🎯" : "Test logged")
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Log a test</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-2">
            <Label>Test type</Label>
            <Select
              value={form.watch("test_type")}
              onValueChange={onChangeTestType as (v: string) => void}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEST_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TEST_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {form.watch("test_type") === "custom" && (
            <div className="grid gap-2">
              <Label>Custom name</Label>
              <Input {...form.register("custom_name")} />
            </div>
          )}

          <div className="grid gap-2">
            <Label>Trial values (optional, comma-separated)</Label>
            <Input
              placeholder="e.g. 38.2, 38.5, 37.9"
              onChange={(e) => onTrialsChange(e.target.value)}
            />
            {trials && trials.length > 0 && (
              <p className="text-muted-foreground text-xs">
                Best ({method}) = {Number(reduceTrials(trials, method).toFixed(3))}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Result</Label>
              <Input
                type="number"
                step="0.001"
                {...form.register("result_value", { valueAsNumber: true })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Unit</Label>
              <Input {...form.register("result_unit")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Date</Label>
              <Input type="date" {...form.register("test_date")} />
            </div>
            <div className="grid gap-2">
              <Label>Body weight (kg, optional)</Label>
              <Input
                type="number"
                step="0.1"
                {...form.register("body_weight_kg", {
                  setValueAs: (v) => (v === "" ? null : Number(v)),
                })}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Notes</Label>
            <Textarea
              rows={2}
              {...form.register("notes", { setValueAs: (v) => (v === "" ? null : v) })}
            />
          </div>

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Saving..." : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
