import { z } from "zod"

export const SERVICE_TYPES = [
  "in_person",
  "online",
  "assessment",
  "clinic",
  "camp",
] as const

export type ServiceType = (typeof SERVICE_TYPES)[number]

export const SERVICE_LABELS: Record<ServiceType, string> = {
  in_person: "In-Person Coaching",
  online: "Online Coaching",
  assessment: "Assessment & Return to Performance",
  clinic: "Agility Clinic",
  camp: "Performance Camp",
}

export const inquiryFormSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be under 100 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: z
    .string()
    .max(30, "Phone must be under 30 characters")
    .optional()
    .transform((v) => v || null),
  service: z.enum(SERVICE_TYPES, { message: "Please select a service" }),
  sport: z
    .string()
    .max(100, "Sport must be under 100 characters")
    .optional()
    .transform((v) => v || null),
  experience: z
    .string()
    .max(50)
    .optional()
    .transform((v) => v || null),
  goals: z
    .string()
    .min(10, "Please tell us a bit more about your goals")
    .max(2000, "Goals must be under 2000 characters"),
  injuries: z
    .string()
    .max(1000, "Injury info must be under 1000 characters")
    .optional()
    .transform((v) => v || null),
  how_heard: z
    .string()
    .max(200)
    .optional()
    .transform((v) => v || null),
})

export type InquiryFormData = z.infer<typeof inquiryFormSchema>
