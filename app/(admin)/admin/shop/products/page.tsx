import { ShoppingBag, Star, CheckCircle2, RefreshCw } from "lucide-react"
import { listAllProducts } from "@/lib/db/shop-products"
import { ShopProductsTable } from "./ShopProductsTable"
import { SyncButton } from "./SyncButton"

export const metadata = { title: "Shop Products · Admin" }

export default async function ShopProductsPage() {
  const products = await listAllProducts()
  const total = products.length
  const active = products.filter((p) => p.is_active).length
  const featured = products.filter((p) => p.is_featured).length
  const lastSync = products.reduce<string | null>(
    (acc, p) => (p.last_synced_at && (!acc || p.last_synced_at > acc) ? p.last_synced_at : acc),
    null,
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-heading text-primary">Shop Products</h1>
          <p className="text-sm text-muted-foreground">Manage products synced from Printful</p>
        </div>
        <SyncButton />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard icon={ShoppingBag} label="Total" value={total} />
        <StatCard icon={CheckCircle2} label="Active" value={active} />
        <StatCard icon={Star} label="Featured" value={featured} />
        <StatCard
          icon={RefreshCw}
          label="Last Sync"
          value={lastSync ? new Date(lastSync).toLocaleDateString() : "Never"}
        />
      </div>

      <ShopProductsTable products={products} />
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
}) {
  return (
    <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
      <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="size-3.5 sm:size-4 text-primary" />
      </div>
      <div>
        <p className="text-[10px] sm:text-xs text-muted-foreground">{label}</p>
        <p className="text-lg sm:text-2xl font-semibold text-primary">{value}</p>
      </div>
    </div>
  )
}
