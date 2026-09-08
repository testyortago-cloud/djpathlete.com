// @vitest-environment node
//
// Reads the migration off disk and checks its structure, the same way
// __tests__/migrations/00254_sequence_tag_stage_steps.test.ts reads 00254.
// __tests__/lib/lead-engine/seed-sequences.test.ts is scoped to 00218 by a
// hardcoded path and does NOT cover this file.
//
// THE ASSERTION THAT MATTERS MOST is the branch-arm walk near the bottom.
// This migration seeds the first `branch` steps this repository has ever
// shipped. branch_condition / on_true_position / on_false_position have
// existed and worked since 00216, but nothing has ever exercised them, and
// nothing checks that both arms actually terminate. A branch target is the
// engine's only jump -- every other step advances by position + 1 -- so an
// arm that runs off its own end falls straight into the OTHER arm's steps,
// and the person gets both messages. That is exactly the design error this
// feature already made once (see the design doc's own record of it), so the
// walk below is written to catch it again, deliberately, via mutation
// testing (see the task report for the mutation log).
//
// A caution about text assertions: the migration's header comment quotes
// `{{sms_consent_url}}` twice and discusses the branch-termination rule in
// prose, precisely because those are the things it is warning about. A
// `SQL.includes(...)` or merge-field regex run over the WHOLE file would
// match that prose and fail for the wrong reason. Every content assertion
// below is scoped to the quoted $subj$/$body$ text, never the whole file.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/00255_sequence_content_and_branching.sql"),
  "utf8",
)

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------
//
// Not a general SQL parser -- understands exactly the subset this migration's
// sequence_steps INSERTs use: each row is introduced by the sub-select
// `... AND key = '<seq_key>')` followed by `<position>, '<kind>'`, and runs
// until either the next row's leading `('0000...` business_id literal or the
// statement's trailing `ON CONFLICT`.

interface StepTuple {
  seqKey: string
  position: number
  kind: string
  /** Everything in the tuple after `'<kind>'`, up to (not including) the next tuple or ON CONFLICT. */
  rest: string
}

