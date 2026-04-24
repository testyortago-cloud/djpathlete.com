import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Film, FileImage } from "lucide-react"
import { getAssetWithLinkedPosts } from "@/lib/db/media-assets"
import { getAdminStorage } from "@/lib/firebase-admin"
import { PLATFORM_ICONS, PLATFORM_LABELS } from "@/lib/social/platform-ui"
import type { SocialPlatform } from "@/types/database"

interface PageProps {
  params: Promise<{ id: string }>
}

const SIGNED_URL_TTL_MS = 60 * 60 * 1000

async function signPreviewUrl(storagePath: string): Promise<string | null> {
  try {
    const [url] = await getAdminStorage()
      .bucket()
      .file(storagePath)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + SIGNED_URL_TTL_MS,
      })
    return url
  } catch {
    return null
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "—"
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export default async function AssetDetailPage({ params }: PageProps) {
  const { id } = await params
  const result = await getAssetWithLinkedPosts(id)
  if (!result) notFound()

  const { asset, posts } = result
  const previewUrl = asset.kind === "image" ? await signPreviewUrl(asset.storage_path) : null
  const Icon = asset.kind === "video" ? Film : FileImage
  const filename = asset.storage_path.split("/").pop() ?? asset.storage_path

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <Link
        href="/admin/content?tab=assets"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" /> Back to assets
      </Link>

      <header className="space-y-2">
        <h1 className="font-heading text-xl text-primary truncate">{filename}</h1>
        <p className="text-xs text-muted-foreground">{asset.mime_type}</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-6">
        {/* Preview */}
        <div className="border border-border rounded-lg bg-muted/30 overflow-hidden flex items-center justify-center min-h-[300px]">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={asset.ai_alt_text ?? ""}
              className="max-w-full max-h-[600px] object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground py-16">
              <Icon className="size-12" />
              <span className="text-xs">
                {asset.kind === "video" ? "Video preview coming soon" : "Preview unavailable"}
              </span>
            </div>
          )}
        </div>

        {/* Metadata + linked posts */}
        <aside className="space-y-6">
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Kind</dt>
              <dd className="font-mono">{asset.kind}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Size</dt>
              <dd className="font-mono">{formatSize(asset.bytes)}</dd>
            </div>
            {asset.width && asset.height ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Dimensions</dt>
                <dd className="font-mono">
                  {asset.width}×{asset.height}
                </dd>
              </div>
            ) : null}
            {asset.duration_ms ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Duration</dt>
                <dd className="font-mono">{Math.round(asset.duration_ms / 1000)}s</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Created</dt>
              <dd className="font-mono">{new Date(asset.created_at).toLocaleString()}</dd>
            </div>
            {asset.derived_from_video_id ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Derived from video</dt>
                <dd className="font-mono truncate max-w-[150px]" title={asset.derived_from_video_id}>
                  {asset.derived_from_video_id.slice(0, 8)}…
                </dd>
              </div>
            ) : null}
          </dl>

          {asset.ai_alt_text ? (
            <section>
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                AI alt-text
              </h2>
              <p className="text-sm text-primary italic">“{asset.ai_alt_text}”</p>
            </section>
          ) : null}

          {asset.ai_analysis ? (
            <section>
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                AI analysis
              </h2>
              <pre className="text-[11px] bg-muted/30 rounded p-2 overflow-auto max-h-64">
                {JSON.stringify(asset.ai_analysis, null, 2)}
              </pre>
            </section>
          ) : null}
        </aside>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
          Used in {posts.length} {posts.length === 1 ? "post" : "posts"}
        </h2>
        {posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not attached to any post yet.
          </p>
        ) : (
          <ul className="divide-y divide-border border border-border rounded-lg bg-white">
            {posts.map((post) => {
              const PlatformIcon = PLATFORM_ICONS[post.platform as SocialPlatform]
              return (
                <li key={post.id}>
                  <Link
                    href={`/admin/content/post/${post.id}`}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-surface/40"
                  >
                    {PlatformIcon ? (
                      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                        <PlatformIcon className="size-4 text-primary" />
                      </span>
                    ) : null}
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{PLATFORM_LABELS[post.platform as SocialPlatform] ?? post.platform}</span>
                        <span>•</span>
                        <span className="font-mono">{post.approval_status}</span>
                        <span>•</span>
                        <span className="font-mono">{post.post_type}</span>
                      </div>
                      <p className="text-sm text-primary line-clamp-2">{post.content}</p>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
