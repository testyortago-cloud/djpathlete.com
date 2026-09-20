// @vitest-environment node
//
// Reads migration 00267 off disk and checks its structure, modelled on
// __tests__/migrations/00266_sequence_run_enrolment_metadata.test.ts.
//
// Text assertions run over the STATEMENTS only: every `--` comment line is
// stripped first, because this migration's header explains the column, the
// nullability and the deploy race in prose — exactly the words a whole-file
// `includes` would match for the wrong reason. The header assertions at the
// bottom deliberately read RAW, and say so.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const RAW = readFileSync(join(process.cwd(), "supabase/migrations/00267_sequence_run_anchor_at.sql"), "utf8")
const SQL = RAW.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")

describe("00267 — sequence_runs.anchor_at", () => {
  it("adds the column to public.sequence_runs, idempotently", () => {
    // IF NOT EXISTS is load-bearing twice: the dev clone gets it through the
    // MCP under its own timestamp version, and the workflow applies every
    // pending migration in one unattended run.
    expect(SQL).toMatch(/ALTER TABLE public\.sequence_runs\s+ADD COLUMN IF NOT EXISTS anchor_at/i)
  })

  it("is timestamptz and NULLABLE — 'not anchored' is a real state, not an empty value", () => {
    expect(SQL).toMatch(/anchor_at\s+timestamptz\s*;/i)
    // The negative half, which is the one that matters. A NOT NULL column
    // would need a default, and every default is wrong here: a sentinel in
    // the past fires every reminder at once, and one in the future parks
    // them. Almost every run in the product has no anchor at all.
    expect(SQL).not.toMatch(/anchor_at[^;]*NOT NULL/i)
    expect(SQL).not.toMatch(/anchor_at[^;]*DEFAULT/i)
  })

  it("adds no index — nothing queries BY this column", () => {
    // The reader loads a run already claimed by primary key. Claiming orders
    // on next_run_at, which is what the anchor has already been resolved into
    // by then.
    expect(SQL).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i)
  })

  it("touches nothing but that one column", () => {
    // Additive and narrow. Catches a later edit bolting a second change onto
    // a file that has already been applied somewhere.
    expect(SQL).not.toMatch(/\bDROP\b/i)
    expect(SQL).not.toMatch(/\bUPDATE\b/i)
    expect(SQL).not.toMatch(/\bDELETE\b/i)
    expect(SQL.match(/ALTER TABLE/gi) ?? []).toHaveLength(1)
  })

  it("names its writer and its reader — a column with no reader is a labelling gap", () => {
    // Read RAW on purpose: this asserts the prose, which is the point.
    expect(RAW).toContain("insertSequenceRun")
    expect(RAW).toContain("decideStep")
  })

  it("records WHY the anchor does not travel in the metadata bag", () => {
    // The funnel path passes the visitor's entire typed payload as `metadata`,
    // and funnel field names are owner-chosen. Somebody reading this migration
    // later and thinking "the bag was right there" needs the answer in the
    // file, not in a session transcript.
    expect(RAW).toContain("capture-contact.ts")
    expect(RAW).toContain("pickEnrolmentMetadata")
  })
})
