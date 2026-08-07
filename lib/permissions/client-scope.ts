import { listAssignedClientIds } from "@/lib/db/team-members"
import { hasPermission, type PermissionActor } from "@/lib/permissions/registry"

/**
 * Which clients an actor is allowed to see.
 *
 * `all` is the owner. `assigned` is a staff member, and an EMPTY id list means
 * exactly zero clients — never "unfiltered". That inversion is the classic
 * scoping bug (an empty `IN ()` quietly becoming a no-op filter), so callers
 * must branch on `mode` rather than on `clientIds.length`.
 */
export type ClientScope = { mode: "all" } | { mode: "assigned"; clientIds: string[] }

export const NO_CLIENTS: ClientScope = { mode: "assigned", clientIds: [] }

export async function resolveClientScope(actor: PermissionActor | null | undefined): Promise<ClientScope> {
  if (!actor) return NO_CLIENTS
  if (actor.role === "admin") return { mode: "all" }
  if (actor.role !== "staff") return NO_CLIENTS
  if (!hasPermission(actor.permissions, "clients", "view")) return NO_CLIENTS

  return { mode: "assigned", clientIds: await listAssignedClientIds(actorId(actor)) }
}

function actorId(actor: PermissionActor): string {
  if (!actor.id) throw new Error("resolveClientScope requires an actor with an id for staff")
  return actor.id
}

/** May this actor open this specific client record? */
export async function canViewClient(
  actor: PermissionActor | null | undefined,
  clientId: string,
): Promise<boolean> {
  const scope = await resolveClientScope(actor)
  if (scope.mode === "all") return true
  return scope.clientIds.includes(clientId)
}

/**
 * Narrow a list of client ids to what the actor may see. Pure, so the filter
 * itself is testable without a database.
 */
export function applyClientScope(scope: ClientScope, clientIds: string[]): string[] {
  if (scope.mode === "all") return clientIds
  const allowed = new Set(scope.clientIds)
  return clientIds.filter((id) => allowed.has(id))
}

/**
 * Apply the scope to a PostgREST query builder.
 *
 * Returns the builder unchanged for the owner; otherwise constrains it, and
 * for an empty assignment set constrains it to a value that matches nothing —
 * rather than skipping the filter, which would show the whole roster.
 */
export function scopeQueryToClients<T extends { in: (col: string, values: string[]) => T }>(
  query: T,
  scope: ClientScope,
  column = "id",
): T {
  if (scope.mode === "all") return query
  return query.in(column, scope.clientIds.length > 0 ? scope.clientIds : ["00000000-0000-0000-0000-000000000000"])
}
