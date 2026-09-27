// @vitest-environment node
// Static-only: this migration has no live half (a lone `ADD COLUMN`, no
// function, no RLS, no policy), so there is nothing for
// `test:integration:drift` to check here. See the migration's own header for
// the writer/reader and the NULL-means-old-behaviour contract.
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

const SQL = readFileSync("supabase/migrations/00282_business_settings_alert_email.sql", "utf8")

describe("00282 business_settings.alert_email", () => {
  it("adds a nullable text column, not NOT NULL", () => {
    // MUTANT: `text not null` -- every existing row would need a backfill
    // that does not exist, and the migration would fail to apply against the
    // clone's already-populated business_settings table.
    expect(SQL).toMatch(/add column if not exists alert_email\s+text\s*;/i)
    expect(SQL).not.toMatch(/alert_email[^;]*not null/i)
  })

  it("sets no default", () => {
    // MUTANT: a default of '' or any literal -- every existing tenant would
    // silently claim an alert address it never chose, exactly the mistake
    // the brand_color migration (00260) already documented and avoided.
    expect(SQL).not.toMatch(/alert_email[^;]*default/i)
  })

  it("is idempotent (IF NOT EXISTS), so a re-run does not fail", () => {
    expect(SQL).toMatch(/add column if not exists alert_email/i)
  })

  it("names its writer and reader in the header, and says NULL means the old behaviour", () => {
    expect(SQL).toMatch(/PATCH \/api\/admin\/businesses\/\[id\]/)
    expect(SQL).toContain("alertAddressing")
    expect(SQL).toMatch(/NULL[^.]*reply_to/i)
  })

  it("carries no business_id-specific data -- no UUID literals", () => {
    // A per-tenant setting migration must not smuggle in a value for ONE
    // business: every business_settings row gets the same nullable column.
    expect(SQL).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  })

  it("touches only business_settings", () => {
    const alters = SQL.match(/alter table[^\n]+/gi) ?? []
    for (const line of alters) expect(line).toMatch(/public\.business_settings/i)
  })
})
