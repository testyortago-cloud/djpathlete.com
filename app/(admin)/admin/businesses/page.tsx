import Link from "next/link"
import { requireAdmin } from "@/lib/auth-helpers"
import { listBusinesses } from "@/lib/db/businesses"
import { Button } from "@/components/ui/button"
import {
  DataTableCard,
  DataTable,
  DataTableHeader,
  DataTableHead,
  DataTableRow,
  DataTableCell,
  DataTableEmpty,
  DataTableBadge,
} from "@/components/ui/data-table"

export const metadata = { title: "Businesses" }

/**
 * Owner-only. `/admin/businesses` is in OWNER_ONLY_PREFIXES, so the
 * middleware turns staff away before this renders; requireAdmin() is the
 * second layer.
 */
export default async function BusinessesPage() {
  await requireAdmin()
  const businesses = await listBusinesses({ activeOnly: false })

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-primary">Businesses</h1>
          <p className="font-body text-sm text-muted-foreground">
            Every coach you run this platform for. Each one keeps its own contacts, pipeline, bookings
            and settings.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/businesses/new">Add a business</Link>
        </Button>
      </header>

      <DataTableCard>
        <DataTable>
          <DataTableHeader>
            <DataTableHead>Name</DataTableHead>
            <DataTableHead>Web address</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            <DataTableHead>Created</DataTableHead>
          </DataTableHeader>
          <tbody>
            {businesses.length === 0 ? (
              <DataTableEmpty colSpan={4}>No businesses yet. Add one to get started.</DataTableEmpty>
            ) : (
              businesses.map((b) => (
                <DataTableRow key={b.id}>
                  <DataTableCell>
                    <Link
                      href={`/admin/businesses/${b.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {b.name}
                    </Link>
                  </DataTableCell>
                  <DataTableCell muted>{b.slug}</DataTableCell>
                  <DataTableCell>
                    <DataTableBadge tone={b.status === "active" ? "success" : "neutral"}>
                      {b.status === "active" ? "Active" : "Paused"}
                    </DataTableBadge>
                  </DataTableCell>
                  <DataTableCell muted>{new Date(b.created_at).toLocaleDateString()}</DataTableCell>
                </DataTableRow>
              ))
            )}
          </tbody>
        </DataTable>
      </DataTableCard>
    </div>
  )
}
