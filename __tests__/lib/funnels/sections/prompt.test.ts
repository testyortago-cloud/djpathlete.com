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
import { ISLAND_LIST, SAFE_LINK } from "@/lib/funnels/islands"
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
    nextStepSlug: "thank-you",
  }
}

/**
 * Every DOTTED PATH in a props schema whose value is a UUID, in the
 * `<field>` / `<field>.<sub>` / `<field>[].<sub>` form the prompt renders
 * under `<kind>.props.`.
 *
 * Fix round 1, M1: the first spelling of this collected bare field NAMES, and
 * `leadMagnetId` on its own is ALSO printed by the per-kind props signature
 * (`leadMagnetId?: uuid | null`). So the whole `## You never write a UUID`
 * section could be deleted and the assertion stayed green — the exact
 * "test that cannot fail" this file's header claims to have avoided. The
 * dotted path is rendered nowhere but that section.
 */
function uuidFieldPaths(node: unknown, path: string, out: string[]): void {
  if (node === null || typeof node !== "object") return
  const record = node as Record<string, unknown>
  if (record.format === "uuid") {
    out.push(path)
    return
  }
  const properties = record.properties as Record<string, unknown> | undefined
  if (properties) {
    for (const [key, child] of Object.entries(properties)) {
      uuidFieldPaths(child, path === "" ? key : `${path}.${key}`, out)
    }
  }
  if (record.items) uuidFieldPaths(record.items, `${path}[]`, out)
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    const members = record[key]
    if (Array.isArray(members)) for (const member of members) uuidFieldPaths(member, path, out)
  }
}

/** Every `<kind>.props.<path>` in the registry that takes a UUID. */
function uuidPathsAcrossRegistry(): string[] {
  return SECTION_KINDS.flatMap((kind) => {
    const found: string[] = []
    uuidFieldPaths(
      z.toJSONSchema(SECTION_REGISTRY[kind].propsSchema, { io: "input", unrepresentable: "any" }),
      "",
      found,
    )
    return found.map((field) => `${kind}.props.${field}`)
  })
}

/** Every four-digit 19xx/20xx number in `text`, as numbers. */
function yearsIn(text: string): number[] {
  return [...text.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]))
}

/**
 * The slice of Block A under one `## ` heading, up to the next `## `.
 *
 * Fix round 1, M3/M1: a `toContain` against the WHOLE of Block A is satisfied
 * by any accidental occurrence elsewhere in a 12 KB string — which is how the
 * island pin survived deleting the island block and the UUID pin survived
 * deleting the UUID rule. Scoping to the section makes the deletion mutant the
 * thing the assertion actually tests. Returns "" when the heading is gone, so
 * every assertion downstream fails rather than being skipped.
 */
function blockASection(heading: string): string {
  const start = SECTION_BUILDER_BLOCK_A.indexOf(`## ${heading}`)
  if (start === -1) return ""
  const rest = SECTION_BUILDER_BLOCK_A.slice(start + heading.length + 3)
  const end = rest.indexOf("\n## ")
  return end === -1 ? rest : rest.slice(0, end)
}

