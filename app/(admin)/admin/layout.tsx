import { requireAdmin } from "@/lib/auth-helpers"
import { getUserById } from "@/lib/db/users"
import { AdminLayout } from "@/components/admin/AdminLayout"
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
    <AdminLayout avatarUrl={avatarUrl} initials={initials} contentStudioEnabled={isContentStudioEnabled()}>
      {children}
    </AdminLayout>
  )
}
