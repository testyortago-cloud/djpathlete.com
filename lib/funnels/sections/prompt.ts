// lib/funnels/sections/prompt.ts — the prompt the page-builder model sees.
//
// GENERATED FROM THE REGISTRY, NEVER HAND-WRITTEN. registry.ts's whole promise
// is that "the schemas, the renderer, the stylesheet and the prompt can never
// drift apart"; a hand-typed list of nine prop shapes would break that on the
// day someone adds a tenth kind, and nothing would go red. So every per-kind
// entry below is derived from `SECTION_REGISTRY`, the op grammar from
// `opSchema`, the interactive-element list from `ISLANDS`, and the response
// schema imports `opSchema` outright.
//
// ---------------------------------------------------------------------------
// THE THREE-BLOCK LAYOUT, AND WHY THE ORDER IS LOAD-BEARING
// ---------------------------------------------------------------------------
// `callAgent(system, user, schema, {cacheSystemPrompt: true})` puts exactly
// ONE `cache_control: {type:"ephemeral"}` breakpoint on the whole system
// string. Anthropic prompt caching is a STRICT PREFIX MATCH, so anything that
// varies invalidates everything after it:
//
//   A  frozen   role + the nine kinds + CtaTarget + style knobs + brand rules
//               + the op grammar + the eight semantics rules + 2 examples
//               -> system, cached, BUILT ONCE AT MODULE LOAD
//   B  per-page the live catalogue, NAMES ONLY, NO IDS
//               -> system, cached per page
//   C  per-turn the current SectionDoc + recent prose + the new message
//               -> user, never cached
//
// *** BLOCK A IS A MODULE-LEVEL CONST, NOT A FUNCTION. ***
// Interpolating the date, the funnel name, or a step id into it would be a
// SILENT cache invalidator: no error anywhere, every turn a full cache write
// instead of a read, forever. `SECTION_BUILDER_BLOCK_A` is computed once at
// import and is reference-identical on every read — prompt.test.ts pins that
// with `toBe`, which a `buildBlockA()` called per turn would fail while
// passing any `toEqual`.
//
// *** BLOCK B CONTAINS NO IDS. ***
// One UUID in the prompt is a training signal to emit UUIDs, which is the
// exact failure `CtaTarget` (registry.ts) and `resolveDoc` (resolve.ts) exist
// to make structurally impossible. `buildCatalogueBlock` takes the same
// `Catalogue` type resolve.ts already owns — which carries `{id, name}` — and
// renders ONLY `name`. Pinned by a test that feeds real UUIDs and asserts none
// of them survive.
//
// *** BLOCK C IS THE DOCUMENT, NOT THE PAGE. ***
// The compiled `FunnelNode` tree, previous doc versions and rendered HTML are
// never sent. The document is the context; everything else is derived from it
// on the server and would only teach the model to reason about markup it must
// never emit.

import { z } from "zod"
import { opSchema, type SectionOp } from "@/lib/funnels/sections/apply"
import {
  SECTION_KINDS,
  SECTION_LIST,
  ctaTargetSchema,
  ctaWithLabelSchema,
  sectionDocThemeSchema,
  sectionStyleSchema,
} from "@/lib/funnels/sections/registry"
import { ISLAND_LIST } from "@/lib/funnels/islands"
import { TONE_COLOUR_LEGEND } from "@/lib/funnels/sections/tone-legend"
import { PALETTE_PRESETS } from "@/lib/funnels/sections/palettes"
import type { Catalogue } from "@/lib/funnels/sections/resolve"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import {
  SECTION_BUILDER_HISTORY_TURNS,
  SECTION_BUILDER_MAX_OPS,
  SECTION_BUILDER_MAX_REPLY_LENGTH,
} from "@/lib/funnels/sections/builder-config"

// ---------------------------------------------------------------------------
// JSON Schema derivation
//
// WHICH `z.toJSONSchema` ROUTE, AND WHY (the brief flagged this as a risk
// because `formSectionPropsSchema` embeds `formIslandSchema`, which carries
// `.refine()` + `.superRefine()` from Stage 0).
//
// Probed first, before writing a line of this file: Zod 4.3.6's
// `z.toJSONSchema` does NOT throw on any of the nine props schemas, `form`
// included. Refinements are simply dropped from the emitted JSON Schema (they
// are checks, not types), and the two intersections (`faq`, `form`) come out
// as `allOf`. So route (a) — the plain call — works today.
//
// `unrepresentable: "any"` is still passed, and NOT as cargo-cult: the default
// is `"throw"`, and this module's whole output is a module-level const, so the
// day someone adds a `z.date()` / `z.bigint()` / `z.custom()` to a props
// schema, the DEFAULT behaviour would be an exception at IMPORT time — which
// takes down every route that transitively imports the builder, not just the
// prompt. Degrading that one field to `unknown` in the prompt is strictly
// better than a module that will not load.
//
// `io: "input"` is the correct direction and is not interchangeable with the
// default (`"output"`): the model is writing INPUT to these schemas, so a
// field with `.default()` (`testimonial.limit`, `form.submitLabel`,
// `form.successMode`, `funnelFormField.required`) must read as OPTIONAL. In
// output mode Zod marks those as present/required, and the prompt would tell
// the model it must supply values the schema would have filled in.
// ---------------------------------------------------------------------------

const JSON_SCHEMA_OPTIONS = { io: "input", unrepresentable: "any" } as const

function toJson(schema: z.ZodType): JsonNode {
  return z.toJSONSchema(schema, JSON_SCHEMA_OPTIONS) as JsonNode
}

/** The subset of JSON Schema draft 2020-12 that Zod 4 actually emits here. */
interface JsonNode {
  $schema?: string
  type?: string
  properties?: Record<string, JsonNode>
  required?: string[]
  items?: JsonNode
  minItems?: number
  maxItems?: number
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  enum?: unknown[]
  const?: unknown
  pattern?: string
  format?: string
  default?: unknown
  oneOf?: JsonNode[]
  anyOf?: JsonNode[]
  allOf?: JsonNode[]
}

/**
 * Order-insensitive structural fingerprint of a JSON Schema node, used to
 * recognise a subtree as one of the NAMED shapes below. `$schema` is dropped
 * so a top-level result compares equal to the same shape nested inside a
 * parent, and keys are sorted so the comparison never depends on Zod's
 * emission order.
 */
