import { describe, it, expect } from "vitest"
import { isPgMissingColumn } from "@/lib/supabase-errors"

describe("isPgMissingColumn", () => {
  it("returns true for Postgres 42703 (undefined_column, seen on a read)", () => {
    expect(
      isPgMissingColumn({
        code: "42703",
        message: 'column "thumbnail_path" of relation "team_video_versions" does not exist',
      }),
    ).toBe(true)
  })

  it("returns true for PostgREST PGRST204 (schema-cache miss, seen on a write)", () => {
    expect(
      isPgMissingColumn({
        code: "PGRST204",
        message: "Could not find the 'thumbnail_path' column of 'team_video_versions' in the schema cache",
      }),
    ).toBe(true)
  })

  it("returns false for an unrelated Postgres error code", () => {
    expect(isPgMissingColumn({ code: "42501", message: "permission denied" })).toBe(false)
  })

  it("returns false for null", () => {
    expect(isPgMissingColumn(null)).toBe(false)
  })

  it("returns false for undefined", () => {
    expect(isPgMissingColumn(undefined)).toBe(false)
  })
})
