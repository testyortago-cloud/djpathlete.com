// @vitest-environment node
// __tests__/lib/quizzes/quiz-create.test.ts
//
// THE REMAPPING IS THE WHOLE JOB, so it is what these tests point at.
//
// A clone that keeps the SOURCE's branch ids on its options is not a loud
// failure. Every row inserts, the count is right, and the copy looks like it
// worked; the damage only surfaces when somebody tries to activate it and the
// gate says every branch is unreachable. That is a long way from the copy.
//
// The mock applies the filters it is asked for, the same contract as
// quiz-dal.test.ts: a double that returns canned rows regardless of `.eq()`
// passes with the scoping deleted.
//
// Spec: docs/superpowers/specs/2026-08-24-quiz-funnel-creator-design.md §3
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createQuizFrom, getQuizDefinition, getQuizDefinitionForEditor } from "@/lib/db/quizzes"
import { quizGate } from "@/lib/quizzes/gate"
import { RPI_ATHLETE_QUIZ, toDefinition } from "@/lib/quizzes/seed/rpi-athlete-quiz"
import type { QuizDefinition, QuizOption } from "@/lib/quizzes/types"

// Matches TABLES.quizzes' business_id below -- the free-key collision test
// depends on `uniqueQuizKey`'s scoped read actually seeing the existing row.
const BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

// A DIFFERENT tenant, used only where a test needs to prove that the caller's
// OWN value reaches the write/read rather than some other value (a hardcoded
// SINGLETON_BUSINESS_ID, which is exactly what BUSINESS_ID above equals) --
// see __tests__/lib/lead-engine/import.test.ts's "writes the caller's
// businessId, not the platform singleton" for the pattern this follows.
// Every OTHER test in this file keeps using BUSINESS_ID untouched.
const OTHER_BUSINESS_ID = "22222222-2222-2222-2222-222222222222"

type Row = Record<string, unknown>

/** Canned tables. Deliberately contains rows that MUST be filtered out. */
const TABLES: Record<string, Row[]> = {
  quizzes: [
    {
      id: "q1",
      business_id: "00000000-0000-0000-0000-000000000001",
      key: "rpi-athlete-quiz",
      name: "RPI Athlete Quiz",
      status: "active",
      intro_headline: "Where is your performance leaking?",
      intro_body: "Twelve questions.",
      gate_headline: "Where should we send it?",
      gate_body: "No spam.",
      result_headline: "Your RPI",
      seed_marker: "reconstructed-from-ghl-export-2026-08-23",
    },
    // A SECOND QUIZ, on the same business. Every read below must exclude it.
    { id: "q2", business_id: "00000000-0000-0000-0000-000000000001", key: "other", name: "Other", status: "draft" },
  ],
  quiz_branches: [
    { id: "br1", quiz_id: "q1", key: "rebuilder", name: "Rebuilder", description: null, position: 1 },
    { id: "br2", quiz_id: "q1", key: "ceiling_breaker", name: "Ceiling Breaker", description: null, position: 2 },
    { id: "brX", quiz_id: "q2", key: "intruder", name: "Intruder", description: null, position: 1 },
  ],
  quiz_questions: [
    { id: "qu1", quiz_id: "q1", branch_id: null, position: 10, prompt: "Which describes you best?", help_text: null, is_active: true },
    { id: "qu2", quiz_id: "q1", branch_id: "br1", position: 50, prompt: "Rebuilder question", help_text: null, is_active: true },
    { id: "quOff", quiz_id: "q1", branch_id: null, position: 20, prompt: "Retired question", help_text: null, is_active: false },
    { id: "quX", quiz_id: "q2", branch_id: null, position: 10, prompt: "Intruder question", help_text: null, is_active: true },
  ],
  quiz_options: [
    { id: "o1", question_id: "qu1", position: 1, label: "Pushing higher", weight: 0, routes_to_branch_id: "br2", profile_id: null },
    { id: "o2", question_id: "qu1", position: 2, label: "Coming back from injury", weight: 0, routes_to_branch_id: "br1", profile_id: "p1" },
    { id: "o3", question_id: "qu2", position: 1, label: "Fully confident", weight: 3, routes_to_branch_id: null, profile_id: "p1" },
    { id: "oOff", question_id: "quOff", position: 1, label: "Retired option", weight: 1, routes_to_branch_id: null, profile_id: null },
    { id: "oX", question_id: "quX", position: 1, label: "Intruder option", weight: 9, routes_to_branch_id: null, profile_id: null },
  ],
  quiz_tiers: [
    { id: "t1", quiz_id: "q1", key: "red", position: 1, min_score: 0, max_score: 100, headline: "Red", body: "", cta_label: "Talk to us", cta_href: "/contact" },
    { id: "tX", quiz_id: "q2", key: "red", position: 1, min_score: 0, max_score: 100, headline: "Intruder", body: "", cta_label: null, cta_href: null },
  ],
  quiz_profiles: [
    { id: "p1", quiz_id: "q1", key: "not_sure", name: "Not sure", description: "", position: 0 },
    { id: "pX", quiz_id: "q2", key: "intruder", name: "Intruder", description: "", position: 0 },
  ],
  quiz_attempts: [],
}

