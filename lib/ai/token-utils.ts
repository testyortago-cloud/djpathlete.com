/**
 * Token estimation utilities for pre-flight budget checks.
 * Uses chars/4 heuristic — intentionally simple and fast.
 */

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function checkTokenBudget(
  system: string,
  user: string,
  maxTokens: number
): { estimated: number; fits: boolean; overage: number } {
  const estimated = estimateTokens(system) + estimateTokens(user)
  const overage = Math.max(0, estimated - maxTokens)
  return { estimated, fits: estimated <= maxTokens, overage }
}
