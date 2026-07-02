import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.fn()
const getAdGroupForMutation = vi.fn()
const setAdGroupStatus = vi.fn()
const getAdForMutation = vi.fn()
const setAdStatus = vi.fn()
const mutateResourcesRest = vi.fn()
const recordAudit = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/google-ads-ad-groups", () => ({
  getAdGroupForMutation: (...a: unknown[]) => getAdGroupForMutation(...a),
  setAdGroupStatus: (...a: unknown[]) => setAdGroupStatus(...a),
}))
vi.mock("@/lib/db/google-ads-ads", () => ({
  getAdForMutation: (...a: unknown[]) => getAdForMutation(...a),
  setAdStatus: (...a: unknown[]) => setAdStatus(...a),
}))
vi.mock("@/lib/ads/google-ads-rest", () => ({
  mutateResourcesRest: (...a: unknown[]) => mutateResourcesRest(...a),
  isRemovedResourceError: (message: string) =>
    message.includes("OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE"),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }))

import { POST as adGroupStatusPOST } from "@/app/api/admin/ads/ad-groups/[id]/status/route"
import { POST as adStatusPOST } from "@/app/api/admin/ads/ads/[id]/status/route"

function req(body: unknown) {
  return new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body) })
}

const ADMIN_SESSION = { user: { id: "admin-1", role: "admin" } }
const CLIENT_SESSION = { user: { id: "client-1", role: "client" } }

beforeEach(() => {
  authMock.mockReset()
  getAdGroupForMutation.mockReset()
  setAdGroupStatus.mockReset()
  getAdForMutation.mockReset()
  setAdStatus.mockReset()
  mutateResourcesRest.mockReset()
  recordAudit.mockReset()
})