function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "$schema")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${fingerprint(child)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

/**
 * Shapes that appear at many CTA sites and are described ONCE, by name,
 * instead of being expanded inline everywhere they occur.
 *
 * This is a token decision with a correctness side-effect. Expanded inline,
 * the seven-member `CtaTarget` union costs ~1.1 KB and appears five times
 * across hero / pricing / cta / footer — ~5.5 KB of pure repetition, which is
 * most of the 11 KB of raw JSON Schema the nine kinds emit. Naming it also
 * stops the model treating each occurrence as a subtly different union.
 *
 * Recognition is by fingerprint against the registry's OWN schemas, not by a
 * hardcoded key list: if `ctaWithLabelSchema` gains a field, both the
 * definition printed below and every site that collapses to it change
 * together, because both come from the same object.
 */
const NAMED_SHAPES: ReadonlyArray<{ name: string; schema: z.ZodType }> = [
  { name: "CtaWithLabel", schema: ctaWithLabelSchema },
  { name: "CtaTarget", schema: ctaTargetSchema },
]

const ALIAS_BY_FINGERPRINT = new Map(NAMED_SHAPES.map((entry) => [fingerprint(toJson(entry.schema)), entry.name]))

// ---------------------------------------------------------------------------
// JSON Schema -> compact signature
//
// A deterministic pretty-printer over the JSON Schema ABOVE — never over Zod's
// internal `._def`, which is private and version-fragile. The input is derived
// from the registry, so this stays anti-drift; only the RENDERING is ours.
// ---------------------------------------------------------------------------

/** Beyond this, an object/union is broken across lines instead of inlined. */
const WRAP_WIDTH = 92

/** Zod emits these for a bare `z.number().int()`; they are noise, not bounds. */
const INT_NOISE_MAX = Number.MAX_SAFE_INTEGER
const INT_NOISE_MIN = -Number.MAX_SAFE_INTEGER

function lengthSuffix(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return min === max ? `(${min})` : `(${min}..${max})`
  if (max !== undefined) return `(<=${max})`
  if (min !== undefined) return `(>=${min})`
  return ""
}

function numericSuffix(node: JsonNode): string {
  const parts: string[] = []
  if (node.exclusiveMinimum !== undefined) parts.push(`>${node.exclusiveMinimum}`)
  else if (node.minimum !== undefined && node.minimum !== INT_NOISE_MIN) parts.push(`>=${node.minimum}`)
  if (node.maximum !== undefined && node.maximum !== INT_NOISE_MAX) parts.push(`<=${node.maximum}`)
  return parts.length > 0 ? `(${parts.join(" ")})` : ""
}

function describeScalar(node: JsonNode): string {
  if (node.const !== undefined) return JSON.stringify(node.const)
  if (Array.isArray(node.enum)) return node.enum.map((value) => JSON.stringify(value)).join(" | ")
  switch (node.type) {
    case "string": {
      if (node.format === "uuid") return "uuid"
      const bounds = lengthSuffix(node.minLength, node.maxLength)
      const pattern = node.pattern ? ` matching /${node.pattern}/` : ""
      return `string${bounds}${pattern}`
    }
    case "integer":
      return `int${numericSuffix(node)}`
    case "number":
      return `number${numericSuffix(node)}`
    case "boolean":
      return "boolean"
    case "null":
      return "null"
    default:
      return "unknown"
  }
}

/** Every member is a plain object, so an `allOf` is just their merged shape. */
function mergeObjects(members: JsonNode[]): JsonNode | null {
  if (members.length === 0) return null
  if (!members.every((member) => member.type === "object" && member.properties)) return null
  const properties: Record<string, JsonNode> = {}
  const required: string[] = []
  for (const member of members) {
    Object.assign(properties, member.properties)
    if (member.required) required.push(...member.required)
  }
  return { type: "object", properties, required }
}

function describeObject(node: JsonNode, indent: string): string {
  const properties = node.properties ?? {}
  const required = new Set(node.required ?? [])
  const entries = Object.entries(properties).map(
    ([key, child]) => `${key}${required.has(key) ? "" : "?"}: ${describeNode(child, `${indent}  `)}`,
  )
  if (entries.length === 0) return "{}"
  const inline = `{ ${entries.join(", ")} }`
  if (inline.length <= WRAP_WIDTH && !inline.includes("\n")) return inline
  return `{\n${indent}  ${entries.join(`,\n${indent}  `)}\n${indent}}`
}

function describeUnion(members: JsonNode[], indent: string): string {
  const rendered = members.map((member) => describeNode(member, `${indent}  `))
  const inline = rendered.join(" | ")
  if (inline.length <= WRAP_WIDTH && !inline.includes("\n")) return inline
  return `one of:\n${indent}  - ${rendered.join(`\n${indent}  - `)}`
}

/**
 * `skipAlias` exists for exactly one call site: printing the DEFINITION of a
 * named shape. Without it `CtaWithLabel = ${describeNode(ctaWithLabel)}` looks
 * itself up in the alias table and renders the tautology
 * `CtaWithLabel = CtaWithLabel`. It is suppressed for the root node only, so
 * the `target` nested inside still collapses to `CtaTarget`.
 */
function describeNode(node: JsonNode, indent: string, skipAlias = false): string {
  if (!skipAlias) {
    const alias = ALIAS_BY_FINGERPRINT.get(fingerprint(node))
    if (alias) return alias
  }

  if (node.allOf) {
    const merged = mergeObjects(node.allOf)
    if (merged) return describeObject(merged, indent)
    return node.allOf.map((member) => describeNode(member, indent)).join(`\n${indent}AND `)
  }

  if (node.anyOf) {
    // `z.string().nullable()` comes out as anyOf:[X, {type:"null"}].
    const nonNull = node.anyOf.filter((member) => member.type !== "null")
    if (nonNull.length === 1 && node.anyOf.length === 2) return `${describeNode(nonNull[0], indent)} | null`
    return describeUnion(node.anyOf, indent)
  }

  if (node.oneOf) return describeUnion(node.oneOf, indent)

  if (node.type === "object") return describeObject(node, indent)

  if (node.type === "array") {
    const item = node.items ? describeNode(node.items, indent) : "unknown"
    const count = lengthSuffix(node.minItems, node.maxItems)
    return `${item}[]${count}`
  }

  return describeScalar(node)
}

/** Renders a Zod schema as the compact signature the prompt shows. */
function signature(schema: z.ZodType, indent = "", expandRoot = false): string {
  return describeNode(toJson(schema), indent, expandRoot)
}

/**
 * Every path in a JSON Schema whose value is a UUID.
 *
 * DERIVED, not typed out, because this feeds the "you never write a UUID"
 * rule and that rule going stale is the exact failure the whole CtaTarget
 * design exists to prevent. Today this finds one field (`form.leadMagnetId`,
 * inherited from `formIslandSchema`); the day a tenth kind adds another, the
 * rule names it without anyone remembering to.
 */
function uuidPaths(node: JsonNode, path: string, out: string[]): void {
  if (node.format === "uuid") {
    out.push(path)
    return
  }
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    uuidPaths(child, path === "" ? key : `${path}.${key}`, out)
  }
  if (node.items) uuidPaths(node.items, `${path}[]`, out)
  for (const member of [...(node.oneOf ?? []), ...(node.anyOf ?? []), ...(node.allOf ?? [])]) {
    uuidPaths(member, path, out)
  }
}

