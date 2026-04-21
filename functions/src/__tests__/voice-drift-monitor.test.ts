import { describe, it, expect, vi, beforeEach } from "vitest"
import { runVoiceDriftMonitor } from "../voice-drift-monitor.js"
import type { VoiceDriftAssessment } from "../ai/schemas.js"

interface InsertRow {
  entity_type: string
  entity_id: string
  drift_score: number
  severity: string
  issues: unknown
  content_preview: string
  scanned_at: string
}

interface FakeData {
  voiceProfile: string | null
  socials: Array<{ id: string; content: string; created_at: string }>
  blogs: Array<{ id: string; content: string; created_at: string }>
  newsletters: Array<{ id: string; content: string; created_at: string }>
}

function makeSupabaseStub(data: FakeData) {
  const inserts: InsertRow[] = []

  const stub = {
    from(table: string) {
      if (table === "prompt_templates") {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () =>
                  data.voiceProfile === null
                    ? { data: null, error: null }
                    : { data: { prompt: data.voiceProfile }, error: null },
              }),
            }),
          }),
        }
      }
      const listImpl =
        table === "social_posts"
          ? data.socials
          : table === "blog_posts"
            ? data.blogs
            : table === "newsletters"
              ? data.newsletters
              : null

      if (listImpl !== null) {
        return {
          select: () => ({
            not: () => ({
              gte: () => ({
                order: () => ({
                  limit: async () => ({ data: listImpl, error: null }),
                }),
              }),
            }),
          }),
        }
      }

      if (table === "voice_drift_flags") {
        return {
          insert: async (row: InsertRow) => {
            inserts.push(row)
            return { error: null }
          },
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }

  return { stub, inserts }
}

const ISO_NOW = "2026-04-21T04:00:00.000Z"
const SAMPLE = (offset: number) => ({
  id: `id-${offset}`,
  content: `content-${offset}`,
  created_at: `2026-04-2${offset}T10:00:00Z`,
})

describe("runVoiceDriftMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("bails out with skippedNoVoiceProfile=true when no voice profile exists", async () => {
    const { stub, inserts } = makeSupabaseStub({
      voiceProfile: null,
      socials: [SAMPLE(1)],
      blogs: [],
      newsletters: [],
    })
    const claudeImpl = vi.fn()

    const result = await runVoiceDriftMonitor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseImpl: stub as any,
      claudeImpl,
      now: new Date(ISO_NOW),
    })

    expect(result).toEqual({ scanned: 0, flagged: 0, skippedNoVoiceProfile: true, errors: 0 })
    expect(claudeImpl).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })

  it("scans all available items but inserts only non-low severities", async () => {
    const { stub, inserts } = makeSupabaseStub({
      voiceProfile: "Friendly, direct, coach-like.",
      socials: [SAMPLE(1), SAMPLE(2)],
      blogs: [SAMPLE(3)],
      newsletters: [SAMPLE(4)],
    })

    const assessments: VoiceDriftAssessment[] = [
      { drift_score: 15, severity: "low", issues: [] },
      { drift_score: 55, severity: "medium", issues: [{ issue: "too formal", suggestion: "loosen" }] },
      { drift_score: 80, severity: "high", issues: [{ issue: "off-topic", suggestion: "refocus" }] },
      { drift_score: 20, severity: "low", issues: [] },
    ]
    let callIdx = 0
    const claudeImpl = vi.fn(async () => assessments[callIdx++])

    const result = await runVoiceDriftMonitor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseImpl: stub as any,
      claudeImpl,
      now: new Date(ISO_NOW),
    })

    expect(result.scanned).toBe(4)
    expect(result.flagged).toBe(2)
    expect(result.errors).toBe(0)
    expect(inserts).toHaveLength(2)
    expect(inserts[0].severity).toBe("medium")
    expect(inserts[1].severity).toBe("high")
  })

  it("increments errors but keeps going when Claude throws", async () => {
    const { stub, inserts } = makeSupabaseStub({
      voiceProfile: "voice",
      socials: [SAMPLE(1), SAMPLE(2)],
      blogs: [],
      newsletters: [],
    })

    const claudeImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValueOnce({
        drift_score: 75,
        severity: "high",
        issues: [{ issue: "x", suggestion: "y" }],
      })

    const result = await runVoiceDriftMonitor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseImpl: stub as any,
      claudeImpl,
      now: new Date(ISO_NOW),
    })

    expect(result.scanned).toBe(2)
    expect(result.flagged).toBe(1)
    expect(result.errors).toBe(1)
    expect(inserts).toHaveLength(1)
  })

  it("returns zeroes when there is nothing AI-generated in the last 7 days", async () => {
    const { stub, inserts } = makeSupabaseStub({
      voiceProfile: "voice",
      socials: [],
      blogs: [],
      newsletters: [],
    })
    const claudeImpl = vi.fn()

    const result = await runVoiceDriftMonitor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseImpl: stub as any,
      claudeImpl,
      now: new Date(ISO_NOW),
    })

    expect(result).toEqual({ scanned: 0, flagged: 0, skippedNoVoiceProfile: false, errors: 0 })
    expect(claudeImpl).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })

  it("respects the optional limit option (newest first)", async () => {
    const { stub, inserts } = makeSupabaseStub({
      voiceProfile: "voice",
      socials: [SAMPLE(1), SAMPLE(2), SAMPLE(3)],
      blogs: [SAMPLE(4)],
      newsletters: [SAMPLE(5)],
    })
    const claudeImpl = vi.fn().mockResolvedValue({ drift_score: 10, severity: "low", issues: [] })

    const result = await runVoiceDriftMonitor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseImpl: stub as any,
      claudeImpl,
      now: new Date(ISO_NOW),
      limit: 2,
    })

    expect(result.scanned).toBe(2)
    expect(claudeImpl).toHaveBeenCalledTimes(2)
    expect(inserts).toHaveLength(0) // all low severity
  })
})
