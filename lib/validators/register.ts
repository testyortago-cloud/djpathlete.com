import { z } from "zod"

function calculateAge(dateOfBirth: string): number {
  const today = new Date()
  const birth = new Date(dateOfBirth)
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return age
}

export const registerSchema = z
  .object({
    firstName: z.string().min(1, "First name is required").max(50),
    lastName: z.string().min(1, "Last name is required").max(50),
    dateOfBirth: z.string().min(1, "Date of birth is required").refine(
      (val) => {
        const date = new Date(val)
        return !isNaN(date.getTime()) && date < new Date()
      },
      { message: "Please enter a valid date of birth" }
    ),
    email: z.string().email("Please enter a valid email"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
    termsAccepted: z.literal(true, {
      message: "You must accept the Terms of Service and Privacy Policy",
    }),
    guardianName: z.string().optional(),
    guardianEmail: z.string().optional(),
    parentalConsent: z.boolean().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
  .superRefine((data, ctx) => {
    const age = calculateAge(data.dateOfBirth)

    if (age < 13) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "You must be at least 13 years old to create an account",
        path: ["dateOfBirth"],
      })
      return
    }

    if (age < 18) {
      if (!data.guardianName || data.guardianName.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Guardian name is required for users under 18",
          path: ["guardianName"],
        })
      }
      if (!data.guardianEmail || data.guardianEmail.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Guardian email is required for users under 18",
          path: ["guardianEmail"],
        })
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.guardianEmail)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please enter a valid guardian email",
          path: ["guardianEmail"],
        })
      }
      if (!data.parentalConsent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Parental consent is required for users under 18",
          path: ["parentalConsent"],
        })
      }
    }
  })

export type RegisterFormData = z.infer<typeof registerSchema>

export { calculateAge }
