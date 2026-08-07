import {
  DataTable,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableToolbar,
} from "@/components/ui/data-table"

import Link from "next/link"
import { Plus, Package } from "lucide-react"
import { listMarketingProducts } from "@/lib/db/marketing-products"

export const metadata = { title: "Marketing Products — DJP Athlete" }
export const dynamic = "force-dynamic"

export default async function MarketingProductsPage() {
  const products = await listMarketingProducts()
  const activeCount = products.filter((p) => p.status === "active").length

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="size-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Package className="size-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-heading text-primary">Marketing Products</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Always-on programs the ads agent can propose campaigns for. Specific clinic/camp instances live under Events
            — the agent reads from both. Only rows with status &quot;active&quot; are visible to the agent.
          </p>
        </div>
        <Link
          href="/admin/marketing/products/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          <Plus className="size-4" />
          New product
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-10 text-center bg-surface">
          <p className="text-sm text-muted-foreground">
            No products yet. Click &quot;New product&quot; to seed one — the agent will start considering it on the next
            memo run.
          </p>
        </div>
      ) : (
        <DataTableCard>
          <DataTableToolbar className="items-center gap-3">
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              {products.length} total · {activeCount} active
            </p>
          </DataTableToolbar>
          <DataTable>
            <DataTableHeader>
              <DataTableHead>Slug</DataTableHead>
              <DataTableHead>Name</DataTableHead>
              <DataTableHead>Conversion</DataTableHead>
              <DataTableHead>Price</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead align="right">Updated</DataTableHead>
            </DataTableHeader>
            <tbody>
              {products.map((p) => (
                <DataTableRow key={p.slug} className="hover:bg-surface/40">
                  <DataTableCell className="font-mono text-xs">
                    <Link href={`/admin/marketing/products/${p.slug}`} className="text-accent hover:underline">
                      {p.slug}
                    </Link>
                  </DataTableCell>
                  <DataTableCell>{p.name}</DataTableCell>
                  <DataTableCell className="font-mono text-xs">{p.conversion_type}</DataTableCell>
                  <DataTableCell className="font-mono text-xs">
                    {p.price_cents != null ? `$${(p.price_cents / 100).toFixed(2)}` : "—"}
                  </DataTableCell>
                  <DataTableCell className="text-xs">
                    <span
                      className={
                        p.status === "active"
                          ? "text-success"
                          : p.status === "draft"
                            ? "text-warning"
                            : "text-muted-foreground"
                      }
                    >
                      {p.status}
                    </span>
                  </DataTableCell>
                  <DataTableCell align="right" muted className="text-xs">
                    {new Date(p.updated_at).toLocaleDateString()}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        </DataTableCard>
      )}
    </div>
  )
}
