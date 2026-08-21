// @vitest-environment node
//
// Migrations 00212-00218 have not run against any real database yet (see
// Task 13's precondition check), so this cannot be a live-DB test the way
// __tests__/migrations/00078_platform_connections.test.ts is. Instead it
// parses the seed migration's raw SQL text — the same "read the file on
// disk" approach __tests__/lib/lead-engine/no-brand-literals.test.ts already
// uses for this file.
//
// The parser below is NOT a general SQL parser. It understands exactly the
// subset of syntax this migration uses: single-quoted strings (with ''
// escapes), dollar-quoted strings ($tag$...$tag$), line comments (-- ...),
// and parenthesised VALUES tuples, including a parenthesised subselect as a
// field value. That is enough to recover, from the file alone, the same
// structure the CHECK constraints in 00216 enforce at insert time — so a
// malformed step (e.g. an email step with no body) fails both here AND at
// `pgcheck.sh`, for two different reasons.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const MIGRATION_PATH = join(process.cwd(), "supabase/migrations/00218_lead_engine_seed_sequences.sql")
const rawSql = readFileSync(MIGRATION_PATH, "utf8")

// ---------------------------------------------------------------------------
// Minimal SQL tokenizing helpers
// ---------------------------------------------------------------------------

/** Strips `-- ...` line comments, but never inside a quoted or dollar-quoted string. */
function stripSqlComments(sql: string): string {
  let out = ""
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'") {
      out += ch
      i++
      while (i < sql.length) {
        out += sql[i]
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += sql[i + 1]
          i += 2
          continue
        }
        if (sql[i] === "'") {
          i++
          break
        }
        i++
      }
      continue
    }
    if (ch === "$") {
      const m = /^\$[a-zA-Z0-9_]*\$/.exec(sql.slice(i))
      if (m) {
        const tag = m[0]
        const endIdx = sql.indexOf(tag, i + tag.length)
        const end = endIdx === -1 ? sql.length : endIdx + tag.length
        out += sql.slice(i, end)
        i = end
        continue
      }
    }
    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i)
      i = nl === -1 ? sql.length : nl
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Splits `s` on `sepChar` only at paren-depth 0 and outside any quoted or
 * dollar-quoted string. Used both to split the file into statements
 * (`sepChar = ';'`) and to split a tuple's fields (`sepChar = ','`) —
 * the latter must not split inside a parenthesised subselect field.
 */
function splitTopLevel(s: string, sepChar: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ""
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === "'") {
      current += ch
      i++
      while (i < s.length) {
        current += s[i]
        if (s[i] === "'" && s[i + 1] === "'") {
          current += s[i + 1]
          i += 2
          continue
        }
        if (s[i] === "'") {
          i++
          break
        }
        i++
      }
      continue
    }
    if (ch === "$") {
      const m = /^\$[a-zA-Z0-9_]*\$/.exec(s.slice(i))
      if (m) {
        const tag = m[0]
        const endIdx = s.indexOf(tag, i + tag.length)
        const end = endIdx === -1 ? s.length : endIdx + tag.length
        current += s.slice(i, end)
        i = end
        continue
      }
    }
    if (ch === "(") {
      depth++
      current += ch
      i++
      continue
    }
    if (ch === ")") {
      depth--
      current += ch
      i++
      continue
    }
    if (depth === 0 && ch === sepChar) {
      parts.push(current)
      current = ""
      i++
      continue
    }
    current += ch
    i++
  }
  parts.push(current)
  return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

/** Unwraps a single-quoted or dollar-quoted SQL literal; `NULL` -> null; anything else -> raw text (e.g. a bare integer or a subselect). */
function unquote(raw: string): string | null {
  const t = raw.trim()
  if (/^NULL$/i.test(t)) return null
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
    return t.slice(1, -1).replace(/''/g, "'")
  }
  const dollarMatch = /^(\$[a-zA-Z0-9_]*\$)([\s\S]*)\1$/.exec(t)
  if (dollarMatch) return dollarMatch[2]
  return t
}

