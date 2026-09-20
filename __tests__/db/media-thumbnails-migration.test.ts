// @vitest-environment node
//
// Reads migration 00265 off disk and checks its structure. Modelled on
// __tests__/migrations/00263_sequence_reenrol_cooldown.test.ts.
//
// This replaces an earlier version of this file that asserted on TypeScript
// types via `satisfies` / `import type`. vitest here transpiles with esbuild
// and never type-checks, so that version passed identically whether the
// types in types/database.ts were right or wrong — it could not fail.
// Asserting on the migration SQL itself is falsifiable instead: deleting an
// `ADD COLUMN` line from the migration makes this file fail (proven in the
// task-1 report's red/green run).
//
// Assertions run over the STATEMENTS only: every `--` comment line is
// stripped first, because the migration's own header names both columns in
// prose — exactly the words a whole-file `includes` would match for the
// wrong reason, and just as unfalsifiable as the type-only version this
// file replaces.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const RAW = readFileSync(join(process.cwd(), "supabase/migrations/00265_media_thumbnails.sql"), "utf8")
const SQL = RAW.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")

/**
 * The full `ALTER TABLE <table> ADD COLUMN <column> ...;` clause for one
 * column. Throws (failing the calling test loudly) if the migration no
 * longer has that statement, rather than returning null and letting a
 * `.not.toMatch()` on `null` fail with a confusing matcher-type error.
 */
function addColumnClause(table: string, column: string): string {
  const re = new RegExp(`ALTER TABLE ${table}\\s+ADD COLUMN ${column}[^;]*;`, "i")
  const match = SQL.match(re)
  if (!match) {
    throw new Error(
      `No "ALTER TABLE ${table} ADD COLUMN ${column} ...;" statement found in 00265_media_thumbnails.sql`,
    )
  }
  return match[0]
}

describe("00265 — video_uploads.thumbnail_source, team_video_versions.thumbnail_path", () => {
  it("adds thumbnail_source to video_uploads as text", () => {
    expect(addColumnClause("video_uploads", "thumbnail_source")).toMatch(/\btext\b/i)
  })

  it("adds thumbnail_path to team_video_versions as text", () => {
    expect(addColumnClause("team_video_versions", "thumbnail_path")).toMatch(/\btext\b/i)
  })

  it("does not mark thumbnail_source NOT NULL", () => {
    expect(addColumnClause("video_uploads", "thumbnail_source")).not.toMatch(/NOT NULL/i)
  })

  it("does not mark thumbnail_path NOT NULL", () => {
    expect(addColumnClause("team_video_versions", "thumbnail_path")).not.toMatch(/NOT NULL/i)
  })

  it("gives thumbnail_source no DEFAULT", () => {
    expect(addColumnClause("video_uploads", "thumbnail_source")).not.toMatch(/DEFAULT/i)
  })

  it("gives thumbnail_path no DEFAULT", () => {
    expect(addColumnClause("team_video_versions", "thumbnail_path")).not.toMatch(/DEFAULT/i)
  })
})
