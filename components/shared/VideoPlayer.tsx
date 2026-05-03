"use client"

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react"
import { Play, Pause } from "lucide-react"
import type { TeamVideoComment } from "@/types/database"

export interface VideoPlayerHandle {
  /** Seek the player to the given timestamp (seconds) and pause. */
  seek: (timeSeconds: number) => void
  /** Get the current playback time in seconds. */
  getCurrentTime: () => number
  /** Get the total duration in seconds (0 until metadata loads). */
  getDuration: () => number
  /** Pause playback. */
  pause: () => void
}

interface Props {
  /** Signed read URL for the video file. */
  src: string
  /** Comments to render as markers on the timeline. Defaults to empty. */
  comments?: TeamVideoComment[]
  /** Called when a marker is clicked. Parent typically scrolls comment thread to it. */
  onMarkerClick?: (commentId: string, timecodeSeconds: number) => void
  /** Optional extra classes for the outer wrapper. */
  className?: string
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00"
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, "0")
  return `${m}:${sec}`
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { src, comments = [], onMarkerClick, className }, ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useImperativeHandle(ref, () => ({
    seek(t) {
      const v = videoRef.current
      if (!v) return
      v.currentTime = Math.max(0, Math.min(t, v.duration || t))
      v.pause()
    },
    getCurrentTime() {
      return videoRef.current?.currentTime ?? 0
    },
    getDuration() {
      return videoRef.current?.duration ?? 0
    },
    pause() {
      videoRef.current?.pause()
    },
  }))

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }

  function onScrubberClick(e: React.MouseEvent<HTMLDivElement>) {
    const v = videoRef.current
    if (!v || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    v.currentTime = Math.max(0, Math.min(duration * ratio, duration))
  }

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTimeUpdate = () => setCurrentTime(v.currentTime)
    const onLoadedMeta = () => setDuration(v.duration)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    v.addEventListener("timeupdate", onTimeUpdate)
    v.addEventListener("loadedmetadata", onLoadedMeta)
    v.addEventListener("play", onPlay)
    v.addEventListener("pause", onPause)
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate)
      v.removeEventListener("loadedmetadata", onLoadedMeta)
      v.removeEventListener("play", onPlay)
      v.removeEventListener("pause", onPause)
    }
  }, [])

  const timecodedComments = comments.filter((c) => c.timecode_seconds != null && c.status === "open")
  const progressPct = duration ? (currentTime / duration) * 100 : 0

  return (
    <div className={className ? `space-y-2 ${className}` : "space-y-2"}>
      <div className="overflow-hidden rounded-md bg-black">
        <video
          ref={videoRef}
          src={src}
          className="aspect-video w-full"
          preload="metadata"
          controls={false}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="rounded-full bg-primary p-2 text-primary-foreground hover:bg-primary/90"
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>

        <div className="relative flex-1">
          <div
            role="slider"
            tabIndex={0}
            aria-label="Video scrubber"
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration)}
            aria-valuenow={Math.floor(currentTime)}
            onClick={onScrubberClick}
            className="relative h-2 cursor-pointer rounded-full bg-muted"
          >
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-primary"
              style={{ width: `${progressPct}%` }}
            />
            {timecodedComments.map((c) => {
              const left = duration ? ((c.timecode_seconds ?? 0) / duration) * 100 : 0
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const v = videoRef.current
                    if (v) v.currentTime = c.timecode_seconds ?? 0
                    onMarkerClick?.(c.id, c.timecode_seconds ?? 0)
                  }}
                  title={c.comment_text.slice(0, 60)}
                  aria-label={`Comment at ${fmtTime(c.timecode_seconds ?? 0)}`}
                  className="absolute -top-1 size-4 -translate-x-1/2 rounded-full border-2 border-white bg-accent shadow"
                  style={{ left: `${left}%` }}
                />
              )
            })}
          </div>
        </div>

        <div className="font-mono text-xs text-muted-foreground tabular-nums">
          {fmtTime(currentTime)} / {fmtTime(duration)}
        </div>
      </div>
    </div>
  )
})