const cleaned = stripSqlComments(rawSql)
const statements = splitTopLevel(cleaned, ";")

/** The text right after `VALUES`, stripped of any trailing `ON CONFLICT ...` clause. */
function valuesSectionOf(statement: string): string {
  const afterValues = statement.split(/\bVALUES\b/i)[1] ?? ""
  return afterValues.split(/\bON CONFLICT\b/i)[0]
}

// splitTopLevel already yields whole "(...)" chunks when splitting on "," at
// depth 0, because depth returns to 0 only once a tuple's closing paren is
// consumed — the comma between tuples is the very next character.
function extractTuples(valuesSection: string): string[] {
  return splitTopLevel(valuesSection, ",")
}

function stripOuterParens(tuple: string): string {
  const t = tuple.trim()
  if (t.startsWith("(") && t.endsWith(")")) return t.slice(1, -1)
  return t
}

// ---------------------------------------------------------------------------
// Parse `sequences` rows: (business_id, key, name, description, trigger_source, status)
// ---------------------------------------------------------------------------

const sequencesStatement = statements.find((s) => /^INSERT INTO public\.sequences\s*\(/i.test(s.trim()))
if (!sequencesStatement)
  throw new Error("no INSERT INTO public.sequences statement found in 00218 — parser or migration drifted")

const sequenceRows = extractTuples(valuesSectionOf(sequencesStatement)).map((tuple) => {
  const fields = splitTopLevel(stripOuterParens(tuple), ",")
  const [businessId, key, name, description, triggerSource, status] = fields.map(unquote)
  return { businessId, key, name, description, triggerSource, status }
})

// ---------------------------------------------------------------------------
// Parse `sequence_steps` rows: (business_id, sequence_id, position, kind, wait_minutes, subject, body)
// Each seeded step is its own single-row INSERT, so one tuple per statement.
// `sequence_id` is a `(SELECT ... WHERE key = 'xxx')` subselect — the step's
// owning sequence is recovered from that literal, per the brief's requirement
// that steps reference their sequence via a subselect on `key`, never a
// hardcoded uuid.
// ---------------------------------------------------------------------------

const stepStatements = statements.filter((s) => /^INSERT INTO public\.sequence_steps\s*\(/i.test(s.trim()))
if (stepStatements.length === 0)
  throw new Error("no INSERT INTO public.sequence_steps statements found in 00218 — parser or migration drifted")

const stepRows = stepStatements.map((statement) => {
  const tuples = extractTuples(valuesSectionOf(statement))
  expect(tuples.length).toBe(1) // one step per INSERT, by construction
  const fields = splitTopLevel(stripOuterParens(tuples[0]), ",")
  const [businessId, sequenceIdExpr, position, kind, waitMinutes, subject, body] = fields
  const keyMatch = /key\s*=\s*'([^']+)'/.exec(sequenceIdExpr)
  if (!keyMatch)
    throw new Error(`sequence_steps row does not reference its sequence via a key subselect: ${sequenceIdExpr}`)
  return {
    businessId: unquote(businessId),
    sequenceKey: keyMatch[1],
    position: Number(unquote(position)),
    kind: unquote(kind),
    waitMinutes: unquote(waitMinutes) === null ? null : Number(unquote(waitMinutes)),
    subject: unquote(subject),
    body: unquote(body),
  }
})

