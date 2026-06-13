import type { ClientPackage, ClientPackageStatus, PackReminderThreshold } from "@/types/database"

// ─── Pure credit math (single source of truth for balance) ───────────────────

type PackLike = Pick<ClientPackage, "credits_total" | "credits_used" | "expires_at">

export function remainingCredits(p: Pick<ClientPackage, "credits_total" | "credits_used">): number {
  return Math.max(0, p.credits_total - p.credits_used)
}

export function isExpired(p: Pick<ClientPackage, "expires_at">, now: Date): boolean {
  if (!p.expires_at) return false
  return new Date(p.expires_at).getTime() <= now.getTime()
}

export function packStatusAfter(p: PackLike, now: Date): ClientPackageStatus {
  if (isExpired(p, now)) return "expired"
  return remainingCredits(p) <= 0 ? "depleted" : "active"
}

/** Highest-priority reminder threshold this pack has reached, or null. */
export function reminderThreshold(
  p: PackLike,
  now: Date,
  lowAt: number,
  expiryDays: number,
): PackReminderThreshold | null {
  if (isExpired(p, now)) return null // already expired — not a renewal nudge
  const rem = remainingCredits(p)
  if (rem <= 0) return "empty"
  if (p.expires_at) {
    const days = (new Date(p.expires_at).getTime() - now.getTime()) / 86_400_000
    if (days <= expiryDays) return "expiring"
  }
  if (rem <= lowAt) return "low"
  return null
}

/** purchased_at + validityDays → ISO expires_at, or null when no validity window. */
export function expiresAtFrom(purchasedAtIso: string, validityDays: number | null): string | null {
  if (validityDays == null) return null
  const d = new Date(purchasedAtIso)
  d.setUTCDate(d.getUTCDate() + validityDays)
  return d.toISOString()
}
