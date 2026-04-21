"use client"

import { VIDEO_COLUMNS, VIDEO_COLUMN_LABELS, videosByColumn, type VideoColumn } from "@/lib/content-studio/pipeline-columns"
import { HELP_COPY } from "@/lib/help-copy"
import { Lane, LaneColumn, type LaneTone } from "./Lane"
import { VideoCard } from "./VideoCard"
import type { PipelineData } from "@/lib/content-studio/pipeline-data"

interface VideosLaneProps {
  data: PipelineData
}

const VIDEO_COLUMN_TONES: Record<string, LaneTone> = {
  uploaded:    "neutral",
  transcribing: "progress",
  transcribed: "success",
  generated:   "progress",
  complete:    "published",
}

const VIDEO_COLUMN_HELP: Record<VideoColumn, string> = {
  uploaded:     HELP_COPY.uploadedColumn,
  transcribing: HELP_COPY.transcribingColumn,
  transcribed:  HELP_COPY.transcribedColumn,
  generated:    HELP_COPY.generatedColumn,
  complete:     HELP_COPY.completeColumn,
}

export function VideosLane({ data }: VideosLaneProps) {
  const grouped = videosByColumn(data.videos, data.posts)
  const videoCount = data.videos.length
  const withPosts = Object.keys(data.postCountsByVideo).length

  return (
    <Lane
      title="Videos"
      subtitle="Auto-advance based on transcription + fanout state"
      tone="neutral"
      help={HELP_COPY.videosLane}
      meta={
        videoCount > 0
          ? `${videoCount} total${withPosts > 0 ? ` · ${withPosts} with posts` : ""}`
          : undefined
      }
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