/**
 * KINDS AND ISLANDS THE PAGE BUILDER IS NOT OFFERED, and why that is a design
 * decision rather than a saving.
 *
 * `quiz` is a section the model CANNOT author correctly. Its only required
 * prop is `quizId`, a uuid naming a row that already exists, which only the
 * owner can supply from the builder — and the publish gate REFUSES a page
 * whose quiz is missing, not active, or unable to score. So every quiz section
 * the model could write is a page that cannot publish, and a rejected batch
 * fails the owner's whole turn. Describing it in the prompt buys nothing and
 * spends real budget.
 *
 * AND THE BUDGET IS THE POINT. `SECTION_BUILDER_BLOCK_A` is a frozen cached
 * prefix under a size ceiling `prompt.test.ts` enforces, and at ec3acb16 it
 * measured 16,929 against 17,000 — SEVENTY-ONE characters of headroom. The
 * quiz section's own block is ~407 characters and its island line ~104. Adding
 * them silently put the block 440 over.
 *
 * Excluded HERE, in the prompt, and nowhere else: the registry, the compiler,
 * the renderer and the publish gate all still know about `quiz` in full. This
 * list only decides what the model is told it may write.
 */
export const NOT_OFFERED_TO_THE_BUILDER: ReadonlySet<string> = new Set(["quiz"])

const OFFERED_SECTIONS = SECTION_LIST.filter((def) => !NOT_OFFERED_TO_THE_BUILDER.has(def.kind))
const OFFERED_ISLANDS = ISLAND_LIST.filter((island) => !NOT_OFFERED_TO_THE_BUILDER.has(island.name))

const UUID_FIELD_PATHS: string[] = SECTION_LIST.flatMap((def) => {
  const found: string[] = []
  uuidPaths(toJson(def.propsSchema), "", found)
  return found.map((field) => `${def.kind}.props.${field}`)
})

// ---------------------------------------------------------------------------
// The nine kinds
// ---------------------------------------------------------------------------

/**
 * The `id` and `style` sub-schemas are described ONCE, above the per-kind
 * list, because `buildSectionSchema` in registry.ts gives every kind the same
 * two. `SECTION_LIST[0]` is therefore representative, not arbitrary —
 * prompt.test.ts pins that all nine agree, so this stays true or goes red.
 */
const SECTION_ENVELOPE = toJson(SECTION_LIST[0].schema)
const SECTION_ID_SIGNATURE = describeNode(SECTION_ENVELOPE.properties?.id ?? {}, "")

function kindEntry(def: (typeof SECTION_LIST)[number]): string {
  return [
    `### ${def.kind} — ${def.label}`,
    def.description,
    `variant: ${def.variants.map((variant) => JSON.stringify(variant)).join(" | ")}`,
    `props: ${signature(def.propsSchema, "")}`,
  ].join("\n")
}

const KINDS_BLOCK = OFFERED_SECTIONS.map(kindEntry).join("\n\n")

const ISLANDS_BLOCK = OFFERED_ISLANDS.map(
  (island) => `- ${island.name} (${island.label}) — ${island.description}`,
).join("\n")

// ---------------------------------------------------------------------------
// The op grammar, in English
//
// The op SHAPES are derived from `opSchema` itself: the op names come from its
// union members, and each op's field names — plus whether each is optional or
// nullable — come from asking the field schema (`safeParse(undefined)` /
// `safeParse(null)`), never from restating the grammar. A second Zod copy of
// the op grammar is exactly the class of duplication that has already shipped
// three bugs in this repo.
//
// The SEMANTICS have to be English, and English cannot be generated. So the
// gloss below is a `Record<SectionOp["op"], string>` — adding a seventh op to
// `opSchema` without writing its gloss is a COMPILE ERROR here, not a silently
// undocumented op the model will then misuse.
// ---------------------------------------------------------------------------

const OP_GLOSS: Record<SectionOp["op"], string> = {
  set_page:
    "Replace every section on the page with the array you supply (1-24 full Section objects). " +
    "Only for a first draft or an explicit 'start over' — it is a rewrite, and it is reported to the owner as one.",
  add_section:
    "Insert one new Section. `after` is the id of the section it should follow, or null to put it at the very top.",
  update_section:
    "Change one existing section in place. `props` is a SHALLOW patch, `style` is a partial of the style knobs, " +
    "`variant` replaces the variant. This is the op to reach for; prefer it over set_page every time.",
  move_section: "Reorder. Moves the section with `id` to sit after `after`, or to the very top when `after` is null.",
  remove_section: "Delete the section with `id`.",
  set_theme: "Merge a partial theme patch over the page theme. Only the keys you send change.",
}

function fieldMarks(field: z.ZodType): string {
  const optional = field.safeParse(undefined).success
  const nullable = field.safeParse(null).success
  return `${optional ? "?" : ""}${nullable ? " (may be null)" : ""}`
}

const OP_OPTIONS = (opSchema as unknown as { options: Array<{ shape: Record<string, z.ZodType> }> }).options

const OPS_BLOCK = OP_OPTIONS.map((option) => {
  const shape = option.shape
  const name = (shape.op as unknown as { def: { values: string[] } }).def.values[0] as SectionOp["op"]
  const fields = Object.keys(shape)
    .filter((key) => key !== "op")
    .map((key) => `${key}${fieldMarks(shape[key])}`)
  return `- { op: "${name}", ${fields.join(", ")} }\n  ${OP_GLOSS[name]}`
}).join("\n")

// ---------------------------------------------------------------------------
// The eight semantics rules
//
// Rules 1-6 are cross-stage obligations recorded in the SDD ledger. Rules 7
// and 8 exist ONLY in apply.ts's code comments and NOT in the plan's §4
// grammar — a prompt written from the plan alone teaches the model to emit ops
// that kill the WHOLE BATCH, because `applyOps` is transactional and one
// invalid op rejects everything alongside it.
//
// RULE 6 WAS REWRITTEN WHEN THE HAZARD IT DESCRIBED WAS FIXED. It used to
// tell the model that a dark background rescues only `.djp-hd` / `.djp-sub`
// and strands every muted line in `var(--muted-foreground)`, and to keep
// faq/pricing/testimonial/bullets/steps/footer off dark because of it. That
// was true of the stylesheet as first written; it is not true now. styles.ts's
// tone pass carries EVERY element with the tone (panels lift instead of
// switching to `--surface`, the nine muted classes become `inherit` + opacity,
// colliding shapes swap to the other brand pair) and doc.ts resolves page tone
// into each section's own tone knob, so a dark page is a dark SECTION on every
// kind rather than a `--foreground`-on-`--primary` cascade accident.
//
// The rule was not simply deleted, because a rule that forbids something
// already impossible is not harmless redundancy: it sits in a FROZEN, CACHED
// prefix that is re-read on every single turn, and it teaches the model a
// constraint the product does not have — the page builder would keep laying
// out grey-on-white pages to dodge a bug that no longer exists. So the slot
// now carries what IS true: tone is a rhythm knob, page tone is a per-section
// default, and there is exactly one residual (a `boxed` form is its own band).
// Whoever fixes or changes that residual should rewrite this rule and
// prompt.test.ts's matching REQUIRED_CONCEPTS row in the same commit — the
// test pins the CLAIM, so a stale claim fights a correct rewrite.
//
// RULE 6 WAS REWRITTEN AGAIN ON 2026-09-13 (task 10), for the same reason as
// the first rewrite: the closing sentence went stale, not wrong-in-spirit.
// "no hex or colour field exists anywhere in this document, so these four
// tones ARE the colour control" was TRUE the day it was written — verified
// against the live model, which answered a plain "a green background with
// white text" request by refusing the whole turn — and is FALSE the moment
// `theme.palette` (design-system spec §3.1) lands: there IS a colour field
// now, and telling the model there still isn't one would teach it to refuse a
// request it can satisfy. `TONE_COLOUR_LEGEND` and the "owners name tones by
// colour" framing stay, because that mapping (their words -> the tone enum)
// remains exactly as true as it ever was; only the closing claim changes, to
// say what tone controls (RHYTHM: which of the page's already-paired colours
// a section takes) versus what the palette controls (the BRAND colour itself).
// ---------------------------------------------------------------------------

