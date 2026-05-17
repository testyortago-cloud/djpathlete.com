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
            Always-on programs the ads agent can propose campaigns for. Specific
            clinic/camp instances live under Events — the agent reads from both. Only
            rows with status &quot;active&quot; are visible to the agent.
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
            No products yet. Click &quot;New product&quot; to seed one — the agent
            will start considering it on the next memo run.
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <div className="p-4 border-b border-border/60 flex items-center gap-3">
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              {products.length} total · {activeCount} active
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">Slug</th>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Conversion</th>
                <th className="text-left p-3">Price</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.slug} className="border-t border-border/60 hover:bg-surface/40">
                  <td className="p-3 font-mono text-xs">
                    <Link
                      href={`/admin/marketing/products/${p.slug}`}
                      className="text-accent hover:underline"
                    >
                      {p.slug}
                    </Link>
                  </td>
                  <td className="p-3">{p.name}</td>
                  <td className="p-3 font-mono text-xs">{p.conversion_type}</td>
                  <td className="p-3 font-mono text-xs">
                    {p.price_cents != null ? `$${(p.price_cents / 100).toFixed(2)}` : "—"}
                  </td>
                  <td className="p-3 text-xs">
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
                  </td>
                  <td className="p-3 text-xs text-muted-foreground text-right">
                    {new Date(p.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
