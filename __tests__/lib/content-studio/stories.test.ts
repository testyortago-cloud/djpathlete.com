import { describe, it, expect } from "vitest"
import {
  STORY_MAX_VIDEO_MS,
  formatClock,
  isStoryVideoTooLong,
  spreadTimes,
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
})
