import { ShoppingCart, AlertCircle, Factory, Truck } from "lucide-react"
import { listOrders, getOrderStats } from "@/lib/db/shop-orders"
import { ShopOrdersTable } from "@/components/admin/shop/orders/ShopOrdersTable"
import { FinancialsPanel } from "@/components/admin/shop/orders/FinancialsPanel"

export const metadata = { title: "Shop Orders · Admin" }

export default async function ShopOrdersPage() {
  const [orders, stats] = await Promise.all([listOrders(), getOrderStats()])

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-heading text-primary">Shop Orders</h1>
        <p className="text-sm text-muted-foreground">View and manage customer orders</p>
      </div>

      {/* Operational queue */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={ShoppingCart} label="Today" value={stats.today} />
        <StatCard icon={AlertCircle} label="Needs Action" value={stats.needs_action} />
        <StatCard icon={Factory} label="In Production" value={stats.in_production} />
        <StatCard icon={Truck} label="Shipped This Week" value={stats.shipped_this_week} />
      </div>

      {/* Financials + profit breakdown */}
      <FinancialsPanel stats={stats} />

      <ShopOrdersTable orders={orders} />
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
