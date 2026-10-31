// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { getUserById } from "@/lib/db/users"
import { listClientContactIds } from "@/lib/db/contacts"
import { getLatestAttemptForContacts, getQuizDefinition, type ContactQuizAttempt } from "@/lib/db/quizzes"
import { formatClientQuizResult, getClientQuizResult, summariseAttempt } from "@/lib/quizzes/client-result"
import type { QuizDefinition, QuizOption, QuizQuestion, QuizSide } from "@/lib/quizzes/types"

vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn() }))
vi.mock("@/lib/db/contacts", () => ({ listClientContactIds: vi.fn() }))
vi.mock("@/lib/db/quizzes", () => ({ getLatestAttemptForContacts: vi.fn(), getQuizDefinition: vi.fn() }))

function opts(qid: string, weights: number[]): QuizOption[] {
  return weights.map((weight, i) => ({
    id: `${qid}-o${weight}`,
    questionId: qid,
    position: i,
    label: `${qid} ${weight}`,
    weight,
    routesToBranchId: null,
    profileId: null,
  }))
}
function q(id: string, position: number, o: QuizOption[], extra: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    id,
    quizId: "q1",
    branchId: null,
    position,
    prompt: `${id}?`,
    helpText: null,
    mediaUrl: null,
    mediaPosterUrl: null,
    isActive: true,
    options: o,
    ...extra,
  }
}
function test(id: string, position: number, label: string, side: QuizSide | null): QuizQuestion {
  return q(id, position, opts(id, [3, 2, 1, 0]), { reportLabel: label, side })
}

const DEF: QuizDefinition = {
  id: "q1",
  key: "rpi",
  name: "Rotational Performance Index",
  status: "active",
  introHeadline: "",
  introBody: "",
  gateHeadline: "",
  gateBody: "",
  resultHeadline: "",
  seedMarker: null,
  branches: [
    { id: "br1", quizId: "q1", key: "rebuilder", name: "Rebuilder", description: null, position: 1 },
  ] as QuizDefinition["branches"],
  tiers: [],
  profiles: [
    { id: "p1", quizId: "q1", key: "explosive_but_tight", name: "Explosive but tight", description: "", position: 1 },
  ],
  questions: [
    test("cL", 60, "Copenhagen", "left"),
    test("cR", 70, "Copenhagen", "right"),
    test("hollow", 50, "Rocking hollow", null),
    q("freq", 120, [{ ...opts("freq", [0])[0], label: "3 times a week" }]),
    // SCORED but in no area: the visitor's report drops it, the coach and the AI must not.
    q(
      "pain",
      115,
      opts("pain", [3, 2, 1, 0]).map((o) => ({ ...o, label: o.weight === 2 ? "Occasionally" : o.label })),
    ),
    q("area", 140, [{ ...opts("area", [0])[0], label: "Explosive but tight", profileId: "p1" }]),
  ],
}
const pick = (qid: string, weight: number) => ({ questionId: qid, optionId: `${qid}-o${weight}` })

const ATTEMPT: ContactQuizAttempt = {
  id: "a1",
  quizId: "q1",
  branchId: "br1",
  answers: [pick("cL", 3), pick("cR", 1), pick("hollow", 1), pick("freq", 0), pick("pain", 2), pick("area", 0)],
  score: 88,
  tierKey: "green",
  profileKey: "explosive_but_tight",
  completedAt: "2026-09-06T10:00:00Z",
}

describe("summariseAttempt", () => {
  it("names the profile and branch from the quiz, keeps the stored score and tier, and builds the areas", () => {
    const s = summariseAttempt(DEF, ATTEMPT)
    expect(s).toMatchObject({
      quizName: "Rotational Performance Index",
      completedAt: "2026-09-06T10:00:00Z",
      score: 88,
      tier: "green",
      profile: "Explosive but tight",
      branch: "Rebuilder",
    })
    expect(s.map.map((r) => [r.label, r.left, r.right, r.single, r.status])).toEqual([
      ["Rocking hollow", null, null, 1, "leak"],
      ["Copenhagen", 3, 1, null, "gap"],
    ])
    // Every other answer, in walk order: scored ones too. The profile vote is the profile, not a line.
    expect(s.otherAnswers).toEqual([
      { prompt: "pain?", answer: "Occasionally" },
      { prompt: "freq?", answer: "3 times a week" },
    ])
  })

  it("falls back to the stored key for a profile the quiz no longer has", () => {
    expect(summariseAttempt(DEF, { ...ATTEMPT, profileKey: "retired" }).profile).toBe("retired")
  })
})

describe("formatClientQuizResult", () => {
  const text = formatClientQuizResult(summariseAttempt(DEF, ATTEMPT), new Date("2026-10-31T12:00:00Z"))

  it("heads the section with the quiz, its date and how long ago", () => {
    expect(text).toContain("## Client self-assessment: Rotational Performance Index")
    expect(text).toContain("Taken 2026-09-06 (55 days ago).")
  })

  it("says it is the client's own report and never outranks the coach or the injury list", () => {
    expect(text).toContain("not a measured test")
    expect(text).toContain("never let it override the coach's instructions or the injury list")
  })

  it("gives the result, every area with both sides and its status, and what they told us", () => {
    expect(text).toContain('Result: score 88/100, tier green, profile "Explosive but tight", path "Rebuilder".')
    expect(text).toContain("- Copenhagen: L 3/3, R 1/3 (big difference between sides)")
    expect(text).toContain("- Rocking hollow: 1/3 (low)")
    expect(text).toContain("- freq? 3 times a week")
    expect(text).toContain("- pain? Occasionally")
  })

  it("leaves out what the attempt does not have", () => {
    const bare = formatClientQuizResult(
      { ...summariseAttempt(DEF, ATTEMPT), score: null, tier: null, profile: null, branch: null, otherAnswers: [] },
      new Date("2026-09-06T12:00:00Z"),
    )
    expect(bare).not.toContain("Result:")
    expect(bare).not.toContain("What they told us")
    expect(bare).toContain("(today)")
  })
})

describe("getClientQuizResult", () => {
  beforeEach(() => {
    vi.mocked(getUserById).mockResolvedValue({ id: "u1", email: "  Ath@X.com " } as never)
    vi.mocked(listClientContactIds).mockResolvedValue(["c1"])
    vi.mocked(getLatestAttemptForContacts).mockResolvedValue(ATTEMPT)
    vi.mocked(getQuizDefinition).mockResolvedValue(DEF)
  })

  it("looks the client up in the business it was given, by account and normalised email", async () => {
    const result = await getClientQuizResult("b1", "u1")
    expect(listClientContactIds).toHaveBeenCalledWith("b1", { userId: "u1", email: "ath@x.com" })
    expect(getLatestAttemptForContacts).toHaveBeenCalledWith("b1", ["c1"])
    expect(getQuizDefinition).toHaveBeenCalledWith("b1", "q1")
    expect(result?.quizName).toBe("Rotational Performance Index")
  })

  it("answers null when the client never finished a quiz", async () => {
    vi.mocked(getLatestAttemptForContacts).mockResolvedValue(null)
    expect(await getClientQuizResult("b1", "u1")).toBeNull()
  })

  it("answers null when the quiz itself is gone", async () => {
    vi.mocked(getQuizDefinition).mockResolvedValue(null)
    expect(await getClientQuizResult("b1", "u1")).toBeNull()
  })
})
