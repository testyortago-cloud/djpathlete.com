import { requireAdmin } from "@/lib/auth-helpers"
import { getUserById } from "@/lib/db/users"
import { AdminLayout } from "@/components/admin/AdminLayout"
import { SessionExpiryGuard } from "@/components/auth/SessionExpiryGuard"
import { MessagingMount } from "@/components/messaging/MessagingMount"
import { isContentStudioEnabled } from "@/lib/content-studio/feature-flag"

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin()

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
      <AdminLayout avatarUrl={avatarUrl} initials={initials} contentStudioEnabled={isContentStudioEnabled()}>
        {children}
      </AdminLayout>
      {/* Outside AdminLayout so the dock is fixed to the viewport, not the
          scrolling content column. */}
      <MessagingMount />
    </>
  )
}
