import { z } from "zod"

export const celebrateAchievementSchema = z.object({
  id: z.string().uuid(),
})

export type CelebrateAchievementData = z.infer<
  typeof celebrateAchievementSchema
>
