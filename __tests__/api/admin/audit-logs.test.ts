import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "@/app/api/admin/audit-logs/route"
import { insertAuditLog } from "@/lib/db/audit-logs"
import { createServiceRoleClient } from "@/lib/supabase"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "u-admin", email: "admin@test", role: "admin" },
  }),
}))

const TEST_TARGET = "00000000-0000-0000-0000-0000000ad777"

describe("GET /api/admin/audit-logs", () => {
  const supabase = createServiceRoleClient()
  beforeEach(async () => {
    await supabase.from("audit_logs").delete().eq("target_id", TEST_TARGET)
    await insertAuditLog({
      action: "user.updated",
      category: "admin_write",
      target_type: "user",
      target_id: TEST_TARGET,
    })
  })

  it("returns rows for an admin", async () => {
    const req = new Request(`https://x/api/admin/audit-logs?target_type=user&target_id=${TEST_TARGET}`)
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json() as { rows: unknown[]; total: number }
    expect(body.total).toBe(1)
  })

  it("rejects non-admin", async () => {
    const { auth } = await import("@/lib/auth")
    ;(auth as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      user: { id: "u-client", email: "c@test", role: "client" },
    })
    const req = new Request("https://x/api/admin/audit-logs")
    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})
