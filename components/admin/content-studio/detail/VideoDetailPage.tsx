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

// Section headings: primary weight + a hairline rule so the stacked sections
// read as distinct bands without any decorative chrome.
const SECTION_HEADING = "font-heading text-sm font-semibold text-primary border-b border-border pb-1.5 mb-3"

export function VideoDetailPage({ data, backHref, backLabel, highlightPostId }: VideoDetailPageProps) {
  const video = data.video!
  const title = video.title ?? video.original_filename

  return (
    <div className="px-4 py-4 sm:px-6">
      <div className="mb-6 border-b border-border pb-4">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-3.5" /> {backLabel}
        </Link>
        <div className="mt-2 flex items-start justify-between gap-3">
          <h1 className="min-w-0 truncate font-heading text-xl text-primary" title={title}>
            {title}
          </h1>
          <MarkReadyButton videoUploadId={video.id} needsEdit={video.needs_edit} />
        </div>
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
