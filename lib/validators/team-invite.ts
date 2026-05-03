import { z } from "zod"

export const sendInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address"),
  role: z.enum(["editor"]),
})

export type SendInviteInput = z.infer<typeof sendInviteSchema>

export const claimInviteSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().min(1, "Last name is required").max(60),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(120, "Password is too long"),
})

export type ClaimInviteInput = z.infer<typeof claimInviteSchema>
