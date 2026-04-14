import { z } from "zod"

export const weekAccessSchema = z.object({
  access_type: z.enum(["included", "paid"]),
  price_cents: z.number().int().min(0).nullable().optional(),
})

export const addWeekWithAccessSchema = z
  .object({
    access_type: z.enum(["included", "paid"]).default("included"),
    price_cents: z.number().int().min(50).nullable().optional(),
  })
  .refine((data) => data.access_type === "included" || (data.price_cents && data.price_cents > 0), {
    message: "Paid weeks must have a price",
    path: ["price_cents"],
  })

export const weekCheckoutSchema = z.object({
  assignmentId: z.string().uuid(),
  weekNumber: z.number().int().min(1),
})

export type WeekAccessFormData = z.infer<typeof weekAccessSchema>
export type AddWeekWithAccessFormData = z.infer<typeof addWeekWithAccessSchema>
export type WeekCheckoutFormData = z.infer<typeof weekCheckoutSchema>
