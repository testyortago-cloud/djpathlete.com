"use client"

import {
  VIDEO_COLUMNS,
  VIDEO_COLUMN_LABELS,
  videosByColumn,
} from "@/lib/content-studio/pipeline-columns"
import { Lane, LaneColumn } from "./Lane"
import { VideoCard } from "./VideoCard"
import type { PipelineData } from "@/lib/content-studio/pipeline-data"

interface VideosLaneProps {
  data: PipelineData
}

export function VideosLane({ data }: VideosLaneProps) {
  const grouped = videosByColumn(data.videos, data.posts)

  return (
    <Lane title="Videos" subtitle="Auto-advance based on transcription + fanout state">
      {VIDEO_COLUMNS.map((col) => (
        <LaneColumn
          key={col}
          id={`video-${col}`}
          label={VIDEO_COLUMN_LABELS[col]}
          count={grouped[col].length}
          accepts={false}
        >
          {grouped[col].map((v) => (
            <VideoCard key={v.id} video={v} counts={data.postCountsByVideo[v.id] ?? null} />
          ))}
          {grouped[col].length === 0 && (
            <div className="py-6 text-center text-[11px] text-muted-foreground/60 italic">
              empty
            </div>
          )}
        </LaneColumn>
      ))}
    </Lane>
  )
}
