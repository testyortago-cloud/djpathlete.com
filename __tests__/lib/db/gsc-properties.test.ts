import { describe, expect, it, vi, beforeEach } from "vitest"

// Mock the Supabase client factory before importing the DAL.
const builderResponse = vi.fn()
const fromMock = vi.fn(() => ({
  select: vi.fn(() => ({
    limit: vi.fn(() => ({
      maybeSingle: () => builderResponse(),
    })),
  })),
  upsert: vi.fn(() => ({
    select: vi.fn(() => ({
      single: () => builderResponse(),
    })),
  })),
  update: vi.fn(() => ({
    eq: () => builderResponse(),
  })),
  delete: vi.fn(() => ({
    eq: () => builderResponse(),
  })),
}))

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}))

const { getGscProperty, upsertGscProperty, updateAccessToken, deleteGscProperty } =
  await import("@/lib/db/gsc-properties")

beforeEach(() => {
  fromMock.mockClear()
  builderResponse.mockReset()
})

describe("gsc_properties DAL", () => {
  it("getGscProperty returns null when no row exists", async () => {
    builderResponse.mockResolvedValueOnce({ data: null, error: null })
    const out = await getGscProperty()
    expect(out).toBeNull()
    expect(fromMock).toHaveBeenCalledWith("gsc_properties")
  })

  it("getGscProperty returns the row when one exists", async () => {
    const row = { id: "u1", site_url: "sc-domain:darrenjpaul.com", refresh_token: "rt" }
    builderResponse.mockResolvedValueOnce({ data: row, error: null })
    const out = await getGscProperty()
    expect(out).toEqual(row)
  })

  it("upsertGscProperty calls upsert with onConflict=site_url", async () => {
    const row = { id: "u1", site_url: "sc-domain:darrenjpaul.com" }
    builderResponse.mockResolvedValueOnce({ data: row, error: null })
    const out = await upsertGscProperty({
      site_url: "sc-domain:darrenjpaul.com",
      refresh_token: "rt",
      access_token: "at",
      access_token_expires: "2030-01-01T00:00:00Z",
      connected_by_user_id: "user-1",
    })
    expect(out).toEqual(row)
  })

  it("updateAccessToken throws when Supabase returns error", async () => {
    builderResponse.mockResolvedValueOnce({ data: null, error: { message: "boom" } })
    await expect(updateAccessToken("u1", "at", "2030-01-01T00:00:00Z")).rejects.toMatchObject({
      message: "boom",
    })
  })

  it("deleteGscProperty completes successfully", async () => {
    builderResponse.mockResolvedValueOnce({ data: null, error: null })
    await expect(deleteGscProperty("u1")).resolves.toBeUndefined()
  })
})
