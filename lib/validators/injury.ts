import { z } from "zod"

export const BODY_REGIONS = [
  "head",
  "neck",
  "shoulder",
  "elbow",
  "wrist",
  "hand",
  "chest",
  "upper_back",
  "lower_back",
  "hip",
  "glute",
  "hamstring",
  "quad",
  "knee",
  "calf",
  "ankle",
  "foot",
  "other",
] as const

export const BODY_REGION_LABELS: Record<(typeof BODY_REGIONS)[number], string> = {
  head: "Head",
  neck: "Neck",
  shoulder: "Shoulder",
  elbow: "Elbow",
  wrist: "Wrist",
  hand: "Hand",
  chest: "Chest",
  upper_back: "Upper Back",
  lower_back: "Lower Back",
  hip: "Hip",
  glute: "Glute",
  hamstring: "Hamstring",
  quad: "Quad",
  knee: "Knee",
  calf: "Calf",
  ankle: "Ankle",
  foot: "Foot",
  other: "Other",
}

export const INJURY_SIDES = ["left", "right", "bilateral", "n_a"] as const
export const INJURY_SEVERITIES = ["minor", "moderate", "severe"] as const
export const INJURY_STATUSES = ["active", "recovering", "resolved"] as const

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")

export const rehabMilestoneSchema = z.object({
  name: z.string().min(1).max(200),
  target_date: isoDate.nullable(),
  completed_date: isoDate.nullable(),
  notes: z.string().max(1000).nullable(),
})

export const injuryFormSchema = z
  .object({
    body_region: z.enum(BODY_REGIONS),
    side: z.enum(INJURY_SIDES),
    injury_type: z.string().min(1).max(100),
    severity: z.enum(INJURY_SEVERITIES),
    mechanism: z.string().max(500).nullable(),
    description: z.string().max(2000).nullable(),
    date_occurred: isoDate,
    date_resolved: isoDate.nullable(),
    status: z.enum(INJURY_STATUSES),
    rehab_milestones: z.array(rehabMilestoneSchema),
  })
  .refine((d) => !(d.status === "resolved" && !d.date_resolved), {
    message: "Resolved injuries must have a date_resolved",
    path: ["date_resolved"],
  })

export type InjuryFormData = z.infer<typeof injuryFormSchema>
export type RehabMilestoneFormData = z.infer<typeof rehabMilestoneSchema>
