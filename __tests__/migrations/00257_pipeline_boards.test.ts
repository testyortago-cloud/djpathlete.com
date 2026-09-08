// @vitest-environment node
//
// Reads migration 00257 off disk and checks its structure, the same way
// __tests__/migrations/00255_sequence_content_and_branching.test.ts reads
// 00255. __tests__/lib/lead-engine/seed-sequences.test.ts is scoped to 00218
// by a hardcoded path and does NOT cover this file, and there is no
// 00256_pipeline_boards test to model this on -- 00256 is
// sequence_management, from a sibling branch cut separately.
//
// THE ASSERTION THAT MATTERS MOST is the won/lost cardinality check per
// board. `decideMove` (lib/lead-engine/pipeline-move.ts:112-113, :118-119)
// throws a bare Error at RUNTIME on a board with no `open` stage or no stage
// of a `kind` it looks up -- and because that lookup is `.find()`, a SECOND
// `won` or `lost` stage does not throw at all, it silently picks whichever
// comes first, which is an order-dependent accident of where a paid card
// lands. So this file asserts "at least one open" AND "exactly one won" AND
// "exactly one lost", never just "a won stage exists".
//
// A caution about text assertions: this migration's header comment discusses
// "Programs & Products", "SINGLETON_BUSINESS_ID" and the won/lost hazard at
// length, precisely because those are the things it is warning about. A
// whole-file `SQL.includes(...)` would match that prose and pass (or fail)
// for the wrong reason. Every structural assertion below is scoped to the
// parsed INSERT statements, never the whole file.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"
import { CAMPS_CLINICS_KEY, ASSESSMENT_KEY } from "@/lib/lead-engine/pipeline-route"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/00257_pipeline_boards.sql"), "utf8")

// ---------------------------------------------------------------------------
// Parsing -- not a general SQL parser, understands exactly the two shapes
// this migration uses: a `pipelines` row insert, and a `pipeline_stages`
// insert built from a `CROSS JOIN (VALUES ...) AS s(...)` filtered by a
// `WHERE p.key = '<key>'`.
// ---------------------------------------------------------------------------

interface PipelineRow {
  businessId: string
  key: string
  name: string
}

function parsePipelineRows(sql: string): PipelineRow[] {
  const re =
    /INSERT INTO public\.pipelines \(business_id, key, name\)\s*VALUES \('([0-9a-f-]+)',\s*'([a-z_]+)',\s*'([^']*)'\)\s*ON CONFLICT \(business_id, key\) DO NOTHING;/g
  const rows: PipelineRow[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(sql))) {
    rows.push({ businessId: m[1], key: m[2], name: m[3] })
  }
  return rows
}

interface StageTuple {
  key: string
  name: string
  position: number
  kind: string
  amber: number | null
  red: number | null
}

interface StageBlock {
  pipelineKey: string
  businessId: string
  tuples: StageTuple[]
}

function parseStageBlocks(sql: string): StageBlock[] {
  const blockRe =
    /CROSS JOIN \(VALUES([\s\S]*?)\)\s*AS s\(key, name, position, kind, amber, red\)\s*WHERE p\.key = '([a-z_]+)'\s*AND p\.business_id = '([0-9a-f-]+)'\s*ON CONFLICT \(pipeline_id, key\) DO NOTHING;/g
  const rowRe = /\(\s*'([a-z_]+)',\s*'([^']*)',\s*(\d+),\s*'([a-z]+)',\s*(NULL|\d+),\s*(NULL|\d+)\s*\)/g

  const blocks: StageBlock[] = []
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(sql))) {
    const rowsText = m[1]
    const tuples: StageTuple[] = []
    let rm: RegExpExecArray | null
    rowRe.lastIndex = 0
    while ((rm = rowRe.exec(rowsText))) {
      tuples.push({
        key: rm[1],
        name: rm[2],
        position: Number(rm[3]),
        kind: rm[4],
        amber: rm[5] === "NULL" ? null : Number(rm[5]),
        red: rm[6] === "NULL" ? null : Number(rm[6]),
      })
    }
    blocks.push({ pipelineKey: m[2], businessId: m[3], tuples })
  }
  return blocks
}

const PIPELINE_ROWS = parsePipelineRows(SQL)
const STAGE_BLOCKS = parseStageBlocks(SQL)

// ---------------------------------------------------------------------------
// Parser sanity -- if these are wrong, every assertion below is checking a
// fiction instead of the file.
// ---------------------------------------------------------------------------

describe("parser sanity", () => {
  it("finds exactly two pipelines rows", () => {
    expect(PIPELINE_ROWS.length).toBe(2)
  })

  it("finds exactly two pipeline_stages blocks", () => {
    expect(STAGE_BLOCKS.length).toBe(2)
  })

  it("finds four stage tuples in each block (parser didn't come back empty)", () => {
    for (const block of STAGE_BLOCKS) {
      expect(block.tuples.length, `block for '${block.pipelineKey}'`).toBe(4)
    }
  })
})

