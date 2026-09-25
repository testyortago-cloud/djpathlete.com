// @vitest-environment node
//
// getBusinessSettings selects with a bare `.select("*")`, so `brand_color` /
// accent_color` (migration 00260) already ride along in the wire response --
// but "*" reaching the network is not the same as the TYPE promising the
// field exists to callers. This suite pins that BusinessSettings actually
// carries both columns through untouched, including the NULL case that is
// the everyday state for every tenant that has not chosen a brand yet. A
// column the DAL's type omits is invisible to every reader even when the
// query already returns it -- see other DAL suites in this repo that pin
// exactly that gap for other columns.
import { describe, it, expect, vi, beforeEach } from "vitest"

const state = {
  selectResult: { data: null as unknown, error: null as null | { code: string; message: string } },
  updateResult: { data: null as unknown, error: null as null | { code: string; message: string; details?: string } },
  calls: [] as Array<[string, unknown]>,
  updatePayloads: [] as Array<Record<string, unknown>>,
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      state.calls.push(["from", table])
      const builder = {
        select: (cols: string) => {
          state.calls.push(["select", cols])
          return builder
        },
        eq: (col: string, val: unknown) => {
          state.calls.push(["eq", `${col}=${String(val)}`])
          return builder
        },
        maybeSingle: async () => state.selectResult,
        update: (payload: Record<string, unknown>) => {
          state.updatePayloads.push(payload)
          return builder
        },
        single: async () => state.updateResult,
      }
      return builder
    },
  }),
}))

import {
  getBusinessSettings,
  updateBusinessSettings,
  BusinessSettingsMissingError,
  SmsSenderPhoneTakenError,
} from "@/lib/db/businesses"

const baseRow = {
  business_id: "biz-1",
  display_name: "Trailhead",
  sender_name: "Trailhead",
  sender_email: "hello@trailhead.test",
  reply_to: "hello@trailhead.test",
  logo_url: null,
  timezone: "America/Los_Angeles",
  quiet_hours_start: 8,
  quiet_hours_end: 21,
  daily_message_cap: 1,
  postal_address: "",
  sms_help_text: "",
  sms_messaging_service_sid: "",
  sms_sender_phone: "",
}

beforeEach(() => {
  state.calls.length = 0
  state.updatePayloads.length = 0
  state.selectResult = { data: null, error: null }
  state.updateResult = { data: null, error: null }
})

describe("getBusinessSettings", () => {
  it("returns brand_color and accent_color when the tenant has chosen a brand", async () => {
    state.selectResult = {
      data: { ...baseRow, brand_color: "#6d28d9", accent_color: "#f59e0b" },
      error: null,
    }
    const result = await getBusinessSettings("biz-1")
    expect(result.brand_color).toBe("#6d28d9")
    expect(result.accent_color).toBe("#f59e0b")
  })

  it("returns NULL for brand_color/accent_color -- the everyday case for a tenant with no brand chosen", async () => {
    state.selectResult = {
      data: { ...baseRow, brand_color: null, accent_color: null },
      error: null,
    }
    const result = await getBusinessSettings("biz-1")
    expect(result.brand_color).toBeNull()
    expect(result.accent_color).toBeNull()
  })

  it("selects with '*' so the new columns ride along without a query change", async () => {
    state.selectResult = { data: { ...baseRow, brand_color: null, accent_color: null }, error: null }
    await getBusinessSettings("biz-1")
    expect(state.calls).toContainEqual(["select", "*"])
  })

  it("throws BusinessSettingsMissingError when no row exists, not a null brand", async () => {
    state.selectResult = { data: null, error: null }
    await expect(getBusinessSettings("biz-missing")).rejects.toBeInstanceOf(BusinessSettingsMissingError)
  })

  it("throws on a genuine read error rather than returning a null brand", async () => {
    state.selectResult = {
      data: null,
      error: { code: "PGRST205", message: "Could not find the table 'public.business_settings'" },
    }
    await expect(getBusinessSettings("biz-1")).rejects.toMatchObject({ code: "PGRST205" })
  })
})

describe("updateBusinessSettings", () => {
  it("passes brand_color and accent_color straight through in the update payload", async () => {
    state.updateResult = {
      data: { ...baseRow, brand_color: "#123456", accent_color: "#abcdef" },
      error: null,
    }
    await updateBusinessSettings({ brand_color: "#123456", accent_color: "#abcdef" }, "biz-1")
    expect(state.updatePayloads[0]).toMatchObject({
      brand_color: "#123456",
      accent_color: "#abcdef",
    })
  })

  it("passes NULL through to clear a previously-chosen brand", async () => {
    state.updateResult = { data: { ...baseRow, brand_color: null, accent_color: null }, error: null }
    await updateBusinessSettings({ brand_color: null, accent_color: null }, "biz-1")
    expect(state.updatePayloads[0]).toMatchObject({ brand_color: null, accent_color: null })
  })

  // G33. 00247's partial unique index lets only one business send from a
  // number. The error shape is Postgres's own, passed through by PostgREST:
  // the INDEX name in `message`, the COLUMN in `details`.
  it("names a clash on 00247's unique sender-number index as SmsSenderPhoneTakenError", async () => {
    state.updateResult = {
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "business_settings_sms_sender_phone_unique"',
        details: "Key (sms_sender_phone)=(+12025550123) already exists.",
      },
    }
    await expect(updateBusinessSettings({ sms_sender_phone: "+12025550123" }, "biz-1")).rejects.toBeInstanceOf(
      SmsSenderPhoneTakenError,
    )
  })

  it("CONTROL: a unique violation that is NOT about the sender number is rethrown as it came", async () => {
    // No such index exists on business_settings today (the only other unique
    // index is the primary key, which an update keyed on business_id cannot
    // hit), but a future one must not be reported as a taken phone number.
    const other = { code: "23505", message: 'duplicate key value violates unique constraint "some_future_key"' }
    state.updateResult = { data: null, error: other }
    await expect(updateBusinessSettings({ display_name: "X" }, "biz-1")).rejects.toBe(other)
  })
})
