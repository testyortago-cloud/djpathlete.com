import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { syncPrintfulCatalog } from "@/lib/shop/sync"
import { findPendingOrdersOlderThan, updateOrderStatus } from "@/lib/db/shop-orders"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  try {
    const result = await syncPrintfulCatalog()

    const stale = await findPendingOrdersOlderThan(25)
    let canceled = 0
    for (const order of stale) {
      try { await updateOrderStatus(order.id, "canceled"); canceled += 1 } catch { /* skip */ }
    }

    return NextResponse.json({ ...result, stale_orders_canceled: canceled })
  } catch (err) {
    console.error("[shop sync]", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