const insertsByTable: Record<string, Row[]> = {}
const inserted = (table: string): Row[] => insertsByTable[table] ?? []

function makeClient() {
  return {
    from(table: string) {
      const eqs: [string, unknown][] = []
      const ins: [string, unknown[]][] = []
      let op = "select"
      let payload: Row[] = []

      const apply = () =>
        (TABLES[table] ?? []).filter(
          (row) =>
            eqs.every(([col, val]) => row[col] === val) &&
            ins.every(([col, vals]) => vals.includes(row[col] as never)),
        )

      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          eqs.push([col, val])
          return chain
        },
        in: (col: string, vals: unknown[]) => {
          ins.push([col, vals])
          return chain
        },
        order: () => chain,
        insert: (p: Row | Row[]) => {
          op = "insert"
          payload = Array.isArray(p) ? p : [p]
          insertsByTable[table] = [...(insertsByTable[table] ?? []), ...payload]
          return chain
        },
        update: () => chain,
        delete: () => chain,
        single: async () => {
          if (op === "insert") return { data: payload[0], error: null }
          const rows = apply()
          return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } }
        },
        maybeSingle: async () => {
          if (op === "insert") return { data: payload[0] ?? null, error: null }
          return { data: apply()[0] ?? null, error: null }
        },
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: op === "insert" ? payload : apply(), error: null })),
      }
      return chain
    },
  }
}

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => makeClient() }))

beforeEach(() => {
  for (const key of Object.keys(insertsByTable)) delete insertsByTable[key]
})

/**
 * Rebuilds a `QuizDefinition` out of the rows `createQuizFrom` actually wrote,
 * so the gate can be run against the CLONE rather than against the source it
 * was made from. Running it on the source would pass with every remap deleted.
 */
function rebuildFromInserts(): QuizDefinition {
  const quiz = inserted("quizzes")[0]
  const optionsByQuestion = new Map<string, QuizOption[]>()
  for (const row of inserted("quiz_options")) {
    const list = optionsByQuestion.get(String(row.question_id)) ?? []
    list.push({
      id: String(row.id),
      questionId: String(row.question_id),
      position: Number(row.position),
      label: String(row.label),
      weight: Number(row.weight),
      routesToBranchId: (row.routes_to_branch_id as string | null) ?? null,
      profileId: (row.profile_id as string | null) ?? null,
    })
    optionsByQuestion.set(String(row.question_id), list)
  }
  return {
    id: String(quiz.id),
    key: String(quiz.key),
    name: String(quiz.name),
    status: quiz.status as QuizDefinition["status"],
    introHeadline: String(quiz.intro_headline),
    introBody: String(quiz.intro_body),
    gateHeadline: String(quiz.gate_headline),
    gateBody: String(quiz.gate_body),
    resultHeadline: String(quiz.result_headline),
    seedMarker: (quiz.seed_marker as string | null) ?? null,
    branches: inserted("quiz_branches").map((r) => ({
      id: String(r.id), quizId: String(r.quiz_id), key: String(r.key),
      name: String(r.name), description: (r.description as string | null) ?? null, position: Number(r.position),
    })),
    questions: inserted("quiz_questions").map((r) => ({
      id: String(r.id), quizId: String(r.quiz_id),
      branchId: (r.branch_id as string | null) ?? null,
      position: Number(r.position), prompt: String(r.prompt),
      helpText: (r.help_text as string | null) ?? null,
      isActive: r.is_active !== false,
      options: optionsByQuestion.get(String(r.id)) ?? [],
    })),
    tiers: inserted("quiz_tiers").map((r) => ({
      id: String(r.id), quizId: String(r.quiz_id), key: String(r.key), position: Number(r.position),
      minScore: Number(r.min_score), maxScore: Number(r.max_score),
      headline: String(r.headline), body: String(r.body),
      ctaLabel: (r.cta_label as string | null) ?? null, ctaHref: (r.cta_href as string | null) ?? null,
    })),
    profiles: inserted("quiz_profiles").map((r) => ({
      id: String(r.id), quizId: String(r.quiz_id), key: String(r.key),
      name: String(r.name), description: String(r.description), position: Number(r.position),
    })),
  }
}

