const attempts = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): { ok: boolean; remaining: number } {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: max - 1 }
  }
  entry.count += 1
  if (entry.count > max) return { ok: false, remaining: 0 }
  return { ok: true, remaining: max - entry.count }
}
