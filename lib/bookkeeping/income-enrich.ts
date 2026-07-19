// Pure enrichment stamping for platform-income sources: which users/programs
// to look up, and how the looked-up names fold back onto the rows. Zero IO —
// the DAL fetches, this stamps. Lookup misses stay null (graceful).
import type { IncomeSourceRows } from "./types"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface EnrichmentUser {
  first_name: string | null
  last_name: string | null
  email: string | null
}

export function collectEnrichmentIds(sources: IncomeSourceRows): { userIds: string[]; programIds: string[] } {
  const userIds = new Set<string>()
  const programIds = new Set<string>()
  for (const p of sources.payments) {
    if (p.user_id) userIds.add(p.user_id)
    const pid = (p.metadata as Record<string, unknown> | null)?.programId
    if (typeof pid === "string" && UUID_RE.test(pid)) programIds.add(pid)
  }
  for (const cp of sources.clientPackages) {
    if (cp.client_user_id) userIds.add(cp.client_user_id)
  }
  return { userIds: [...userIds], programIds: [...programIds] }
}

export function fullName(u: EnrichmentUser | undefined): string | null {
  if (!u) return null
  const name = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim()
  return name || null
}

export function stampIncomeEnrichment(
  sources: IncomeSourceRows,
  usersById: Map<string, EnrichmentUser>,
  programNamesById: Map<string, string>,
): IncomeSourceRows {
  return {
    ...sources,
    payments: sources.payments.map((p) => {
      const u = p.user_id ? usersById.get(p.user_id) : undefined
      const pid = (p.metadata as Record<string, unknown> | null)?.programId
      return {
        ...p,
        payer_name: fullName(u),
        payer_email: u?.email ?? null,
        program_name: typeof pid === "string" ? (programNamesById.get(pid) ?? null) : null,
      }
    }),
    clientPackages: sources.clientPackages.map((cp) => ({
      ...cp,
      client_name: fullName(cp.client_user_id ? usersById.get(cp.client_user_id) : undefined),
    })),
  }
}