/**
 * Exported so the rendering of Block A and the tests that pin these rules read
 * the SAME strings. Eight entries, in the ledger's order.
 */
export const BUILDER_RULES: readonly string[] = [
  "Ops apply in ARRAY ORDER, each one against the result of the one before it. An `add_section` whose `after` " +
    "names a section a `remove_section` deleted earlier in the same batch is rejected — and the whole batch fails " +
    "with it, because applying ops is transactional: either every op lands or none does.",

  "`update_section.props` merges SHALLOWLY, per top-level key. Keys you do not mention are kept exactly as they " +
    "are; you never resend the whole props object to change one field.",

  "Because the merge is shallow, an array-valued key (`items`, `plans`, `features`, `quotes`, `fields`, `links`, " +
    "`lines`, `steps`) is REPLACED WHOLESALE. To change one bullet, send the whole array back with that one " +
    "element edited — there is no element-level patch.",

  "A props, style, or theme key whose patch value is `null` is DELETED. That is the only way to remove an " +
    "optional field, because `undefined` does not survive JSON. Nulling a REQUIRED field fails validation and " +
    "rejects the batch.",

  "`after: null` means INSERT AT THE VERY TOP, on both `add_section` and `move_section`. It is not 'append' and " +
    "it is not an error — it is how you put something above the hero.",

  "`style.tone` is a RHYTHM knob, not a risk. Every tone carries the whole section with it — headings, subheads, " +
    "muted body copy, card and quote and plan panels, list icons, step counters and buttons all resolve to a " +
    'PAIRED colour — so `"dark"` and `"accent"` are safe on faq, pricing, testimonial, bullets, steps and ' +
    "footer exactly as they are on hero and cta. Alternate tones to mark the turns in the page instead of " +
    'avoiding them. Two consequences to know: `theme.tone: "dark"` is a DEFAULT, so every section that sets no ' +
    'tone of its own renders dark and a section you give `style.tone: "muted"` there is a LIGHT band, not a ' +
    'darker one; and a form with `variant: "boxed"` is its own band, so on a dark page its box merges with the ' +
    'page and only its narrower width still reads — use `variant: "band"`, or `style.tone: "muted"` to keep ' +
    "the box. OWNERS NAME TONES BY COLOUR, on today's default palette: " +
    TONE_COLOUR_LEGEND +
    ' — so "green with white text" means `style.tone: "dark"`, UNLESS `theme.palette` is set, in which case ' +
    '"accent"/"dark" repaint to THAT palette\'s colours instead. Tone picks WHICH paired colour a section takes, ' +
    "for rhythm; the BRAND colour itself is `theme.palette` (a named preset or a custom brand hex — see the " +
    "design vocabulary below). Never reply that you cannot change a colour.",

  "An `update_section` op MUST carry at least one of `props`, `style` or `variant`, and it must be non-empty — " +
    "`{}` counts as absent. An op with none of them is not a tolerated no-op: it REJECTS THE ENTIRE BATCH, " +
    "including every other op you sent with it.",

  "A `set_theme` whose `theme` object is empty changes nothing and reports no theme change, so never emit one. " +
    "Send only the theme keys you actually want to change.",
]

const RULES_BLOCK = BUILDER_RULES.map((rule, index) => `${index + 1}. ${rule}`).join("\n\n")

// ---------------------------------------------------------------------------
// Page craft: universal rules + named recipes (design-system spec §6.2).
//
// Everything else in Block A is generated from the registry, so it describes
// what the model MAY write. This block is the only part that says what it
// SHOULD, and it exists because the pages the builder shipped were structurally
// valid and commercially useless: the first real waitlist page put its form at
// the bottom of a four-screen scroll and filled its FAQ section with the
// site-wide FAQ, so a page selling a strength class opened its objection
// handling with "What is DJP Athlete and what services do you offer?".
//
// Neither was a bug in any module. Both were the model doing something
// reasonable that nobody had told it not to do.
//
// RE-CUT ON 2026-09-13 (task 10). Until now this was ONE skeleton
// (`LEADGEN_RULES`, six items) implicitly assuming every page is a capture
// page. Making the page SHAPE plural must not make the CONVERSION rules
// optional — each one below still exists because a real page shipped broken —
// so the ones that are genuinely shape-independent, OR ALREADY SCOPE
// THEMSELVES IN THEIR OWN TEXT, stay under the name `LEADGEN_RULES` (kept for
// `leadgen.test.ts`, which already imports it) and apply to every recipe.
// Only the truly capture-specific instruction (form goes first, `variant:
// "split"`) moves into `capture-split` below, where it belongs.
//
// "KEEP IT SHORT" stays here rather than moving with it, for a reason beyond
// spec-tidiness: its OWN wording already says "for a capture page", so it
// does not contradict `long-form-sales` wanting more sections — and, load-
// bearing, `audit-prompt-agreement.test.ts`'s "section-count" audit code
// keys on the literal phrase "Six to nine sections" appearing EXACTLY ONCE
// in `LEADGEN_RULES`. `lib/funnels/sections/review/audit.ts` (a separate,
// pre-existing subsystem, out of this task's file list) enforces that same
// bound in code with no notion of "recipe" — moving this rule out from under
// `LEADGEN_RULES` would silently decouple the auditor from the instruction
// that produced it, which is exactly the drift that test file exists to
// catch. Fixing the auditor to be recipe-aware is real future work; it is
// not this task's to do by accident. Exported so the rules, the recipes and
// the tests that pin them all read the same strings.
// ---------------------------------------------------------------------------

export const LEADGEN_RULES: readonly string[] = [
  "ONE OFFER, ONE ACTION. Every CTA on the page points at the SAME place. A page that offers a waitlist and a " +
    "consultation and a program purchase converts on none of them. If the owner asks for a second action, put it " +
    "in the footer as a link, not as a competing button.",

  'NEVER USE `faq` WITH `source: "live"` ON A CAMPAIGN PAGE. That pulls the SITE-WIDE FAQ — "What is DJP ' +
    'Athlete?", "Where are you based?" — which is written for a visitor who has never heard of the business, ' +
    'not for someone deciding about THIS offer. Write `source: "inline"` items that answer the objections to ' +
    "this specific thing: what it costs, how much time it takes, whether it suits their level, what happens if " +
    "they are injured, how to cancel. Live FAQ belongs on an evergreen page, not a campaign.",

  "PROOF GOES NEAR THE TOP. A `proof` section directly under the first screen, or a `testimonial` before the " +
    "halfway point. Social proof at the bottom is read by people who were already going to convert.",

  "KEEP IT SHORT. Six to nine sections for a capture page. Every section a visitor scrolls past without acting " +
    "is a chance to leave; length is not thoroughness. If you cannot say why a section earns its place, omit it.",

  "THE FOOTER IS NOT A SITE FOOTER. On a landing page it carries the business name, one contact line and the " +
    "legal text — nothing that invites someone to navigate away. `links` should be empty or near it.",
]

