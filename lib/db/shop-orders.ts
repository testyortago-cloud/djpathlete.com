import { createServiceRoleClient } from "@/lib/supabase"
import type { ShopOrder, ShopOrderItem, ShopOrderStatus } from "@/types/database"
import { generateOrderNumber } from "@/lib/shop/order-number"

function getClient() {
  return createServiceRoleClient()
}

const STATUS_ORDER: Record<ShopOrderStatus, number> = {
  pending: 0,
  paid: 1,
  draft: 2,
  confirmed: 3,
  in_production: 4,
  shipped: 5,
  fulfilled_digital: 6,
  canceled: 90,
  refunded: 91,
}

export function canTransition(from: ShopOrderStatus, to: ShopOrderStatus): boolean {
  if (to === "canceled" || to === "refunded") return true
  return STATUS_ORDER[to] > STATUS_ORDER[from]
}

export async function createOrder(
  input: Omit<
    ShopOrder,
    | "id"
    | "order_number"
    | "created_at"
    | "updated_at"
    | "shipped_at"
    | "stripe_session_id"
    | "stripe_payment_intent_id"
    | "printful_order_id"
    | "tracking_number"
    | "tracking_url"
    | "carrier"
    | "refund_amount_cents"
  >,
): Promise<ShopOrder> {
  const supabase = getClient()
  for (let attempt = 0; attempt < 3; attempt++) {
    const order_number = generateOrderNumber()
    const { data, error } = await supabase
      .from("shop_orders")
      .insert({ ...input, order_number })
      .select()
      .single()
    if (!error) return data as ShopOrder
    const code = (error as { code?: string }).code
    if (code !== "23505") throw error
  }
  throw new Error("Failed to generate unique order_number after 3 attempts")
}

export async function getOrderById(id: string): Promise<ShopOrder | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("shop_orders").select("*").eq("id", id).single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopOrder
}

export async function getOrderByNumber(orderNumber: string): Promise<ShopOrder | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_orders")
    .select("*")
    .eq("order_number", orderNumber)
    .single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopOrder
}

export async function getOrderByStripeSessionId(sessionId: string): Promise<ShopOrder | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_orders")
    .select("*")
    .eq("stripe_session_id", sessionId)
    .single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopOrder
}

export async function updateOrder(
  id: string,
  updates: Partial<Omit<ShopOrder, "id" | "created_at" | "order_number">>,
): Promise<ShopOrder> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_orders")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as ShopOrder
}

export async function updateOrderStatus(
  id: string,
  next: ShopOrderStatus,
  extra: Partial<ShopOrder> = {},
): Promise<ShopOrder> {
  const current = await getOrderById(id)
  if (!current) throw new Error(`Order ${id} not found`)
  if (current.status === next) return current
  if (!canTransition(current.status, next)) {
    throw new Error(`Invalid status transition: ${current.status} → ${next}`)
  }
  return updateOrder(id, { status: next, ...extra })
}

export async function listOrders(
  opts: {
    status?: ShopOrderStatus | ShopOrderStatus[]
    limit?: number
    offset?: number
  } = {},
): Promise<ShopOrder[]> {
  const supabase = getClient()
  let query = supabase.from("shop_orders").select("*").order("created_at", { ascending: false })
  if (Array.isArray(opts.status)) query = query.in("status", opts.status)
  else if (opts.status) query = query.eq("status", opts.status)
  if (opts.limit) query = query.limit(opts.limit)
  if (opts.offset) query = query.range(opts.offset, opts.offset + (opts.limit ?? 50) - 1)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as ShopOrder[]
}

export async function findPendingOrdersOlderThan(hours: number): Promise<ShopOrder[]> {
  const supabase = getClient()
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString()
  const { data, error } = await supabase
    .from("shop_orders")
    .select("*")
    .eq("status", "pending")
    .lt("created_at", cutoff)
  if (error) throw error
  return (data ?? []) as ShopOrder[]
}

export async function getOrderByPrintfulOrderId(printfulOrderId: number): Promise<ShopOrder | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_orders")
    .select("*")
    .eq("printful_order_id", printfulOrderId)
    .single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopOrder
}

export interface OrderStats {
  // Operational
  today: number
  needs_action: number
  in_production: number
  shipped_this_week: number

  // Financials (all revenue-counting statuses — includes fulfilled_digital)
  /** Gross amount charged to customers, including shipping. */
  revenue_all_time_cents: number
  /** Shipping collected from customers (pass-through, not counted in margin). */
  shipping_collected_cents: number
  /** Product revenue (sum of line unit_price × qty). Used as the margin base. */
  subtotal_all_cents: number
  subtotal_pod_cents: number
  subtotal_digital_cents: number
  /** Printful product costs for POD items. Digital COGS is always 0. */
  cogs_pod_cents: number
  /** subtotal_all − cogs_pod */
  gross_profit_cents: number
  /** gross_profit / subtotal_all, in basis points (7050 = 70.50%). */
  gross_margin_bps: number