describe("POST /api/admin/ads/ad-groups/[id]/status", () => {
  const params = Promise.resolve({ id: "ag-row-1" })
  const adGroupRow = {
    id: "ag-row-1",
    ad_group_id: "555",
    name: "Comeback Code — Ad Group",
    status: "PAUSED",
    customer_id: "1234567890",
  }

  it("403s for non-admin", async () => {
    authMock.mockResolvedValue(CLIENT_SESSION)
    const res = await adGroupStatusPOST(req({ status: "ENABLED" }), { params })
    expect(res.status).toBe(403)
    expect(getAdGroupForMutation).not.toHaveBeenCalled()
  })

  it("404s when the ad group row is missing", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    getAdGroupForMutation.mockResolvedValue(null)
    const res = await adGroupStatusPOST(req({ status: "ENABLED" }), { params })
    expect(res.status).toBe(404)
  })

  it("happy path: mutates, mirrors status, records audit, returns ok", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    getAdGroupForMutation.mockResolvedValue({ ...adGroupRow, status: "ENABLED" })
    mutateResourcesRest.mockResolvedValue({ response: {}, createdCampaignResource: null })

    const res = await adGroupStatusPOST(req({ status: "PAUSED" }), { params })
    const json = await res.json()

    expect(mutateResourcesRest).toHaveBeenCalledTimes(1)
    const [customerId, ops] = mutateResourcesRest.mock.calls[0]
    expect(customerId).toBe("1234567890")
    expect(ops).toEqual([
      {
        entity: "ad_group",
        operation: "update",
        resource: expect.stringContaining("adGroups/555"),
        status: "PAUSED",
        update_mask: "status",
      },
    ])
    expect(setAdGroupStatus).toHaveBeenCalledWith("ag-row-1", "PAUSED")
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ads.ad_group_status_changed" }),
    )
    expect(json).toEqual({ ok: true, status: "PAUSED", previous: "ENABLED" })
  })

  it("noop when already the requested status", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    getAdGroupForMutation.mockResolvedValue({ ...adGroupRow, status: "PAUSED" })

    const res = await adGroupStatusPOST(req({ status: "PAUSED" }), { params })
    const json = await res.json()

    expect(mutateResourcesRest).not.toHaveBeenCalled()
    expect(setAdGroupStatus).not.toHaveBeenCalled()
    expect(json).toEqual({ ok: true, status: "PAUSED", noop: true })
  })

  it("409 removed self-heal when upstream rejects as removed", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    getAdGroupForMutation.mockResolvedValue({ ...adGroupRow, status: "ENABLED" })
    mutateResourcesRest.mockRejectedValue(
      new Error("googleAds:mutate failed (HTTP 400): OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE"),
    )

    const res = await adGroupStatusPOST(req({ status: "PAUSED" }), { params })
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.removed).toBe(true)
    expect(setAdGroupStatus).toHaveBeenCalledWith("ag-row-1", "REMOVED")
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ads.ad_group_status_changed", outcome: "failure" }),
    )
  })

  it("409s when the row is already REMOVED", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    getAdGroupForMutation.mockResolvedValue({ ...adGroupRow, status: "REMOVED" })

    const res = await adGroupStatusPOST(req({ status: "ENABLED" }), { params })
    expect(res.status).toBe(409)
    expect(mutateResourcesRest).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/ads/ads/[id]/status", () => {
  const params = Promise.resolve({ id: "ad-row-1" })
  const adRow = {
    id: "ad-row-1",
    ad_id: "777",
    status: "PAUSED",
    ad_group_id_external: "555",
    customer_id: "1234567890",
    headline: "Comeback Code — Get Started",
  }

  it("403s for non-admin", async () => {
    authMock.mockResolvedValue(CLIENT_SESSION)
    const res = await adStatusPOST(req({ status: "ENABLED" }), { params })
    expect(res.status).toBe(403)
    expect(getAdForMutation).not.toHaveBeenCalled()
  })

  it("404s when the ad row is missing", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    getAdForMutation.mockResolvedValue(null)
    const res = await adStatusPOST(req({ status: "ENABLED" }), { params })
    expect(res.status).toBe(404)
  })

  it("happy path: mutates, mirrors status, records audit, returns ok", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    getAdForMutation.mockResolvedValue({ ...adRow, status: "ENABLED" })
    mutateResourcesRest.mockResolvedValue({ response: {}, createdCampaignResource: null })

    const res = await adStatusPOST(req({ status: "PAUSED" }), { params })
    const json = await res.json()

    expect(mutateResourcesRest).toHaveBeenCalledTimes(1)
    const [customerId, ops] = mutateResourcesRest.mock.calls[0]
    expect(customerId).toBe("1234567890")
    expect(ops).toEqual([
      {
        entity: "ad_group_ad",
        operation: "update",
        resource: expect.stringContaining("adGroupAds/555~777"),
        status: "PAUSED",
        update_mask: "status",
      },
    ])
    expect(setAdStatus).toHaveBeenCalledWith("ad-row-1", "PAUSED")
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ads.ad_status_changed" }),
    )
    expect(json).toEqual({ ok: true, status: "PAUSED", previous: "ENABLED" })
  })

  it("noop when already the requested status", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    getAdForMutation.mockResolvedValue({ ...adRow, status: "PAUSED" })

    const res = await adStatusPOST(req({ status: "PAUSED" }), { params })
    const json = await res.json()

    expect(mutateResourcesRest).not.toHaveBeenCalled()
    expect(setAdStatus).not.toHaveBeenCalled()
    expect(json).toEqual({ ok: true, status: "PAUSED", noop: true })
  })

  it("409 removed self-heal when upstream rejects as removed", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    getAdForMutation.mockResolvedValue({ ...adRow, status: "ENABLED" })
    mutateResourcesRest.mockRejectedValue(
      new Error("googleAds:mutate failed (HTTP 400): OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE"),
    )

    const res = await adStatusPOST(req({ status: "PAUSED" }), { params })
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.removed).toBe(true)
    expect(setAdStatus).toHaveBeenCalledWith("ad-row-1", "REMOVED")
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ads.ad_status_changed", outcome: "failure" }),
    )
  })

  it("409s when the row is already REMOVED", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    getAdForMutation.mockResolvedValue({ ...adRow, status: "REMOVED" })

    const res = await adStatusPOST(req({ status: "ENABLED" }), { params })
    expect(res.status).toBe(409)
    expect(mutateResourcesRest).not.toHaveBeenCalled()
  })
})
