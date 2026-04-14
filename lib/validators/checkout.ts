import { z } from "zod"

export const checkoutSchema = z.object({
  programId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid program ID"),
  returnUrl: z.string().startsWith("/").max(200).optional(),
})

export type CheckoutData = z.infer<typeof checkoutSchema>
