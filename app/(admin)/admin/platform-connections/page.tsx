import Link from "next/link"
import { CheckCircle, Pause, XCircle, Circle, Facebook, Instagram, Music2, Youtube, Linkedin } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { listPlatformConnections } from "@/lib/db"
import type { PlatformConnection, SocialPlatform } from "@/types/database"
import { SetupGuide } from "@/components/admin/platform-connections/SetupGuide"
import { ConnectionToaster } from "@/components/admin/platform-connections/ConnectionToaster"

export const metadata = { title: "Platform Connections" }

interface PluginMeta {
  label: string
  icon: LucideIcon
}

const PLUGIN_META: Record<SocialPlatform, PluginMeta> = {
  facebook: { label: "Facebook", icon: Facebook },
  instagram: { label: "Instagram", icon: Instagram },
  tiktok: { label: "TikTok", icon: Music2 },
  youtube: { label: "YouTube", icon: Youtube },
  youtube_shorts: { label: "YouTube Shorts", icon: Youtube },
  linkedin: { label: "LinkedIn", icon: Linkedin },
}

const DISPLAY_ORDER: SocialPlatform[] = ["facebook", "instagram", "tiktok", "youtube", "youtube_shorts", "linkedin"]

// Platforms that drive their own OAuth flow. Paired platforms (youtube_shorts,
// instagram) ride on the same OAuth grant as their parent — they show a
// "Shares X" badge instead of their own buttons.
const OAUTH_PRIMARY: Partial<Record<SocialPlatform, { primary: SocialPlatform; path: string }>> = {
  youtube: { primary: "youtube", path: "youtube" },
  facebook: { primary: "facebook", path: "facebook" },
  tiktok: { primary: "tiktok", path: "tiktok" },
}

const SHARED_PAIR: Partial<Record<SocialPlatform, { sharesWith: string }>> = {
  youtube_shorts: { sharesWith: "YouTube" },
  instagram: { sharesWith: "Facebook" },
}

function PlatformActions({
  connection,
  label,
}: {
  connection: PlatformConnection
  label: string
}) {
  const oauth = OAUTH_PRIMARY[connection.plugin_name]
  const shared = SHARED_PAIR[connection.plugin_name]

  if (oauth) {
    const connected = connection.status === "connected"
    return (
      <>
        <Link
          href={`/api/admin/platform-connections/${oauth.path}/connect`}
          prefetch={false}
          aria-label={connected ? `Reconnect ${label}` : `Connect ${label}`}
          className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {connected ? "Reconnect" : "Connect"}
        </Link>
        {connected ? (
          <form action={`/api/admin/platform-connections/${oauth.path}/disconnect`} method="post">
            <button
              type="submit"
              aria-label={`Disconnect ${label}`}
              className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-error hover:border-error/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Disconnect
            </button>
          </form>
        ) : null}
      </>
    )
  }

  if (shared) {
    return (
      <span
        aria-label={`${label} shares its connection with ${shared.sharesWith}`}
        className="text-xs px-3 py-1.5 rounded-md bg-muted/40 text-muted-foreground"
        title={`${label} shares the ${shared.sharesWith} connection — connect ${shared.sharesWith} above.`}
      >
        Shares {shared.sharesWith}
      </span>
    )
  }

  return (
    <button
      type="button"
      disabled
      aria-label={`Connect ${label} (available in Phase 2)`}
      className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-muted-foreground cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      title="OAuth connect ships in Phase 2"
    >
      Connect
    </button>
  )
}

function statusBadge(status: PlatformConnection["status"]) {
  if (status === "connected") {
    return (
      <span aria-label="Connected" className="inline-flex items-center gap-1 text-xs font-medium text-success">
        <CheckCircle className="size-3.5" /> Connected
      </span>
    )
  }
  if (status === "paused") {
    return (
      <span aria-label="Paused" className="inline-flex items-center gap-1 text-xs font-medium text-warning">
        <Pause className="size-3.5" /> Paused
      </span>
    )
  }
  if (status === "error") {
    return (
      <span
        aria-label="Connection error"
        role="status"
        className="inline-flex items-center gap-1 text-xs font-medium text-error"
      >
        <XCircle className="size-3.5" /> Error
      </span>
    )
  }
  return (
    <span
      aria-label="Not connected"
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"
    >
      <Circle className="size-3.5" /> Not connected
    </span>
  )
}

export default async function PlatformConnectionsPage() {
  const connections = (await listPlatformConnections()) as PlatformConnection[]

  const byPlugin = new Map<SocialPlatform, PlatformConnection>()
  for (const c of connections) {
    byPlugin.set(c.plugin_name, c)
  }

  const ordered = DISPLAY_ORDER.map((name) => byPlugin.get(name)).filter((c): c is PlatformConnection => Boolean(c))

  return (
    <div>
      <ConnectionToaster />
      <h1 className="text-2xl font-semibold text-primary mb-6">Platform Connections</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Activate each platform when you&apos;re ready. You can do this at any time — the AI keeps generating captions
        whether a platform is connected or not.
      </p>

      <div className="bg-white rounded-xl border border-border divide-y divide-border">
        {ordered.map((c) => {
          const meta = PLUGIN_META[c.plugin_name]
          const PluginIcon = meta.icon
          return (
            <div key={c.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <PluginIcon className="size-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-primary">{meta.label}</p>
                    <p className="text-xs text-muted-foreground">{c.account_handle ?? "No account linked"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {statusBadge(c.status)}
                  <PlatformActions connection={c} label={meta.label} />
                </div>
              </div>
              <SetupGuide
                platform={c.plugin_name}
                platformLabel={meta.label}
                alreadyConnected={c.status === "connected"}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
