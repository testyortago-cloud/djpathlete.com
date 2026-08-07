import {
  DataTable,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table"

import type { MarketingConsentLog } from "@/types/database"

interface Props {
  rows: Array<MarketingConsentLog & { user_email?: string | null }>
}

export function ConsentLogTable({ rows }: Props) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No consent events yet.</p>
  }
  return (
    <DataTableCard>
      <DataTable>
        <DataTableHeader>
          <DataTableHead>When</DataTableHead>
          <DataTableHead>User</DataTableHead>
          <DataTableHead>Event</DataTableHead>
          <DataTableHead>Source</DataTableHead>
          <DataTableHead>IP</DataTableHead>
        </DataTableHeader>
        <tbody>
          {rows.map((r) => (
            <DataTableRow key={r.id}>
              <DataTableCell className="font-mono text-xs">{new Date(r.created_at).toLocaleString()}</DataTableCell>
              <DataTableCell>{r.user_email ?? r.user_id}</DataTableCell>
              <DataTableCell>
                <span
                  className={
                    r.granted
                      ? "inline-block px-2 py-0.5 rounded text-xs bg-success/10 text-success"
                      : "inline-block px-2 py-0.5 rounded text-xs bg-error/10 text-error"
                  }
                >
                  {r.granted ? "Granted" : "Revoked"}
                </span>
              </DataTableCell>
              <DataTableCell className="font-mono text-xs">{r.source}</DataTableCell>
              <DataTableCell muted className="font-mono text-xs">
                {r.ip_address ?? "—"}
              </DataTableCell>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
    </DataTableCard>
  )
}