const LEADGEN_BLOCK = LEADGEN_RULES.map((rule) => `- ${rule}`).join("\n\n")

/** One named page shape: who it is for, and the section order that answers that job. */
export interface PageRecipe {
  name: string
  /** The job this shape exists for — when to pick it over the other five. */
  job: string
  /** The section spine, in order, as prose — not a literal Section[] the model must copy verbatim. */
  spine: string
}

/**
 * Six named recipes, replacing the single implicit "every page is a capture
 * page" skeleton this file used to assume. The model picks one and says which
 * (Block C asks for this on a first draft) — none of it is enforced by a
 * schema, because the section grammar has no notion of "recipe"; it is
 * guidance for a first draft, not a constraint `applyOps` checks.
 */
export const PAGE_RECIPES: readonly PageRecipe[] = [
  {
    name: "capture-split",
    job: "The default for a bare opt-in (waitlist, free guide, enquiry) that needs no persuading.",
    spine:
      '`form` FIRST, `variant: "split"` — pitch on one side, fields on the other, so someone already sold can ' +
      "act without scrolling. Headline/offer in the form's own `heading`/`sub`, plus 2-3 `proofPoints` (\"No " +
      'payment now", "Coached in person", "12 spots"). NO hero above it — two headlines in the first screen ' +
      "compete (see the length rule above).",
  },
  {
    name: "capture-hero-first",
    job:
      "Traffic that does not already know the offer and needs a screen or two of persuading before the form " +
      "feels reasonable to fill in.",
    spine:
      "hero (the pitch), proof, a short case (bullets or steps), then the form — the hero earns the form's " +
      "place instead of replacing it (see the length rule above).",
  },
  {
    name: "long-form-sales",
    job:
      "A considered purchase — a program, a coaching package — that needs the full case made before someone " + "pays.",
    spine:
      "hero, problem, proof, method (steps), pricing, objections (faq, inline), cta. Length is earned here, " +
      "not a defect: this is the one recipe where more sections is normal.",
  },
  {
    name: "event",
    job:
      "A camp, clinic or one-off event, where the date, place and price decide the click more than the pitch " +
      "does.",
    spine:
      "hero naming the date/place/price up front, bullets or steps on what is included, pricing, then a " +
      "form or cta to register.",
  },
  {
    name: "application",
    job: "High-ticket, where friction is the point: the form should qualify, not convert everyone who lands.",
    spine:
      'hero, proof, bullets on who this is for, then a form (`successMode` "message" or "redirect", never ' +
      '"checkout") asking enough to filter a fit from a browser.',
  },
  {
    name: "thank-you",
    job: "The page someone lands on right after converting.",
    spine:
      "one short cta confirming what just happened and naming the SINGLE next action (add to calendar, " +
      "join a group, watch a video) — nothing else competes with it, and it never links onward into another " +
      "capture form.",
  },
]

const RECIPES_BLOCK = PAGE_RECIPES.map(
  (recipe) => `### ${recipe.name}\nFor: ${recipe.job}\nSpine: ${recipe.spine}`,
).join("\n\n")

// ---------------------------------------------------------------------------
// Worked examples
//
// TYPED AS `BuildResult`, NOT WRITTEN AS PROSE JSON. tsc checks their shape at
// build time and prompt.test.ts re-parses each one through the REAL
// `buildResultSchema` — so a worked example that would be rejected by the very
// validator it is teaching the model to satisfy cannot ship. An invalid
// example is worse than no example: it is a demonstration, in the cached
// prefix, of how to fail.
// ---------------------------------------------------------------------------

interface WorkedExample {
  message: string
  response: BuildResult
}

export const WORKED_EXAMPLES: readonly WorkedExample[] = [
  {
    message: "Make the hero headline bigger and swap the sub for 'Eight weeks. Measurable rotational power.'",
    response: {
      reply: "Bumped the hero headline to the largest size and rewrote the subhead. Nothing else on the page changed.",
      blocked: false,
      ops: [
        {
          op: "update_section",
          id: "hero",
          style: { headline: "xl" },
          props: { sub: "Eight weeks. Measurable rotational power." },
        },
      ],
    },
  },
  {
    message: "Drop the second hero button, add a 3-step 'how it works' under the bullets, and lead with the pricing.",
    response: {
      reply:
        "Removed the secondary hero button, added a three-step section after the bullets, and moved pricing to the top of the page.",
      blocked: false,
      ops: [
        { op: "update_section", id: "hero", props: { secondaryCta: null } },
        {
          op: "add_section",
          after: "bullets",
          section: {
            id: "how",
            kind: "steps",
            variant: "numbered",
            style: { headline: "lg", align: "left" },
            props: {
              heading: "How it works",
              steps: [
                { title: "Assess", body: "A 45-minute movement and power screen." },
                { title: "Build", body: "Eight weeks of programming built from your numbers." },
                { title: "Retest", body: "Same screen, side-by-side results." },
              ],
            },
          },
        },
        { op: "move_section", id: "pricing", after: null },
      ],
    },
  },
]

const EXAMPLES_BLOCK = WORKED_EXAMPLES.map(
  (example, index) =>
    `Example ${index + 1}\nOwner: ${example.message}\nYou: ${JSON.stringify(example.response, null, 2)}`,
).join("\n\n")

// ---------------------------------------------------------------------------
// BLOCK A — frozen, built once, cached
// ---------------------------------------------------------------------------