function stepsFor(key: string) {
  return stepRows.filter((s) => s.sequenceKey === key).sort((a, b) => a.position - b.position)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("seed migration 00218 — the four sequences", () => {
  it("is actually parsing the file — a guard against a silently empty sweep", () => {
    expect(sequenceRows.length).toBeGreaterThan(0)
    expect(stepRows.length).toBeGreaterThan(0)
  })

  it("seeds exactly four sequences, all in draft", () => {
    expect(sequenceRows).toHaveLength(4)
    for (const row of sequenceRows) {
      expect(row.status).toBe("draft")
    }
    expect(sequenceRows.map((r) => r.key).sort()).toEqual([
      "cold_lead_re_engagement",
      "lead_magnet_delivery",
      "new_lead_nurture",
      "newsletter_welcome",
    ])
  })

  it("every step belongs to one of the four seeded sequences", () => {
    const seededKeys = new Set(sequenceRows.map((r) => r.key))
    for (const step of stepRows) {
      expect(seededKeys.has(step.sequenceKey)).toBe(true)
    }
  })

  it("gives every email step both a subject and a body", () => {
    const emailSteps = stepRows.filter((s) => s.kind === "email")
    expect(emailSteps.length).toBeGreaterThan(0)
    for (const step of emailSteps) {
      expect(step.subject, `sequence ${step.sequenceKey} position ${step.position}`).toBeTruthy()
      expect(step.body, `sequence ${step.sequenceKey} position ${step.position}`).toBeTruthy()
    }
  })

  it("gives every wait step a wait_minutes value", () => {
    const waitSteps = stepRows.filter((s) => s.kind === "wait")
    expect(waitSteps.length).toBeGreaterThan(0)
    for (const step of waitSteps) {
      expect(step.waitMinutes, `sequence ${step.sequenceKey} position ${step.position}`).not.toBeNull()
      expect(step.waitMinutes as number).toBeGreaterThan(0)
    }
  })

  it("opens with a wait on any source that already auto-replies", () => {
    // From the migration header's audit table: contact_form, lead_magnet and
    // event_signup already email the lead at the moment of capture.
    const AUTO_REPLY_SOURCES = new Set(["contact_form", "lead_magnet", "event_signup"])
    for (const row of sequenceRows) {
      if (!row.triggerSource || !AUTO_REPLY_SOURCES.has(row.triggerSource)) continue
      const steps = stepsFor(row.key as string)
      expect(steps.length, `sequence ${row.key}`).toBeGreaterThan(0)
      expect(steps[0].kind, `sequence ${row.key} (trigger_source=${row.triggerSource}) must open with a wait`).toBe(
        "wait",
      )
    }
    // Sanity: at least one seeded sequence actually exercises this rule —
    // otherwise the assertion above would pass vacuously.
    const auditedSequences = sequenceRows.filter((r) => r.triggerSource && AUTO_REPLY_SOURCES.has(r.triggerSource))
    expect(auditedSequences.length).toBeGreaterThan(0)
  })

  it("does NOT open with a wait on a source that does not already email the lead", () => {
    const AUTO_REPLY_SOURCES = new Set(["contact_form", "lead_magnet", "event_signup"])
    const immediateSequences = sequenceRows.filter((r) => !r.triggerSource || !AUTO_REPLY_SOURCES.has(r.triggerSource))
    expect(immediateSequences.length).toBeGreaterThan(0)
    for (const row of immediateSequences) {
      const steps = stepsFor(row.key as string)
      expect(steps.length, `sequence ${row.key}`).toBeGreaterThan(0)
      expect(steps[0].kind, `sequence ${row.key}`).toBe("email")
    }
  })

  it("ends every sequence with a stop step", () => {
    for (const row of sequenceRows) {
      const steps = stepsFor(row.key as string)
      expect(steps.length, `sequence ${row.key}`).toBeGreaterThan(0)
      expect(steps[steps.length - 1].kind, `sequence ${row.key}`).toBe("stop")
    }
  })

  it("numbers each sequence's steps contiguously from 0", () => {
    for (const row of sequenceRows) {
      const steps = stepsFor(row.key as string)
      const positions = steps.map((s) => s.position)
      expect(positions, `sequence ${row.key}`).toEqual(positions.map((_, idx) => idx))
    }
  })

  it("uses {{name}} for personalisation, and never right before punctuation that would read badly when it renders empty", () => {
    // e.g. "Hi {{name}}," would render "Hi ," when the contact has no name on
    // file. lib/lead-engine/email.ts substitutes {{name}} with "" verbatim —
    // there is no template fallback — so the character immediately after the
    // token in the SOURCE COPY must never be a comma, period, or other
    // punctuation mark that would look broken glued to nothing.
    const emailSteps = stepRows.filter((s) => s.kind === "email")
    let usesName = false
    for (const step of emailSteps) {
      for (const field of [step.subject, step.body]) {
        if (!field) continue
        let idx = field.indexOf("{{name}}")
        while (idx !== -1) {
          usesName = true
          const after = field.slice(idx + "{{name}}".length, idx + "{{name}}".length + 1)
          expect(
            /[,.!?;:]/.test(after),
            `sequence ${step.sequenceKey} position ${step.position}: "{{name}}${after}"`,
          ).toBe(false)
          idx = field.indexOf("{{name}}", idx + 1)
        }
      }
    }
    expect(usesName).toBe(true)
  })

  it("uses no brand literal", () => {
    // Mirrors __tests__/lib/lead-engine/no-brand-literals.test.ts, which now
    // also scans this exact file path — this is the same check run directly
    // against the migration so a failure here points straight at the copy.
    const FORBIDDEN = [/DJP\s*Athlete/i, /\bDarren\b/i, /darrenjpaul\.com/i]
    for (const re of FORBIDDEN) {
      expect(re.test(rawSql), `matched ${re}`).toBe(false)
    }
  })
})

// =============================================================================
// Migration 00222 — sms steps seeded into the three DRAFT sequences only.
// Reuses the tokenizing helpers above; they are generic SQL-subset parsing,
// not specific to 00218.
// =============================================================================

const MIGRATION_222_PATH = join(process.cwd(), "supabase/migrations/00222_lead_engine_seed_sms_steps.sql")
const rawSql222 = readFileSync(MIGRATION_222_PATH, "utf8")
const cleaned222 = stripSqlComments(rawSql222)
const statements222 = splitTopLevel(cleaned222, ";")

const DRAFT_KEYS = ["newsletter_welcome", "lead_magnet_delivery", "cold_lead_re_engagement"] as const

const stepInsertStatements222 = statements222.filter((s) => /^INSERT INTO public\.sequence_steps\s*\(/i.test(s.trim()))
if (stepInsertStatements222.length === 0)
  throw new Error("no INSERT INTO public.sequence_steps statements found in 00222 — parser or migration drifted")

const stepRows222 = stepInsertStatements222.map((statement) => {
  const tuples = extractTuples(valuesSectionOf(statement))
  expect(tuples.length).toBe(1) // one step per INSERT, by construction — same style as 00218
  const fields = splitTopLevel(stripOuterParens(tuples[0]), ",")
  const [businessId, sequenceIdExpr, position, kind, waitMinutes, subject, body] = fields
  const keyMatch = /key\s*=\s*'([^']+)'/.exec(sequenceIdExpr)
  if (!keyMatch)
    throw new Error(`sequence_steps row does not reference its sequence via a key subselect: ${sequenceIdExpr}`)
  return {
    businessId: unquote(businessId),
    sequenceKey: keyMatch[1],
    position: Number(unquote(position)),
    kind: unquote(kind),
    waitMinutes: unquote(waitMinutes) === null ? null : Number(unquote(waitMinutes)),
    subject: unquote(subject),
    body: unquote(body),
  }
})

