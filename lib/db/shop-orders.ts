import { createServiceRoleClient } from "@/lib/supabase"
import type { ShopOrder, ShopOrderStatus } from "@/types/database"
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

export async function getOrderStats(): Promise<{
  today: number
  needs_action: number
  in_production: number
  shipped_this_week: number
  revenue_all_time_cents: number
}> {
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
      .select("total_cents")
      .in("status", ["paid", "confirmed", "in_production", "shipped"]),
  ])
  if (revenueRes.error) throw revenueRes.error
  const revenue_all_time_cents = (revenueRes.data ?? []).reduce(
    (sum, r) => sum + (r.total_cents ?? 0),
    0,
  )

  return {
    today: today ?? 0,
    needs_action: needs_action ?? 0,
    in_production: in_production ?? 0,
    shipped_this_week: shipped_this_week ?? 0,
    revenue_all_time_cents,
  }
}
