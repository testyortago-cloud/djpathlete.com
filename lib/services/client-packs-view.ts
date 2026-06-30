import type { ClientPackage, SessionCheckin } from "@/types/database"
import { auth } from "@/lib/auth"
import { listPackagesForClient } from "@/lib/db/client-packages"
import { listCheckinsForPackage } from "@/lib/db/session-checkins"
import { getAssignmentById } from "@/lib/db/assignments"
import { getProgramById } from "@/lib/db/programs"
import { remainingCredits, isExpired } from "@/lib/services/session-credits"

export type PackWithCheckins = ClientPackage & { checkins: SessionCheckin[]; program_name: string | null }

/** A client's packages (newest first), each with its check-in history and the
 *  linked program's name. Shared by the GET route and the client detail page so
 *  there is a single definition of "the pack view". */
export async function loadClientPacksView(clientUserId: string): Promise<PackWithCheckins[]> {
  const packages = await listPackagesForClient(clientUserId)

  // Resolve linked program names once per unique assignment.
  const programNameByAssignment = new Map<string, string | null>()
  for (const a of new Set(packages.map((p) => p.assignment_id).filter((x): x is string => !!x))) {
    try {
      const assignment = await getAssignmentById(a)
      const program = await getProgramById(assignment.program_id)
      programNameByAssignment.set(a, program?.name ?? null)
    } catch {
      programNameByAssignment.set(a, null)
    }
  }

  return Promise.all(
    packages.map(async (p) => ({
      ...p,
      checkins: await listCheckinsForPackage(p.id),
      program_name: p.assignment_id ? (programNameByAssignment.get(p.assignment_id) ?? null) : null,
    })),
  )
}

type PackSlice = Pick<ClientPackage, "status" | "credits_total" | "credits_used" | "expires_at" | "assignment_id">

export interface ClientPacksSummary {
  /** Total credits across packs that would actually be deducted on check-in. */
  activeRemaining: number
  hasActiveCredits: boolean
  /** Per linked assignment, summed over those same active packs. */
  byAssignment: Map<string, { remaining: number; total: number }>
}

/**
 * Pure summary of a client's packs for the detail page. A pack contributes iff
 * it would actually be deducted on a check-in (status `active`, not expired,
 * `remaining > 0`) — mirroring `getActivePackageForClient`. Reuses the credit
 * math in `session-credits.ts` so balances stay defined in one place.
 */
export function summarizeClientPacks(packs: PackSlice[], now: Date): ClientPacksSummary {
  let activeRemaining = 0
  const byAssignment = new Map<string, { remaining: number; total: number }>()

  for (const p of packs) {
    if (p.status !== "active" || isExpired(p, now)) continue
    const rem = remainingCredits(p)
    if (rem <= 0) continue

    activeRemaining += rem
    if (p.assignment_id) {
      const prev = byAssignment.get(p.assignment_id) ?? { remaining: 0, total: 0 }
      byAssignment.set(p.assignment_id, {
        remaining: prev.remaining + rem,
        total: prev.total + p.credits_total,
      })
    }
  }

  return { activeRemaining, hasActiveCredits: activeRemaining > 0, byAssignment }
}

/** Earliest `expires_at` among packs that would actually deduct on check-in
 *  (active, not expired, remaining > 0), or null when none/never expires. */
export function nearestActiveExpiry(packs: PackSlice[], now: Date): string | null {
  let earliest: string | null = null
  for (const p of packs) {
    if (p.status !== "active" || isExpired(p, now) || remainingCredits(p) <= 0) continue
    if (!p.expires_at) continue
    if (!earliest || new Date(p.expires_at) < new Date(earliest)) earliest = p.expires_at
  }
  return earliest
}

export interface MyPacksView {
  packs: PackWithCheckins[]
  summary: ClientPacksSummary
  nearestExpiry: string | null
}

/**
 * The logged-in client's own pack view (null for non-client sessions). The user
 * id comes from the verified session, never from input — safe to use the
 * service-role DALs underneath.
 */
export async function loadMyPacksView(now: Date = new Date()): Promise<MyPacksView | null> {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "client") return null
  const packs = await loadClientPacksView(session.user.id)
  return { packs, summary: summarizeClientPacks(packs, now), nearestExpiry: nearestActiveExpiry(packs, now) }
}