// The stop-shift UPDATEs. Parsed straight out of `statements222` (already
// comment-stripped by `stripSqlComments`), so anything living only inside
// the new_lead_nurture comment block can never appear here.
const updateStopStatements222 = statements222.filter((s) => /^UPDATE public\.sequence_steps\b/i.test(s.trim()))

/**
 * Finds the stop-shift UPDATE for `key` and reports (a) whether it uses the
 * relative `position = position + 2` form the brief requires (never a
 * hardcoded absolute new position, which would silently disagree with
 * whatever the row's actual current position is) and (b) the literal old
 * position it gates on via `WHERE ... position = <n>` — the idempotency
 * guard: a second run finds the stop already moved off `<n>`, so the WHERE
 * matches nothing and the UPDATE becomes a no-op.
 */
function stopShiftFor(key: string): { oldPosition: number | null; usesRelativeShift: boolean } | null {
  const stmt = updateStopStatements222.find((s) => new RegExp(`key\\s*=\\s*'${key}'`).test(s))
  if (!stmt) return null
  const oldPositionMatch = /\bposition\s*=\s*(\d+)\b/.exec(stmt)
  const usesRelativeShift = /SET\s+position\s*=\s*position\s*\+\s*2\b/i.test(stmt)
  return {
    oldPosition: oldPositionMatch ? Number(oldPositionMatch[1]) : null,
    usesRelativeShift,
  }
}

