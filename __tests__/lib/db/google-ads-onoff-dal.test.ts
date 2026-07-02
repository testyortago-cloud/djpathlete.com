import { describe, it, expect, vi, beforeEach } from "vitest"

// Chainable mock. Each terminal method resolves to { data, error }.
const state: {
  result: { data: unknown; error: unknown }
  lastFromTable?: string
  lastUpdatePayload?: unknown
  lastUpdateTable?: string
  lastEqArgs?: Array<[string, string]>
} = {
  result: { data: null, error: null },
}

function makeBuilder(table: string) {
  const maybeSingleResult = {
    maybeSingle: vi.fn(() => Promise.resolve(state.result)),
  }
  const eq = vi.fn((col: string, val: string) => {
    state.lastEqArgs = [...(state.lastEqArgs ?? []), [col, val]]
    return maybeSingleResult
  })
  const updateEq = vi.fn(() => Promise.resolve(state.result))

  const builder = {
    select: vi.fn(() => ({
      eq,
      order: vi.fn(() => Promise.resolve(state.result)),
    })),
    update: vi.fn((payload: unknown) => {
      state.lastUpdatePayload = payload
      state.lastUpdateTable = table
      return { eq: updateEq }
    }),
  }
  return builder
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: vi.fn((table: string) => {
      state.lastFromTable = table
      return makeBuilder(table)
    }),
  }),
}))

import {
  getAdGroupForMutation,
  setAdGroupStatus,
  listAllAdGroups,
} from "@/lib/db/google-ads-ad-groups"
import { getAdForMutation, setAdStatus, listAllAds } from "@/lib/db/google-ads-ads"

beforeEach(() => {
  state.result = { data: null, error: null }
  state.lastFromTable = undefined
  state.lastUpdatePayload = undefined
  state.lastUpdateTable = undefined
  state.lastEqArgs = undefined
})

describe("getAdGroupForMutation", () => {
  it("flattens the joined campaign.customer_id to customer_id", async () => {
    state.result = {
      data: {
        id: "ag-1",
        ad_group_id: "111",
        name: "Ad Group One",
        status: "PAUSED",
        campaign: { customer_id: "cust-1" },
      },
      error: null,
    }
    const row = await getAdGroupForMutation("ag-1")
    expect(row).toEqual({
      id: "ag-1",
      ad_group_id: "111",
      name: "Ad Group One",
      status: "PAUSED",
      customer_id: "cust-1",
    })
  })

  it("returns null when the row is missing", async () => {
    state.result = { data: null, error: null }
    const row = await getAdGroupForMutation("missing")
    expect(row).toBeNull()
  })

  it("throws on error", async () => {
    state.result = { data: null, error: { message: "boom" } }
    await expect(getAdGroupForMutation("ag-1")).rejects.toBeTruthy()
  })
})

describe("setAdGroupStatus", () => {
  it("issues an update with the given status", async () => {
    state.result = { data: null, error: null }
    await setAdGroupStatus("ag-1", "ENABLED")
    expect(state.lastUpdateTable).toBe("google_ads_ad_groups")
    expect(state.lastUpdatePayload).toEqual({ status: "ENABLED" })
  })

  it("throws on error", async () => {
    state.result = { data: null, error: { message: "boom" } }
    await expect(setAdGroupStatus("ag-1", "PAUSED")).rejects.toBeTruthy()
  })
})

describe("listAllAdGroups", () => {
  it("returns the rows", async () => {
    state.result = { data: [{ id: "ag-1" }, { id: "ag-2" }], error: null }
    const rows = await listAllAdGroups()
    expect(rows).toHaveLength(2)
  })
})

describe("getAdForMutation", () => {
  it("flattens ad_group.ad_group_id, ad_group.campaign.customer_id, and first headline", async () => {
    state.result = {
      data: {
        id: "ad-1",
        ad_id: "999",
        status: "ENABLED",
        headlines: [{ text: "Get Fit Now" }, { text: "Second Headline" }],
        ad_group: { ad_group_id: "111", campaign: { customer_id: "cust-1" } },
      },
      error: null,
    }
    const row = await getAdForMutation("ad-1")
    expect(row).toEqual({
      id: "ad-1",
      ad_id: "999",
      status: "ENABLED",
      ad_group_id_external: "111",
      customer_id: "cust-1",
      headline: "Get Fit Now",
    })
  })

  it("returns null headline when headlines is empty or missing", async () => {
    state.result = {
      data: {
        id: "ad-1",
        ad_id: "999",
        status: "ENABLED",
        headlines: [],
        ad_group: { ad_group_id: "111", campaign: { customer_id: "cust-1" } },
      },
      error: null,
    }
    const row = await getAdForMutation("ad-1")
    expect(row?.headline).toBeNull()
  })

  it("returns null when the row is missing", async () => {
    state.result = { data: null, error: null }
    const row = await getAdForMutation("missing")
    expect(row).toBeNull()
  })

  it("throws on error", async () => {
    state.result = { data: null, error: { message: "boom" } }
    await expect(getAdForMutation("ad-1")).rejects.toBeTruthy()
  })
})

describe("setAdStatus", () => {
  it("issues an update with the given status", async () => {
    state.result = { data: null, error: null }
    await setAdStatus("ad-1", "REMOVED")
    expect(state.lastUpdateTable).toBe("google_ads_ads")
    expect(state.lastUpdatePayload).toEqual({ status: "REMOVED" })
  })

  it("throws on error", async () => {
    state.result = { data: null, error: { message: "boom" } }
    await expect(setAdStatus("ad-1", "PAUSED")).rejects.toBeTruthy()
  })
})

describe("listAllAds", () => {
  it("returns the rows", async () => {
    state.result = { data: [{ id: "ad-1" }], error: null }
    const rows = await listAllAds()
    expect(rows).toHaveLength(1)
  })
})