export const SECTION_BUILDER_BLOCK_A = `
You build landing pages for a strength-and-conditioning coaching business by editing a
TYPED DOCUMENT. You never write HTML. You never write CSS. You never write a UUID.

A server-side renderer turns the document into markup from a hand-authored stylesheet — but
that stylesheet no longer makes every visual decision on its own. Your job is structure and
copy AND the page's visual direction: which sections, in what order, saying what, in what
palette, font, density, width and rhythm (see the design vocabulary below).

## The document

SectionDoc = {
  v: 1,
  engine: "sections",
  theme: ${signature(sectionDocThemeSchema, "  ")},
  sections: Section[](1..24)
}

Section = {
  id: ${SECTION_ID_SIGNATURE},
  kind: one of the ${OFFERED_SECTIONS.length} below,
  variant: constrained per kind,
  style: ${signature(sectionStyleSchema, "  ")},
  props: the kind's own shape
}

A section id is STABLE AND PERMANENT. Reuse the id the document already has whenever you
edit a section — it is how ops address it, and it is also the target of an in-page anchor
link, so renaming one breaks every link pointing at it. Pick short, meaningful ids for new
sections ("hero", "pricing", "faq"), never numbered slots.

## CTA targets — how you point at something without knowing its id

CtaWithLabel = ${signature(ctaWithLabelSchema, "", true)}

CtaTarget = ${signature(ctaTargetSchema, "", true)}

For "program", "session_pack" and "event" you write the item's NAME in \`ref\`, exactly as it
appears in the catalogue below. The server matches that name against the real rows and
substitutes the id. Write a name that is not in the catalogue and the button is reported
back to you as unresolved and the page cannot be published — so use the catalogue's own
wording, and if the owner asks for something that is not in it, say so instead of inventing
a plausible name.

"anchor" points at a section id ON THIS PAGE. "url" takes a site path ("/contact") or an
https URL. "booking" needs nothing else.

## Joining this page to the next one

The catalogue names THE NEXT PAGE. When there is one, this page leads to it: its main action
is a \`{ kind: "step", stepSlug }\` CTA with that slug, and any \`form\` gets
\`successMode: "redirect"\` plus the \`redirectUrl\` the catalogue gives, copied exactly — never
build the path yourself. A form left on the default \`"message"\` captures the lead and stops
there — the commonest way a funnel breaks. Never write the next page's content into this one,
and never invent a slug that is not listed. When it says this is the last page, it ends.

## You never write a UUID
${
  UUID_FIELD_PATHS.length > 0
    ? `Any field typed \`uuid\` must be OMITTED — today that is: ${UUID_FIELD_PATHS.join(", ")}. ` +
      `You have no way to know a real id, and a fabricated one passes validation and then silently ` +
      `does nothing on a live page, which is the worst failure this design exists to prevent.`
    : `No field in the document takes a UUID. If one ever appears, omit it.`
}

## The ${OFFERED_SECTIONS.length} section kinds

${KINDS_BLOCK}

## What the interactive parts become

Some sections and CTAs render as live components ("islands") rather than static markup —
a real checkout, a real registration form, live testimonials pulled from the database. You
do not configure these directly; they follow from the section kind and the CTA target you
choose:

${ISLANDS_BLOCK}

A \`form\` section IS the form island. A \`testimonial\` with source "live" and an \`faq\` with
source "live" pull from the database and stay current without re-editing — prefer them over
authored copies when the owner has that content already.

## The ops you emit

You do not return a document. You return a batch of OPS and the server applies them, so
sections you did not name are guaranteed to come through untouched.

${OPS_BLOCK}

## ${BUILDER_RULES.length} rules about how ops are applied

${RULES_BLOCK}

## How to build a page that converts — for EVERY recipe below

${LEADGEN_BLOCK}

## Page recipes — pick one and say which

Default to \`capture-split\` for a bare opt-in with no other signal.

${RECIPES_BLOCK}

## How to write

- Specific beats clever. Concrete numbers, real outcomes, the owner's own words where you have them.
- One idea per section. A landing page has one job; it has no navigation on purpose.
- Every page ends with a way to act — a cta, a form, or a pricing section.
- Keep copy inside the length bounds above. They are enforced; going over rejects the batch.
- Reply in plain prose, never markdown, never markup. Say what you changed and why, briefly.
- If you cannot do what was asked — the catalogue has no matching item, the request needs a
  section kind that does not exist, the page is already at 24 sections — set \`blocked: true\`,
  say plainly what is missing, and send no ops rather than approximating.

## Worked examples

${EXAMPLES_BLOCK}
`.trim()

// ---------------------------------------------------------------------------
// BLOCK DESIGN — frozen, built once, cached. Concatenated between Block A and
// Block B (design-system spec §5.3). A SEPARATE const with a SEPARATE ceiling
// test, on purpose: Block A's own ceiling exists as a tripwire against
// per-KIND duplication (someone inlining the nine props schemas as raw JSON
// Schema instead of the compact signatures — see NOT_OFFERED_TO_THE_BUILDER's
// comment for the exact number that tripwire watches for), and folding the new
// design vocabulary into that same budget would turn a specific tripwire into
// a general one that no longer catches the thing it was built to catch.
//
// EVERYTHING HERE IS PROSE OVER SHAPES BLOCK A ALREADY PRINTS. `theme` and
// `style`'s machine-readable signatures — palette/font/density/width/rhythm,
// bg/width/divider/reverse — are already in Block A's "## The document"
// section, generated from `sectionDocThemeSchema` / `sectionStyleSchema` the
// same anti-drift way as everything else there. What is missing, and what
// this block exists to say, is WHEN to reach for each one — a model that can
// see `rhythm: "flat" | "alternating" | "banded"` has no way to know that
// `"banded"` is the single highest-leverage knob for "it looks the same".
//
// PALETTE NAMES ARE DERIVED FROM `PALETTE_PRESETS`, never retyped, for the
// same reason the section kinds are derived from the registry: a thirteenth
// preset added to palettes.ts must reach the model without anyone remembering
// to edit a second list here.
// ---------------------------------------------------------------------------

const PALETTE_NAME_LIST = PALETTE_PRESETS.join(" · ")

export const SECTION_BUILDER_BLOCK_DESIGN = `
## The page's visual direction

The stylesheet no longer decides this alone. \`theme\` carries five more OPTIONAL keys beyond
tone/accent/radius, and every section's \`style\` carries four more beyond
headline/align/tone/pad — set none of them and a page renders exactly as it always has, so use
them when they earn their place, not on every turn.

\`theme.palette\` is the one that actually changes how a page looks — it IS the colour control
(rule 6 above), so a hex value belongs nowhere else in the document. Two ways to set it:
- A NAMED preset: ${PALETTE_NAME_LIST} — twelve, spanning warm/cool, light/dark and high/low
  chroma, so "warmer", "calmer" and "louder" each have an answer by name, no colour theory
  required.
- A custom brand: \`{ brand: "#rrggbb", accent?: "#rrggbb", mode?: "light" | "dark" }\` — give the
  owner's own hex and the rest (ink, surface, the complementary accent) derives to stay readable,
  so you never hand-pick seven colours yourself.
Leave \`palette\` unset for the owner's own brand colours if they have set any, else today's
green/tan — "match our other pages" means leaving it unset, never copying a preset name you have
seen used before.

\`theme.font\` — five pairings, all reusing fonts the page already loads: "clean" (Lexend
Exa/Lexend Deca — today's default, same as leaving \`font\` unset), "editorial" (serif heading,
considered pitch), "bold" (condensed, numbers-forward — pricing and event pages), "technical"
(mono headings, assessment or data feel), "athletic" (rounded headings on mono body, sporty
stat-sheet feel).

\`theme.density\` — "tight" (compact, more above the fold), "normal" (today), "airy" (generous,
upscale spacing).

\`theme.width\` — "narrow" (a focused single column), "normal" (today's width), "wide", "full"
(edge to edge).

\`theme.rhythm\` — what a section that sets NO \`style.tone\` of its own renders as, down the page:
"flat" (today — every untoned section is the default tone), "alternating" (default/muted
stripes), "banded" (default, with every third section taking the accent tone). This is the
single highest-leverage knob for "the page always looks the same", because it varies the page's
texture without you reasoning about each section individually.

## Four more per-section knobs

\`style.bg\` — a background independent of tone: \`{ kind: "gradient", from: hex, to: hex, angle? }\`
freely, between any two colours; or \`{ kind: "image", src, overlay?, position? }\` ONLY when
\`src\` is an image the owner already uploaded through the page — inventing an image URL renders
no background at all and is reported, the same rule as never writing a UUID.

\`style.width\` — overrides the page's width for exactly one section (a wide pricing table on an
otherwise narrow page).

\`style.divider\` — "none" | "line" | "angle" | "curve" | "fade": a shaped edge between this
section and the next, for a page that wants more than a flat tone change at the seam.

\`style.reverse\` — flips a two-column layout to the other side, so two media sections in a row
do not repeat the same silhouette.

## When the owner attaches a reference design

Sometimes the owner pastes an image — a screenshot, a brand board, a page they like. Read it
for the things this document can actually express, and nothing else:
- colour -> \`theme.palette\` (a preset name, or a custom \`{brand, accent, mode}\` from its hex)
- type -> \`theme.font\`; air -> \`theme.density\`; measure -> \`theme.width\`; texture down the
  page -> \`theme.rhythm\`
- what the page is SHAPED like -> which recipe, which sections, in what order

Then write what you took into \`theme.designNote\` (<=400 chars) with \`set_theme\` — one line,
plain words, e.g. "Warm sand palette, editorial serif headings, airy spacing, photo-led hero."
The image is NOT kept after this turn; that note is the only memory of it, and every later turn
reads it, so "make the headline bolder" five turns from now still respects the brief.

In \`reply\`, say BOTH halves plainly: what you matched, and what you could not. "I matched the
colours and the spacing. I couldn't match the overlapping headline — there's no way to express
that here." Never silently approximate something the vocabulary cannot say: an owner who is
told can decide what to do, an owner who is not concludes you are bad at this.

You do not copy a layout pixel for pixel and you never reuse a photograph out of the image.
`.trim()

