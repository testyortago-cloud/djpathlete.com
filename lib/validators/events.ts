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
  location_name: z.string().min(1).max(200),
  location_address: z.string().max(300).optional().nullable(),
  location_map_url: z.string().url().max(500).optional().nullable(),
  capacity: z.number().int().min(1).max(500),
  hero_image_url: z.string().url().max(500).optional().nullable(),
  status: z.enum(EVENT_STATUSES).default("draft"),
  age_min: z.number().int().min(6).max(21).optional().nullable(),
  age_max: z.number().int().min(6).max(21).optional().nullable(),
})

const ageRefine = (d: { age_min?: number | null; age_max?: number | null }) =>
  d.age_min == null || d.age_max == null || d.age_max >= d.age_min

const clinicEvent = eventBase
  .extend({
    type: z.literal("clinic"),
    start_date: z.string().datetime(),
  })
  .refine(ageRefine, { message: "age_max must be >= age_min", path: ["age_max"] })

const campEvent = eventBase
  .extend({
    type: z.literal("camp"),
    start_date: z.string().datetime(),
    end_date: z.string().datetime(),
    session_schedule: z.string().max(200).optional().nullable(),
    price_dollars: z.number().nonnegative().max(10000).optional().nullable(),
  })
  .refine(ageRefine, { message: "age_max must be >= age_min", path: ["age_max"] })

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

export type CreateEventInput = z.infer<typeof createEventSchema>
export type UpdateEventInput = z.infer<typeof updateEventSchema>
