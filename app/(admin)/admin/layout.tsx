import { requireAdmin } from "@/lib/auth-helpers"
import { AdminLayout } from "@/components/admin/AdminLayout"

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()

  return <AdminLayout>{children}</AdminLayout>
}
