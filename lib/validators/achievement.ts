import { z } from "zod"

export const celebrateAchievementSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid ID"),
})

export type CelebrateAchievementData = z.infer<
  typeof celebrateAchievementSchema
>