  // Per-type breakdown
  pod_orders_count: number
  digital_orders_count: number
  pod_profit_cents: number
  pod_margin_bps: number
  digital_profit_cents: number
  digital_margin_bps: number
}

const REVENUE_STATUSES: ShopOrderStatus[] = [
  "paid",
  "draft",
  "confirmed",
  "in_production",
  "shipped",
  "fulfilled_digital",
]

const REVENUE_STATUSES_FOR_RANGE: ShopOrderStatus[] = [
  "paid", "draft", "confirmed", "in_production", "shipped", "fulfilled_digital",
]

export async function listOrdersInRange(from: Date, to: Date): Promise<ShopOrder[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_orders")
    .select("*")
    .in("status", REVENUE_STATUSES_FOR_RANGE)
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString())
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as ShopOrder[]
}

export async function getOrderStats(): Promise<OrderStats> {
  const supabase = getClient()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - 7)

  const [
    { count: today },
    { count: needs_action },
    { count: in_production },
    { count: shipped_this_week },
    revenueRes,
  ] = await Promise.all([
    supabase
      .from("shop_orders")
      .select("*", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString()),
    supabase
      .from("shop_orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "paid"),
    supabase
      .from("shop_orders")
      .select("*", { count: "exact", head: true })
      .in("status", ["confirmed", "in_production"]),
    supabase
      .from("shop_orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "shipped")
      .gte("shipped_at", weekStart.toISOString()),
    supabase
      .from("shop_orders")
      .select("items, subtotal_cents, shipping_cents, total_cents")
      .in("status", REVENUE_STATUSES),
  ])
  if (revenueRes.error) throw revenueRes.error

  const revOrders = (revenueRes.data ?? []) as Array<{
    items: ShopOrderItem[]
    subtotal_cents: number
    shipping_cents: number
    total_cents: number
  }>

  // Any POD line items missing a cost snapshot (older orders) need a
  // current-variant cost lookup. Not perfectly historical, but accurate enough
  // for a margin dashboard and documented as a known caveat.
  const missingCostVariantIds = new Set<string>()
  for (const o of revOrders) {
    for (const it of o.items) {
      if (it.product_type !== "digital" && it.printful_cost_cents == null) {
        missingCostVariantIds.add(it.variant_id)
      }
    }
  }

  const variantCostFallback = new Map<string, number>()
  if (missingCostVariantIds.size > 0) {
    const { data: variants, error: vErr } = await supabase
      .from("shop_product_variants")
      .select("id, printful_cost_cents")
      .in("id", Array.from(missingCostVariantIds))
    if (vErr) throw vErr
    for (const v of variants ?? []) {
      variantCostFallback.set(v.id, v.printful_cost_cents ?? 0)
    }
  }

  let revenue_all_time_cents = 0
  let shipping_collected_cents = 0
  let subtotal_pod_cents = 0
  let subtotal_digital_cents = 0
  let cogs_pod_cents = 0
  let pod_orders_count = 0
  let digital_orders_count = 0

  for (const o of revOrders) {
    revenue_all_time_cents += o.total_cents
    shipping_collected_cents += o.shipping_cents

    let orderHasPod = false
    let orderHasDigital = false

    for (const it of o.items) {
      const lineSubtotal = it.unit_price_cents * it.quantity
      if (it.product_type === "digital") {
        subtotal_digital_cents += lineSubtotal
        orderHasDigital = true
      } else {
        subtotal_pod_cents += lineSubtotal
        orderHasPod = true
        const unitCost =
          it.printful_cost_cents ?? variantCostFallback.get(it.variant_id) ?? 0
        cogs_pod_cents += unitCost * it.quantity
      }
    }

    if (orderHasPod) pod_orders_count++
    if (orderHasDigital) digital_orders_count++
  }

  const subtotal_all_cents = subtotal_pod_cents + subtotal_digital_cents
  const gross_profit_cents = subtotal_all_cents - cogs_pod_cents
  const gross_margin_bps =
    subtotal_all_cents > 0
      ? Math.round((gross_profit_cents / subtotal_all_cents) * 10000)
      : 0

  const pod_profit_cents = subtotal_pod_cents - cogs_pod_cents
  const pod_margin_bps =
    subtotal_pod_cents > 0
      ? Math.round((pod_profit_cents / subtotal_pod_cents) * 10000)
      : 0

  const digital_profit_cents = subtotal_digital_cents
  const digital_margin_bps = subtotal_digital_cents > 0 ? 10000 : 0

  return {
    today: today ?? 0,
    needs_action: needs_action ?? 0,
    in_production: in_production ?? 0,
    shipped_this_week: shipped_this_week ?? 0,

    revenue_all_time_cents,
    shipping_collected_cents,
    subtotal_all_cents,
    subtotal_pod_cents,
    subtotal_digital_cents,
    cogs_pod_cents,
    gross_profit_cents,
    gross_margin_bps,

    pod_orders_count,
    digital_orders_count,
    pod_profit_cents,
    pod_margin_bps,
    digital_profit_cents,
    digital_margin_bps,
  }
}
