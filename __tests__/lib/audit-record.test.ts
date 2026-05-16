import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"

// Mock auth() to control session presence
vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "11111111-1111-1111-1111-111111111111", email: "a@b.com", role: "admin", name: "Tester" },
  }),
}))

import { recordAudit } from "@/lib/audit/record"
import { listAuditLogs } from "@/lib/db/audit-logs"
import { createServiceRoleClient } from "@/lib/supabase"

const ACTOR = "11111111-1111-1111-1111-111111111111"
const ACTOR_EMAIL = "a@b.com"

describe("recordAudit", () => {
  const supabase = createServiceRoleClient()

  // The audit_logs.actor_id column has a FK to users(id), so we seed a test
  // user with the mocked session UUID before running the integration tests.
  beforeAll(async () => {
    await supabase.from("users").upsert(
      {
        id: ACTOR,
        email: ACTOR_EMAIL,
        password_hash: "test-not-used",
        first_name: "Test",
        last_name: "Actor",
        role: "admin",
      },
      { onConflict: "id" },
    )
  })

  afterAll(async () => {
    await supabase.from("audit_logs").delete().eq("actor_id", ACTOR)
    await supabase.from("audit_logs").delete().eq("actor_email", "system")
    await supabase.from("users").delete().eq("id", ACTOR)
  })

  beforeEach(async () => {
    await supabase.from("audit_logs").delete().eq("actor_id", ACTOR)
  })

  it("resolves actor from session and writes a row", async () => {
    await recordAudit({
      action: "user.updated",
      category: "admin_write",
      target: { type: "user", id: "tgt-1", label: "Jane Doe" },
      metadata: { changed: ["email"] },
    })
    const { rows } = await listAuditLogs({ actor_id: ACTOR, page: 1, perPage: 10 })
    expect(rows[0].action).toBe("user.updated")
    expect(rows[0].actor_email).toBe("a@b.com")
    expect(rows[0].actor_role).toBe("admin")
    expect(rows[0].target_id).toBe("tgt-1")
  })

  it("scrubs sensitive metadata keys", async () => {
    await recordAudit({
      action: "user.updated",
      category: "admin_write",
      metadata: { password: "hunter2", normal: "ok" },
    })
    const { rows } = await listAuditLogs({ actor_id: ACTOR, page: 1, perPage: 10 })
    expect(rows[0].metadata.password).toBe("[REDACTED]")
    expect(rows[0].metadata.normal).toBe("ok")
  })

  it("extracts ip + ua from request headers when provided", async () => {
    const req = new Request("https://example.com/api/admin/users", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1", "user-agent": "Mozilla/Test" },
    })
    await recordAudit({ action: "user.created", category: "admin_write", request: req })
    const { rows } = await listAuditLogs({ actor_id: ACTOR, page: 1, perPage: 10 })
    expect(rows[0].ip_address).toBe("203.0.113.5")
    expect(rows[0].user_agent).toBe("Mozilla/Test")
    expect(rows[0].request_method).toBe("POST")
    expect(rows[0].request_path).toBe("/api/admin/users")
  })

  it("honors actor override (for system/cron writes)", async () => {
    await recordAudit({
      action: "cron.manual_trigger",
      category: "automation",
      actor: { id: null, email: "system", role: "system" },
      metadata: { cron_name: "automationHealthCron" },
    })
    const { rows } = await listAuditLogs({ page: 1, perPage: 10, category: "automation" })
    const row = rows.find((r) => r.metadata.cron_name === "automationHealthCron")
    expect(row?.actor_role).toBe("system")
    expect(row?.actor_email).toBe("system")
  })
})
