import { describe, it, expect, beforeEach } from "vitest"
import { insertAuditLog, listAuditLogs, pruneAuditLogs } from "@/lib/db/audit-logs"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_TARGET_ID = "00000000-0000-0000-0000-0000000ad001"

describe("audit-logs DAL", () => {
  const supabase = createServiceRoleClient()

  beforeEach(async () => {
    await supabase.from("audit_logs").delete().eq("target_id", TEST_TARGET_ID)
  })

  it("insertAuditLog writes a row and listAuditLogs returns it", async () => {
    await insertAuditLog({
      action: "user.updated",
      category: "admin_write",
      outcome: "success",
      target_type: "user",
      target_id: TEST_TARGET_ID,
      target_label: "Test User",
      metadata: { changed: ["email"] },
    })

    const { rows, total } = await listAuditLogs({ target_type: "user", target_id: TEST_TARGET_ID, page: 1, perPage: 10 })
    expect(total).toBe(1)
    expect(rows[0].action).toBe("user.updated")
    expect(rows[0].metadata).toEqual({ changed: ["email"] })
  })

  it("listAuditLogs filters by category, outcome, date range, and free-text", async () => {
    await insertAuditLog({ action: "user.updated", category: "admin_write", outcome: "success", target_type: "user", target_id: TEST_TARGET_ID })
    await insertAuditLog({ action: "auth.login_failed", category: "auth", outcome: "failure", target_type: "user", target_id: TEST_TARGET_ID, actor_email: "needle@example.com" })

    const failures = await listAuditLogs({ outcome: "failure", target_type: "user", target_id: TEST_TARGET_ID, page: 1, perPage: 10 })
    expect(failures.total).toBe(1)
    expect(failures.rows[0].action).toBe("auth.login_failed")

    const authOnly = await listAuditLogs({ category: "auth", target_type: "user", target_id: TEST_TARGET_ID, page: 1, perPage: 10 })
    expect(authOnly.total).toBe(1)

    const byEmail = await listAuditLogs({ q: "needle", target_type: "user", target_id: TEST_TARGET_ID, page: 1, perPage: 10 })
    expect(byEmail.total).toBe(1)
  })

  it("pruneAuditLogs deletes rows older than N days", async () => {
    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 100).toISOString()
    await supabase.from("audit_logs").insert({
      action: "user.updated",
      category: "admin_write",
      outcome: "success",
      target_type: "user",
      target_id: TEST_TARGET_ID,
      created_at: oldDate,
    })
    await insertAuditLog({ action: "user.updated", category: "admin_write", outcome: "success", target_type: "user", target_id: TEST_TARGET_ID })

    const deleted = await pruneAuditLogs(30)
    expect(deleted).toBeGreaterThanOrEqual(1)

    const { total } = await listAuditLogs({ target_type: "user", target_id: TEST_TARGET_ID, page: 1, perPage: 10 })
    expect(total).toBe(1)
  })
})
