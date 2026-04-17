// app/(admin)/admin/shop/orders/[id]/DownloadAdminActions.tsx
"use client"
import { toast } from "sonner"

export function DownloadAdminActions({ downloadId }: { downloadId: string }) {
  async function revoke() {
    if (!confirm("Revoke access to this file?")) return
    const res = await fetch(`/api/admin/shop/downloads/${downloadId}/revoke`, { method: "POST" })
    if (res.ok) { toast.success("Revoked"); location.reload() }
  }
  async function extend() {
    const days = prompt("Extend by how many days?", "30")
    if (!days) return
    const expires = new Date(Date.now() + Number(days) * 86_400_000).toISOString()
    const res = await fetch(`/api/admin/shop/downloads/${downloadId}/extend`, {
      method: "POST", body: JSON.stringify({ expires_at: expires }),
    })
    if (res.ok) { toast.success("Extended"); location.reload() }
  }
  async function bump() {
    const max = prompt("New max downloads (blank = unlimited)")
    if (max === null) return
    const v = max === "" ? null : Number(max)
    const res = await fetch(`/api/admin/shop/downloads/${downloadId}/max`, {
      method: "POST", body: JSON.stringify({ max: v }),
    })
    if (res.ok) { toast.success("Updated"); location.reload() }
  }
  return (
    <div className="flex gap-2">
      <button onClick={extend} className="rounded border px-2 py-1">Extend</button>
      <button onClick={bump} className="rounded border px-2 py-1">Max</button>
      <button onClick={revoke} className="rounded border border-destructive px-2 py-1 text-destructive">Revoke</button>
    </div>
  )
}