// ---------------------------------------------------------------------------
// BLOCK B — the live catalogue, per page, NAMES ONLY
// ---------------------------------------------------------------------------

/**
 * What Block B renders.
 *
 * `catalogue` is resolve.ts's OWN `Catalogue` type, reused rather than
 * redeclared so a fourth resolvable CTA kind is a compile error here (the
 * `Record<ResolvableCtaKind, ...>` gains a key) instead of a silently
 * unadvertised target. It carries `{id, name}` per row; only `name` is ever
 * rendered.
 *
 * `stepSlugs` is NOT in the catalogue and is required anyway: `CtaTarget` has
 * a `{kind:"step", stepSlug}` member, and without the funnel's real slug list
 * the model has no choice but to invent one — the same hallucination the
 * name-not-id design closes for the other three kinds. A slug is authored
 * text, not a row id, so it does not violate the no-ids rule.
 *
 * All three fields are required rather than optional, following the reasoning
 * on resolve.ts's `CatalogueRows`: a named object whose keys must all be
 * supplied turns "I forgot to pass the events" into a compile error instead of
 * a silently short catalogue.
 */
export interface BuilderCatalogueInput {
  catalogue: Catalogue
  /** `page_key` values the faqs table actually has rows for. */
  faqPageKeys: string[]
  /**
   * Whether this business may use the platform's live FAQ list and live
   * testimonial feed (G35) — `Catalogues.liveFeedsAvailable`'s question, asked
   * by the build route for the prompt. `false` adds `LIVE_FEEDS_UNAVAILABLE`
   * to Block B.
   *
   * Required, following the reasoning above: a forgotten argument must be a
   * compile error, not a coach's builder told to prefer a feed the gate will
   * refuse.
   */
  liveFeedsAvailable: boolean
  /** Slugs of the other steps in this funnel, for `{kind:"step"}` CTAs. */
  stepSlugs: string[]
  /**
   * The slug of the page that comes AFTER this one, or `null` on the last page.
   *
   * Required, not optional, following the reasoning above: a forgotten
   * argument becomes a compile error instead of a page that silently stops
   * being told to connect itself.
   *
   * `stepSlugs` alone was not enough and the difference is the whole point. It
   * says which pages EXIST; it does not say which one this page should lead
   * to, so the model had to guess an ordering it could not see — and mostly
   * did not try, which is how a real funnel ended up with six CTAs and not one
   * link to another page.
   *
   * Stable for the life of a page, so Block B stays cacheable.
   */
  nextStepSlug: string | null
  /**
   * The funnel's REAL address slug, or `null` when the page context could not
   * be read. The model has to write `redirectUrl: "/go/<this>/<next>"` for a
   * form, and until this field existed it invented the slug from the funnel's
   * NAME — right whenever address == slugify(name), a 404 after submit the
   * first time they differ (audit 2026-09-13 §3.1). Stable for the life of a
   * page except across a rename, which only costs a prompt-cache miss.
   */
  funnelSlug: string | null
}

/**
 * Block B's line for a business that is not the platform (G35).
 *
 * Block A tells EVERY builder to prefer `source: "live"` for testimonials and
 * FAQs, and it cannot be told otherwise per business: it is frozen and cached
 * as one prefix for every page of every business. So the exception lives
 * here, in the per-page block, where the business is known.
 *
 * `faqs` and `testimonials` have no `business_id` column — every row belongs
 * to the platform, not to this business — so on any other business's page the
 * live islands show nothing and the publish gate refuses the section. Saying
 * so up front is what keeps the model from building a section the owner then
 * cannot publish.
 *
 * Written to Controller ruling R4: no platform brand literal in coach-facing
 * copy, including this prompt text the model reads.
 *
 * Exported so the tests assert the exact line rather than a paraphrase of it.
 */
export const LIVE_FEEDS_UNAVAILABLE =
  "Live FAQs and live testimonials are NOT available on this business's pages. Use inline FAQs and quoted " +
  "testimonials written for this business instead."

function nameList(names: string[]): string {
  if (names.length === 0) return "  (none)"
  // Deliberately one per line, quoted: `ref` matching is exact-normalised-name
  // first, so the model needs to see the exact string, including any internal
  // punctuation a comma-joined list would blur.
  return names.map((name) => `  - ${JSON.stringify(name)}`).join("\n")
}

/**
 * Block B. Cached with Block A (both live in the system string), so it must
 * stay stable for the life of a page: no timestamps, no counts that change per
 * turn, no ordering that depends on anything but the source rows.
 */
