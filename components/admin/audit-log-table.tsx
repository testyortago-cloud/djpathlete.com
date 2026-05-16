import Link from "next/link"
import type { AuditLogRow } from "@/lib/audit/types"
import { AuditLogRowView } from "./audit-log-row"

interface Props {
  rows: AuditLogRow[]
  total: number
  page: number
  perPage: number
}

export function AuditLogTable({ rows, total, page, perPage }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  return (
    <div className="space-y-4">
      <div className="border-border overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Actor</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Target</th>
              <th className="px-3 py-2 text-left">Outcome</th>
              <th className="px-3 py-2 text-left">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="text-muted-foreground px-3 py-6 text-center"
                >
                  No audit rows match these filters.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <AuditLogRowView key={r.id} row={r} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>{total.toLocaleString()} total</span>
        <div className="flex gap-2">
          {page > 1 && (
            <Link href={`?page=${page - 1}`} className="hover:underline">
              ← Prev
            </Link>
          )}
          <span>
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={`?page=${page + 1}`} className="hover:underline">
              Next →
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
