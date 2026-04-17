import { DollarSign, TrendingUp, Percent, Shirt, Download } from "lucide-react"
import { cn } from "@/lib/utils"
import type { OrderStats } from "@/lib/db/shop-orders"

interface FinancialsPanelProps {
  stats: OrderStats
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function fmtCents(cents: number): string {
  return usd.format(cents / 100)
}

function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`
}

export function FinancialsPanel({ stats }: FinancialsPanelProps) {
  const {
    revenue_all_time_cents,
    shipping_collected_cents,
    subtotal_all_cents,
    gross_profit_cents,
    gross_margin_bps,
    cogs_pod_cents,
    subtotal_pod_cents,
    pod_profit_cents,
    pod_margin_bps,
    pod_orders_count,
    subtotal_digital_cents,
    digital_profit_cents,
    digital_margin_bps,
    digital_orders_count,
  } = stats

  return (
    <section className="bg-white rounded-xl border border-border p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-heading text-primary">Financials</h2>
          <p className="text-xs text-muted-foreground">
            Revenue, costs, and gross margin across all completed orders.
          </p>
        </div>
      </div>

      {/* Top-line metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <BigStat
          icon={DollarSign}
          label="Revenue (All Time)"
          primary={fmtCents(revenue_all_time_cents)}
          secondary={
            shipping_collected_cents > 0
              ? `incl. ${fmtCents(shipping_collected_cents)} shipping`
              : "products only"
          }
        />
        <BigStat
          icon={DollarSign}
          label="Product Revenue"
          primary={fmtCents(subtotal_all_cents)}
          secondary="excludes shipping"
          tone="neutral"
        />
        <BigStat
          icon={TrendingUp}
          label="Gross Profit"
          primary={fmtCents(gross_profit_cents)}
          secondary={`COGS ${fmtCents(cogs_pod_cents)}`}
          tone="positive"
        />
        <BigStat
          icon={Percent}
          label="Gross Margin"
          primary={fmtBps(gross_margin_bps)}
          secondary="profit / product revenue"
          tone="positive"
        />
      </div>

      {/* Per-type breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        <BreakdownCard
          icon={Shirt}
          label="Print-on-Demand"
          orders={pod_orders_count}
          revenue={subtotal_pod_cents}
          cogs={cogs_pod_cents}
          profit={pod_profit_cents}
          marginBps={pod_margin_bps}
        />
        <BreakdownCard
          icon={Download}
          label="Digital"
          orders={digital_orders_count}
          revenue={subtotal_digital_cents}
          cogs={0}
          profit={digital_profit_cents}
          marginBps={digital_margin_bps}
        />
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Margin uses product revenue (subtotal). Shipping is treated as pass-through.
        POD costs come from the order&apos;s Printful cost snapshot, falling back to the
        current variant cost for legacy orders without a snapshot.
      </p>
    </section>
  )
}

function BigStat({
  icon: Icon,
  label,
  primary,
  secondary,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  primary: string
  secondary?: string
  tone?: "neutral" | "positive"
}) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 p-3 sm:p-4">
      <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p
        className={cn(
          "mt-1.5 font-heading text-xl sm:text-2xl font-semibold",
          tone === "positive" ? "text-primary" : "text-foreground",
        )}
      >
        {primary}
      </p>
      {secondary && (
        <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">{secondary}</p>
      )}
    </div>
  )
}

function BreakdownCard({
  icon: Icon,
  label,
  orders,
  revenue,
  cogs,
  profit,
  marginBps,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  orders: number
  revenue: number
  cogs: number
  profit: number
  marginBps: number
}) {
  const empty = orders === 0
  return (
    <div
      className={cn(
        "rounded-lg border p-4 space-y-3",
        empty ? "border-dashed border-border bg-transparent" : "border-border bg-surface/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-3.5" />
          </div>
          <h3 className="font-heading text-sm font-semibold text-primary">{label}</h3>
        </div>
        <span className="text-[11px] font-mono text-muted-foreground">
          {orders} order{orders === 1 ? "" : "s"}
        </span>
      </div>

      {empty ? (
        <p className="text-xs text-muted-foreground">No sales yet.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-sm">
          <dt className="text-xs text-muted-foreground">Revenue</dt>
          <dd className="text-right font-medium">{fmtCents(revenue)}</dd>

          <dt className="text-xs text-muted-foreground">COGS</dt>
          <dd className="text-right font-medium text-muted-foreground">
            {cogs === 0 ? "—" : fmtCents(cogs)}
          </dd>

          <dt className="text-xs text-muted-foreground pt-2 border-t border-border">
            Gross Profit
          </dt>
          <dd className="text-right font-semibold text-primary pt-2 border-t border-border">
            {fmtCents(profit)}
          </dd>

          <dt className="text-xs text-muted-foreground">Margin</dt>
          <dd className="text-right font-medium text-primary">{fmtBps(marginBps)}</dd>
        </dl>
      )}
    </div>
  )
}
