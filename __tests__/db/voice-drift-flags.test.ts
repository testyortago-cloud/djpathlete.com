// __tests__/db/voice-drift-flags.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { insertVoiceDriftFlag, listRecentVoiceDriftFlags } from "@/lib/db/voice-drift-flags"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_TAG = "__TEST_VOICE_DRIFT__"

describe("voice-drift-flags DAL", () => {
  const supabase = createServiceRoleClient()

  async function cleanup() {
    await supabase.from("voice_drift_flags").delete().like("content_preview", `${TEST_TAG}%`)
  }

  beforeEach(cleanup)
  afterAll(cleanup)

  it("inserts a flag and reads it back", async () => {
    const inserted = await insertVoiceDriftFlag({
      entity_type: "social_post",
      entity_id: "11111111-1111-1111-1111-111111111111",
      drift_score: 65,
      severity: "medium",
      issues: [{ issue: "too formal", suggestion: "loosen the tone" }],
      content_preview: `${TEST_TAG}sample caption`,
      scanned_at: new Date().toISOString(),
    })

    expect(inserted.id).toBeTruthy()
    expect(inserted.drift_score).toBe(65)
    expect(inserted.issues).toHaveLength(1)

    const rows = await listRecentVoiceDriftFlags({ limit: 10 })
    expect(rows.find((r) => r.id === inserted.id)).toBeTruthy()
  })

  it("filters by severity", async () => {
    const baseRow = {
      entity_type: "social_post" as const,
      entity_id: "22222222-2222-2222-2222-222222222222",
      issues: [],
      scanned_at: new Date().toISOString(),
    }
    await insertVoiceDriftFlag({
      ...baseRow,
      drift_score: 30,
      severity: "low",
      content_preview: `${TEST_TAG}low`,
    })
    await insertVoiceDriftFlag({
      ...baseRow,
      drift_score: 60,
      severity: "medium",
      content_preview: `${TEST_TAG}medium`,
    })
    await insertVoiceDriftFlag({
      ...baseRow,
      drift_score: 85,
      severity: "high",
      content_preview: `${TEST_TAG}high`,
    })

    const highOnly = await listRecentVoiceDriftFlags({ severity: "high" })
    expect(highOnly.filter((r) => r.content_preview.startsWith(TEST_TAG))).toHaveLength(1)

    const mediumAndHigh = await listRecentVoiceDriftFlags({
      severity: ["medium", "high"],
    })
    expect(mediumAndHigh.filter((r) => r.content_preview.startsWith(TEST_TAG))).toHaveLength(2)
  })

  it("filters by since", async () => {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000)

    await insertVoiceDriftFlag({
      entity_type: "blog_post",
      entity_id: "33333333-3333-3333-3333-333333333333",
      drift_score: 50,
      severity: "medium",
      issues: [],
      content_preview: `${TEST_TAG}recent`,
      scanned_at: oneHourAgo.toISOString(),
    })
    await insertVoiceDriftFlag({
      entity_type: "blog_post",
      entity_id: "44444444-4444-4444-4444-444444444444",
      drift_score: 50,
      severity: "medium",
      issues: [],
      content_preview: `${TEST_TAG}older`,
      scanned_at: twoDaysAgo.toISOString(),
    })

    const recent = await listRecentVoiceDriftFlags({
      since: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    })
    const testRows = recent.filter((r) => r.content_preview.startsWith(TEST_TAG))
    expect(testRows.map((r) => r.content_preview)).toContain(`${TEST_TAG}recent`)
    expect(testRows.map((r) => r.content_preview)).not.toContain(`${TEST_TAG}older`)
  })
})
