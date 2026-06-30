import { z } from "zod"

export const exerciseFavoriteToggleSchema = z.object({
  exerciseId: z.string().uuid(),
  favorited: z.boolean(),
})
export type ExerciseFavoriteToggleInput = z.infer<typeof exerciseFavoriteToggleSchema>

export const adminExerciseFavoriteSchema = z.object({
  exerciseId: z.string().uuid(),
})
