// The two AI calls behind Ask AI.
//
// `callAgent` is mocked — these tests are about WHAT IS ASKED and WITH WHICH
// MODEL, not about the model's answer. Both of those are silently wrong-able:
// a swapped model is a cost and quality regression with no error, and a prompt
// that hand-lists the templates goes stale the moment one is added.

import { describe, it, expect, vi, beforeEach } from "vitest"

const callAgentMock = vi.fn()
vi.mock("@/lib/ai/anthropic", () => ({
  callAgent: (...args: unknown[]) => callAgentMock(...args),
}))

import {
  interviewQuestions,
  draftFunnelPlan,
  MIN_QUESTIONS,
  MAX_QUESTIONS,
} from "@/lib/ai/funnel-interview"
import { MODEL_HAIKU, MODEL_SONNET } from "@/lib/ai/models"
import { FUNNEL_TEMPLATES } from "@/lib/funnels/templates"
import { FUNNEL_GOALS } from "@/lib/validators/funnel"

beforeEach(() => {
  vi.clearAllMocks()
  // `content`, NOT `data`. AgentCallResult's field is `content`, and mocking
  // the wrong name is how the implementation shipped reading `result.data` —
  // undefined at runtime — with every test green. Only tsc caught it.
  callAgentMock.mockResolvedValue({ content: { questions: [], template: "leads" }, tokens_used: 0 })
})

/** (system, user, schema, options) as handed to callAgent. */
function lastCall() {
  const [system, user, schema, options] = callAgentMock.mock.calls.at(-1)!
  return { system: system as string, user: user as string, schema, options: options as { model?: string } }
}

describe("interviewQuestions", () => {
  it("uses Haiku, not the expensive model", async () => {
    // MUTANT KILLED: reaching for Sonnet because it is the default. Asking
    // three questions about one sentence is the easy half, and this fires on
    // an interactive click — the wrong model here is pure cost with no error.
    await interviewQuestions("summer camp for junior tennis")
    expect(lastCall().options.model).toBe(MODEL_HAIKU)
  })

  it("puts the brief in the user message, not the system prompt", async () => {
    // The system prompt is the cacheable half. Interpolating the brief into it
    // would defeat any prefix caching and change the prompt on every call.
    await interviewQuestions("summer camp for junior tennis")
    const { system, user } = lastCall()
    expect(user).toContain("summer camp for junior tennis")
    expect(system).not.toContain("summer camp for junior tennis")
  })

  it("refuses to ask about things the system already decides", async () => {
    await interviewQuestions("anything")
    const { system } = lastCall()
    expect(system).toMatch(/NEVER ask which template/i)
  })

  it("bounds how many questions come back", async () => {
    await interviewQuestions("anything")
    const parsed = lastCall().schema.safeParse({
      questions: Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => ({
        id: `q${i}`,
        question: "why",
        hint: null,
        placeholder: null,
      })),
    })
    expect(parsed.success).toBe(false)
  })

  it("truncates a brief longer than the cap", async () => {
    await interviewQuestions("x".repeat(5000))
    expect(lastCall().user.length).toBeLessThan(1000)
  })
})

describe("draftFunnelPlan", () => {
  const answers = [{ question: "What ages?", answer: "12 to 16" }]

  it("uses Sonnet, because this is the judgment call", async () => {
    await draftFunnelPlan("camp", answers)
    expect(lastCall().options.model).toBe(MODEL_SONNET)
  })

  it("sends every answer, paired with its question", async () => {
    // MUTANT KILLED: sending the answers alone. "12 to 16" means nothing
    // without the question it answered, and the model would guess.
    await draftFunnelPlan("camp", [
      { question: "What ages?", answer: "12 to 16" },
      { question: "Deposit or full?", answer: "Deposit" },
    ])
    const { user } = lastCall()
    expect(user).toContain("What ages?")
    expect(user).toContain("12 to 16")
    expect(user).toContain("Deposit or full?")
    expect(user).toContain("Deposit")
  })

  it("generates the template list from the registry rather than hand-listing it", async () => {
    // MUTANT KILLED: a prompt with the six templates typed out. Add a seventh
    // to the registry and the model would never be told it exists — a silent
    // capability gap with no failing build.
    await draftFunnelPlan("camp", answers)
    const { system } = lastCall()
    for (const template of FUNNEL_TEMPLATES) {
      expect(system, template.value).toContain(template.value)
      expect(system, template.label).toContain(template.label)
    }
  })

  it("tells the model the real goal vocabulary", async () => {
    await draftFunnelPlan("camp", answers)
    const { system } = lastCall()
    for (const goal of FUNNEL_GOALS) expect(system, goal.value).toContain(goal.value)
  })

  it("forbids inventing a product name", async () => {
    // The one instruction that matters most: an invented ref survives every
    // other check and renders as a dead button. The sanitiser drops it too,
    // but a model that never invents one produces a better plan.
    await draftFunnelPlan("camp", answers)
    expect(lastCall().system).toMatch(/[Nn]ever invent a product name/)
  })

  it("only accepts a template the registry knows", async () => {
    await draftFunnelPlan("camp", answers)
    const { schema } = lastCall()
    const base = {
      name: "Camp",
      steps: [{ name: "A", slug: "index", goal: null }],
      audience: null,
      description: null,
      offer: null,
      starts_at: null,
      ends_at: null,
    }
    expect(schema.safeParse({ ...base, template: "event" }).success).toBe(true)
    expect(schema.safeParse({ ...base, template: "webinar" }).success).toBe(false)
  })

  it("truncates an over-long answer", async () => {
    await draftFunnelPlan("camp", [{ question: "Why?", answer: "y".repeat(5000) }])
    expect(lastCall().user.length).toBeLessThan(2000)
  })
})

describe("what callAgent actually returns", () => {
  it("reads the questions out of `content`", async () => {
    // MUTANT KILLED: `result.data`. AgentCallResult has no `data` field, so the
    // feature returned undefined at runtime while every mocked test passed.
    // This asserts the real contract rather than the mock's shape.
    callAgentMock.mockResolvedValue({
      content: { questions: [{ id: "q1", question: "Why?", hint: null, placeholder: null }] },
      tokens_used: 12,
    })
    await expect(interviewQuestions("camp")).resolves.toEqual([
      { id: "q1", question: "Why?", hint: null, placeholder: null },
    ])
  })

  it("reads the plan out of `content`", async () => {
    callAgentMock.mockResolvedValue({ content: { template: "event", name: "Camp" }, tokens_used: 9 })
    await expect(draftFunnelPlan("camp", [])).resolves.toMatchObject({ template: "event" })
  })
})
