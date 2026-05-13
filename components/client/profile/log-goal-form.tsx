"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  GOAL_METRIC_KINDS,
  GOAL_METRIC_KIND_LABELS,
  GOAL_DIRECTIONS,
  athleteGoalFormSchema,
  type AthleteGoalFormData,
} from "@/lib/validators/athlete-goal"
import { TEST_TYPES, TEST_TYPE_LABELS } from "@/lib/validators/performance-test"

export function LogGoalForm({ clientUserId }: { clientUserId?: string }) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<AthleteGoalFormData>({
    resolver: zodResolver(athleteGoalFormSchema),
    defaultValues: {
      metric_kind: "test",
      test_type: "drop_jump",
      target_value: 40,
      target_unit: "cm",
      direction: "higher",
      start_value: null,
      deadline: null,
      notes: null,
    },
  })

  const kind = form.watch("metric_kind")

  async function onSubmit(values: AthleteGoalFormData) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/athlete-goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(clientUserId ? { ...values, client_user_id: clientUserId } : values),
      })
      if (!res.ok) throw new Error("Save failed")
      toast.success("Goal added")
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid gap-2">
        <Label>Metric</Label>
        <Select
          value={form.watch("metric_kind")}
          onValueChange={(v) => form.setValue("metric_kind", v as AthleteGoalFormData["metric_kind"])}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GOAL_METRIC_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {GOAL_METRIC_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {kind === "test" && (
        <div className="grid gap-2">
          <Label>Test type</Label>
          <Select
            value={form.watch("test_type") ?? "drop_jump"}
            onValueChange={(v) => form.setValue("test_type", v as AthleteGoalFormData["test_type"])}
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
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Target value</Label>
          <Input type="number" step="0.001" {...form.register("target_value", { valueAsNumber: true })} />
        </div>
        <div className="grid gap-2">
          <Label>Unit</Label>
          <Input {...form.register("target_unit")} />
        </div>
      </div>

      {kind === "test" && (
        <div className="grid gap-2">
          <Label>Direction</Label>
          <Select
            value={form.watch("direction")}
            onValueChange={(v) => form.setValue("direction", v as AthleteGoalFormData["direction"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GOAL_DIRECTIONS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d === "higher" ? "Higher is better" : "Lower is better"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-2">
        <Label>Deadline (optional)</Label>
        <Input type="date" {...form.register("deadline", { setValueAs: (v) => (v === "" ? null : v) })} />
      </div>

      <div className="grid gap-2">
        <Label>Notes</Label>
        <Textarea rows={2} {...form.register("notes", { setValueAs: (v) => (v === "" ? null : v) })} />
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Saving..." : "Add goal"}
      </Button>
    </form>
  )
}
