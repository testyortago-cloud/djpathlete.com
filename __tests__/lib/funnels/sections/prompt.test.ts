// Stage 1.6 of the AI page builder: the prompt the builder model sees
// (lib/funnels/sections/prompt.ts).
//
// This repo's dominant defect class is TESTS THAT CANNOT FAIL, and a
// prompt-generation module is unusually good at producing them: it is all
// strings, so `expect(prompt).toContain("something I typed two lines up")`
// passes forever and proves nothing. Every assertion below is written against
// a named mutant instead:
//
//   - the anti-drift pins derive their expectations from `SECTION_KINDS`,
//     `ISLAND_NAMES` and `SECTION_REGISTRY` — never a hardcoded list, because a
//     hardcoded list is exactly how kind #10 ships with a green suite;
//   - the worked examples are not eyeballed, they are re-parsed through the
//     REAL `buildResultSchema` and then actually EXECUTED through the REAL
//     `applyOps`, so an example that teaches the model an invalid op cannot
//     ship;
//   - the "no ids in Block B" pin feeds real UUIDs in and asserts they do not
//     come out, rather than asserting on a catalogue with no ids to leak;
//   - the "no markup in Block C" pin renders the doc's ACTUAL html via the real
//     `reassemble()` and asserts that string is absent, rather than grepping
//     for "<div".
//
// Zero mocks — every module under test here is pure.
import { describe, it, expect } from "vitest"
import { z } from "zod"
import {
  SECTION_BUILDER_BLOCK_A,
  BUILDER_RULES,
  WORKED_EXAMPLES,
  buildCatalogueBlock,
  buildSystemPrompt,
  buildTurnMessage,
  buildResultSchema,
  type BuilderCatalogueInput,
} from "@/lib/funnels/sections/prompt"
import {
  SECTION_BUILDER_HISTORY_TURNS,
  SECTION_BUILDER_MAX_OPS,
  SECTION_BUILDER_MAX_REPLY_LENGTH,
} from "@/lib/funnels/sections/builder-config"
import { SECTION_KINDS, SECTION_REGISTRY, type Section, type SectionDoc } from "@/lib/funnels/sections/registry"
import { ISLAND_NAMES } from "@/lib/funnels/islands"
import { applyOps, opSchema } from "@/lib/funnels/sections/apply"
import { reassemble } from "@/lib/funnels/sections/doc"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Ids here are the ones the worked examples reference, on purpose. */
function docWithExampleIds(): SectionDoc {
  const sections: Section[] = [
    {
      id: "hero",
      kind: "hero",
      variant: "centered",
      style: { headline: "lg" },
      props: {
        headline: "Train like an athlete",
        sub: "An eight-week rotational power block",
        primaryCta: { label: "Start now", target: { kind: "booking" } },
        secondaryCta: { label: "See pricing", target: { kind: "anchor", sectionId: "pricing" } },
      },
    },
    {
      id: "bullets",
      kind: "bullets",
      variant: "cards",
      style: {},
      props: {
        items: [
          { title: "Measured", body: "Every block starts and ends with the same screen." },
          { title: "Specific", body: "Built from your numbers, not a template." },
        ],
      },
    },
    {
      id: "pricing",
      kind: "pricing",
      variant: "single",
      style: {},
      props: {
        plans: [
          {
            name: "Eight-week block",
            price: "$800",
            features: ["Twice-weekly sessions", "Full programming"],
            cta: { label: "Buy", target: { kind: "program", ref: "Comeback Code" } },
          },
        ],
      },
    },
  ]
  return { v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" }, sections }
}

const UUID_PROGRAM = "8f14e45f-ceea-4a67-b1b5-6e0f1c2d3a4b"
const UUID_PACK = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed"
const UUID_EVENT = "6ba7b810-9dad-41d1-80b4-00c04fd430c8"

function catalogueInput(): BuilderCatalogueInput {
  return {
    catalogue: {
      program: [{ id: UUID_PROGRAM, name: "Comeback Code" }],
      session_pack: [{ id: UUID_PACK, name: "10-Session Pack" }],
      event: [{ id: UUID_EVENT, name: "Winter Velocity Camp" }],
    },
    faqPageKeys: ["programs"],
    stepSlugs: ["thank-you"],
  }
}

/** Names of every field in a props schema whose value is a UUID. */
function uuidFieldNames(node: unknown, key: string, out: Set<string>): void {
  if (node === null || typeof node !== "object") return
  const record = node as Record<string, unknown>
  if (record.format === "uuid" && key !== "") out.add(key)
  for (const [childKey, child] of Object.entries(record)) {
    if (childKey === "properties") {
      for (const [name, sub] of Object.entries(child as Record<string, unknown>)) uuidFieldNames(sub, name, out)
    } else if (Array.isArray(child)) {
      for (const item of child) uuidFieldNames(item, key, out)
    } else if (typeof child === "object") {
      uuidFieldNames(child, key, out)
    }
  }
}

// ---------------------------------------------------------------------------
// Block A is frozen
// ---------------------------------------------------------------------------

describe("Block A is built once, at module load", () => {
  it("is a string constant, not a per-turn builder", () => {
    // The mutant this kills: turning Block A into `buildBlockA()` called every
    // turn. A function's two calls are `toEqual` but never `toBe`, and the
    // damage — a full cache WRITE instead of a read on every single turn, with
    // no error anywhere — is otherwise completely silent.
    const first = SECTION_BUILDER_BLOCK_A
    const second = SECTION_BUILDER_BLOCK_A
    expect(first).toBe(second)
    expect(typeof SECTION_BUILDER_BLOCK_A).toBe("string")
  })

  it("is a byte-identical PREFIX of the system prompt for two different pages", () => {
    // This is the property caching actually depends on: Anthropic's cache is a
    // strict prefix match, so Block A must be untouched by anything per-page.
    // A mutant that interpolates the catalogue, a date, or a funnel name
    // ANYWHERE inside Block A fails here even though the first test passes.
    const pageOne = buildSystemPrompt(catalogueInput())
    const pageTwo = buildSystemPrompt({
      catalogue: { program: [], session_pack: [], event: [{ id: UUID_EVENT, name: "Spring Camp" }] },
      faqPageKeys: [],
      stepSlugs: [],
    })
    expect(pageOne.startsWith(SECTION_BUILDER_BLOCK_A)).toBe(true)
    expect(pageTwo.startsWith(SECTION_BUILDER_BLOCK_A)).toBe(true)
    // ...and the two prompts genuinely differ AFTER the shared prefix, so the
    // assertion above is not passing because both pages render the same thing.
    expect(pageOne).not.toBe(pageTwo)
  })

  it("stays under the size ceiling the token budget assumes", () => {
    // ~4 characters per token for English prose, so 16000 characters is
    // roughly 4000 tokens. The design budgets Block A at ~3000 tokens; it
    // measures ~3200 today. The ceiling is deliberately close, not generous:
    // Block A is written into the cache on the first turn of every page, and
    // the thing that would silently blow it up is someone inlining the nine
    // props schemas as raw JSON Schema (11119 characters on its own) instead
    // of the compact signatures. This goes red long before that reaches prod.
    expect(SECTION_BUILDER_BLOCK_A.length).toBeLessThan(16_000)
    // Not a "non-empty" check — `" "` would pass that. The floor is set below
    // the current size but far above any degenerate render.
    expect(SECTION_BUILDER_BLOCK_A.length).toBeGreaterThan(8_000)
  })
})

// ---------------------------------------------------------------------------
// The anti-drift pins
// ---------------------------------------------------------------------------

describe("every registry entry reaches the prompt", () => {
  it.each(SECTION_KINDS)("kind %s is described", (kind) => {
    const def = SECTION_REGISTRY[kind]
    expect(SECTION_BUILDER_BLOCK_A).toContain(`### ${kind}`)
    expect(SECTION_BUILDER_BLOCK_A).toContain(def.description)
  })

  it.each(SECTION_KINDS)("every variant of %s is offered", (kind) => {
    // A kind whose variants were dropped reads as "pick anything" and the
    // model invents one, which `z.enum` then rejects — killing the batch.
    for (const variant of SECTION_REGISTRY[kind].variants) {
      expect(SECTION_BUILDER_BLOCK_A).toContain(JSON.stringify(variant))
    }
  })

  it.each(ISLAND_NAMES)("island %s is named", (island) => {
    expect(SECTION_BUILDER_BLOCK_A).toContain(island)
  })

  it("describes every op that opSchema accepts", () => {
    // Derived from the validator, not from a list here: a seventh op added to
    // `opSchema` and forgotten in the prompt is an op the model never uses.
    const options = (opSchema as unknown as { options: Array<{ shape: Record<string, unknown> }> }).options
    const names = options.map(
      (option) => (option.shape.op as unknown as { def: { values: string[] } }).def.values[0],
    )
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(SECTION_BUILDER_BLOCK_A).toContain(`op: "${name}"`)
    }
  })

  it("names every UUID field so the no-ids rule cannot go stale", () => {
    // The single most dangerous drift in this file: a new uuid-typed field
    // that the "you never write a UUID" rule does not name is a field the
    // model will happily fabricate — and a fabricated id passes Zod, passes
    // the compiler, and renders as silent nothing (resolve.ts's opening note).
    const found = new Set<string>()
    for (const kind of SECTION_KINDS) {
      uuidFieldNames(z.toJSONSchema(SECTION_REGISTRY[kind].propsSchema, { io: "input", unrepresentable: "any" }), "", found)
    }
    expect(found.size).toBeGreaterThan(0)
    for (const field of found) {
      expect(SECTION_BUILDER_BLOCK_A).toContain(field)
    }
  })

  it("describes id and style once, which is only honest if all nine agree", () => {
    // Block A prints the `id` and `style` shapes ABOVE the per-kind list and
    // claims they are shared. `buildSectionSchema` makes that true today; this
    // is what says so if a kind ever gets its own.
    const shapes = SECTION_KINDS.map((kind) => {
      const json = z.toJSONSchema(SECTION_REGISTRY[kind].schema, {
        io: "input",
        unrepresentable: "any",
      }) as unknown as { properties: { id: unknown; style: unknown } }
      return JSON.stringify({ id: json.properties.id, style: json.properties.style })
    })
    expect(new Set(shapes).size).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// The eight rules
// ---------------------------------------------------------------------------

describe("the eight op-semantics rules", () => {
  it("there are exactly eight, and Block A renders all of them", () => {
    // Six of these come from the plan; rules 7 and 8 exist ONLY in apply.ts's
    // code comments. A prompt written from the plan alone has six, and the
    // model then emits ops that reject whole batches. The count is the pin.
    expect(BUILDER_RULES).toHaveLength(8)
    for (const rule of BUILDER_RULES) {
      expect(SECTION_BUILDER_BLOCK_A).toContain(rule)
    }
  })

  /**
   * Each entry names the concepts that rule must carry. Asserting on
   * CO-OCCURRENCE within a single rule — not on a sentence copied from the
   * implementation — is what makes these fail when a rule is dropped, merged
   * into another, or reduced to a fragment that no longer states its point.
   */
  const REQUIRED_CONCEPTS: Array<{ label: string; tokens: RegExp[] }> = [
    { label: "sequential application", tokens: [/order/i, /batch/i] },
    { label: "shallow props merge", tokens: [/props/, /shallow/i, /top-level/i] },
    { label: "arrays replace wholesale", tokens: [/items/, /plans/, /features/, /whole/i] },
    { label: "null deletes a key", tokens: [/null/, /delet/i, /undefined/] },
    { label: "after: null inserts at the top", tokens: [/after/, /null/, /top/i] },
    { label: "dark tone has no cascade rescue", tokens: [/dark/i, /muted-foreground/, /faq/i] },
    { label: "update_section needs one of three", tokens: [/update_section/, /props/, /style/, /variant/, /batch/i] },
    { label: "empty set_theme is a no-op", tokens: [/set_theme/, /empty/i] },
  ]

  it.each(REQUIRED_CONCEPTS)("some rule states: $label", ({ tokens }) => {
    const matching = BUILDER_RULES.filter((rule) => tokens.every((token) => token.test(rule)))
    expect(matching).toHaveLength(1)
  })

  it("states `after` and `null` and 'top' together in ONE sentence, not scattered", () => {
    // The brief's own worked example of a load-bearing assertion. Three
    // separate rules that each mention one of the three words would satisfy a
    // whole-prompt `toContain` and teach the model nothing.
    const sentences = BUILDER_RULES.join(" ").split(/(?<=\.)\s+/)
    const together = sentences.filter((s) => s.includes("after") && s.includes("null") && /top/i.test(s))
    expect(together.length).toBeGreaterThan(0)
  })

  it("rules 7 and 8 warn that the failure is BATCH-WIDE, not a silent no-op", () => {
    // The specific misunderstanding that costs a turn: a model told an op is
    // "ignored" will happily send it. `applyOps` rejects everything alongside
    // it (apply.ts:435-438).
    const updateRule = BUILDER_RULES.find((rule) => /update_section/.test(rule) && /variant/.test(rule))
    expect(updateRule).toBeDefined()
    expect(updateRule).toMatch(/entire batch/i)
    // And it must cover the `{}` spelling, not just the omitted-key spelling —
    // apply.ts tests for EMPTINESS, not absence (Fix round 3, NEW-1).
    expect(updateRule).toMatch(/\{\}/)
  })
})

// ---------------------------------------------------------------------------
// The worked examples
// ---------------------------------------------------------------------------

describe("worked examples are valid, not merely plausible", () => {
  it("there are two of them, and Block A shows them", () => {
    expect(WORKED_EXAMPLES).toHaveLength(2)
    for (const example of WORKED_EXAMPLES) {
      expect(SECTION_BUILDER_BLOCK_A).toContain(example.message)
    }
  })

  it.each(WORKED_EXAMPLES.map((example, index) => [index, example] as const))(
    "example %i parses against the REAL response schema",
    (_index, example) => {
      const parsed = buildResultSchema.safeParse(example.response)
      expect(parsed.success).toBe(true)
    },
  )

  it.each(WORKED_EXAMPLES.map((example, index) => [index, example] as const))(
    "example %i actually APPLIES — its ops are executable, not decorative",
    (_index, example) => {
      // The strongest available check. A worked example is a demonstration in
      // the cached prefix; if its ops would be rejected by `applyOps`, the
      // prompt is teaching the model how to fail, forever, for free.
      const result = applyOps(docWithExampleIds(), example.response.ops)
      if (!result.ok) throw new Error(`example ops rejected: ${result.errors.join("; ")}`)
      expect(result.ok).toBe(true)
    },
  )

  it("example 1 demonstrates a SURGICAL edit — untouched sections keep reference identity", () => {
    // The whole feature's guarantee, shown to the model by example. If example
    // 1 ever grows into a `set_page`, this goes red: `set_page` replaces every
    // section, so nothing would come through `===`.
    const doc = docWithExampleIds()
    const result = applyOps(doc, WORKED_EXAMPLES[0].response.ops)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.sections[1]).toBe(doc.sections[1])
    expect(result.doc.sections[2]).toBe(doc.sections[2])
    expect(result.receipt.isRewrite).toBe(false)
  })

  it("example 2 demonstrates `null` deleting an optional field", () => {
    const doc = docWithExampleIds()
    const result = applyOps(doc, WORKED_EXAMPLES[1].response.ops)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const hero = result.doc.sections.find((section) => section.id === "hero")
    expect(hero?.props).not.toHaveProperty("secondaryCta")
    // ...and `after: null` really did put pricing at the very top.
    expect(result.doc.sections[0].id).toBe("pricing")
  })
})

// ---------------------------------------------------------------------------
// Block B — the catalogue, names only
// ---------------------------------------------------------------------------

describe("Block B carries names and never ids", () => {
  it("renders every catalogue name", () => {
    const block = buildCatalogueBlock(catalogueInput())
    expect(block).toContain("Comeback Code")
    expect(block).toContain("10-Session Pack")
    expect(block).toContain("Winter Velocity Camp")
    expect(block).toContain("programs")
    expect(block).toContain("thank-you")
  })

  it.each([UUID_PROGRAM, UUID_PACK, UUID_EVENT])("does not leak the row id %s", (id) => {
    // The catalogue rows carry REAL uuids — the same `{id, name}` shape
    // `loadCatalogue()` returns — so this fails the moment anyone "helpfully"
    // renders the id alongside the name. One id in the prompt is a training
    // signal to emit ids, which is the exact failure CtaTarget exists to
    // prevent (resolve.ts, opening comment).
    expect(buildCatalogueBlock(catalogueInput())).not.toContain(id)
  })

  it("leaks no id from anywhere in the whole system prompt", () => {
    const prompt = buildSystemPrompt(catalogueInput())
    for (const id of [UUID_PROGRAM, UUID_PACK, UUID_EVENT]) {
      expect(prompt).not.toContain(id)
    }
  })

  it("says '(none)' rather than rendering an empty section for an empty list", () => {
    // An empty heading with nothing under it reads to a model as "anything
    // goes here"; "(none)" reads as "there are none", which is the truth and
    // is what should make it refuse rather than invent a name.
    const block = buildCatalogueBlock({
      catalogue: { program: [], session_pack: [], event: [] },
      faqPageKeys: [],
      stepSlugs: [],
    })
    expect(block.match(/\(none\)/g)).toHaveLength(5)
  })

  it("quotes names exactly, so a name with punctuation survives", () => {
    // `matchRef` resolves on the EXACT normalised name first; a name rendered
    // into a comma-joined list is a name the model will split on the comma.
    const block = buildCatalogueBlock({
      catalogue: {
        program: [{ id: UUID_PROGRAM, name: "Comeback Code: Phase 2, Rebuilt" }],
        session_pack: [],
        event: [],
      },
      faqPageKeys: [],
      stepSlugs: [],
    })
    expect(block).toContain('"Comeback Code: Phase 2, Rebuilt"')
  })
})

// ---------------------------------------------------------------------------
// Block C — the turn
// ---------------------------------------------------------------------------

describe("Block C sends the document, never the page", () => {
  it("includes the live document and the new message", () => {
    const doc = docWithExampleIds()
    const turn = buildTurnMessage({ doc, history: [], message: "Make the pricing single-plan." })
    expect(turn).toContain("Train like an athlete")
    expect(turn).toContain("Make the pricing single-plan.")
    expect(turn).toContain('"id": "bullets"')
  })

  it("never contains the rendered HTML for that same document", () => {
    // Not a grep for "<div". The REAL html this doc compiles to is generated
    // here and asserted absent, so a mutant that helpfully attaches
    // `reassemble(doc).html` "for context" cannot pass.
    const doc = docWithExampleIds()
    const { html, css } = reassemble(doc)
    const turn = buildTurnMessage({ doc, history: [], message: "tweak it" })
    expect(html.length).toBeGreaterThan(200)
    expect(turn).not.toContain(html)
    expect(turn).not.toContain(css)
    expect(turn).not.toContain("djp-s-hero")
    // ...nor a compiled FunnelNode tree, whose discriminator is `t`.
    expect(turn).not.toContain('"t":"el"')
    expect(turn).not.toContain('"t": "el"')
  })

  it("keeps only the last SECTION_BUILDER_HISTORY_TURNS turns of prose", () => {
    // The marker is bracketed on BOTH sides on purpose: a bare
    // `turn-marker-1` is a substring of `turn-marker-10`, so the naive
    // spelling reports the trimmed turn as still present and this test fails
    // for a reason that has nothing to do with the code under test.
    const marker = (index: number) => `<turn-marker-${index}>`
    const history = Array.from({ length: SECTION_BUILDER_HISTORY_TURNS + 4 }, (_, index) => ({
      role: index % 2 === 0 ? ("owner" as const) : ("builder" as const),
      text: marker(index),
    }))
    const turn = buildTurnMessage({ doc: docWithExampleIds(), history, message: "next" })
    // The oldest four are gone...
    for (let index = 0; index < 4; index++) {
      expect(turn).not.toContain(marker(index))
    }
    // ...and every one of the last eight survives.
    for (let index = 4; index < history.length; index++) {
      expect(turn).toContain(marker(index))
    }
  })

  it("handles the first turn, when no document exists yet", () => {
    const turn = buildTurnMessage({ doc: null, history: [], message: "Build me a page for the winter camp." })
    expect(turn).toContain("set_page")
    expect(turn).toContain("Build me a page for the winter camp.")
    expect(turn).not.toContain("null")
  })
})

// ---------------------------------------------------------------------------
// The response schema
// ---------------------------------------------------------------------------

describe("buildResultSchema", () => {
  it("uses the imported opSchema, so every op opSchema accepts is accepted here", () => {
    // The mutant: someone restates the op grammar as a second Zod schema. It
    // would drift silently the first time an op changes. Feeding a real op
    // whose shape only `opSchema` knows (`after: null`, which no naive
    // restatement models — the plan's own grammar had `after` as a required
    // string) is what catches it.
    const parsed = buildResultSchema.safeParse({
      reply: "Moved it.",
      ops: [{ op: "move_section", id: "pricing", after: null }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.blocked).toBe(false)
  })

  it("rejects an op that opSchema rejects", () => {
    const parsed = buildResultSchema.safeParse({
      reply: "ok",
      ops: [{ op: "rewrite_everything", html: "<h1>no</h1>" }],
    })
    expect(parsed.success).toBe(false)
  })

  it("caps ops at SECTION_BUILDER_MAX_OPS", () => {
    const op = { op: "remove_section" as const, id: "hero" }
    expect(buildResultSchema.safeParse({ reply: "x", ops: Array(SECTION_BUILDER_MAX_OPS).fill(op) }).success).toBe(true)
    expect(buildResultSchema.safeParse({ reply: "x", ops: Array(SECTION_BUILDER_MAX_OPS + 1).fill(op) }).success).toBe(
      false,
    )
  })

  it("caps the prose reply and rejects an empty one", () => {
    expect(buildResultSchema.safeParse({ reply: "", ops: [] }).success).toBe(false)
    expect(
      buildResultSchema.safeParse({ reply: "a".repeat(SECTION_BUILDER_MAX_REPLY_LENGTH + 1), ops: [] }).success,
    ).toBe(false)
  })

  it("converts to JSON Schema without throwing", () => {
    // What `generateObject` does internally before it can send the tool
    // definition. `formIslandSchema` reaches this schema through
    // opSchema -> sectionSchema -> formSectionPropsSchema and carries
    // `.refine()` + `.superRefine()`; the day a props schema gains something
    // genuinely unrepresentable, EVERY builder call 500s at request time. This
    // is the cheap place to find that out.
    expect(() => z.toJSONSchema(buildResultSchema, { io: "input", unrepresentable: "any" })).not.toThrow()
  })

  it("allows an empty ops batch — a purely conversational reply is legal", () => {
    // `applyOps` has a documented no-op fast path for exactly this; a `.min(1)`
    // here would make "what do you think of the headline?" impossible to answer.
    const parsed = buildResultSchema.safeParse({ reply: "The headline reads well as it is.", ops: [] })
    expect(parsed.success).toBe(true)
  })
})
