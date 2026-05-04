import { createServiceRoleClient } from "@/lib/supabase"
import { listGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"
import { ConnectGoogleAdsButton } from "./ConnectGoogleAdsButton"
import { RediscoverAccountsButton } from "./RediscoverAccountsButton"
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading text-primary">Google Ads — Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          OAuth status, connected customer accounts, and last-sync state. Reconnect here if the
          refresh token ever rotates.
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
            ? " No accounts discovered yet — verify GOOGLE_ADS_LOGIN_CUSTOMER_ID is correct and reconnect."
            : " Nightly sync runs at 06:00 UTC; trigger one manually from /admin/ads/campaigns."}
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
        {isConnected ? (
          <div className="flex items-start justify-between gap-4 pt-4 border-t border-border/60">
            <div>
              <p className="text-sm text-primary">Re-discover accounts</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                Re-runs <code className="font-mono">listAccessibleCustomers</code> against the
                stored refresh token and upserts each Customer ID. Use this if the OAuth
                handshake completed before <code className="font-mono">GOOGLE_ADS_DEVELOPER_TOKEN</code>{" "}
                was set, or after the dev token rotates. No consent screen.
              </p>
            </div>
            <RediscoverAccountsButton />
          </div>
        ) : null}
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
