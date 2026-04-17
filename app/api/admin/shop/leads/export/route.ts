import { requireAdmin } from "@/lib/auth-helpers"
import { listLeads } from "@/lib/db/shop-leads"

function escape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replaceAll('"', '""')}"`
  }
  return v
}

export async function GET(req: Request) {
  await requireAdmin()
  const url = new URL(req.url)
  const productId = url.searchParams.get("product_id") ?? undefined
  const statusParam = url.searchParams.get("status")
  const status =
    statusParam === "pending" ||
    statusParam === "synced" ||
    statusParam === "failed"
      ? statusParam
      : undefined
  const leads = await listLeads({
    productId,
    status,
    limit: 10000,
  })
  const rows = [
    "email,product_id,resend_sync_status,created_at",
    ...leads.map(
      (l) =>
        `${escape(l.email)},${l.product_id},${l.resend_sync_status},${l.created_at}`,
    ),
  ].join("\n")
  return new Response(rows, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="shop-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
