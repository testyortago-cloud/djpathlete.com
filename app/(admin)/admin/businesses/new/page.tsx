import { requireAdmin } from "@/lib/auth-helpers"
import { BusinessCreateForm } from "@/components/admin/businesses/BusinessCreateForm"

export const metadata = { title: "Add a business" }

/**
 * Owner-only. `/admin/businesses` is in OWNER_ONLY_PREFIXES, so the
 * middleware turns staff away before this renders; requireAdmin() is the
 * second layer.
 */
export default async function NewBusinessPage() {
  await requireAdmin()

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="font-heading text-2xl text-primary">Add a business</h1>
        <p className="font-body text-sm text-muted-foreground">
          Set up a new coach on this platform. They get their own contacts, pipeline, bookings and
          settings, separate from everyone else.
        </p>
      </header>

      <BusinessCreateForm />
    </div>
  )
}
