import {
  DataTable,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableToolbar,
} from "@/components/ui/data-table"

import { createServiceRoleClient } from "@/lib/supabase"
import { listGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"
import { ConnectGoogleAdsButton } from "./ConnectGoogleAdsButton"
import { RediscoverAccountsButton } from "./RediscoverAccountsButton"
import { AccountToggleButton } from "./AccountToggleButton"
import { HiddenAccountsToggle } from "./HiddenAccountsToggle"
import type { GoogleAdsAccount } from "@/types/database"

export const metadata = { title: "Google Ads — Settings" }

interface PageProps {
  searchParams: Promise<{ connected?: string; error?: string; show_hidden?: string }>
}

export default async function GoogleAdsSettingsPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const showHidden = sp.show_hidden === "1"
  const supabase = createServiceRoleClient()

  const { data: connection } = await supabase
    .from("platform_connections")
    .select("status, account_handle, updated_at")
    .eq("plugin_name", "google_ads")
    .maybeSingle()

  const isConnected = (connection?.status ?? "not_connected") === "connected"
  const accounts: GoogleAdsAccount[] = isConnected ? await listGoogleAdsAccounts() : []
  const activeAccounts = accounts.filter((a) => a.is_active)
  const hiddenAccounts = accounts.filter((a) => !a.is_active)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading text-primary">Google Ads — Settings</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Manage which Google Ads accounts the assistant looks at. Hide any sub-accounts you don&apos;t actively run ads
          in — they&apos;ll disappear from every screen and the AI will stop suggesting changes for them. You can
          re-enable them anytime.
        </p>
      </div>

      {sp.error ? (
        <div className="border border-error/40 bg-error/5 text-error rounded-lg p-4 text-sm">{sp.error}</div>
      ) : null}
      {sp.connected === "1" ? (
        <div className="border border-success/40 bg-success/5 text-success rounded-lg p-4 text-sm">
          {activeAccounts.length === 0
            ? "Connected, but no accounts were found yet. Try Re-discover accounts below."
            : "Connected. New ad performance refreshes every night."}
        </div>
      ) : null}

      <div className="border border-border rounded-xl p-6 space-y-4 bg-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-primary">Connection</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isConnected
                ? `Signed in${connection?.account_handle ? ` to Google Ads (Customer ID ${connection.account_handle})` : ""}.`
                : "Not connected to Google Ads."}
            </p>
          </div>
          <ConnectGoogleAdsButton isConnected={isConnected} />
        </div>
        {isConnected ? (
          <div className="flex items-start justify-between gap-4 pt-4 border-t border-border/60">
            <div>
              <p className="text-sm text-primary">Re-discover accounts</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                Ask Google for the latest list of accounts you can access and add any new ones here. Existing accounts
                keep their hide/show state — no consent screen, no re-sign-in.
              </p>
            </div>
            <RediscoverAccountsButton />
          </div>
        ) : null}
      </div>

      {activeAccounts.length > 0 ? (
        <AccountsTable title="Accounts the assistant manages" accounts={activeAccounts} mode="active" />
      ) : null}

      {hiddenAccounts.length > 0 ? (
        <div className="space-y-3">
          <HiddenAccountsToggle hiddenCount={hiddenAccounts.length} showHidden={showHidden} />
          {showHidden ? (
            <AccountsTable
              title="Hidden accounts (the assistant ignores these)"
              accounts={hiddenAccounts}
              mode="hidden"
              muted
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function AccountsTable({
  title,
  accounts,
  mode,
  muted,
}: {
  title: string
  accounts: GoogleAdsAccount[]
  mode: "active" | "hidden"
  muted?: boolean
}) {
  return (
    <DataTableCard className={muted ? "border-dashed" : undefined}>
      <DataTableToolbar>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
      </DataTableToolbar>
      <DataTable>
        <DataTableHeader>
          <DataTableHead>Customer ID</DataTableHead>
          <DataTableHead>Name</DataTableHead>
          <DataTableHead>Last refreshed</DataTableHead>
          <DataTableHead>Health</DataTableHead>
          <DataTableHead align="right">Action</DataTableHead>
        </DataTableHeader>
        <tbody>
          {accounts.map((a) => (
            <DataTableRow key={a.customer_id}>
              <DataTableCell className="font-mono text-xs">{a.customer_id}</DataTableCell>
              <DataTableCell>{a.descriptive_name ?? "—"}</DataTableCell>
              <DataTableCell muted className="text-xs">
                {a.last_synced_at
                  ? new Date(a.last_synced_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "Never"}
              </DataTableCell>
              <DataTableCell className="text-xs">
                {a.last_error ? (
                  <span className="text-error" title={a.last_error}>
                    Last refresh failed
                  </span>
                ) : (
                  <span className="text-success">OK</span>
                )}
              </DataTableCell>
              <DataTableCell align="right">
                <AccountToggleButton customerId={a.customer_id} active={mode === "active"} />
              </DataTableCell>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
    </DataTableCard>
  )
}