/** The slice of Block A describing ONE kind, `### <kind>` to the next heading. */
function blockAKindEntry(kind: string): string {
  const start = SECTION_BUILDER_BLOCK_A.search(new RegExp(`^### ${kind}\\b`, "m"))
  if (start === -1) return ""
  const rest = SECTION_BUILDER_BLOCK_A.slice(start + kind.length + 4)
  const end = rest.search(/^#{2,3} /m)
  return end === -1 ? rest : rest.slice(0, end)
}

/**
 * Every regex Block A prints as `matching /.../`. The body allows `\/`, so a
 * pattern containing escaped slashes (which every link pattern does) is
 * captured whole instead of being cut at its first inner slash.
 */
function printedPatterns(): string[] {
  return [...SECTION_BUILDER_BLOCK_A.matchAll(/matching \/((?:[^/\\]|\\.)*)\//g)].map((match) => match[1])
}

/**
 * The op names `opSchema` accepts, derived through JSON Schema emission.
 *
 * Fix round 1, M2: prompt.ts extracts these with a private-internals cast
 * (`shape.op.def.values[0]`). The first spelling of this test used the SAME
 * cast, so the day that internal moves BOTH go `undefined` together: the
 * prompt renders `- { op: "undefined", ... }` and the test asserts that string
 * is present. Green suite, corrupted cached prefix. This route shares nothing
 * with the module's.
 */
function opNamesViaJsonSchema(): string[] {
  const json = z.toJSONSchema(opSchema, { io: "input", unrepresentable: "any" }) as {
    anyOf?: Array<Record<string, unknown>>
    oneOf?: Array<Record<string, unknown>>
  }
  const members = json.anyOf ?? json.oneOf ?? []
  return members.map((member) => {
    const op = (member.properties as Record<string, { const?: unknown; enum?: unknown[] }> | undefined)?.op
    if (typeof op?.const === "string") return op.const
    if (Array.isArray(op?.enum) && typeof op.enum[0] === "string") return op.enum[0]
    return ""
  })
}

/**
 * Checked AGAINST `opSchema` below, never trusted on its own. A literal list
 * is the point: it is the one expectation in this file that does not travel
 * through any of the module's own machinery, so a seventh op has to be typed
 * here, glossed in `OP_GLOSS`, and printed in Block A before the suite is
 * green again.
 */
const EXPECTED_OP_NAMES = [
  "set_page",
  "add_section",
  "update_section",
  "move_section",
  "remove_section",
  "set_theme",
] as const

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
      nextStepSlug: null,
    })
    expect(pageOne.startsWith(SECTION_BUILDER_BLOCK_A)).toBe(true)
    expect(pageTwo.startsWith(SECTION_BUILDER_BLOCK_A)).toBe(true)
    // ...and the two prompts genuinely differ AFTER the shared prefix, so the
    // assertion above is not passing because both pages render the same thing.
    expect(pageOne).not.toBe(pageTwo)
  })

  it("interpolates nothing that changes between PROCESSES, not just between turns", () => {
    // Fix round 1, L2: the two pins above both survive a
    // `${new Date().toISOString()}` interpolated INSIDE the module-level
    // template literal. It is evaluated once at import, so Block A is still
    // one object per process and still a byte-identical prefix of every prompt
    // that process builds — the cache miss is per COLD START, which no
    // in-process assertion can see. Every serverless instance would then write
    // the whole 12 KB prefix instead of reading it, silently, forever.
    //
    // Funnel names and step ids are already impossible here (they are not in
    // scope inside the const), so date-shaped and random-shaped text is the
    // whole remaining exposure.
    expect(SECTION_BUILDER_BLOCK_A).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/) // ISO timestamp
    expect(SECTION_BUILDER_BLOCK_A).not.toMatch(/\b\d{10,}\b/) // epoch ms, Math.random digits

    // Cleanup batch: the year guard used to be a bare
    // `not.toMatch(/\b(19|20)\d{2}\b/)`, which false-positives on any numeric
    // BOUND that lands in 1900-2099 — Block A renders `z.string().max(2000)`
    // as `string(<=2000)`, so the assertion was really "no schema in this
    // registry may have a four-digit bound", which is not the property and
    // would have gone red for a reason unrelated to caching.
    //
    // The mutant is a year interpolated AT MODULE LOAD, and such a year is
    // always the year the process runs in. Deriving the forbidden values from
    // the clock makes the guard exact instead of approximate, and it stays
    // correct as time passes. +/- 1 covers a run straddling New Year.
    const thisYear = new Date().getUTCFullYear()
    const years = yearsIn(SECTION_BUILDER_BLOCK_A)
    for (const year of [thisYear - 1, thisYear, thisYear + 1]) {
      expect(years, `Block A contains ${year}, which changes between processes`).not.toContain(year)
    }
    // ...and the scan itself discriminates, so a future "simplification" that
    // makes it unable to fail is visible right here rather than in six months.
    expect(yearsIn(`Prompt generated ${thisYear}.`)).toContain(thisYear)
    expect(yearsIn("reply: string(<=2000), href: string(<=300)")).not.toContain(thisYear)
  })

  it("stays under the size ceiling the token budget assumes", () => {
    // ~4 characters per token for English prose, so 17000 characters is
    // roughly 4250 tokens. The design budgets Block A at ~3000 tokens; it
    // measures ~4050 today. The ceiling is deliberately close, not generous:
    // Block A is written into the cache on the first turn of every page, and
    // the thing that would silently blow it up is someone inlining the nine
    // props schemas as raw JSON Schema (11119 characters on its own) instead
    // of the compact signatures. This goes red long before that reaches prod.
    //
    // RAISED FROM 16000 on 2026-08-17, by 138 characters of real content: the
    // form field's `role` enum (rendered ONCE, in the field signature) and
    // `eventId` (rendered twice — the signature, and the UUID_FIELD_PATHS list
    // that tells the model to omit it). Both were measured before raising this,
    // because the failure mode this test exists to catch is duplication across
    // the nine kinds, and an enum rendered nine times would have been a reason
    // to compact the content instead of moving the line. The tripwire is intact:
    // an inlined 11119-character JSON Schema still blows straight past 17000.
    expect(SECTION_BUILDER_BLOCK_A.length).toBeLessThan(17_000)
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

  it.each(SECTION_KINDS)("every variant of %s is offered UNDER THAT KIND'S OWN ENTRY", (kind) => {
    // A kind whose variants were dropped reads as "pick anything" and the
    // model invents one, which `z.enum` then rejects — killing the batch.
    //
    // Fix round 1, L1: this used to search the whole of Block A, and variant
    // names are shared across kinds — `faq`'s only variant is `"stack"`, which
    // is also `testimonial`'s, so deleting faq's entire `variant:` line stayed
    // green. Scoped to the `### <kind>` slice, each kind stands alone.
    const entry = blockAKindEntry(kind)
    expect(entry).not.toBe("")
    for (const variant of SECTION_REGISTRY[kind].variants) {
      expect(entry).toContain(JSON.stringify(variant))
    }
  })

  it.each(ISLAND_LIST.map((island) => [island.name, island] as const))(
    "island %s is named IN the islands block",
    (_name, island) => {
      // Fix round 1, M3: the first spelling was `toContain(name)` over the
      // whole of Block A, and all six names already occur outside
      // `ISLANDS_BLOCK` — `checkout` and `testimonials` in the paragraph above
      // it ("a real checkout, ... live testimonials pulled from the
      // database"), the rest throughout the kinds and CTA sections. Deleting
      // `ISLANDS_BLOCK` outright left the suite green. The intro prose lives
      // inside this same `##` section, so scoping alone is not enough: the
      // list-item form and the island's own description are what exist
      // nowhere else. The drift mutant (a seventh island) still fails too.
      const section = blockASection("What the interactive parts become")
      expect(section).not.toBe("")
      expect(section).toContain(`- ${island.name} (`)
      expect(section).toContain(island.description)
    },
  )

  it("describes every op that opSchema accepts, and no phantom op", () => {
    // Derived from the validator, not from a list here: a seventh op added to
    // `opSchema` and forgotten in the prompt is an op the model never uses.
    //
    // Fix round 1, M2: `opNamesViaJsonSchema()` does NOT share the module's
    // `.def.values[0]` private-internals cast, so the two can no longer fail
    // in lockstep into `op: "undefined"`.
    const names = opNamesViaJsonSchema()
    expect(names.every((name) => typeof name === "string" && name.length > 0)).toBe(true)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual([...EXPECTED_OP_NAMES].sort())
    for (const name of names) {
      expect(SECTION_BUILDER_BLOCK_A).toContain(`op: "${name}"`)
    }
    // The corruption itself, named: this is the literal string Block A renders
    // when the module's extraction cast stops resolving.
    expect(SECTION_BUILDER_BLOCK_A).not.toContain('op: "undefined"')
  })

  it("names every UUID field IN the no-ids rule, so that rule cannot go stale", () => {
    // The single most dangerous drift in this file: a new uuid-typed field
    // that the "you never write a UUID" rule does not name is a field the
    // model will happily fabricate — and a fabricated id passes Zod, passes
    // the compiler, and renders as silent nothing (resolve.ts's opening note).
    //
    // Fix round 1, M1: everything here is asserted against the SECTION SLICE
    // and against the `<kind>.props.<field>` path form. The previous spelling
    // asserted the bare field name against all of Block A, which the per-kind
    // props signature already prints — so deleting the whole rule was green.
    const section = blockASection("You never write a UUID")
    expect(section).not.toBe("")
    const paths = uuidPathsAcrossRegistry()
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      expect(section).toContain(path)
    }
    // ...and the rule says what to DO with such a field. A section that named
    // the paths without an instruction would teach the model nothing.
    expect(section).toMatch(/OMITTED|omit/)
  })

  it("prints ONE link rule, and it is SAFE_LINK's", () => {
    // Fix round 1, H1. `registry.ts` used to restate `ctaTargetSchema.href`'s
    // rule as `/^(\/|https:\/\/)/`, which accepts the protocol-relative
    // `//evil.example`. Because this prompt is GENERATED from those schemas,
    // Block A printed that weak pattern for `CtaTarget` and `SAFE_LINK`'s
    // strong one for `form.props.redirectUrl` thirty lines apart: two
    // contradictory link rules inside one frozen, cached prefix, paid on every
    // page forever. `renderCtaTarget` then degrades the href the prompt
    // endorsed into a disabled placeholder with `ok:true, warnings:[]`.
    //
    // Pinned as EQUALITY with `SAFE_LINK.source`, not as "contains the
    // lookahead": divergence in either direction is the bug.
    const linkPatterns = printedPatterns().filter((pattern) => pattern.includes("https"))
    expect(linkPatterns.length).toBeGreaterThanOrEqual(2)
    for (const pattern of linkPatterns) {
      expect(pattern).toBe(SAFE_LINK.source)
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
    // REWRITTEN WITH RULE 6 ITSELF. The old row pinned the OPPOSITE claim —
    // "dark strands `var(--muted-foreground)`, keep faq/pricing/testimonial off
    // it" — which was true of the stylesheet as first written and false the
    // moment styles.ts's tone pass landed. A concepts row is a claim about the
    // product, so a stale one does not just go quiet: it fails the correct
    // rewrite and pressures whoever hits it into restoring the false rule.
    // These five tokens are what rule 6 now has to keep saying: tone is safe
    // and PAIRED, it is safe specifically on the text-heavy kinds the old rule
    // banned, `theme.tone` is a per-section default, and the boxed-form
    // residual is named rather than left for someone to rediscover.
    {
      label: "tone is a paired, safe rhythm knob; page tone is a section default",
      tokens: [/tone/i, /paired/i, /faq/i, /theme\.tone/, /boxed/i],
    },
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
    // `loadCatalogues().offer` returns — so this fails the moment anyone "helpfully"
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
      nextStepSlug: null,
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
      nextStepSlug: null,
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

// ---------------------------------------------------------------------------
// The next page — the field that turns a list of pages into a sequence.
//
// `stepSlugs` already said which pages EXIST. It never said which one this
// page should lead to, so the model had to infer an ordering it could not see
// and mostly did not try: a probe of a real funnel found six CTAs and not one
// link to another page.
// ---------------------------------------------------------------------------
describe("the next page", () => {
  const withNext = (nextStepSlug: string | null) =>
    buildCatalogueBlock({
      catalogue: { program: [], session_pack: [], event: [] },
      faqPageKeys: [],
      stepSlugs: ["thank-you"],
      nextStepSlug,
    })

  it("names the next page in the catalogue block", () => {
    expect(withNext("thank-you")).toMatch(/next page[\s\S]*"thank-you"/i)
  })

  it("SAYS it is the last page rather than omitting the line", () => {
    // MUTANT TO KILL: rendering nothing when `nextStepSlug` is null. An absent
    // heading reads to a model as a field it was not given and is free to
    // guess at — which is how a thank-you page grows its own thank-you page.
    // "(none)" reads as an instruction. Same reasoning the catalogue's own
    // empty-list rendering already records.
    const block = withNext(null)
    expect(block).toMatch(/next page/i)
    expect(block).toMatch(/last page/i)
  })

  it("Block A tells the model to lead to the next page, and how", () => {
    // The three things that were missing, checked as three things. The form
    // half is the one that matters: `successMode` defaults to "message", so a
    // page whose form is left alone captures the lead and stops.
    expect(SECTION_BUILDER_BLOCK_A).toMatch(/next page/i)
    expect(SECTION_BUILDER_BLOCK_A).toContain('successMode: "redirect"')
    expect(SECTION_BUILDER_BLOCK_A).toMatch(/kind": "step"|kind: "step"/)
  })

  it("Block A still forbids inventing a page slug", () => {
    expect(SECTION_BUILDER_BLOCK_A).toMatch(/never invent a slug/i)
  })

  it("the next page does not change Block A, so the cache prefix is stable", () => {
    // Block A and Block B share the system string, and Block A is the cached
    // prefix. A per-page value leaking into it would cost a cache miss on
    // every page of every funnel.
    expect(buildSystemPrompt({ ...catalogueInput(), nextStepSlug: "a" }).startsWith(SECTION_BUILDER_BLOCK_A)).toBe(true)
    expect(buildSystemPrompt({ ...catalogueInput(), nextStepSlug: "b" }).startsWith(SECTION_BUILDER_BLOCK_A)).toBe(true)
  })
})