export function buildCatalogueBlock(input: BuilderCatalogueInput): string {
  const { catalogue, faqPageKeys, liveFeedsAvailable, stepSlugs, nextStepSlug, funnelSlug } = input
  return `
## The catalogue — the only names a CTA may reference

These are the real, live items on this site. Use these exact names in \`ref\`.

Programs ({ kind: "program", ref }):
${nameList(catalogue.program.map((row) => row.name))}

Session packs ({ kind: "session_pack", ref }):
${nameList(catalogue.session_pack.map((row) => row.name))}

Events ({ kind: "event", ref }):
${nameList(catalogue.event.map((row) => row.name))}

FAQ page keys (faq section, source "live", \`pageKey\`):
${nameList(faqPageKeys)}${
    // ONLY for a business that is not the platform, and absent (not "(none)",
    // not a "yes") for the platform, so the platform's Block B is exactly what
    // it was before G35.
    liveFeedsAvailable ? "" : `\n\n${LIVE_FEEDS_UNAVAILABLE}`
  }

Other steps in this funnel ({ kind: "step", stepSlug }):
${nameList(stepSlugs)}

The next page in the sequence:
${
  // STATED EITHER WAY, never omitted. A missing line reads to a model as a
  // field it was not given and is free to guess at; "this is the last page" is
  // an instruction, and it is the one that stops a thank-you page growing its
  // own thank-you page.
  nextStepSlug === null
    ? "  (none — this is the last page of the funnel, so it ends here)"
    : `  ${JSON.stringify(nextStepSlug)}`
}${
    // THE WHOLE PATH, NOT ITS SHAPE. Block A used to spell this out as
    // "/go/<funnel-slug>/<next-page-slug>" and leave the model to fill the first
    // half in — which it did from the funnel's NAME, since that is the only
    // funnel-level string it was ever shown. That is right exactly while
    // `slug === slugify(name)` and a 404 after submit the moment they differ
    // (audit 2026-09-13 §3.1). Rendered only here, where the real slug is, and
    // only when there is a page to redirect TO.
    nextStepSlug === null
      ? ""
      : funnelSlug === null
        ? `\n\nThe funnel's address could not be read, so do not write a redirectUrl for a form on this` +
          ` page — leave successMode "message"; the owner connects it afterwards.`
        : `\n\nAny form on this page redirects there: successMode "redirect" and redirectUrl exactly` +
          ` ${JSON.stringify(`/go/${funnelSlug}/${nextStepSlug}`)}. A form already on successMode` +
          ` "checkout" is the exception — leave it exactly as it is; Stripe returns the payer to` +
          ` the funnel's last page by itself.`
  }
`.trim()
}

/**
 * The whole system string: frozen Block A, then frozen Block DESIGN, then the
 * per-page Block B. Blocks A and DESIGN come FIRST and are never interpolated,
 * so the cache prefix they form is identical for every page and every turn —
 * Anthropic's cache is a strict prefix match, so DESIGN must sit BETWEEN A and
 * B, never after B, or every page would invalidate it.
 */
export function buildSystemPrompt(input: BuilderCatalogueInput): string {
  return `${SECTION_BUILDER_BLOCK_A}\n\n${SECTION_BUILDER_BLOCK_DESIGN}\n\n${buildCatalogueBlock(input)}`
}

// ---------------------------------------------------------------------------
// BLOCK C — per turn, in the USER message, never cached
// ---------------------------------------------------------------------------

/** One prior turn of PROSE. Never ops, never HTML, never a diff receipt. */
export interface BuilderTurn {
  role: "owner" | "builder"
  text: string
}

export interface BuilderTurnInput {
  /** The live document, or null when the page does not exist yet. */
  doc: SectionDoc | null
  /** Oldest first. Trimmed to the last `SECTION_BUILDER_HISTORY_TURNS`. */
  history: BuilderTurn[]
  /** What the owner just typed. */
  message: string
  /**
   * A per-turn nonce (design-system spec §6.3), so two owners with an
   * identical brief do not get an identical page. MUST live here, in Block C
   * (the uncached user message), and NOWHERE in Block A / DESIGN / B — those
   * three form the cached system-prompt prefix, and Anthropic's cache is a
   * strict prefix match, so a seed interpolated into any of them would be a
   * SILENT cache invalidator on every single turn. Generated per call by the
   * route (`crypto.randomUUID()`); a test value is fine here because this
   * function only renders whatever string it is given.
   */
  variationSeed: string
}

/**
 * Block C.
 *
 * THE DOCUMENT IS THE CONTEXT. The compiled `FunnelNode` tree, the rendered
 * `{html, css}` from `reassemble()`, and every previous version of the doc are
 * all deliberately absent: the model edits the document, so showing it markup
 * only invites markup back. Pinned by a test that renders the real HTML for a
 * doc and asserts none of it appears here.
 *
 * The doc is pretty-printed rather than minified. It costs perhaps a thousand
 * uncached tokens on a full 24-section page, and it buys structural accuracy on
 * exactly the thing that is expensive to get wrong: reading a nested id out of
 * the document to use as an op's `id` or `after`. One mis-targeted op rejects
 * the whole batch and costs a full retry turn, which is worth far more than
 * the whitespace.
 */
export function buildTurnMessage(input: BuilderTurnInput): string {
  const { doc, history, message, variationSeed } = input
  const recent = history.slice(-SECTION_BUILDER_HISTORY_TURNS)

  const docBlock =
    doc === null
      ? "There is no page yet. This is a first draft: reply with a single set_page op. In `reply`, also name " +
        "the design direction you chose for it — the palette, font, density and rhythm, and which page recipe " +
        "you built from — and one line of why, so the owner can read it and argue with it."
      : JSON.stringify(doc, null, 2)

  const historyBlock =
    recent.length === 0
      ? "(nothing yet)"
      : recent.map((turn) => `${turn.role === "owner" ? "Owner" : "You"}: ${turn.text}`).join("\n")

  return `## Current document

${docBlock}

## Recent conversation (oldest first)

${historyBlock}

## Variation

Turn nonce: ${variationSeed}. Two otherwise-identical briefs should not produce identical pages —
where the brief leaves room, vary wording, section order and a design choice (palette, font,
density, rhythm) you would otherwise default to the same way every time.

## The owner's new message

${message}`
}

// ---------------------------------------------------------------------------
// The response schema
//
// `opSchema` is IMPORTED, never restated. A second Zod copy of the op grammar
// would drift the day someone adds a seventh op, and nothing would catch it —
// this repo has already shipped three bugs from exactly that move (two link
// regexes that diverged, a schema copied instead of imported, and a
// hand-rolled `looksLikeUuid()` guarding an RFC-9562-strict `z.uuid()`).
// ---------------------------------------------------------------------------

export const buildResultSchema = z.object({
  /** Prose shown in chat. Never markup, never markdown. */
  reply: z.string().min(1).max(SECTION_BUILDER_MAX_REPLY_LENGTH),
  /** Set when the request cannot be carried out; `ops` should then be empty. */
  blocked: z.boolean().default(false),
  ops: z.array(opSchema).max(SECTION_BUILDER_MAX_OPS),
  /**
   * The model's own report of a `ref` it does not expect to resolve. Advisory
   * only — `resolveDoc` on the server is the authority, and `publishGate`
   * reads that, never this.
   */
  unresolved: z.array(z.object({ sectionId: z.string(), field: z.string(), ref: z.string() })).optional(),
})

export type BuildResult = z.infer<typeof buildResultSchema>

/** Every kind the prompt advertises, for callers that want to assert coverage. */
export const PROMPTED_SECTION_KINDS = SECTION_KINDS
