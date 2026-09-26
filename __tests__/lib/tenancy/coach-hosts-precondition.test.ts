// @vitest-environment node
//
// A TRIPWIRE, NOT A FEATURE TEST: the owner's G48 ruling (2026-09-26, option A)
// made "G48 is fixed" a PRECONDITION of giving a coach their own host.
//
// Why that is checkable at all: a non-platform business's public pages only
// resolve to that business once its host is in `business_domains`
// (`resolvePublicTenant()` -> `findBusinessIdByHost`). Until then its quiz
// cannot take an answer (`/api/quiz/progress` reads the quiz under the Host's
// tenant) and its `quiz_*` sequences cannot enrol anyone, so the wrong
// `has_user` arm (G48: `contacts.user_id` is linked across businesses by
// `linkContactsToUser` AND `upsertContactIdentity`) cannot be reached. Nothing
// writes `business_domains` today except migration 00251's one-time seed of the
// platform's own hosts.
//
// So this fails the moment anything else writes it: application code
// (`.from("business_domains")` followed by insert/upsert/update/delete) or a
// later migration (`insert into` / `update` on the table). When it fails, do
// not add an exemption to make it pass. Close what it names first:
//   - G48 (docs/lead-engine-gaps-to-ship-2026-09-19.md): the `has_user` branch
//     must mean "a client of THIS business", which needs G37's ruling;
//   - G49's host half: unsubscribe and consent links still use the
//     deployment-wide `appOrigin()`.
// Then retire this file in the same change, and say so in the ledger.

import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const CODE_ROOTS = ["lib", "app", "components", "functions/src"]
const MIGRATIONS = "supabase/migrations"
/** The one sanctioned writer: the platform's own hosts, seeded once. */
const SEED_MIGRATION = "00251_business_domains_platform_seed.sql"

function filesUnder(dir: string): string[] {
  const st = statSync(dir, { throwIfNoEntry: false })
  if (!st) return []
  if (st.isFile()) return [dir]
  return readdirSync(dir)
    .filter((name) => name !== "node_modules" && name !== "__tests__")
    .flatMap((name) => filesUnder(join(dir, name)))
}

// The gap between `.from("business_domains")` and the write may not contain
// another `.from(`: without that, a match could start at a READER near the top
// of a file and run on into a later writer's chain, swallowing the writer's own
// `.from(` so that it is never matched by itself. That false negative is how the
// first version of this file passed with a writer in place.
const WRITE_AFTER_FROM =
  /\.from\(\s*["'`]business_domains["'`]\s*\)(?:(?!\.from\()[\s\S]){0,400}?\.(insert|upsert|update|delete)\(/
const SQL_WRITE = /\b(insert\s+into|update|delete\s+from)\s+(public\.)?business_domains\b/i

describe("no coach can be given a host before G48 is fixed (owner's ruling, 2026-09-26)", () => {
  it("no application code writes business_domains", () => {
    const writers = CODE_ROOTS.flatMap(filesUnder)
      .filter((file) => /\.(ts|tsx|js|mjs)$/.test(file))
      .filter((file) => WRITE_AFTER_FROM.test(readFileSync(file, "utf8")))
    expect(writers, "a writer of business_domains appeared: close G48 first (see this file's header)").toEqual([])
  })

  it("no migration after the platform's one-time seed writes business_domains", () => {
    const writers = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql") && name !== SEED_MIGRATION)
      .filter((name) => SQL_WRITE.test(readFileSync(join(MIGRATIONS, name), "utf8")))
    expect(writers, "a migration writes business_domains: close G48 first (see this file's header)").toEqual([])
  })

  it("is looking at real files: the seed migration is seen as a writer, and the reader is found", () => {
    // The control. Without it, a regex that never matches anything would pass
    // both tests above forever.
    expect(SQL_WRITE.test(readFileSync(join(MIGRATIONS, SEED_MIGRATION), "utf8"))).toBe(true)
    expect(readFileSync("lib/db/business-domains.ts", "utf8")).toMatch(/\.from\(\s*["']business_domains["']\s*\)/)
    expect(WRITE_AFTER_FROM.test('x.from("business_domains").insert({})')).toBe(true)
    // The false negative the first version had: a reader near the top of a
    // file, then a writer within 400 characters. The writer must still be seen.
    const readerThenWriter =
      'const a = await db.from("business_domains").select("id")\n' +
      'const b = await db.from("business_domains").insert({ host })'
    expect(WRITE_AFTER_FROM.test(readerThenWriter)).toBe(true)
    // ...and a reader followed by a write to some OTHER table is not a writer.
    const readerThenOther =
      'const a = await db.from("business_domains").select("id")\n' + 'const b = await db.from("contacts").insert({})'
    expect(WRITE_AFTER_FROM.test(readerThenOther)).toBe(false)
  })
})