// ---------------------------------------------------------------------------
// Cross-file pin: the seeded keys must be the EXACT strings
// lib/lead-engine/pipeline-route.ts already exports and routes onto. If this
// migration and the router ever disagree on the literal string, a routed
// event resolves to a board that was never seeded and throws
// PipelineNotConfiguredError for every card.
// ---------------------------------------------------------------------------

describe("seeded keys match the router's exported constants exactly", () => {
  it("seeds a pipelines row for CAMPS_CLINICS_KEY", () => {
    expect(PIPELINE_ROWS.some((r) => r.key === CAMPS_CLINICS_KEY)).toBe(true)
  })

  it("seeds a pipelines row for ASSESSMENT_KEY", () => {
    expect(PIPELINE_ROWS.some((r) => r.key === ASSESSMENT_KEY)).toBe(true)
  })

  it("seeds no third pipeline (no Programs & Products board)", () => {
    // Scoped to the PARSED rows, not the whole file -- the header comment
    // discusses "Programs & Products" in prose at length, on purpose,
    // because that is exactly the board this migration must NOT seed.
    expect(PIPELINE_ROWS.map((r) => r.key).sort()).toEqual([ASSESSMENT_KEY, CAMPS_CLINICS_KEY].sort())
  })

  it("names neither seeded pipeline 'programs' or similar, in the actual row data", () => {
    for (const row of PIPELINE_ROWS) {
      expect(row.key.toLowerCase()).not.toContain("program")
      expect(row.name.toLowerCase()).not.toContain("program")
    }
  })
})

// ---------------------------------------------------------------------------
// business_id -- every row carries the same tenant, and it must be a real
// UUID literal, not an empty capture.
// ---------------------------------------------------------------------------

describe("business_id is set on every row", () => {
  it("every pipelines row uses the singleton business id", () => {
    for (const row of PIPELINE_ROWS) {
      expect(row.businessId).toBe(SINGLETON_BUSINESS_ID)
    }
  })

  it("every pipeline_stages block's SELECT/WHERE uses the same singleton business id", () => {
    for (const block of STAGE_BLOCKS) {
      expect(block.businessId).toBe(SINGLETON_BUSINESS_ID)
    }
  })
})

// ---------------------------------------------------------------------------
// THE ASSERTION THAT MATTERS MOST -- stage kind cardinality per board.
// ---------------------------------------------------------------------------

describe.each(STAGE_BLOCKS.map((b) => [b.pipelineKey, b] as const))("board '%s'", (_key, block) => {
  it("has at least one 'open' stage", () => {
    const openCount = block.tuples.filter((t) => t.kind === "open").length
    expect(openCount).toBeGreaterThanOrEqual(1)
  })

  it("has EXACTLY one 'won' stage", () => {
    const wonCount = block.tuples.filter((t) => t.kind === "won").length
    expect(wonCount).toBe(1)
  })

  it("has EXACTLY one 'lost' stage", () => {
    const lostCount = block.tuples.filter((t) => t.kind === "lost").length
    expect(lostCount).toBe(1)
  })

  it("uses only 'open', 'won' or 'lost' as a stage kind", () => {
    for (const t of block.tuples) {
      expect(["open", "won", "lost"]).toContain(t.kind)
    }
  })

  it("gives every stage a unique, non-empty key", () => {
    const keys = block.tuples.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k.length).toBeGreaterThan(0)
  })

  it("gives every stage a unique position, starting at 1 (not 0)", () => {
    const positions = block.tuples.map((t) => t.position).sort((a, b) => a - b)
    expect(new Set(positions).size).toBe(positions.length)
    expect(Math.min(...positions)).toBe(1)
  })

  it("gives every stage a human-facing name with no 'opportunity' or 'board' jargon", () => {
    for (const t of block.tuples) {
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.name.toLowerCase()).not.toContain("opportunity")
      expect(t.name.toLowerCase()).not.toContain("board")
    }
  })

  it("orders every stage's thresholds amber <= red (pipeline_stages_thresholds_ordered)", () => {
    for (const t of block.tuples) {
      if (t.amber !== null && t.red !== null) {
        expect(t.amber, `stage '${t.key}' in '${block.pipelineKey}'`).toBeLessThanOrEqual(t.red)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Idempotence signal in the SQL itself -- both INSERT shapes carry an
// ON CONFLICT DO NOTHING clause. (Actual idempotence is proven by applying
// the file twice against the dev database; see the task report.)
// ---------------------------------------------------------------------------

it("both pipelines inserts declare ON CONFLICT (business_id, key) DO NOTHING", () => {
  const count = (SQL.match(/ON CONFLICT \(business_id, key\) DO NOTHING;/g) ?? []).length
  expect(count).toBe(2)
})

it("both pipeline_stages inserts declare ON CONFLICT (pipeline_id, key) DO NOTHING", () => {
  const count = (SQL.match(/ON CONFLICT \(pipeline_id, key\) DO NOTHING;/g) ?? []).length
  expect(count).toBe(2)
})
