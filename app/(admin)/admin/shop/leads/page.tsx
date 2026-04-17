import { listLeads } from "@/lib/db/shop-leads"
import { listAllProducts } from "@/lib/db/shop-products"
import { LeadsTable } from "./LeadsTable"

type PageProps = { searchParams: Promise<{ product_id?: string; status?: string }> }

export default async function AdminShopLeadsPage({ searchParams }: PageProps) {
  const { product_id, status } = await searchParams
  const products = await listAllProducts()
  const leads = await listLeads({
    productId: product_id,
    status: status as "pending" | "synced" | "failed" | undefined,
    limit: 500,
  })
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-2xl">Shop leads</h1>
        <a
          href={`/api/admin/shop/leads/export${product_id ? `?product_id=${product_id}` : ""}`}
          className="rounded border px-3 py-1.5 text-sm"
        >
          Export CSV
        </a>
      </div>
      <LeadsTable leads={leads} products={products} initialFilter={{ product_id, status }} />
    </div>
  )
}
