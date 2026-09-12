import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"

const sql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/00259_sms_messages.sql"),
  "utf8",
)

describe("00259_sms_messages", () => {
  it("keys the thread on a NOT NULL phone", () => {
    expect(sql).toMatch(/phone\s+text NOT NULL/)
  })

  it("lets a message outlive its contact rather than cascading it away", () => {
    // A cascade here would destroy the record of real texts to a real
    // person. The phone number is the key; the contact link is enrichment.
    expect(sql).toMatch(/contact_id\s+uuid REFERENCES public\.contacts\(id\) ON DELETE SET NULL/)
  })

  it("enables RLS with a service-role-only policy", () => {
    expect(sql).toMatch(/ALTER TABLE public\.sms_messages ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/FOR ALL TO service_role/)
  })

  it("scopes the phone index by tenant", () => {
    expect(sql).toMatch(/sms_messages_phone_idx[\s\S]*business_id, phone/)
  })
})
