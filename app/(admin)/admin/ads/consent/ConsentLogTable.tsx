import type { MarketingConsentLog } from "@/types/database"

interface Props {
  rows: Array<MarketingConsentLog & { user_email?: string | null }>
}

export function ConsentLogTable({ rows }: Props) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No consent events yet.</p>
  }
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left p-3">When</th>
            <th className="text-left p-3">User</th>
            <th className="text-left p-3">Event</th>
            <th className="text-left p-3">Source</th>
            <th className="text-left p-3">IP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border/60">
              <td className="p-3 font-mono text-xs">{new Date(r.created_at).toLocaleString()}</td>
              <td className="p-3">{r.user_email ?? r.user_id}</td>
              <td className="p-3">
                <span
                  className={
                    r.granted
                      ? "inline-block px-2 py-0.5 rounded text-xs bg-success/10 text-success"
                      : "inline-block px-2 py-0.5 rounded text-xs bg-error/10 text-error"
                  }
                >
                  {r.granted ? "Granted" : "Revoked"}
                </span>
              </td>
              <td className="p-3 font-mono text-xs">{r.source}</td>
              <td className="p-3 font-mono text-xs text-muted-foreground">{r.ip_address ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