/** Strips every line that is entirely a `--` comment (after trimming leading whitespace). */
function stripCommentLines(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
}

describe("seed migration 00222 — sms steps for the three draft sequences", () => {
  it("is actually parsing the file — a guard against a silently empty sweep", () => {
    expect(stepRows222.length).toBeGreaterThan(0)
    expect(updateStopStatements222.length).toBeGreaterThan(0)
  })

  it("inserts exactly one sms step, and only into the three draft sequences", () => {
    const smsSteps = stepRows222.filter((s) => s.kind === "sms")
    expect(smsSteps).toHaveLength(3)
    expect(smsSteps.map((s) => s.sequenceKey).sort()).toEqual([...DRAFT_KEYS].sort())
  })

  it("shifts each draft sequence's stop by exactly 2 via a relative UPDATE, with the new wait+sms landing exactly where the shift vacated", () => {
    expect(updateStopStatements222).toHaveLength(3)
    for (const key of DRAFT_KEYS) {
      const shift = stopShiftFor(key)
      expect(shift, `sequence ${key}`).not.toBeNull()
      expect(
        shift!.usesRelativeShift,
        `sequence ${key} must shift via position = position + 2, not a hardcoded absolute position`,
      ).toBe(true)
      expect(shift!.oldPosition, `sequence ${key}`).not.toBeNull()

      const waitStep = stepRows222.find((s) => s.sequenceKey === key && s.kind === "wait")
      const smsStep = stepRows222.find((s) => s.sequenceKey === key && s.kind === "sms")
      expect(waitStep, `sequence ${key} missing its inserted wait step`).toBeTruthy()
      expect(smsStep, `sequence ${key} missing its inserted sms step`).toBeTruthy()
      expect(waitStep!.position, `sequence ${key}: wait step must land exactly at the old stop position`).toBe(
        shift!.oldPosition,
      )
      expect(smsStep!.position, `sequence ${key}: sms step must land exactly one after the wait`).toBe(
        shift!.oldPosition! + 1,
      )
    }
  })

  it("no sms body contains the word STOP (the renderer appends the opt-out sentence — one source) or a brand word", () => {
    const FORBIDDEN = [/DJP\s*Athlete/i, /\bDarren\b/i, /darrenjpaul\.com/i]
    const smsSteps = stepRows222.filter((s) => s.kind === "sms")
    expect(smsSteps.length).toBeGreaterThan(0)
    for (const step of smsSteps) {
      expect(step.body, `sequence ${step.sequenceKey}`).toBeTruthy()
      expect(/\bSTOP\b/i.test(step.body as string), `sequence ${step.sequenceKey} sms body contains STOP`).toBe(false)
      for (const re of FORBIDDEN) {
        expect(re.test(step.body as string), `sequence ${step.sequenceKey} matched ${re}`).toBe(false)
      }
    }
  })

  // Mirrors 00218's identical assertion for email steps (Fix wave, Finding
  // 3): lib/lead-engine/sms.ts substitutes {{name}} with "" verbatim for a
  // nameless contact, so a body that opens "{{name}}, ..." renders as a
  // literal leading ", ..." — the character immediately after the token in
  // the SOURCE COPY must never be a comma, period, or other punctuation mark
  // that would look broken glued to nothing.
  it("uses {{name}} for personalisation in its sms bodies, and never right before punctuation that would read badly when it renders empty", () => {
    const smsSteps = stepRows222.filter((s) => s.kind === "sms")
    let usesName = false
    for (const step of smsSteps) {
      const field = step.body
      if (!field) continue
      let idx = field.indexOf("{{name}}")
      while (idx !== -1) {
        usesName = true
        const after = field.slice(idx + "{{name}}".length, idx + "{{name}}".length + 1)
        expect(/[,.!?;:]/.test(after), `sequence ${step.sequenceKey}: "{{name}}${after}"`).toBe(false)
        idx = field.indexOf("{{name}}", idx + 1)
      }
    }
    expect(usesName).toBe(true)
  })

  it("touches only the three draft sequences — new_lead_nurture gets no live INSERT or UPDATE", () => {
    const liveKeys = new Set(stepRows222.map((s) => s.sequenceKey))
    for (const stmt of updateStopStatements222) {
      const m = /key\s*=\s*'([^']+)'/.exec(stmt)
      if (m) liveKeys.add(m[1])
    }
    expect(liveKeys.has("new_lead_nurture")).toBe(false)
    expect([...liveKeys].sort()).toEqual([...DRAFT_KEYS].sort())
  })

  it("keeps the new_lead_nurture runbook comment-only — no line outside `--` mentions it", () => {
    // Deliberately independent of stripSqlComments (which is dollar-quote
    // aware and already used above): the brief asks specifically for a
    // simple line-based strip of `--`-prefixed lines, so this test exercises
    // that exact mechanism against the raw file.
    const withoutComments = stripCommentLines(rawSql222)
    expect(withoutComments).not.toMatch(/new_lead_nurture/)
    // Sanity: the file does discuss new_lead_nurture — inside comments —
    // otherwise the assertion above would pass vacuously.
    expect(rawSql222).toMatch(/new_lead_nurture/)
  })

  it("uses no brand literal anywhere in the file, comments included", () => {
    const FORBIDDEN = [/DJP\s*Athlete/i, /\bDarren\b/i, /darrenjpaul\.com/i]
    for (const re of FORBIDDEN) {
      expect(re.test(rawSql222), `matched ${re}`).toBe(false)
    }
  })
})

