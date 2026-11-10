import { describe, it, expect } from "vitest"
import {
  STORY_MAX_VIDEO_MS,
  formatClock,
  isStoryVideoTooLong,
  spreadTimes,
  spreadableStories,
  storyTooLongMessage,
  videoSecondsFromAudioDuration,
} from "@/lib/content-studio/stories"

describe("story helpers", () => {
  it("stores AssemblyAI's audio length in whole seconds, rounded up", () => {
    expect(videoSecondsFromAudioDuration(58.2)).toBe(59)
    expect(videoSecondsFromAudioDuration(60.4)).toBe(61)
    expect(videoSecondsFromAudioDuration(undefined)).toBeNull()
    expect(videoSecondsFromAudioDuration(0)).toBeNull()
    expect(videoSecondsFromAudioDuration("58")).toBeNull()
  })

  it("formats durations as m:ss", () => {
    expect(formatClock(134_000)).toBe("2:14")
    expect(formatClock(5_000)).toBe("0:05")
  })

  it("flags only videos over 60 seconds", () => {
    expect(isStoryVideoTooLong(STORY_MAX_VIDEO_MS)).toBe(false)
    expect(isStoryVideoTooLong(STORY_MAX_VIDEO_MS + 1)).toBe(true)
    expect(isStoryVideoTooLong(null)).toBe(false)
  })

  it("names the length and the fix", () => {
    expect(storyTooLongMessage(134_000)).toContain("2:14")
    expect(storyTooLongMessage(134_000)).toContain("Split reel")
  })

  it("spreads times evenly with both ends included", () => {
    const start = new Date("2026-11-11T09:00:00Z")
    const end = new Date("2026-11-11T21:00:00Z")
    expect(spreadTimes(start, end, 3).map((d) => d.toISOString())).toEqual([
      "2026-11-11T09:00:00.000Z",
      "2026-11-11T15:00:00.000Z",
      "2026-11-11T21:00:00.000Z",
    ])
  })

  it("puts a single story at the start, and refuses a backwards window", () => {
    const start = new Date("2026-11-11T09:00:00Z")
    const end = new Date("2026-11-11T21:00:00Z")
    expect(spreadTimes(start, end, 1)).toEqual([start])
    expect(spreadTimes(end, start, 2)).toEqual([])
    expect(spreadTimes(start, end, 0)).toEqual([])
  })

  it("refuses to put several stories on one instant", () => {
    const t = new Date("2026-11-11T09:00:00Z")
    expect(spreadTimes(t, t, 3)).toEqual([])
    expect(spreadTimes(t, t, 1)).toEqual([t])
  })

  // Scheduling releases the video's edit gate, so a video story must be approved first.
  it("spreads approved stories and unreviewed photo stories, never an unreviewed video story", () => {
    const s = (id: string, approval_status: string, source_video_id: string | null, created_at: string) => ({
      id,
      approval_status,
      source_video_id,
      created_at,
    })
    const picked = spreadableStories([
      s("video-draft", "draft", "v1", "2026-11-10T01:00:00Z"),
      s("video-approved", "approved", "v2", "2026-11-10T03:00:00Z"),
      s("photo-draft", "draft", null, "2026-11-10T02:00:00Z"),
      s("photo-scheduled", "scheduled", null, "2026-11-10T00:00:00Z"),
      s("quote-edited", "edited", null, "2026-11-10T04:00:00Z"),
    ])
    expect(picked.map((p) => p.id)).toEqual(["photo-draft", "video-approved", "quote-edited"])
  })
})
