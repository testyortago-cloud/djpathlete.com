"use client"
import { useState } from "react"
import type { AuditLogRow } from "@/lib/audit/types"

function outcomeBadgeClass(outcome: string): string {
  if (outcome === "success") return "bg-success/10 text-success"
  if (outcome === "denied") return "bg-warning/10 text-warning"
  return "bg-error/10 text-error"
}

export function AuditLogRowView({ row }: { row: AuditLogRow }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr
        className="hover:bg-muted/30 cursor-pointer border-b"
        onClick={() => setOpen((v) => !v)}
      >
        <td className="px-3 py-2 text-xs whitespace-nowrap">
          {new Date(row.created_at).toLocaleString()}
        </td>
        <td className="px-3 py-2 text-xs">
          <div className="font-medium">{row.actor_email ?? "—"}</div>
          <div className="text-muted-foreground">{row.actor_role ?? "—"}</div>
        </td>
        <td className="px-3 py-2 text-xs font-mono">{row.action}</td>
        <td className="px-3 py-2 text-xs">
          {row.target_type ? <div>{row.target_type}</div> : null}
          {row.target_label ? (
            <div className="text-muted-foreground">{row.target_label}</div>
          ) : null}
        </td>
        <td className="px-3 py-2">
          <span
            className={`rounded-md px-2 py-0.5 text-xs font-medium ${outcomeBadgeClass(row.outcome)}`}
          >
            {row.outcome}
          </span>
        </td>
        <td className="px-3 py-2 text-xs">{row.ip_address ?? "—"}</td>
      </tr>
      {open && (
        <tr className="bg-muted/10 border-b">
          <td colSpan={6} className="p-4">
            {row.error_message && (
              <div className="text-error mb-2 text-sm">
                <strong>{row.error_code ?? "error"}:</strong> {row.error_message}
              </div>
            )}
            <pre className="bg-surface overflow-x-auto rounded-md p-3 text-xs">
              {JSON.stringify(row.metadata, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}