// =============================================================================
// Migration 00223 — the sms_repermission sequence (Task 9). Reuses the same
// tokenizing helpers; generic SQL-subset parsing, not specific to 00218/00222.
// =============================================================================

const MIGRATION_223_PATH = join(process.cwd(), "supabase/migrations/00223_lead_engine_repermission_sequence.sql")
const rawSql223 = readFileSync(MIGRATION_223_PATH, "utf8")
const cleaned223 = stripSqlComments(rawSql223)
const statements223 = splitTopLevel(cleaned223, ";")

const sequencesStatement223 = statements223.find((s) => /^INSERT INTO public\.sequences\s*\(/i.test(s.trim()))
if (!sequencesStatement223)
  throw new Error("no INSERT INTO public.sequences statement found in 00223 — parser or migration drifted")

const sequenceRows223 = extractTuples(valuesSectionOf(sequencesStatement223)).map((tuple) => {
  const fields = splitTopLevel(stripOuterParens(tuple), ",")
  const [businessId, key, name, description, triggerSource, status] = fields.map(unquote)
  return { businessId, key, name, description, triggerSource, status }
})

const stepInsertStatements223 = statements223.filter((s) => /^INSERT INTO public\.sequence_steps\s*\(/i.test(s.trim()))
if (stepInsertStatements223.length === 0)
  throw new Error("no INSERT INTO public.sequence_steps statements found in 00223 — parser or migration drifted")

const stepRows223 = stepInsertStatements223.map((statement) => {
  const tuples = extractTuples(valuesSectionOf(statement))
  expect(tuples.length).toBe(1) // one step per INSERT, by construction — same style as 00218/00222
  const fields = splitTopLevel(stripOuterParens(tuples[0]), ",")
  const [businessId, sequenceIdExpr, position, kind, waitMinutes, subject, body] = fields
  const keyMatch = /key\s*=\s*'([^']+)'/.exec(sequenceIdExpr)
  if (!keyMatch)
    throw new Error(`sequence_steps row does not reference its sequence via a key subselect: ${sequenceIdExpr}`)
  return {
    businessId: unquote(businessId),
    sequenceKey: keyMatch[1],
    position: Number(unquote(position)),
    kind: unquote(kind),
    waitMinutes: unquote(waitMinutes) === null ? null : Number(unquote(waitMinutes)),
    subject: unquote(subject),
    body: unquote(body),
  }
})

