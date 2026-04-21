import Link from "next/link"
import { Link2, ArrowRight } from "lucide-react"
import { listPlatformConnections } from "@/lib/db/platform-connections"

/**
 * Shown above Content Studio when zero platforms are connected. Reassures
 * the coach that AI generation still works and points them at the
 * self-service activation flow. Server component — one Supabase call per
 * render, which Next caches per request.
 */
export async function ConnectionsBanner() {
  const connections = await listPlatformConnections()
  const connectedCount = connections.filter((c) => c.status === "connected").length

  if (connectedCount > 0) return null

  return (
    <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
      <Link2 className="size-5 text-accent shrink-0" />
      <div className="flex-1 text-sm">
        <p className="font-medium text-primary">No platforms connected yet.</p>
        <p className="text-muted-foreground text-xs mt-0.5">
          You can still generate captions and blogs — they&apos;ll queue as{" "}
          <span className="font-medium">Awaiting connection</span> until you link at least one platform.
        </p>
      </div>
      <Link
        href="/admin/platform-connections"
        className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        Connect a platform <ArrowRight className="size-3.5" />
      </Link>
    </div>
  )
}
