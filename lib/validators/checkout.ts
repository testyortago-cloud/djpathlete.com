import { z } from "zod"

export const checkoutSchema = z.object({
  programId: z.string().uuid("Invalid program ID"),
  returnUrl: z.string().url().optional(),
})

export type CheckoutData = z.infer<typeof checkoutSchema>
