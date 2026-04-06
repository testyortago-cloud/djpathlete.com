import { z } from "zod"

export const waiverConsentSchema = z.object({
  programId: z.string().uuid("Invalid program ID"),
})

export type WaiverConsentData = z.infer<typeof waiverConsentSchema>
