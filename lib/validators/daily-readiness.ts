import { z } from "zod"

const rating = z.number().int().min(1).max(5)

export const READINESS_FIELDS = [
  { key: "sleep_quality", label: "Sleep Quality", inverted: false },
  { key: "soreness_overall", label: "Soreness", inverted: true },
  { key: "fatigue", label: "Fatigue", inverted: true },
  { key: "mood", label: "Mood", inverted: false },
  { key: "stress", label: "Stress", inverted: true },
  { key: "hydration", label: "Hydration", inverted: false },
] as const

export const readinessFormSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  sleep_hours: z.number().min(0).max(24).nullable(),
  sleep_quality: rating,
  soreness_overall: rating,
  soreness_by_region: z.record(z.string(), rating),
  fatigue: rating,
  mood: rating,
  stress: rating,
  hydration: rating,
  resting_hr: z.number().int().min(20).max(200).nullable(),
  hrv_ms: z.number().int().min(0).max(500).nullable(),
  notes: z.string().max(2000).nullable(),
})

export type ReadinessFormData = z.infer<typeof readinessFormSchema>
