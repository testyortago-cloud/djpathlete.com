import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import {
  canAccessPath,
  hasPermission,
  staffHomePath,
  NO_ACCESS_PATH,
  type PermissionActor,
  type PermissionKey,
  type PermissionTier,
} from "@/lib/permissions/registry"

/**
 * Impure adapter over the pure registry. Everything that needs a session, a
 * redirect or a Request lives here so `registry.ts` stays testable on its own.
 */

/** Pull the pathname off a Request without throwing on a relative URL. */
function pathnameOf(request: { url: string }): string {
  try {
    return new URL(request.url).pathname
  } catch {
    // Relative URL (some test doubles). Strip query/hash and use as-is.
    return request.url.split("?")[0].split("#")[0]
  }
}

/**
 * The API-route guard. Drop-in replacement for `session.user.role !== "admin"`:
 *
 *     if (!session?.user?.id || !canAccessAdminPath(session.user, request)) {
 *       return NextResponse.json({ error: "Forbidden" }, { status: 403 })
 *     }
 *
 * Returns `true` for `admin` on every path, so adopting it cannot change the
 * owner's behaviour anywhere — that property is asserted in the registry tests.
 */
export function canAccessAdminPath(
  user: PermissionActor | null | undefined,
  request: { url: string; method?: string },
): boolean {
  if (!user) return false
  if (user.role === "admin") return true
  return canAccessPath(user, pathnameOf(request), request.method)
}

/** Non-redirecting check for server components that render partial UI. */
export async function currentActor(): Promise<PermissionActor | null> {
  const session = await auth()
  if (!session?.user) return null
  return { role: session.user.role, permissions: session.user.permissions ?? {} }
}

/**
 * Page guard. Admins pass. Staff pass when they hold `permission` at `tier`.
 * Anyone else is sent somewhere they can actually be — never to a page that
 * would bounce them again.
 */
export async function requirePermission(permission: PermissionKey, tier: PermissionTier = "view") {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const role = session.user.role
  if (role === "admin") return session

  if (role !== "staff") {
    redirect(role === "editor" ? "/editor" : "/client/dashboard")
  }

  const permissions = session.user.permissions ?? {}
  if (!hasPermission(permissions, permission, tier)) {
    const home = staffHomePath(permissions)
    // Bouncing someone from their own landing page would loop.
    redirect(home === NO_ACCESS_PATH ? NO_ACCESS_PATH : `${NO_ACCESS_PATH}?from=${permission}`)
  }

  return session
}

/**
 * Layout-level guard: admits admins and any staff member, leaving the
 * per-area decision to `requirePermission` and the middleware. Replaces
 * `requireAdmin()` in the admin layout only.
 */
export async function requireAdminPanelAccess() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const role = session.user.role
  if (role === "admin" || role === "staff") return session

  redirect(role === "editor" ? "/editor" : "/client/dashboard")
}
