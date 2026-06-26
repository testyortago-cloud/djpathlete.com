import type { ClientPackage, SessionCheckin } from "@/types/database"
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