describe("createQuizFrom", () => {
  it("remaps every routed option onto the CLONE's branches, never the source's", async () => {
    const source = await getQuizDefinition("q1")
    const { id } = await createQuizFrom(BUSINESS_ID, { source: source!, name: "Rotational Reboot" })

    const cloneBranchIds = new Set(inserted("quiz_branches").map((r) => String(r.id)))
    // MUTANT: let `routes_to_branch_id` pass through unmapped.
    for (const option of inserted("quiz_options")) {
      if (option.routes_to_branch_id) {
        expect(cloneBranchIds.has(String(option.routes_to_branch_id))).toBe(true)
      }
    }
    expect(inserted("quiz_options").some((o) => o.routes_to_branch_id === "br1")).toBe(false)
    expect(inserted("quiz_options").some((o) => o.routes_to_branch_id === "br2")).toBe(false)
    expect(inserted("quizzes")[0].id).toBe(id)
  })

  it("remaps profile votes onto the clone's own profiles", async () => {
    const source = await getQuizDefinition("q1")
    await createQuizFrom(BUSINESS_ID, { source: source!, name: "Rotational Reboot" })

    const cloneProfileIds = new Set(inserted("quiz_profiles").map((r) => String(r.id)))
    // MUTANT: let `profile_id` pass through unmapped. The gate's own blocker
    // for this reads "votes for a profile on another quiz".
    for (const option of inserted("quiz_options")) {
      if (option.profile_id) expect(cloneProfileIds.has(String(option.profile_id))).toBe(true)
    }
    expect(inserted("quiz_options").some((o) => o.profile_id === "p1")).toBe(false)
  })

  it("remaps each question onto the clone's own branch", async () => {
    const source = await getQuizDefinition("q1")
    await createQuizFrom(BUSINESS_ID, { source: source!, name: "Rotational Reboot" })

    const cloneBranchIds = new Set(inserted("quiz_branches").map((r) => String(r.id)))
    for (const question of inserted("quiz_questions")) {
      if (question.branch_id) expect(cloneBranchIds.has(String(question.branch_id))).toBe(true)
    }
    expect(inserted("quiz_questions").some((q) => q.branch_id === "br1")).toBe(false)
  })

  it("hangs every child off the new quiz, not the one it copied", async () => {
    const source = await getQuizDefinition("q1")
    const { id } = await createQuizFrom(BUSINESS_ID, { source: source!, name: "Rotational Reboot" })
    for (const table of ["quiz_branches", "quiz_profiles", "quiz_questions", "quiz_tiers"]) {
      expect(inserted(table).every((r) => r.quiz_id === id)).toBe(true)
      expect(inserted(table).length).toBeGreaterThan(0)
    }
  })

  it("suffixes the key until it does not collide", async () => {
    const source = await getQuizDefinition("q1")
    // TABLES.quizzes already holds key "rpi-athlete-quiz".
    // MUTANT: return slugify(name) unsuffixed — a unique-violation 500 at the
    // exact moment the owner clicks Create.
    const { key } = await createQuizFrom(BUSINESS_ID, { source: source!, name: "RPI Athlete Quiz" })
    expect(key).toBe("rpi-athlete-quiz-2")
  })

  it("falls back to a usable key when the name slugifies to nothing", async () => {
    const source = await getQuizDefinition("q1")
    const { key } = await createQuizFrom(BUSINESS_ID, { source: source!, name: "!!!" })
    expect(key).toBe("quiz")
  })

  it("carries the seed marker rather than laundering a guess into a decision", async () => {
    const source = await getQuizDefinition("q1")
    await createQuizFrom(BUSINESS_ID, { source: source!, name: "Copy" })
    // MUTANT: write null. The clone inherits invented weights with no banner
    // saying they were invented.
    expect(inserted("quizzes")[0].seed_marker).toBe("reconstructed-from-ghl-export-2026-08-23")
  })

  it("is a draft even when its source is active", async () => {
    const source = await getQuizDefinition("q1")
    expect(source!.status).toBe("active")
    // MUTANT: copy the source's status. A copy of a live quiz goes live the
    // instant it is made, with its placeholder name on it.
    await createQuizFrom(BUSINESS_ID, { source: source!, name: "Copy" })
    expect(inserted("quizzes")[0].status).toBe("draft")
  })

  it("takes its name from the caller, not from the source", async () => {
    const source = await getQuizDefinition("q1")
    await createQuizFrom(BUSINESS_ID, { source: source!, name: "Rotational Reboot" })
    expect(inserted("quizzes")[0].name).toBe("Rotational Reboot")
  })

  it("produces a clone that passes the gate when its source does", async () => {
    const source = toDefinition(RPI_ATHLETE_QUIZ)
    expect(quizGate(source).blockers).toEqual([])
    await createQuizFrom(BUSINESS_ID, { source, name: "Copy of the original" })
    // Run against what was WRITTEN, not against what was read.
    expect(quizGate(rebuildFromInserts()).blockers).toEqual([])
  })

  it("copies the built-in blueprint, which is not in any table", async () => {
    await createQuizFrom(BUSINESS_ID, { source: toDefinition(RPI_ATHLETE_QUIZ), name: "From the blueprint" })
    expect(inserted("quiz_questions").length).toBe(toDefinition(RPI_ATHLETE_QUIZ).questions.length)
    expect(inserted("quiz_branches").length).toBe(RPI_ATHLETE_QUIZ.branches.length)
  })

  // BUSINESS_ID above equals SINGLETON_BUSINESS_ID, so every test up to here
  // would pass identically against a version of createQuizFrom that ignored
  // its businessId argument and hardcoded the singleton on the insert. This
  // is the one test in the describe block that cannot: it names a DIFFERENT
  // tenant and checks the actual value written, not just that some value was.
  it("writes the caller's businessId, not a different tenant's", async () => {
    const source = await getQuizDefinition("q1")
    await createQuizFrom(OTHER_BUSINESS_ID, { source: source!, name: "Copy for another business" })

    expect(inserted("quizzes")[0].business_id).toBe(OTHER_BUSINESS_ID)
    expect(inserted("quizzes")[0].business_id).not.toBe(BUSINESS_ID)
  })

  // uniqueQuizKey's collision read is scoped by businessId (file header
  // comment). TABLES.quizzes only has "rpi-athlete-quiz" under BUSINESS_ID,
  // so a caller cloning into OTHER_BUSINESS_ID must NOT see that collision --
  // if the scoped read secretly used the singleton regardless of the
  // argument, this would come back suffixed "-2" exactly like the sibling
  // test above that deliberately DOES collide.
  it("does not suffix a key that only collides in a different business", async () => {
    const source = await getQuizDefinition("q1")
    const { key } = await createQuizFrom(OTHER_BUSINESS_ID, { source: source!, name: "RPI Athlete Quiz" })
    expect(key).toBe("rpi-athlete-quiz")
  })
})

