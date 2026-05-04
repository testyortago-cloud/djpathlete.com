import { createServiceRoleClient } from "@/lib/supabase"
import { listGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"
import { ConnectGoogleAdsButton } from "./ConnectGoogleAdsButton"
import type { GoogleAdsAccount } from "@/types/database"

export const metadata = { title: "Google Ads — Settings" }

interface PageProps {
  searchParams: Promise<{ connected?: string; error?: string }>
}

export default async function GoogleAdsSettingsPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const supabase = createServiceRoleClient()

  const { data: connection } = await supabase
    .from("platform_connections")
    .select("status, account_handle, updated_at")
    .eq("plugin_name", "google_ads")
    .maybeSingle()

  const isConnected = (connection?.status ?? "not_connected") === "connected"
  const accounts: GoogleAdsAccount[] = isConnected ? await listGoogleAdsAccounts() : []
  const activeAccounts = accounts.filter((a) => a.is_active)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-heading text-primary">Google Ads — Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your Google Ads account to enable nightly campaign sync, AI recommendations
          (Plan 1.2), and the AI Ads Agent (Plan 1.5g). Until your Developer Token is approved,
          this connection works against Google Ads test accounts only.
        </p>
      </div>

      {sp.error ? (
        <div className="border border-error/40 bg-error/5 text-error rounded-lg p-4 text-sm">
          {sp.error}
        </div>
      ) : null}
      {sp.connected === "1" ? (
        <div className="border border-success/40 bg-success/5 text-success rounded-lg p-4 text-sm">
          Connected.
          {activeAccounts.length === 0
            ? " No accounts discovered yet — set GOOGLE_ADS_DEVELOPER_TOKEN and reconnect."
            : " Nightly sync runs at 06:00 UTC; you can also trigger one manually below (coming with Plan 1.1 sync work)."}
        </div>
      ) : null}

      <div className="border border-border rounded-xl p-6 space-y-4 bg-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-primary">Connection</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isConnected
                ? `Authorized — refresh token stored${connection?.account_handle ? ` for Customer ID ${connection.account_handle}` : ""}.`
                : "Not connected."}
            </p>
          </div>
          <ConnectGoogleAdsButton isConnected={isConnected} />
        </div>
      </div>

      {activeAccounts.length > 0 ? (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <div className="p-4 border-b border-border/60">
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Connected accounts
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">Customer ID</th>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Last synced</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {activeAccounts.map((a) => (
                <tr key={a.customer_id} className="border-t border-border/60">
                  <td className="p-3 font-mono text-xs">{a.customer_id}</td>
                  <td className="p-3">{a.descriptive_name ?? "—"}</td>
                  <td className="p-3 font-mono text-xs">
                    {a.last_synced_at ? new Date(a.last_synced_at).toLocaleString() : "Never"}
                  </td>
                  <td className="p-3 text-xs">
                    {a.last_error ? (
                      <span className="text-error">Error: {a.last_error.slice(0, 80)}</span>
                    ) : (
                      <span className="text-success">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
