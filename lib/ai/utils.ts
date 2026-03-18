import type { ProgramCategory } from "@/types/database"

export function deriveProgramCategory(goals: string[]): ProgramCategory {
  const goalSet = new Set(goals.map((g) => g.toLowerCase()))

  if (goalSet.has("muscle_gain") && goalSet.has("endurance")) return "hybrid"
  if (goalSet.has("muscle_gain") || goalSet.has("weight_loss")) return "strength"
  if (goalSet.has("endurance")) return "conditioning"
  if (goalSet.has("sport_specific")) return "sport_specific"
  if (goalSet.has("flexibility")) return "recovery"
  if (goalSet.has("general_health")) return "hybrid"

  return "strength"
}
