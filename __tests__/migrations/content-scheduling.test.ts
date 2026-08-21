import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/00224_content_scheduling.sql"),
  "utf8",
)

describe("00224_content_scheduling", () => {
  it("allows the scheduled status on both tables", () => {
    expect(sql).toContain("CHECK (status IN ('draft', 'scheduled', 'published'))")
    expect(sql).toContain("CHECK (status IN ('draft', 'scheduled', 'sent'))")
  })

  it("drops the old CHECK before adding the new one on both tables", () => {
    // Without the DROP, ADD CONSTRAINT fails on an existing database and the
    // whole migration aborts — the table keeps its two-value constraint and
    // every /schedule write 400s in production.
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS blog_posts_status_check")
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS newsletters_status_check")
  })

  it("adds scheduled_at and a failure reason to both tables", () => {
    const blogBlock = sql.slice(sql.indexOf("ALTER TABLE blog_posts"), sql.indexOf("ALTER TABLE newsletters"))
    expect(blogBlock).toContain("scheduled_at TIMESTAMPTZ")
    expect(blogBlock).toContain("schedule_failed_reason TEXT")
    const nlBlock = sql.slice(sql.indexOf("ALTER TABLE newsletters"))
    expect(nlBlock).toContain("scheduled_at TIMESTAMPTZ")
    expect(nlBlock).toContain("schedule_failed_reason TEXT")
  })

  it("seeds the cron flag defaulting to true", () => {
    expect(sql).toContain("cron_content_schedule_enabled")
    expect(sql).toMatch(/'true'::jsonb/)
  })

  it("is idempotent — every statement is guarded", () => {
    expect(sql).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/)
    expect(sql).not.toMatch(/CREATE INDEX (?!IF NOT EXISTS)/)
  })
})