describe("getQuizDefinitionForEditor", () => {
  it("includes a question the public read filters out", async () => {
    // The pair is the test. Asserting only the second half passes with the two
    // functions identical, which is the mistake that makes retirement silent.
    expect((await getQuizDefinition("q1"))!.questions.map((q) => q.id)).not.toContain("quOff")
    expect((await getQuizDefinitionForEditor(BUSINESS_ID, "q1"))!.questions.map((q) => q.id)).toContain("quOff")
  })

  it("carries the retired question's own options with it", async () => {
    const def = await getQuizDefinitionForEditor(BUSINESS_ID, "q1")
    const retired = def!.questions.find((q) => q.id === "quOff")!
    expect(retired.isActive).toBe(false)
    expect(retired.options.map((o) => o.id)).toEqual(["oOff"])
  })

  it("still refuses another quiz's rows", async () => {
    const def = await getQuizDefinitionForEditor(BUSINESS_ID, "q1")
    expect(def!.questions.map((q) => q.id)).not.toContain("quX")
    expect(def!.branches.map((b) => b.key)).not.toContain("intruder")
  })

  it("returns null for a quiz that does not exist", async () => {
    expect(await getQuizDefinitionForEditor(BUSINESS_ID, "nope")).toBeNull()
  })

  // q1 belongs to BUSINESS_ID (== SINGLETON_BUSINESS_ID). Asking for it under
  // a DIFFERENT business must come back null, the same answer as "no such
  // quiz" -- a version of this function that ignored businessId (or defaulted
  // it to the singleton internally) would return the real quiz here instead.
  it("refuses a quiz that belongs to a different business", async () => {
    expect(await getQuizDefinitionForEditor(OTHER_BUSINESS_ID, "q1")).toBeNull()
  })
})
