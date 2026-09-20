// @vitest-environment node
//
// Reads migration 00266 off disk and checks its structure, modelled on
// __tests__/migrations/00263_sequence_reenrol_cooldown.test.ts.
//
// Text assertions run over the STATEMENTS only: every `--` comment line is
// stripped first, because the migration's header explains the column, the
// default and the deploy race in prose — exactly the words a whole-file
// `includes` would match for the wrong reason. The two header assertions at
// the bottom deliberately read RAW, and say so.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const RAW = readFileSync(join(process.cwd(), "supabase/migrations/00266_sequence_run_enrolment_metadata.sql"), "utf8")
const SQL = RAW.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")

describe("00266 — sequence_runs.enrolment_metadata", () => {
  it("adds the column to public.sequence_runs, idempotently", () => {
    // IF NOT EXISTS is load-bearing twice over: the dev clone already has the
    // column (applied through the MCP under its own timestamp version), and
    // the workflow applies every pending migration in one unattended run.
    expect(SQL).toMatch(/ALTER TABLE public\.sequence_runs\s+ADD COLUMN IF NOT EXISTS enrolment_metadata/i)
  })

  it("is jsonb, NOT NULL, defaulting to an empty object", () => {
    // All three are named verbatim in the ledger row. NOT NULL + DEFAULT is
    // what makes every reader get an object rather than having to tell
    // "remembers nothing" from "predates the column" — which are the same
    // answer to a branch, and both false.
    expect(SQL).toMatch(/enrolment_metadata\s+jsonb\s+NOT NULL\s+DEFAULT\s+'\{\}'::jsonb/i)
  })

  it("adds no index — nothing queries BY this column", () => {
    // The only reader loads a run it has already claimed by primary key. An
    // index here would be write cost for no query; if one ever appears it
    // should arrive with the screen that filters on it.
    expect(SQL).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i)
  })

  it("touches nothing but that one column", () => {
    // A schema migration in this series is additive and narrow. Catches a
    // later edit quietly bolting a second change onto an applied file.
    expect(SQL).not.toMatch(/\bDROP\b/i)
    expect(SQL).not.toMatch(/\bUPDATE\b/i)
    expect(SQL).not.toMatch(/\bDELETE\b/i)
    expect(SQL.match(/ALTER TABLE/gi) ?? []).toHaveLength(1)
  })

  it("names BOTH readers in its header — a column with no reader is a labelling gap", () => {
    // Read RAW on purpose: this asserts the prose, which is the point.
    expect(RAW).toContain("evaluateBranch")
    expect(RAW).toContain("G16")
  })

  it("names its writer, so the allow-list is findable from the schema", () => {
    expect(RAW).toContain("pickEnrolmentMetadata")
  })
})
