import Link from "next/link"
import { listUserLists } from "@/lib/db/google-ads-user-lists"
import { listGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"
import { previewAudienceSizes } from "@/lib/ads/audiences"
import { UserListForm } from "./UserListForm"
import { SyncAudiencesButton } from "./SyncAudiencesButton"
import type { GoogleAdsAudienceType, GoogleAdsUserList } from "@/types/database"

export const metadata = { title: "Google Ads — Audiences" }
export const dynamic = "force-dynamic"

const AUDIENCE_DESCRIPTIONS: Record<GoogleAdsAudienceType, string> = {
  bookers:
    "Distinct emails from the bookings table. Use to retarget no-shows or exclude already-converted leads from cold campaigns.",
  subscribers:
    "Active newsletter subscribers (unsubscribed_at IS NULL). Use to layer a warmer audience over existing campaigns or build lookalike seeds.",
  icp:
    "Manually-curated ICP list. Phase 1.5b ships the schema slot; Plan 1.5g (AI Agent) will populate this from richer signals (e.g. paid clients filtered by sport/level).",
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never"
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return "just now"
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

export default async function AudiencesPage() {
  const [lists, accounts, sizes] = await Promise.all([
    listUserLists(),
    listGoogleAdsAccounts(),
    previewAudienceSizes(),
  ])

  const customerIds = accounts.filter((a) => a.is_active).map((a) => a.customer_id)
  const byType = {
    bookers: lists.find((l) => l.audience_type === "bookers"),
    subscribers: lists.find((l) => l.audience_type === "subscribers"),
    icp: lists.find((l) => l.audience_type === "icp"),
  } as Record<GoogleAdsAudienceType, GoogleAdsUserList | undefined>

  const tokenSet = Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN)
  const totalEligible = sizes.bookers + sizes.subscribers

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading text-primary">Customer Match Audiences</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Pushes hashed emails from your local data (bookers, newsletter subscribers) into
            Google Ads Customer Match user lists. Daily 07:00 UTC sync via{" "}
            <code className="font-mono text-xs">syncCustomerMatchAudiences</code>; only the delta
            since last sync is uploaded. Lists need ≥1000 active members before Google activates
            them for targeting.
          </p>
        </div>
        <SyncAudiencesButton />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <CountTile label="Bookers (eligible)" value={sizes.bookers} tone="bg-accent/10 text-accent" />
        <CountTile label="Subscribers (eligible)" value={sizes.subscribers} tone="bg-success/10 text-success" />
        <CountTile label="Total eligible" value={totalEligible} tone="bg-primary/10 text-primary" />
      </div>

      {!tokenSet ? (
        <div className="border border-warning/40 bg-warning/5 text-warning rounded-lg p-4 text-sm">
          <p className="font-medium">Developer Token not configured.</p>
          <p className="text-xs mt-1 opacity-90">
            Each daily sync currently logs the would-be delta and skips the upload. The local
            mirror stays empty so the first post-cutover run pushes the full eligible list as
            additions.
          </p>
        </div>
      ) : null}

      <section>
        <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
          ─ User lists
        </h2>
        <UserListForm
          customerIds={customerIds}
          existingByType={byType}
          descriptions={AUDIENCE_DESCRIPTIONS}
        />
      </section>

      <section>
        <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
          ─ Sync state
        </h2>
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">Audience</th>
                <th className="text-left p-3 w-28">Members</th>
                <th className="text-left p-3 w-32">Last synced</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {(["bookers", "subscribers", "icp"] as GoogleAdsAudienceType[]).map((t) => {
                const list = byType[t]
                if (!list) {
                  return (
                    <tr key={t} className="border-t border-border/60 align-top">
                      <td className="p-3 capitalize">{t}</td>
                      <td className="p-3 text-xs text-muted-foreground">—</td>
                      <td className="p-3 text-xs text-muted-foreground">—</td>
                      <td className="p-3 text-xs text-muted-foreground">Not configured</td>
                    </tr>
                  )
                }
                return (
                  <tr key={t} className="border-t border-border/60 align-top">
                    <td className="p-3">
                      <p className="font-medium text-primary capitalize">{t}</p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        UserList {list.user_list_id}
                      </p>
                    </td>
                    <td className="p-3 font-mono text-xs">{list.member_count.toLocaleString()}</td>
                    <td className="p-3 font-mono text-xs">{relativeTime(list.last_synced_at)}</td>
                    <td className="p-3 text-xs">
                      {list.last_error ? (
                        <span className="text-error">{list.last_error.slice(0, 200)}</span>
                      ) : (
                        <span className="text-success">OK</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Hashing: SHA-256 of <code className="font-mono">trim().toLowerCase()</code>. The
        normalized email is stored locally for diffing only — never uploaded. See{" "}
        <Link href="/admin/ads/automation-log" className="underline hover:text-accent">
          automation log
        </Link>{" "}
        for the broader audit trail (recommendations apply path).
      </p>
    </div>
  )
}

function CountTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl border border-border p-4 ${tone}`}>
      <p className="text-[11px] font-mono uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-2xl font-heading mt-1">{value.toLocaleString()}</p>
    </div>
  )
}
