// @vitest-environment node
//
// Reads migration 00263 off disk and checks its structure, modelled on
// __tests__/migrations/00256_sequence_management.test.ts.
//
// Text assertions run over the STATEMENTS only: every `--` comment line is
// stripped first, because the migration's own header explains the column, the
// default and the quiz exception in prose — exactly the words a whole-file
// `includes` would match for the wrong reason.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const RAW = readFileSync(join(process.cwd(), "supabase/migrations/00263_sequence_reenrol_cooldown.sql"), "utf8")
const SQL = RAW.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")

describe("00263 — sequences.reenrol_cooldown_days", () => {
  it("adds the column to public.sequences, idempotently", () => {
    expect(SQL).toMatch(/ALTER TABLE public\.sequences\s+ADD COLUMN IF NOT EXISTS reenrol_cooldown_days/i)
  })

  it("is NOT NULL with a default of 30 days", () => {
    expect(SQL).toMatch(/reenrol_cooldown_days\s+smallint\s+NOT NULL\s+DEFAULT 30/i)
  })

  it("refuses a negative cooldown and caps it at a year", () => {
    expect(SQL).toMatch(/CHECK\s*\(\s*reenrol_cooldown_days\s*>=\s*0\s+AND\s+reenrol_cooldown_days\s*<=\s*365\s*\)/i)
  })

  it("sets the four quiz sequences to 0 — a retake must still get its result email", () => {
    expect(SQL).toMatch(/UPDATE public\.sequences\s+SET reenrol_cooldown_days = 0\s+WHERE key LIKE 'quiz\\_%'/i)
  })

  it("names the reader of the column in its header — a column with no reader is a labelling gap", () => {
    expect(RAW).toContain("enrollIfTriggered")
  })
})
