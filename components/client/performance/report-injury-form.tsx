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
import { BodyMapPicker } from "@/components/shared/body-map/body-map-picker"
import {
  INJURY_SEVERITIES,
  injuryFormSchema,
  type InjuryFormData,
} from "@/lib/validators/injury"

export function ReportInjuryForm({ clientUserId }: { clientUserId?: string }) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<InjuryFormData>({
    resolver: zodResolver(injuryFormSchema),
    defaultValues: {
      body_region: "hamstring",
      side: "n_a",
      injury_type: "",
      severity: "moderate",
      mechanism: null,
      description: null,
      date_occurred: new Date().toISOString().slice(0, 10),
      date_resolved: null,
      status: "active",
      rehab_milestones: [],
    },
  })

  async function onSubmit(values: InjuryFormData) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/injuries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(clientUserId ? { ...values, client_user_id: clientUserId } : values),
      })
      if (!res.ok) throw new Error("Save failed")
      toast.success("Injury reported")
      router.push(clientUserId ? `/admin/clients/${clientUserId}/performance?tab=injuries` : "/client/injuries")
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
        <Label>Body region</Label>
        <BodyMapPicker
          value={{
            region: form.watch("body_region") ?? null,
            side: form.watch("side"),
          }}
          onChange={({ region, side }) => {
            if (region) form.setValue("body_region", region)
            form.setValue("side", side)
          }}
        />
      </div>

      <div className="grid gap-2">
        <Label>Injury type</Label>
        <Input placeholder="strain, sprain, tendinopathy…" {...form.register("injury_type")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Severity</Label>
          <Select
            value={form.watch("severity")}
            onValueChange={(v) => form.setValue("severity", v as InjuryFormData["severity"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INJURY_SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Date occurred</Label>
          <Input type="date" {...form.register("date_occurred")} />
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Mechanism</Label>
        <Textarea
          rows={2}
          placeholder="how did it happen?"
          {...form.register("mechanism", { setValueAs: (v) => (v === "" ? null : v) })}
        />
      </div>

      <div className="grid gap-2">
        <Label>Description</Label>
        <Textarea rows={3} {...form.register("description", { setValueAs: (v) => (v === "" ? null : v) })} />
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Saving..." : "Report injury"}
      </Button>
    </form>
  )
}
