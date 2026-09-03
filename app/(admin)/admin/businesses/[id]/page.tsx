import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/auth-helpers"
import { getBusiness, getBusinessSettings, BusinessSettingsMissingError } from "@/lib/db/businesses"
import { resolveAdminTenant, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { DataTableBadge } from "@/components/ui/data-table"
import { BusinessSettingsForm } from "@/components/admin/businesses/BusinessSettingsForm"

export const metadata = { title: "Business settings" }

/**
 * Owner-only today (`/admin/businesses` is in OWNER_ONLY_PREFIXES, so the
 * middleware turns staff away before this renders) -- but the permitted
 * check below is repeated anyway, the same one `PATCH
 * /api/admin/businesses/[id]` runs. A page that renders what the API would
 * refuse is the same bug facing the other way, and this check is what keeps
 * that true if a later task ever opens this page to non-owner staff.
 */
export default async function BusinessDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params

  let tenant
  try {
    tenant = await resolveAdminTenant()
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) notFound()
    throw err
  }

  const permitted = tenant.isOperator || tenant.choices.some((c) => c.id === id)
  if (!permitted) notFound()

  const business = await getBusiness(id)
  if (!business) notFound()

  // create_business always writes the settings row; a business without one
  // can only exist if it was created outside that function. Either way, a
  // missing row is a 404, not a 500.
  let settings
  try {
    settings = await getBusinessSettings(id)
  } catch (err) {
    if (err instanceof BusinessSettingsMissingError) notFound()
    throw err
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-primary">{business.name}</h1>
          <p className="font-body text-sm text-muted-foreground">{business.slug}</p>
        </div>
        <DataTableBadge tone={business.status === "active" ? "success" : "neutral"}>
          {business.status === "active" ? "Active" : "Paused"}
        </DataTableBadge>
      </header>

      <BusinessSettingsForm businessId={business.id} settings={settings} />
    </div>
  )
}
