import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import {
  canAccessPath,
  hasPermission,
  homeForRole,
  staffHomePath,
  NO_ACCESS_PATH,
  ADMIN_PATH_HEADER,
  ADMIN_METHOD_HEADER,
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
 *     if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
 *       return NextResponse.json({ error: "Forbidden" }, { status: 403 })
 *     }
 *
 * Returns `true` for `admin` on every path, so adopting it cannot change the
 * owner's behaviour anywhere — that property is asserted in the registry tests.
 *
 * For staff it re-derives the permission from the middleware-stamped path
 * header (see ADMIN_PATH_HEADER). Independent re-evaluation, not a rubber
 * stamp: if the header is missing, this denies. Pass `request` explicitly when
 * you have it and want to skip the header entirely.
 */
export async function canAccessAdminPath(
  user: PermissionActor | null | undefined,
  request?: { url: string; method?: string },
): Promise<boolean> {
  if (!user) return false
  if (user.role === "admin") return true
  if (user.role !== "staff") return false

  if (request) return canAccessPath(user, pathnameOf(request), request.method)

  const headerList = await headers()
  const pathname = headerList.get(ADMIN_PATH_HEADER)
  // No stamp means the middleware did not run for this request. Denying is the
  // safe reading — the alternative is granting on the strength of a gate we
  // cannot confirm fired.
  if (!pathname) return false

  return canAccessPath(user, pathname, headerList.get(ADMIN_METHOD_HEADER) ?? undefined)
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
    redirect(homeForRole(role, session.user.permissions))
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
