import { z } from "zod"

export const EVENT_TYPES = ["clinic", "camp"] as const
export const EVENT_STATUSES = ["draft", "published", "cancelled", "completed"] as const

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const eventBase = z.object({
  title: z.string().min(2).max(120),
  slug: z.string().regex(slugRegex, "Slug must be lowercase letters, numbers, and hyphens").min(2).max(120),
  summary: z.string().min(1).max(300),
  description: z.string().min(1).max(5000),
  focus_areas: z.array(z.string().min(1).max(40)).default([]),
  audience: z.array(z.string().min(1).max(200)).default([]),
  location_name: z.string().min(1).max(200),
  location_address: z.string().max(300).optional().nullable(),
  location_map_url: z.string().url().max(500).optional().nullable(),
  capacity: z.number().int().min(1).max(500),
  hero_image_url: z.string().url().max(500).optional().nullable(),
  status: z.enum(EVENT_STATUSES).default("draft"),
  age_min: z.number().int().nonnegative().optional().nullable(),
  age_max: z.number().int().nonnegative().optional().nullable(),
})

const ageRefine = (d: { age_min?: number | null; age_max?: number | null }) =>
  d.age_min == null || d.age_max == null || d.age_max >= d.age_min

const clinicEvent = eventBase
  .extend({
    type: z.literal("clinic"),
    start_date: z.string().datetime(),
    // Optional override. When blank, the DAL auto-sets end_date = start + 2h.
    end_date: z.string().datetime().optional().nullable(),
    price_dollars: z.number().nonnegative().max(10000).optional().nullable(),
  })
  .refine(ageRefine, { message: "age_max must be >= age_min", path: ["age_max"] })

// Camps store their daily session window in the time-of-day of start/end
// (start's time = daily start, end's time = daily end). 00:00 on both means
// "no daily times set" (legacy date-only camps).
const campDailyTimesOrdered = (d: { start_date: string; end_date: string }) => {
  const start = d.start_date.slice(11, 16)
  const end = d.end_date.slice(11, 16)
  return (start === "00:00" && end === "00:00") || end > start
}

const campEvent = eventBase
  .extend({
    type: z.literal("camp"),
    start_date: z.string().datetime(),
    end_date: z.string().datetime(),
    session_schedule: z.string().max(200).optional().nullable(),
    price_dollars: z.number().nonnegative().max(10000).optional().nullable(),
  })
  .refine(ageRefine, { message: "age_max must be >= age_min", path: ["age_max"] })
  .refine((d) => d.end_date.slice(0, 10) >= d.start_date.slice(0, 10), {
    message: "End date must be on or after the start date",
    path: ["end_date"],
  })
  .refine(campDailyTimesOrdered, {
    message: "Daily end time must be after the daily start time",
    path: ["end_date"],
  })

export const createEventSchema = z.discriminatedUnion("type", [clinicEvent, campEvent])

export const updateEventSchema = eventBase
  .partial()
  .extend({
    start_date: z.string().datetime().optional(),
    end_date: z.string().datetime().optional().nullable(),
    session_schedule: z.string().max(200).optional().nullable(),
    price_dollars: z.number().nonnegative().max(10000).optional().nullable(),
  })
  .refine(ageRefine, { message: "age_max must be >= age_min", path: ["age_max"] })
  .refine(
    (d) => !d.start_date || !d.end_date || d.end_date.slice(0, 10) >= d.start_date.slice(0, 10),
    { message: "End date must be on or after the start date", path: ["end_date"] },
  )

export type CreateEventInput = z.infer<typeof createEventSchema>
export type UpdateEventInput = z.infer<typeof updateEventSchema>
