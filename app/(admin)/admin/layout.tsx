import { requireAdminPanelAccess } from "@/lib/permissions/guard"
import { getUserById } from "@/lib/db/users"
import { AdminLayout } from "@/components/admin/AdminLayout"
import { SessionExpiryGuard } from "@/components/auth/SessionExpiryGuard"
import { MessagingMount } from "@/components/messaging/MessagingMount"
import { isContentStudioEnabled } from "@/lib/content-studio/feature-flag"

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  // Admits admins and staff; the per-area decision belongs to the middleware
  // and each page's own requirePermission() call.
  const session = await requireAdminPanelAccess()

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
      >
        {children}
      </AdminLayout>
      {/* Outside AdminLayout so the dock is fixed to the viewport, not the
          scrolling content column. */}
      <MessagingMount />
    </>
  )
}
