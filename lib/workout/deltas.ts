/**
 * Compare the client's current top-set weight against their last logged session
 * of the same exercise. Returns an absolute percentage and a direction so the UI
 * can render a green ↑ / red ↓ chip. `neutral` when there's nothing to compare.
 */
export function computeExerciseDelta(
  currentTopSetKg: number | null,
  history: Array<{ weight_kg: number | null }>,
): { pct: number | null; direction: "up" | "down" | "neutral" } {
  const last =
    history.find((h) => typeof h.weight_kg === "number" && (h.weight_kg ?? 0) > 0)?.weight_kg ?? null
  if (currentTopSetKg == null || currentTopSetKg <= 0 || last == null || last <= 0) {
    return { pct: null, direction: "neutral" }
  }
  const pct = Math.round(((currentTopSetKg - last) / last) * 100)
  return { pct: Math.abs(pct), direction: pct > 0 ? "up" : pct < 0 ? "down" : "neutral" }
}
