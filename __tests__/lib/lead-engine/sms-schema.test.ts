// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

const sql = readFileSync("supabase/migrations/00221_lead_engine_sms_config.sql", "utf8")

describe("00221 — sms config schema", () => {
  it("adds both business_settings columns NOT NULL DEFAULT ''", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS sms_messaging_service_sid\s+text\s+NOT NULL DEFAULT ''/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS sms_sender_phone\s+text\s+NOT NULL DEFAULT ''/)
  })
  it("extends sequence_messages.status with delivered/undelivered, keeping the old four", () => {
    const m = sql.match(/status IN \(([^)]+)\)/)
    expect(m).not.toBeNull()
    const statuses = m![1].split(",").map((s) => s.trim().replace(/'/g, ""))
    expect(statuses.sort()).toEqual(["delivered", "failed", "queued", "sent", "skipped", "undelivered"].sort())
  })
  it("requires a body on sms steps", () => {
    expect(sql).toMatch(/kind <> 'sms' OR body IS NOT NULL/)
  })
})
