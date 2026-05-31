import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import type { DrawerData } from "@/lib/content-studio/drawer-data"
import { VideoDetailSidebar } from "./VideoDetailSidebar"
import { TranscriptTab } from "@/components/admin/content-studio/drawer/TranscriptTab"
import { PostsTab } from "@/components/admin/content-studio/drawer/PostsTab"
import { MetaTab } from "@/components/admin/content-studio/drawer/MetaTab"
import { MarkReadyButton } from "@/components/admin/content-studio/drawer/MarkReadyButton"

interface VideoDetailPageProps {
  data: DrawerData
  backHref: string
  backLabel: string
  highlightPostId: string | null
}

const SECTION_HEADING = "font-heading text-sm uppercase tracking-wide text-muted-foreground mb-2"

export function VideoDetailPage({ data, backHref, backLabel, highlightPostId }: VideoDetailPageProps) {
  const video = data.video!
  const title = video.title ?? video.original_filename

  return (
    <div className="px-4 py-4 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={backHref}
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="size-4" /> {backLabel}
          </Link>
          <h1 className="truncate font-heading text-lg text-primary" title={title}>
            {title}
          </h1>
        </div>
        <MarkReadyButton videoUploadId={video.id} needsEdit={video.needs_edit} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <div className="self-start lg:sticky lg:top-6">
          <VideoDetailSidebar
            video={video}
            previewUrl={data.previewUrl}
            hasTranscript={Boolean(data.transcript?.transcript_text)}
            captionedCutEnabled={data.captionedCutEnabled}
          />
        </div>

        <div className="min-w-0 space-y-8">
          <section aria-labelledby="transcript-heading">
            <h2 id="transcript-heading" className={SECTION_HEADING}>
              Transcript
            </h2>
            <TranscriptTab transcript={data.transcript} video={data.video} />
          </section>

          <section aria-labelledby="posts-heading">
            <h2 id="posts-heading" className={SECTION_HEADING}>
              Posts ({data.posts.length})
            </h2>
            <PostsTab posts={data.posts} mediaByPost={data.mediaByPost} initialExpandedPostId={highlightPostId} />
          </section>

          <section aria-labelledby="meta-heading">
            <h2 id="meta-heading" className={SECTION_HEADING}>
              Details
            </h2>
            <MetaTab video={data.video} transcript={data.transcript} posts={data.posts} />
          </section>
        </div>
      </div>
    </div>
  )
}
