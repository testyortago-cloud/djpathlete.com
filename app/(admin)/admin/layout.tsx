import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { requireAdminPanelAccess } from "@/lib/permissions/guard"
import { getUserById } from "@/lib/db/users"
import { AdminLayout } from "@/components/admin/AdminLayout"
import { BusinessSwitcher } from "@/components/admin/BusinessSwitcher"
import { SessionExpiryGuard } from "@/components/auth/SessionExpiryGuard"
import { MessagingMount } from "@/components/messaging/MessagingMount"
import { isContentStudioEnabled } from "@/lib/content-studio/feature-flag"
import { NoAccessibleBusinessError, resolveAdminTenant, type ResolvedTenant } from "@/lib/tenancy/resolve"
import { NO_ACCESS_PATH, PAGE_PATH_HEADER } from "@/lib/permissions/registry"

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  // Admits admins and staff; the per-area decision belongs to the middleware
  // and each page's own requirePermission() call.
  const session = await requireAdminPanelAccess()

  // PAGE_PATH_HEADER is a UI HINT ONLY (see its own comment in
  // lib/permissions/registry.ts) -- it carries no authorisation meaning,
  // unlike ADMIN_PATH_HEADER, and must never be used for an access decision.
  // Stamped by proxy.ts on every /admin request it renders. Used here ONLY to
  // tell whether this request is already headed to NO_ACCESS_PATH -- because
  // /admin/no-access is itself a page nested under THIS layout, redirecting
  // to it unconditionally below would redirect from NO_ACCESS_PATH to
  // NO_ACCESS_PATH forever for the exact caller this is meant to help.
  const currentPath = (await headers()).get(PAGE_PATH_HEADER)

  // This wraps EVERY admin page, so an uncaught NoAccessibleBusinessError here
  // is a 500 on every screen at once. An empty allowed set is a real state -- a
  // coach whose only business was paused, or a revoked membership -- so it is
  // caught and redirected to the house "nothing to show" landing rather than
  // left to escape as an error boundary.
  let tenant: ResolvedTenant | null = null
  try {
    tenant = await resolveAdminTenant()
  } catch (err) {
    if (!(err instanceof NoAccessibleBusinessError)) throw err
    // Already on the landing page: render it (with no tenant, which it does
    // not need) instead of bouncing back to itself.
    if (currentPath !== NO_ACCESS_PATH) redirect(NO_ACCESS_PATH)
  }

  let avatarUrl: string | null = null
  let initials = "A"
  try {
    const user = await getUserById(session.user.id)
    avatarUrl = user.avatar_url ?? null
    initials = `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase()
  } catch {
    // Fall through with defaults
  }

  return (
    <>
      <SessionExpiryGuard />
      <AdminLayout
        avatarUrl={avatarUrl}
        initials={initials}
        contentStudioEnabled={isContentStudioEnabled()}
        actor={{ role: session.user.role, permissions: session.user.permissions ?? {} }}
        // A coach with exactly one business (or no resolvable tenant at all,
        // e.g. this very no-access landing) never sees a switcher.
        businessSwitcher={
          tenant && tenant.choices.length > 1 ? (
            <BusinessSwitcher choices={tenant.choices} currentId={tenant.businessId} />
          ) : null
        }
      >
        {children}
      </AdminLayout>
      {/* Outside AdminLayout so the dock is fixed to the viewport, not the
          scrolling content column. */}
      <MessagingMount />
    </>
  )
}
