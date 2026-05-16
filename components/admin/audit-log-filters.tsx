"use client"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"

const CATEGORIES = [
  "auth",
  "admin_write",
  "admin_read_sensitive",
  "client_action",
  "support",
  "commerce",
  "billing",
  "marketing",
  "compliance",
  "automation",
  "system",
] as const
const OUTCOMES = ["success", "failure", "denied"] as const

export function AuditLogFilters() {
  const router = useRouter()
  const sp = useSearchParams()

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(sp.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      params.delete("page")
      router.push(`/admin/audit-logs?${params.toString()}`)
    },
    [router, sp],
  )

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
      <input
        defaultValue={sp.get("q") ?? ""}
        onBlur={(e) => setParam("q", e.currentTarget.value)}
        placeholder="Search email / target / error..."
        className="border-border rounded-md border px-3 py-2 text-sm"
      />
      <select
        defaultValue={sp.get("category") ?? ""}
        onChange={(e) => setParam("category", e.currentTarget.value)}
        className="border-border rounded-md border px-3 py-2 text-sm"
      >
        <option value="">All categories</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        defaultValue={sp.get("outcome") ?? ""}
        onChange={(e) => setParam("outcome", e.currentTarget.value)}
        className="border-border rounded-md border px-3 py-2 text-sm"
      >
        <option value="">All outcomes</option>
        {OUTCOMES.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <input
        type="date"
        defaultValue={sp.get("from") ?? ""}
        onChange={(e) => setParam("from", e.currentTarget.value)}
        className="border-border rounded-md border px-3 py-2 text-sm"
      />
      <input
        type="date"
        defaultValue={sp.get("to") ?? ""}
        onChange={(e) => setParam("to", e.currentTarget.value)}
        className="border-border rounded-md border px-3 py-2 text-sm"
      />
    </div>
  )
}
