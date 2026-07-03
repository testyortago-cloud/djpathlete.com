import { z } from "zod"

/** A standing weekly slot for a client (day + time). */
export const recurringSlotSchema = z.object({
  clientUserId: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "HH:MM or HH:MM:SS"),
  durationMinutes: z.number().int().positive().max(600).default(60),
  location: z.string().max(200).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
})

export const recurringSlotUpdateSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).optional(),
  durationMinutes: z.number().int().positive().max(600).optional(),
  location: z.string().max(200).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  status: z.enum(["active", "paused"]).optional(),
})

/** Mutations against a concrete occurrence. */
export const scheduledMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("attended") }),
  z.object({ action: z.literal("no_show") }),
  z.object({ action: z.literal("cancel"), reason: z.string().max(500).nullable().optional() }),
  z.object({
    action: z.literal("reschedule"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  }),
  z.object({ action: z.literal("reassign"), clientUserId: z.string().uuid() }),
])

export const adhocSessionSchema = z.object({
  clientUserId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  durationMinutes: z.number().int().positive().max(600).default(60),
  notes: z.string().max(1000).nullable().optional(),
})

export type RecurringSlotInput = z.infer<typeof recurringSlotSchema>
export type ScheduledMutationInput = z.infer<typeof scheduledMutationSchema>
export type AdhocSessionInput = z.infer<typeof adhocSessionSchema>
