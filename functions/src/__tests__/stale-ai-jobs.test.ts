import { describe, it, expect } from "vitest"
import {
  selectStaleJobs,
  graceMsForType,
  DEFAULT_STALE_MS,
  EXTERNAL_STALE_MS,
  type StaleJobCandidate,
} from "../lib/stale-ai-jobs.js"

const NOW = 1_800_000_000_000
const MIN = 60_000

function job(over: Partial<StaleJobCandidate> = {}): StaleJobCandidate {
  return {
    id: "job1",
    type: "week_generation",
    status: "processing",
    updatedAtMs: NOW - 60 * MIN,
    ...over,
  }
}

describe("graceMsForType", () => {
  it("gives in-function types the default grace", () => {
    expect(graceMsForType("week_generation")).toBe(DEFAULT_STALE_MS)
    expect(graceMsForType("blog_generation")).toBe(DEFAULT_STALE_MS)
  })

  it("gives externally-completed types the long grace", () => {
    // These sit in "processing" while a Cloud Run Job / webhook does the work.
    expect(graceMsForType("split_reel_render")).toBe(EXTERNAL_STALE_MS)
    expect(graceMsForType("video_caption_render")).toBe(EXTERNAL_STALE_MS)
    expect(graceMsForType("broll_generation")).toBe(EXTERNAL_STALE_MS)
    expect(graceMsForType("video_transcription")).toBe(EXTERNAL_STALE_MS)
  })

  it("defaults unknown/missing types to the short grace", () => {
    expect(graceMsForType("something_new")).toBe(DEFAULT_STALE_MS)
    expect(graceMsForType(null)).toBe(DEFAULT_STALE_MS)
    expect(graceMsForType(undefined)).toBe(DEFAULT_STALE_MS)
  })
})

describe("selectStaleJobs", () => {
  it("reaps a processing job past its grace", () => {
    const [verdict, ...rest] = selectStaleJobs([job({ updatedAtMs: NOW - 60 * MIN })], NOW)
    expect(rest).toHaveLength(0)
    expect(verdict.id).toBe("job1")
    expect(verdict.type).toBe("week_generation")
    expect(verdict.staleForMs).toBe(60 * MIN)
    expect(verdict.reason).toContain("60 min")
    expect(verdict.reason).toContain("Safe to retry")
  })

  it("reaps a pending job whose handler never fired", () => {
    const out = selectStaleJobs([job({ status: "pending", updatedAtMs: NOW - 90 * MIN })], NOW)
    expect(out).toHaveLength(1)
  })

  it("reaps a streaming job that stopped emitting", () => {
    const out = selectStaleJobs([job({ status: "streaming", updatedAtMs: NOW - 90 * MIN })], NOW)
    expect(out).toHaveLength(1)
  })

  it("leaves a job that is still inside its grace", () => {
    // 25 min is already past the 9-min Eventarc ceiling, but still inside the
    // grace — the reaper stays conservative rather than racing a live job.
    expect(selectStaleJobs([job({ updatedAtMs: NOW - 25 * MIN })], NOW)).toEqual([])
  })

  it("does not reap exactly at the grace boundary", () => {
    expect(selectStaleJobs([job({ updatedAtMs: NOW - DEFAULT_STALE_MS })], NOW)).toEqual([])
    expect(selectStaleJobs([job({ updatedAtMs: NOW - DEFAULT_STALE_MS - 1 })], NOW)).toHaveLength(1)
  })

  it("never reaps settled jobs", () => {
    const ancient = NOW - 30 * 24 * 60 * MIN
    for (const status of ["completed", "failed", "cancelled"]) {
      expect(selectStaleJobs([job({ status, updatedAtMs: ancient })], NOW)).toEqual([])
    }
  })

  it("ignores an unrecognized status rather than guessing", () => {
    expect(selectStaleJobs([job({ status: "queued_v2", updatedAtMs: NOW - 90 * MIN })], NOW)).toEqual([])
    expect(selectStaleJobs([job({ status: null, updatedAtMs: NOW - 90 * MIN })], NOW)).toEqual([])
  })

  it("spares a long-running render that would be stale under the default grace", () => {
    // The regression this guards: a 90-min Cloud Run render is alive, not wedged.
    const renders = [
      job({ id: "r1", type: "split_reel_render", updatedAtMs: NOW - 90 * MIN }),
      job({ id: "r2", type: "video_transcription", updatedAtMs: NOW - 3 * 60 * MIN }),
    ]
    expect(selectStaleJobs(renders, NOW)).toEqual([])
  })

  it("still reaps an externally-completed job whose webhook never arrived", () => {
    const out = selectStaleJobs([job({ type: "broll_generation", updatedAtMs: NOW - 7 * 60 * MIN })], NOW)
    expect(out).toHaveLength(1)
    expect(out[0].graceMs).toBe(EXTERNAL_STALE_MS)
  })

  it("falls back to createdAt when updatedAt is absent", () => {
    const out = selectStaleJobs([job({ updatedAtMs: null, createdAtMs: NOW - 90 * MIN })], NOW)
    expect(out).toHaveLength(1)
    expect(out[0].staleForMs).toBe(90 * MIN)
  })

  it("prefers updatedAt over createdAt for liveness", () => {
    // Created long ago but touched recently = actively working.
    const out = selectStaleJobs([job({ createdAtMs: NOW - 10 * 60 * MIN, updatedAtMs: NOW - 2 * MIN })], NOW)
    expect(out).toEqual([])
  })

  it("skips docs with no usable timestamp instead of reaping them", () => {
    // An unmaterialized serverTimestamp reads as null and is indistinguishable
    // from a doc created a second ago — reaping it would kill a live job.
    expect(selectStaleJobs([job({ updatedAtMs: null, createdAtMs: null })], NOW)).toEqual([])
  })

  it("treats future-dated timestamps as fresh", () => {
    expect(selectStaleJobs([job({ updatedAtMs: NOW + 5 * MIN })], NOW)).toEqual([])
  })

  it("selects only the stale entries from a mixed batch", () => {
    const out = selectStaleJobs(
      [
        job({ id: "stale", updatedAtMs: NOW - 90 * MIN }),
        job({ id: "fresh", updatedAtMs: NOW - 2 * MIN }),
        job({ id: "done", status: "completed", updatedAtMs: NOW - 90 * MIN }),
        job({ id: "render", type: "video_caption_render", updatedAtMs: NOW - 90 * MIN }),
      ],
      NOW,
    )
    expect(out.map((v) => v.id)).toEqual(["stale"])
  })

  it("returns nothing for an empty batch", () => {
    expect(selectStaleJobs([], NOW)).toEqual([])
  })
})