function stepsFor223(key: string) {
  return stepRows223.filter((s) => s.sequenceKey === key).sort((a, b) => a.position - b.position)
}

describe("seed migration 00223 — the sms_repermission sequence", () => {
  it("is actually parsing the file — a guard against a silently empty sweep", () => {
    expect(sequenceRows223.length).toBeGreaterThan(0)
    expect(stepRows223.length).toBeGreaterThan(0)
  })

  it("seeds exactly one sequence, sms_repermission, draft with a NULL trigger_source", () => {
    expect(sequenceRows223).toHaveLength(1)
    const [row] = sequenceRows223
    expect(row.key).toBe("sms_repermission")
    expect(row.status).toBe("draft")
    expect(row.triggerSource).toBeNull()
  })

  it("has exactly two steps — one email at position 0, then stop at position 1", () => {
    const steps = stepsFor223("sms_repermission")
    expect(steps).toHaveLength(2)
    expect(steps[0].position).toBe(0)
    expect(steps[0].kind).toBe("email")
    expect(steps[1].position).toBe(1)
    expect(steps[1].kind).toBe("stop")
  })

  it("gives the email step the exact subject 'Can we text you?'", () => {
    const [emailStep] = stepsFor223("sms_repermission")
    expect(emailStep.subject).toBe("Can we text you?")
  })

  it("gives the email step a body", () => {
    const [emailStep] = stepsFor223("sms_repermission")
    expect(emailStep.body).toBeTruthy()
  })

  it("uses {{name}} for personalisation, never right before punctuation that would read badly when it renders empty", () => {
    const [emailStep] = stepsFor223("sms_repermission")
    let usesName = false
    for (const field of [emailStep.subject, emailStep.body]) {
      if (!field) continue
      let idx = field.indexOf("{{name}}")
      while (idx !== -1) {
        usesName = true
        const after = field.slice(idx + "{{name}}".length, idx + "{{name}}".length + 1)
        expect(/[,.!?;:]/.test(after), `"{{name}}${after}"`).toBe(false)
        idx = field.indexOf("{{name}}", idx + 1)
      }
    }
    expect(usesName).toBe(true)
  })

  // Unlike 00222's sms bodies (where the renderer appends the opt-out
  // sentence exactly once, so seed copy must NOT contain "STOP"), this is
  // an EMAIL step — nothing in lib/lead-engine/email.ts appends an
  // SMS-style opt-out clause, so the consent-ask sentence has to name
  // STOP/HELP itself, compatibly with renderSmsConsentWording's own clause
  // ("Reply STOP to opt out, HELP for help.").
  it("states message/data rates and mentions STOP/HELP, compatible with renderSmsConsentWording's clause", () => {
    const [emailStep] = stepsFor223("sms_repermission")
    const body = emailStep.body as string
    expect(/message and data rates may apply/i.test(body)).toBe(true)
    expect(/\bSTOP\b/i.test(body)).toBe(true)
    expect(/\bHELP\b/i.test(body)).toBe(true)
  })

  it("asks the recipient to reply YES, and never invents a consent-landing-page link", () => {
    const [emailStep] = stepsFor223("sms_repermission")
    const body = emailStep.body as string
    expect(/reply\s+YES/i.test(body)).toBe(true)
    // No link is offered — this repo has no consent landing page (see this
    // migration's own header comment). A body carrying "http" or "https"
    // would mean a URL snuck in despite that finding.
    expect(/https?:\/\//i.test(body)).toBe(false)
  })

  it("uses no brand literal anywhere in the file, comments included", () => {
    const FORBIDDEN = [/DJP\s*Athlete/i, /\bDarren\b/i, /darrenjpaul\.com/i]
    for (const re of FORBIDDEN) {
      expect(re.test(rawSql223), `matched ${re}`).toBe(false)
    }
  })
})
