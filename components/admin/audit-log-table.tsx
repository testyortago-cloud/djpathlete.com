import {
  DataTable,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table"

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
      <DataTableCard>
        <DataTable>
          <DataTableHeader>
            <DataTableHead>When</DataTableHead>
            <DataTableHead>Actor</DataTableHead>
            <DataTableHead>Action</DataTableHead>
            <DataTableHead>Target</DataTableHead>
            <DataTableHead>Outcome</DataTableHead>
            <DataTableHead>IP</DataTableHead>
          </DataTableHeader>
          <tbody>
            {rows.length === 0 && (
              <DataTableRow>
                <DataTableCell muted colSpan={6} className="py-6 text-center">
                  No audit rows match these filters.
                </DataTableCell>
              </DataTableRow>
            )}
            {rows.map((r) => (
              <AuditLogRowView key={r.id} row={r} />
            ))}
          </tbody>
        </DataTable>
      </DataTableCard>
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