function parseStepTuples(sql: string): StepTuple[] {
  const tupleRe = /key = '([a-z_]+)'\),\s*\n\s*(\d+), '([a-z]+)'([\s\S]*?)(?=\n\s*\('0000|\nON CONFLICT)/g
  const tuples: StepTuple[] = []
  let m: RegExpExecArray | null
  while ((m = tupleRe.exec(sql))) {
    tuples.push({ seqKey: m[1], position: Number(m[2]), kind: m[3], rest: m[4] })
  }
  return tuples
}

/** sequence key -> (position -> kind) */
function buildSequenceMaps(tuples: StepTuple[]): Map<string, Map<number, string>> {
  const bySeq = new Map<string, Map<number, string>>()
  for (const t of tuples) {
    if (!bySeq.has(t.seqKey)) bySeq.set(t.seqKey, new Map())
    const positions = bySeq.get(t.seqKey)!
    // ON CONFLICT (sequence_id, position) DO NOTHING means duplicates can't
    // happen at insert time either -- fail loudly if the file itself repeats
    // a position, rather than silently letting the second write win here.
    if (positions.has(t.position)) {
      throw new Error(`sequence '${t.seqKey}' has position ${t.position} more than once in the file`)
    }
    positions.set(t.position, t.kind)
  }
  return bySeq
}

/** Pulls { onTrue, onFalse } out of a branch tuple's `rest` text. */
function branchTargets(rest: string): { onTrue: number; onFalse: number } | null {
  const m = /\$cond\$[\s\S]*?\$cond\$::jsonb,\s*(\d+),\s*(\d+)/.exec(rest)
  if (!m) return null
  return { onTrue: Number(m[1]), onFalse: Number(m[2]) }
}

const ALL_TUPLES = parseStepTuples(SQL)
const SEQUENCES = buildSequenceMaps(ALL_TUPLES)

// ---------------------------------------------------------------------------
// Sanity on the parser itself -- if this is wrong, every other test below is
// checking a fiction instead of the file.
// ---------------------------------------------------------------------------

describe("parser sanity", () => {
  it("finds all seven sequences seeded with steps in this file", () => {
    expect([...SEQUENCES.keys()].sort()).toEqual(
      [
        "abandoned_checkout",
        "camp_clinic_deadline",
        "quiz_aspiring_pro",
        "quiz_ceiling_breaker",
        "quiz_parent_coach",
        "quiz_rebuilder",
        "service_application_received",
      ].sort(),
    )
  })

  it("parses 50 step tuples total (8 + 6 + 8 + 4x7)", () => {
    expect(ALL_TUPLES.length).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// Structural spot checks -- the position -> kind shape of each sequence.
// ---------------------------------------------------------------------------
//
// The four quiz sequences deliberately have NO position 0 here: position 0
// already exists in production from 00253 and must not be re-inserted, so
// this map starts at 1.

const EXPECTED_SHAPES: Record<string, Record<number, string>> = {
  abandoned_checkout: {
    0: "email",
    1: "wait",
    2: "tag",
    3: "branch",
    4: "sms",
    5: "stop",
    6: "email",
    7: "stop",
  },
  camp_clinic_deadline: {
    0: "email",
    1: "wait",
    2: "email",
    3: "wait",
    4: "email",
    5: "wait",
    6: "email",
    7: "stop",
  },
  service_application_received: {
    0: "email",
    1: "wait",
    2: "email",
    3: "wait",
    4: "email",
    5: "stop",
  },
  quiz_aspiring_pro: { 1: "wait", 2: "email", 3: "branch", 4: "email", 5: "stop", 6: "email", 7: "stop" },
  quiz_ceiling_breaker: { 1: "wait", 2: "email", 3: "branch", 4: "email", 5: "stop", 6: "email", 7: "stop" },
  quiz_parent_coach: { 1: "wait", 2: "email", 3: "branch", 4: "email", 5: "stop", 6: "email", 7: "stop" },
  quiz_rebuilder: { 1: "wait", 2: "email", 3: "branch", 4: "email", 5: "stop", 6: "email", 7: "stop" },
}

describe.each(Object.keys(EXPECTED_SHAPES))("sequence '%s'", (seqKey) => {
  it("has exactly the expected position -> kind shape", () => {
    const actual = SEQUENCES.get(seqKey)
    expect(actual).toBeDefined()
    const actualObj = Object.fromEntries([...actual!.entries()].sort((a, b) => a[0] - b[0]))
    expect(actualObj).toEqual(EXPECTED_SHAPES[seqKey])
  })
})

it("seeds the four quiz sequences with no position 0 in this file", () => {
  // 00253 already owns position 0 for these four in production; re-seeding
  // it here would either collide (harmless, ON CONFLICT DO NOTHING) or --
  // worse -- signal that someone rewrote the owner-reviewed copy in place.
  for (const key of ["quiz_aspiring_pro", "quiz_ceiling_breaker", "quiz_parent_coach", "quiz_rebuilder"]) {
    expect(SEQUENCES.get(key)!.has(0)).toBe(false)
  }
})

// ---------------------------------------------------------------------------
// New sequences seeded as draft, never active.
// ---------------------------------------------------------------------------

describe("00218's gate: new sequences are seeded draft, not active", () => {
  const NEW_KEYS = ["abandoned_checkout", "service_application_received", "camp_clinic_deadline"]

  it("mentions all three new sequence keys", () => {
    for (const key of NEW_KEYS) expect(SQL).toContain(`'${key}'`)
  })

  it("never seeds a new sequence as active", () => {
    expect(SQL).not.toMatch(
      new RegExp(`'(${NEW_KEYS.join("|")})'[\\s\\S]{0,600}?'active'`),
    )
  })
})

// ---------------------------------------------------------------------------
// The trailing UPDATE pauses the four live quiz sequences.
// ---------------------------------------------------------------------------

it("pauses the four live quiz sequences via an UPDATE, not a re-insert", () => {
  expect(SQL).toMatch(/UPDATE public\.sequences\s*\nSET status = 'paused'[\s\S]*?key LIKE 'quiz_%'/)
})

// ---------------------------------------------------------------------------
// Config checks.
// ---------------------------------------------------------------------------

it("gives every tag step a tag in its config", () => {
  // 00254's sequence_steps_tag_needs_config CHECK constraint rejects a tag
  // step with no "tag" key -- this test catches a miss before the migration
  // even runs, the way __tests__/lib/lead-engine/seed-sequences.test.ts does
  // for 00218's tag steps.
  const tagTuples = ALL_TUPLES.filter((t) => t.kind === "tag")
  expect(tagTuples.length).toBeGreaterThan(0)
  for (const t of tagTuples) {
    const cfg = /\$cfg\$([\s\S]*?)\$cfg\$/.exec(t.rest)
    expect(cfg, `tag step at ${t.seqKey}@${t.position} has no $cfg$ block`).not.toBeNull()
    expect(cfg![1]).toContain('"tag"')
  }
})

// ---------------------------------------------------------------------------
// Copy checks -- scoped to $subj$/$body$ blocks only, never the whole file,
// so the header comment's own discussion of these exact hazards can't make
// the assertion pass or fail for the wrong reason.
// ---------------------------------------------------------------------------

/** All $subj$...$subj$ and $body$...$body$ quoted blocks, contents only. */
function quotedCopyBlocks(sql: string): string[] {
  const blocks: string[] = []
  const re = /\$(subj|body)\$([\s\S]*?)\$\1\$/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sql))) blocks.push(m[2])
  return blocks
}

const COPY_BLOCKS = quotedCopyBlocks(SQL)

it("found actual copy to check (parser didn't come back empty)", () => {
  // A regex that stopped matching would make every assertion below
  // vacuously true. Guard against that directly.
  expect(COPY_BLOCKS.length).toBeGreaterThanOrEqual(30)
})

it("carries no placeholder copy in any subject or body", () => {
  for (const block of COPY_BLOCKS) {
    expect(block.toLowerCase()).not.toContain("placeholder")
  }
})

it("uses no merge field beyond {{name}} in any subject or body", () => {
  // {{sms_consent_url}} makes renderSequenceEmail THROW when no URL is
  // supplied, and nothing supplies one here -- the header comment says so
  // explicitly, twice, which is exactly why this check must not scan the
  // whole file: it would see the comment's own mentions and fail on prose,
  // not payload.
  const fields = new Set<string>()
  for (const block of COPY_BLOCKS) {
    for (const match of block.matchAll(/\{\{[a-z_]+\}\}/g)) fields.add(match[0])
  }
  expect([...fields]).toEqual(["{{name}}"])
})

// ---------------------------------------------------------------------------
// THE ASSERTION THAT MATTERS MOST: every branch arm terminates in its own
// stop, and the two arms of a branch never share a position.
// ---------------------------------------------------------------------------

interface WalkResult {
  ok: boolean
  reason: string
  /** Every position visited, start through (and including) its terminal stop, when ok. */
  visited: Set<number>
}

/**
 * Walks forward from `start` by position + 1 -- the engine's only advance
 * rule other than a branch jump -- until it finds a 'stop', runs off a
 * position this sequence never defines, or lands on `otherStart` (the
 * sibling arm's own starting position) before finding its own stop.
 */
function walkArm(positions: Map<number, string>, start: number, otherStart: number): WalkResult {
  const visited = new Set<number>()
  let cur = start
  const guardMax = positions.size + 5
  let steps = 0
  while (positions.has(cur)) {
    visited.add(cur)
    if (positions.get(cur) === "stop") {
      return { ok: true, reason: "", visited }
    }
    cur += 1
    steps += 1
    if (steps > guardMax) {
      return {
        ok: false,
        reason: `walk from ${start} did not terminate within ${guardMax} steps -- possible cycle`,
        visited,
      }
    }
    if (cur === otherStart) {
      return {
        ok: false,
        reason: `walk from ${start} reached the other arm's starting position ${otherStart} (at position ${cur}) before finding its own stop`,
        visited,
      }
    }
  }
  return {
    ok: false,
    reason: `walk from ${start} ran past position ${cur - 1} into an undefined position (${cur}) without reaching a stop`,
    visited,
  }
}

interface BranchStep {
  seqKey: string
  position: number
  onTrue: number
  onFalse: number
}

const BRANCH_STEPS: BranchStep[] = ALL_TUPLES.filter((t) => t.kind === "branch").map((t) => {
  const targets = branchTargets(t.rest)
  if (!targets) throw new Error(`branch step ${t.seqKey}@${t.position} has no parseable on_true/on_false targets`)
  return { seqKey: t.seqKey, position: t.position, onTrue: targets.onTrue, onFalse: targets.onFalse }
})

it("found a branch step in every sequence that has one (5 total)", () => {
  // abandoned_checkout + the four quiz sequences. If this count is wrong,
  // the walk below is silently checking fewer branches than the file has.
  expect(BRANCH_STEPS.length).toBe(5)
})

describe.each(BRANCH_STEPS.map((b) => [`${b.seqKey}@${b.position}`, b] as const))(
  "branch %s",
  (_label, branch) => {
    const positions = SEQUENCES.get(branch.seqKey)!

    it("both on_true_position and on_false_position resolve to a real position in this sequence", () => {
      expect(positions.has(branch.onTrue), `on_true_position ${branch.onTrue} is not a defined step`).toBe(true)
      expect(positions.has(branch.onFalse), `on_false_position ${branch.onFalse} is not a defined step`).toBe(true)
    })

    it("the true arm reaches its own stop before reaching the false arm's start", () => {
      const result = walkArm(positions, branch.onTrue, branch.onFalse)
      expect(result.ok, result.reason).toBe(true)
    })

    it("the false arm reaches its own stop before reaching the true arm's start", () => {
      const result = walkArm(positions, branch.onFalse, branch.onTrue)
      expect(result.ok, result.reason).toBe(true)
    })

    it("the two arms occupy no positions in common", () => {
      const trueVisited = walkArm(positions, branch.onTrue, branch.onFalse).visited
      const falseVisited = walkArm(positions, branch.onFalse, branch.onTrue).visited
      const overlap = [...trueVisited].filter((p) => falseVisited.has(p))
      expect(overlap, `arms share position(s): ${overlap.join(", ")}`).toEqual([])
    })
  },
)
