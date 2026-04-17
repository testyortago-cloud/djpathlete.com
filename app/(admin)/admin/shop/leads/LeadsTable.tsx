"use client"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import type { ShopLead, ShopProduct } from "@/types/database"

export function LeadsTable({
  leads,
  products,
  initialFilter,
}: {
  leads: ShopLead[]
  products: ShopProduct[]
  initialFilter: { product_id?: string; status?: string }
}) {
  const router = useRouter()
  const sp = useSearchParams()
  function setParam(k: string, v: string | null) {
    const next = new URLSearchParams(sp)
    if (v) next.set(k, v)
    else next.delete(k)
    router.push(`?${next.toString()}`)
  }
  async function retry(id: string) {
    const res = await fetch(`/api/admin/shop/leads/${id}/retry`, { method: "POST" })
    if (res.ok) {
      toast.success("Synced")
      router.refresh()
    } else toast.error("Retry failed")
  }
  return (
    <>
      <div className="mb-4 flex gap-2">
        <select
          defaultValue={initialFilter.product_id ?? ""}
          onChange={(e) => setParam("product_id", e.target.value || null)}
          className="rounded border px-2 py-1"
        >
          <option value="">All products</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          defaultValue={initialFilter.status ?? ""}
          onChange={(e) => setParam("status", e.target.value || null)}
          className="rounded border px-2 py-1"
        >
          <option value="">All statuses</option>
          <option value="pending">pending</option>
          <option value="synced">synced</option>
          <option value="failed">failed</option>
        </select>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th>Email</th>
            <th>Product</th>
            <th>Status</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id} className="border-t">
              <td>{l.email}</td>
              <td>{products.find((p) => p.id === l.product_id)?.name ?? l.product_id}</td>
              <td>{l.resend_sync_status}</td>
              <td>{new Date(l.created_at).toLocaleString()}</td>
              <td>
                {l.resend_sync_status === "failed" && (
                  <button onClick={() => retry(l.id)} className="rounded border px-2 py-1">
                    Retry
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
