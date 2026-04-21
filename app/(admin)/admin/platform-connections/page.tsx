import { CheckCircle, Pause, XCircle, Circle, Facebook, Instagram, Music2, Youtube, Linkedin } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { listPlatformConnections } from "@/lib/db"
import type { PlatformConnection, SocialPlatform } from "@/types/database"
import { SetupGuide } from "@/components/admin/platform-connections/SetupGuide"

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
                  <button
                    type="button"
                    disabled
                    aria-label={`Connect ${meta.label} (available in Phase 2)`}
                    className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-muted-foreground cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    title="OAuth connect ships in Phase 2"
                  >
                    Connect
                  </button>
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
