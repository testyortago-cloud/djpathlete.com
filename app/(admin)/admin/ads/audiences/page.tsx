import Link from "next/link"
import { listUserLists } from "@/lib/db/google-ads-user-lists"
import { listGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"
import { previewAudienceSizes } from "@/lib/ads/audiences"
import { listGa4Audiences } from "@/lib/db/google-ads-ga4-audiences"
import { UserListForm } from "./UserListForm"
import { SyncAudiencesButton } from "./SyncAudiencesButton"
import type {
  GoogleAdsAudienceType,
  GoogleAdsGa4Audience,
  GoogleAdsUserList,
} from "@/types/database"

export const metadata = { title: "Google Ads — Audiences" }
export const dynamic = "force-dynamic"

const AUDIENCE_DESCRIPTIONS: Record<GoogleAdsAudienceType, string> = {
  bookers:
    "Distinct emails from the bookings table. Use to retarget no-shows or exclude already-converted leads from cold campaigns.",
  subscribers:
    "Active newsletter subscribers (unsubscribed_at IS NULL). Use to layer a warmer audience over existing campaigns or build lookalike seeds.",
  icp:
    "Manually-curated ICP list (e.g. paid clients filtered by sport/level). Schema slot is reserved for richer signals from the AI Agent; populate manually for now via SQL or seed script.",
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
  const [lists, accounts, sizes, ga4Audiences] = await Promise.all([
    listUserLists(),
    listGoogleAdsAccounts(),
    previewAudienceSizes(),
    listGa4Audiences(),
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

      <Ga4AudiencesSection audiences={ga4Audiences} tokenSet={tokenSet} />

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

const GA4_TYPE_TONE: Record<string, string> = {
  REMARKETING: "bg-accent/10 text-accent",
  RULE_BASED: "bg-success/10 text-success",
  LOGICAL: "bg-primary/10 text-primary",
  SIMILAR: "bg-muted/40 text-muted-foreground",
  LOOKALIKE: "bg-muted/40 text-muted-foreground",
  EXTERNAL_REMARKETING: "bg-warning/15 text-warning",
  UNKNOWN: "bg-muted/40 text-muted-foreground",
}

function Ga4AudiencesSection({
  audiences,
  tokenSet,
}: {
  audiences: GoogleAdsGa4Audience[]
  tokenSet: boolean
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          ─ GA4 / Remarketing audiences (read-only)
        </h2>
        <span className="text-[11px] font-mono text-muted-foreground">
          {audiences.length} list{audiences.length === 1 ? "" : "s"} cached
        </span>
      </div>

      {audiences.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-6 bg-card text-sm text-muted-foreground space-y-3">
          <p>
            No remarketing audiences cached yet. These flow in via the GA4 ↔ Google Ads link —
            we can't create them via API; they're configured once in the Google Ads UI.
          </p>
          <div className="rounded-lg bg-surface border border-border/60 p-4 space-y-2">
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Setup (one-time, ~10 min)
            </p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>
                In Google Ads: <span className="font-mono">Tools → Setup → Linked accounts → Google Analytics (GA4)</span>
                . Link your GA4 property if not already.
              </li>
              <li>
                In Google Ads: <span className="font-mono">Tools → Shared library → Audience manager → +New audience → Website visitors</span>
                . Create lists like &ldquo;Booking-page viewers&rdquo;, &ldquo;Programs-page
                viewers&rdquo;, &ldquo;Newsletter signup completers&rdquo;.
              </li>
              <li>
                In GA4: <span className="font-mono">Admin → Audiences → +New audience</span> for
                segments like &ldquo;Engaged readers&rdquo;, &ldquo;Cart abandoners&rdquo;. Toggle
                &ldquo;Share with Google Ads&rdquo; on each.
              </li>
              <li>
                Wait 24–48h for GA4 audiences to propagate, then click <strong>Sync now</strong>{" "}
                above to refresh this list.
              </li>
            </ol>
          </div>
          {!tokenSet ? (
            <p className="text-[11px] text-warning">
              The sync also requires <code className="font-mono">GOOGLE_ADS_DEVELOPER_TOKEN</code> —
              once that lands and audiences are configured, this section will populate.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">Audience</th>
                <th className="text-left p-3 w-32">Type</th>
                <th className="text-left p-3 w-32">Status</th>
                <th className="text-right p-3 w-28">Display size</th>
                <th className="text-right p-3 w-28">Search size</th>
                <th className="text-right p-3 w-24">Lifespan</th>
              </tr>
            </thead>
            <tbody>
              {audiences.map((a) => (
                <tr key={a.id} className="border-t border-border/60 align-top">
                  <td className="p-3">
                    <p className="font-medium text-primary leading-snug">{a.name}</p>
                    {a.description ? (
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                        {a.description.slice(0, 200)}
                      </p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground font-mono mt-1">
                      {a.customer_id} · {a.user_list_id}
                    </p>
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wider ${GA4_TYPE_TONE[a.list_type] ?? GA4_TYPE_TONE.UNKNOWN}`}
                    >
                      {a.list_type}
                    </span>
                  </td>
                  <td className="p-3 text-xs font-mono text-muted-foreground">
                    {a.membership_status ?? "—"}
                  </td>
                  <td className="p-3 text-right font-mono text-xs">
                    {a.size_for_display != null ? a.size_for_display.toLocaleString() : "—"}
                  </td>
                  <td className="p-3 text-right font-mono text-xs">
                    {a.size_for_search != null ? a.size_for_search.toLocaleString() : "—"}
                  </td>
                  <td className="p-3 text-right font-mono text-xs">
                    {a.membership_life_span_days != null
                      ? `${a.membership_life_span_days}d`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
