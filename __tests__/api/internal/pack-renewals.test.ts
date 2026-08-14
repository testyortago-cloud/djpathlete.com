import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ClientPackage } from "@/types/database"

const isCronSkippedMock = vi.fn()
const listActivePackagesMock = vi.fn()
const updateClientPackageMock = vi.fn()
const getUserByIdMock = vi.fn()
const getUsersMock = vi.fn()
const createNotificationMock = vi.fn()
const sendPackRenewalEmailMock = vi.fn()

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: (...a: unknown[]) => isCronSkippedMock(...a) }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({}) }))
vi.mock("@/lib/db/client-packages", () => ({
  listActivePackages: (...a: unknown[]) => listActivePackagesMock(...a),
  updateClientPackage: (...a: unknown[]) => updateClientPackageMock(...a),
}))
// This suite doesn't exercise the I2 stale-pending-attempt check either (see
// pack-renewals-sweep.test.ts) — default it to zero so the check no-ops
// cleanly instead of throwing on a missing mock export.
vi.mock("@/lib/db/pack-renewal-attempts", () => ({ countStalePendingRenewalAttempts: async () => 0 }))
vi.mock("@/lib/db/users", () => ({
  getUserById: (...a: unknown[]) => getUserByIdMock(...a),
  getUsers: (...a: unknown[]) => getUsersMock(...a),
}))
vi.mock("@/lib/db/notifications", () => ({ createNotification: (...a: unknown[]) => createNotificationMock(...a) }))
vi.mock("@/lib/email", () => ({ sendPackRenewalEmail: (...a: unknown[]) => sendPackRenewalEmailMock(...a) }))
vi.mock("@/lib/packs/flags", () => ({
  PACK_RENEWALS_CRON_KEY: "cron_pack_renewals_enabled",
  packReminderLowAt: async () => 2,
  packReminderExpiryDays: async () => 7,
  // This suite doesn't exercise the auto-renew sweep (see
  // pack-renewals-sweep.test.ts for that) — default it off so the sweep
  // no-ops cleanly instead of throwing on a missing mock export.
  packAutoRenewEnabled: async () => false,
}))

import { POST } from "@/app/api/admin/internal/pack-renewals/route"

function pkg(p: Partial<ClientPackage>): ClientPackage {
  return {
    id: "p",
    client_user_id: "c",
    product_id: null,
    session_type: "1-on-1",
    credits_total: 10,
    credits_used: 0,
    price_cents: 0,
    payment_method: "stripe",
    payment_status: "paid",
    stripe_session_id: null,
    stripe_payment_id: null,
    purchased_at: "2026-06-01T00:00:00Z",
    expires_at: null,
    status: "active",
    last_reminded_threshold: null,
    notes: null,
    created_by: null,
    created_at: "",
    updated_at: "",
    ...p,
  }
}

function req() {
  return new Request("http://localhost/api/admin/internal/pack-renewals", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = "test-token"
  isCronSkippedMock.mockResolvedValue({ skipped: false })
  getUserByIdMock.mockResolvedValue({ id: "c1", email: "c1@x.com", first_name: "Sam" })
  getUsersMock.mockResolvedValue([{ id: "admin-1", role: "admin" }])
})

describe("POST /api/admin/internal/pack-renewals", () => {
  it("401s without the cron token", async () => {
    const r = new Request("http://localhost/api/admin/internal/pack-renewals", { method: "POST" }) as never
    const res = await POST(r)
    expect(res.status).toBe(401)
  })

  it("skips when the cron is disabled", async () => {
    isCronSkippedMock.mockResolvedValue({ skipped: true, reason: "disabled" })
    const res = await POST(req())
    expect((await res.json()).skipped).toBe("disabled")
    expect(listActivePackagesMock).not.toHaveBeenCalled()
  })

  it("sends exactly one reminder and stamps it (empty pack), skipping healthy + already-nudged", async () => {
    listActivePackagesMock.mockResolvedValue([
      pkg({ id: "empty", client_user_id: "c1", credits_total: 5, credits_used: 5 }),
      pkg({ id: "healthy", client_user_id: "c2", credits_used: 0 }),
      pkg({ id: "lowAlready", client_user_id: "c3", credits_used: 8, last_reminded_threshold: "low" }),
    ])

    const res = await POST(req())
    const json = await res.json()

    expect(json).toMatchObject({ scanned: 3, reminders: 1, emailed: 1, notified: 1, errors: 0 })
    expect(sendPackRenewalEmailMock).toHaveBeenCalledTimes(1)
    expect(sendPackRenewalEmailMock).toHaveBeenCalledWith(expect.objectContaining({ threshold: "empty", to: "c1@x.com" }))
    expect(updateClientPackageMock).toHaveBeenCalledWith("empty", { last_reminded_threshold: "empty" })
    // one client in-app notification + one coach summary notification
    expect(createNotificationMock).toHaveBeenCalledTimes(2)
  })
})
