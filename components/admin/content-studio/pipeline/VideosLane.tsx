"use client"

import {
  VIDEO_COLUMNS,
  VIDEO_COLUMN_LABELS,
  videosByColumn,
  VIDEO_COLUMNS_WITH_EDIT,
  VIDEO_COLUMN_WITH_EDIT_LABELS,
  videosByColumnWithEdit,
  type VideoColumnWithEdit,
} from "@/lib/content-studio/pipeline-columns"
import { HELP_COPY } from "@/lib/help-copy"
import { Lane, LaneColumn, type LaneTone } from "./Lane"
import { VideoCard } from "./VideoCard"
import { RenderWatcher } from "./RenderWatcher"
import type { PipelineData } from "@/lib/content-studio/pipeline-data"

interface VideosLaneProps {
  data: PipelineData
}

const VIDEO_COLUMN_TONES: Record<string, LaneTone> = {
  uploaded: "neutral",
  transcribing: "progress",
  transcribed: "success",
  needs_edit: "warning",
  rendering: "progress",
  edited: "success",
  generated: "progress",
  complete: "published",
}

const VIDEO_COLUMN_HELP: Record<string, string> = {
  uploaded: HELP_COPY.uploadedColumn,
  transcribing: HELP_COPY.transcribingColumn,
  transcribed: HELP_COPY.transcribedColumn,
  needs_edit: HELP_COPY.needsEditColumn,
  rendering: HELP_COPY.renderingColumn,
  edited: HELP_COPY.editedColumn,
  generated: HELP_COPY.generatedColumn,
  complete: HELP_COPY.completeColumn,
}

export function VideosLane({ data }: VideosLaneProps) {
  const videoCount = data.videos.length
  const withPosts = Object.keys(data.postCountsByVideo).length

  const meta = videoCount > 0 ? `${videoCount} total${withPosts > 0 ? ` · ${withPosts} with posts` : ""}` : undefined

  if (!data.captionedCutEnabled) {
    const grouped = videosByColumn(data.videos, data.posts)
    return (
      <Lane
        title="Videos"
        subtitle="Auto-advance based on transcription + fanout state"
        tone="neutral"
        help={HELP_COPY.videosLane}
        meta={meta}
      >
        {VIDEO_COLUMNS.map((col) => (
          <LaneColumn
            key={col}
            id={`video-${col}`}
            label={VIDEO_COLUMN_LABELS[col]}
            count={grouped[col].length}
            accepts={false}
            tone={VIDEO_COLUMN_TONES[col] ?? "neutral"}
            help={VIDEO_COLUMN_HELP[col]}
          >
            {grouped[col].map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                counts={data.postCountsByVideo[v.id] ?? null}
                thumbnailUrl={data.thumbnailUrlsByVideo[v.id] ?? null}
                hasCut={data.cutVideoIds.has(v.id)}
              />
            ))}
            {grouped[col].length === 0 && (
              <div className="py-6 text-center text-[11px] text-muted-foreground/50 italic">empty</div>
            )}
          </LaneColumn>
        ))}
      </Lane>
    )
  }

  const renderingVideoIds = new Set(Object.keys(data.renderJobIdByVideo))
  const grouped = videosByColumnWithEdit(data.videos, data.posts, {
    cutVideoIds: data.cutVideoIds,
    renderingVideoIds,
  })

  return (
    <Lane
      title="Videos"
      subtitle="Auto-advance through transcription, editing, and fanout"
      tone="neutral"
      help={HELP_COPY.videosLane}
      meta={meta}
    >
      <RenderWatcher jobIds={Object.values(data.renderJobIdByVideo)} />
      {VIDEO_COLUMNS_WITH_EDIT.map((col: VideoColumnWithEdit) => (
        <LaneColumn
          key={col}
          id={`video-${col}`}
          label={VIDEO_COLUMN_WITH_EDIT_LABELS[col]}
          count={grouped[col].length}
          accepts={false}
          tone={VIDEO_COLUMN_TONES[col] ?? "neutral"}
          help={VIDEO_COLUMN_HELP[col]}
        >
          {grouped[col].map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              counts={data.postCountsByVideo[v.id] ?? null}
              thumbnailUrl={data.thumbnailUrlsByVideo[v.id] ?? null}
              hasCut={data.cutVideoIds.has(v.id)}
              column={col}
              renderFailed={data.failedRenderVideoIds.has(v.id)}
              renderStartedAt={data.renderStartedAtByVideo[v.id] ?? null}
            />
          ))}
          {grouped[col].length === 0 && (
            <div className="py-6 text-center text-[11px] text-muted-foreground/50 italic">empty</div>
          )}
        </LaneColumn>
      ))}
    </Lane>
  )
}
