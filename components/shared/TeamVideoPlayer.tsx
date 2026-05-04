"use client"

import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react"
import { Play, Pause } from "lucide-react"
import type { TeamVideoComment } from "@/types/database"

export interface TeamVideoPlayerHandle {
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
  /** Comments to render as markers on the timeline. */
  comments: TeamVideoComment[]
  /** Called when a marker is clicked. Parent typically scrolls comment thread to it. */
  onMarkerClick?: (commentId: string, timecodeSeconds: number) => void
  /** Called on every `timeupdate` event with the current playback position (seconds). */
  onTimeUpdate?: (currentSeconds: number) => void
  /**
   * Optional render-prop for content that should overlay the visible video area.
   * Receives `{ width, height }` — the pixel dimensions of the actual rendered video
   * rect (after letterbox / pillarbox computation). The overlay div is already
   * positioned and sized to match this rect, so consumers should fill it completely
   * (e.g. a Konva Stage sized to width × height).
   *
   * Note: the overlay wrapper has `pointer-events-none` so clicks fall through to
   * the video element. Override `pointer-events-auto` inside the overlay when you
   * need to capture input (e.g. a drawing canvas in edit mode).
   */
  renderOverlay?: (rect: { width: number; height: number }) => React.ReactNode
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00"
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, "0")
  return `${m}:${sec}`
}

export const TeamVideoPlayer = forwardRef<TeamVideoPlayerHandle, Props>(function TeamVideoPlayer(
  { src, comments, onMarkerClick, onTimeUpdate, renderOverlay }, ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoFrameRef = useRef<HTMLDivElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 })

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

  // Compute the actual rendered video rect inside the 16:9 container.
  // Re-runs whenever the container resizes OR the video metadata (intrinsic size) loads.
  function recompute() {
    const c = videoFrameRef.current
    const v = videoRef.current
    if (!c) return
    const cw = c.clientWidth
    const ch = c.clientHeight
    setContainerSize({ width: cw, height: ch })
    if (!v || !v.videoWidth || !v.videoHeight) {
      // Metadata not yet loaded — best-effort fallback: treat as full container
      setVideoSize({ width: cw, height: ch })
      return
    }
    const containerAspect = cw / ch
    const videoAspect = v.videoWidth / v.videoHeight
    if (videoAspect >= containerAspect) {
      // Video wider than container: fills width, letterboxed top/bottom
      setVideoSize({ width: cw, height: cw / videoAspect })
    } else {
      // Video taller than container: fills height, pillarboxed left/right
      setVideoSize({ width: ch * videoAspect, height: ch })
    }
  }

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTimeUpdateHandler = () => {
      setCurrentTime(v.currentTime)
      onTimeUpdate?.(v.currentTime)
    }
    const onLoadedMeta = () => {
      setDuration(v.duration)
      recompute()
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onError = () => {
      // Suppress overlay when video fails to load — no point measuring an empty frame.
      setVideoSize({ width: 0, height: 0 })
    }
    v.addEventListener("timeupdate", onTimeUpdateHandler)
    v.addEventListener("loadedmetadata", onLoadedMeta)
    v.addEventListener("play", onPlay)
    v.addEventListener("pause", onPause)
    v.addEventListener("error", onError)
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdateHandler)
      v.removeEventListener("loadedmetadata", onLoadedMeta)
      v.removeEventListener("play", onPlay)
      v.removeEventListener("pause", onPause)
      v.removeEventListener("error", onError)
    }
  // recompute and setX are stable across renders (refs + useState setters);
  // only onTimeUpdate is an external callback whose identity matters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onTimeUpdate])

  // ResizeObserver on the video-frame container so recompute fires on layout changes
  useEffect(() => {
    const c = videoFrameRef.current
    if (!c) return
    const ro = new ResizeObserver(recompute)
    ro.observe(c)
    // Initial measurement
    recompute()
    return () => ro.disconnect()
  // recompute closes over refs/setters only — stable across renders.
  // Re-attach the observer when src changes (new video, new layout cycle).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  const timecodedComments = comments.filter((c) => c.timecode_seconds != null && c.status === "open")
  const progressPct = duration ? (currentTime / duration) * 100 : 0

  return (
    <div className="space-y-2">
      <div ref={videoFrameRef} className="relative overflow-hidden rounded-md bg-black">
        <video
          ref={videoRef}
          src={src}
          className="aspect-video w-full"
          preload="metadata"
          controls={false}
        />
        {renderOverlay && videoSize.width > 0 && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: (containerSize.width - videoSize.width) / 2,
              top: (containerSize.height - videoSize.height) / 2,
              width: videoSize.width,
              height: videoSize.height,
            }}
          >
            {renderOverlay({ width: videoSize.width, height: videoSize.height })}
          </div>
        )}
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

        <div className="group relative flex-1 py-2">
          <div
            role="slider"
            tabIndex={0}
            aria-label="Video scrubber"
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration)}
            aria-valuenow={Math.floor(currentTime)}
            onClick={onScrubberClick}
            className="relative h-2 cursor-pointer overflow-visible rounded-full bg-primary/15 ring-1 ring-inset ring-primary/10 transition-all group-hover:h-2.5"
          >
            {/* Filled progress */}
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-primary"
              style={{ width: `${progressPct}%` }}
            />
            {/* Playhead knob — appears on hover so it doesn't crowd the markers at rest */}
            <div
              aria-hidden
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary opacity-0 ring-2 ring-background shadow transition-opacity group-hover:opacity-100"
              style={{ left: `${progressPct}%` }}
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
                  className="absolute -top-1 size-4 -translate-x-1/2 rounded-full border-2 border-background bg-accent shadow hover:scale-110 transition-transform"
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
