// lib/funnels/sections/fields.ts — what the inspector may edit, ASKED OF THE
// SCHEMA rather than written down beside it.
//
// ---------------------------------------------------------------------------
// WHY THIS IS INTROSPECTION AND NOT A TABLE
// ---------------------------------------------------------------------------
// The obvious implementation is a `Record<SectionKind, FieldSpec[]>`, in the
// shape `ISLAND_TRAITS` already uses for islands. It is shorter, it is easier
// to read, and it is the mistake this repo has now paid for three times:
// restating a rule instead of asking the thing that owns it.
//
// It fails silently, which is what makes it expensive. Widen `bulletItemSchema`
// with a new field and the table keeps offering yesterday's list — the new prop
// is uneditable forever, no error, no failing test, nothing anywhere saying so.
// The AI can write it (it walks the schema), the renderer can render it, and
// the one surface the owner uses to change it cannot see it.
//
// So the fields are DERIVED from the same `propsSchema` that validates a save.
// `fields.test.ts` pins both directions: every prop key a section holds is
// reachable, and every text field the inspector offers is one `applyOps` will
// actually accept.
//
// ---------------------------------------------------------------------------
// IT TAKES THE SECTION, NOT JUST THE KIND, AND THAT IS NOT AN ACCIDENT
// ---------------------------------------------------------------------------
// `testimonial` and `faq` are discriminated unions. Which fields apply depends
// on the CURRENT value of the discriminant: a `source: "live"` testimonial has
// no `quotes` to edit, and offering them would invite the owner to write a prop
// its own branch forbids. There is no correct answer derivable from the kind
// alone.
//
// Zod internals are read through `defOf` below, in one place, because they are
// version-specific (this is Zod 4.3's `_zod.def`). If a Zod upgrade moves them,
// exactly one function needs to change and the whole suite says so loudly.

import type { z } from "zod"
import { SAFE_LINK } from "@/lib/funnels/islands"
import {
  SECTION_REGISTRY,
  ctaWithLabelSchema,
  sectionStyleSchema,
  type Section,
} from "@/lib/funnels/sections/registry"

// ---------------------------------------------------------------------------
// The shape the inspector renders
// ---------------------------------------------------------------------------

export type SectionFieldType =
  | "text"
  | "textarea"
  | "number"
  | "checkbox"
  | "select"
  | "cta"
  /** A string the schema constrains to a site path or an https URL. */
  | "url"
  /** An array of plain strings — footer lines, plan features, proof points. */
  | "list"
  /** An array of objects — bullets, steps, quotes, plans, FAQ pairs. */
  | "repeater"

export interface SectionField {
  /** Dot path RELATIVE to the section's props, matching `data-edit`. */
  path: string
  label: string
  type: SectionFieldType
  optional: boolean
  /** `select` only. */
  options?: { id: string; label: string }[]
  /** `list` / `repeater` only — the bounds the schema declares. */
  min?: number
  max?: number
  /** `text` / `textarea` / `list` items — what the schema will accept. */
  maxLength?: number
  /**
   * A format the schema enforces beyond length, as a regex source.
   *
   * Not decoration: `formKey` is `/^[a-z0-9][a-z0-9-]{0,39}$/`, so an inspector
   * that presented it as free text would invite the owner to type "My form" and
   * then refuse the save on a rule they were never shown. Found by the field
   * test, which tried to write ordinary prose into every text field and was
   * refused by exactly this one.
   */
  pattern?: string
  /** `repeater` only: one item's own fields, with paths relative to the item. */
  item?: SectionField[]
}

/** Above this, a string gets a textarea. Below, a single-line input. */
const TEXTAREA_MIN_LENGTH = 200

// ---------------------------------------------------------------------------
// Zod internals, read in ONE place
// ---------------------------------------------------------------------------

interface ZodDef {
  type: string
  innerType?: unknown
  element?: unknown
  shape?: Record<string, unknown>
  left?: unknown
  right?: unknown
  options?: unknown[]
  discriminator?: string
  entries?: Record<string, string>
  values?: unknown[]
  checks?: unknown[]
}

function defOf(schema: unknown): ZodDef | null {
  if (schema === null || typeof schema !== "object") return null
  const withInternals = schema as { _zod?: { def?: ZodDef }; def?: ZodDef; _def?: ZodDef }
  return withInternals._zod?.def ?? withInternals.def ?? withInternals._def ?? null
}

/** `{ check: "max_length", maximum: 120 }` and friends, flattened. */
function checkValues(def: ZodDef): { min?: number; max?: number; pattern?: string } {
  const out: { min?: number; max?: number; pattern?: string } = {}
  for (const raw of def.checks ?? []) {
    const checkDef = defOf(raw) as
      | { check?: string; minimum?: number; maximum?: number; pattern?: RegExp }
      | null
    if (!checkDef) continue
    if (typeof checkDef.minimum === "number") out.min = checkDef.minimum
    if (typeof checkDef.maximum === "number") out.max = checkDef.maximum
    if (checkDef.pattern instanceof RegExp) out.pattern = checkDef.pattern.source
  }
  return out
}

/** Strips `optional` / `default` / `nullable` wrappers, reporting what it found. */
function unwrap(schema: unknown): { schema: unknown; optional: boolean } {
  let current = schema
  let optional = false
  for (let guard = 0; guard < 10; guard++) {
    const def = defOf(current)
    if (!def) break
    if (def.type === "optional" || def.type === "default" || def.type === "nullable") {
      optional = true
      current = def.innerType
      continue
    }
    break
  }
  return { schema: current, optional }
}

// ---------------------------------------------------------------------------
// Labels
//
// Derived by humanising the key, with an override map for the handful that
// read badly. Labels are presentation, not validation, so a table is the right
// tool here — the thing that must not be restated is what the schema ACCEPTS.
// ---------------------------------------------------------------------------

const LABEL_OVERRIDES: Record<string, string> = {
  q: "Question",
  a: "Answer",
  sub: "Subheading",
  cta: "Button",
  primaryCta: "Primary CTA",
  secondaryCta: "Secondary CTA",
  formKey: "Form key",
  submitLabel: "Button label",
  successMode: "After submit",
  successMessage: "Success message",
  redirectUrl: "Redirect URL",
  consentText: "Consent text",
  proofPoints: "Reassurance lines",
  featuredOnly: "Featured only",
  pageKey: "FAQ page",
  businessName: "Business name",
  blurb: "Description",
  legal: "Legal line",
  source: "Content source",
}

function labelFor(key: string): string {
  const override = LABEL_OVERRIDES[key]
  if (override) return override
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function optionLabel(value: string): string {
  const spaced = value.replace(/[-_]/g, " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

function scalarField(
  path: string,
  def: ZodDef,
  optional: boolean,
): SectionField | null {
  const bounds = checkValues(def)

  if (def.type === "string") {
    // A link field is recognised by IDENTITY against the exported rule, never
    // by a shape heuristic over the pattern. This repo has shipped three bugs
    // from divergent link regexes; a fourth spelling of "looks like a URL"
    // living in the inspector is exactly how the fourth one gets written.
    const isLink = bounds.pattern !== undefined && bounds.pattern === SAFE_LINK.source
    return {
      path,
      label: labelFor(lastSegment(path)),
      type: isLink ? "url" : (bounds.max ?? 0) >= TEXTAREA_MIN_LENGTH ? "textarea" : "text",
      optional,
      maxLength: bounds.max,
      pattern: bounds.pattern,
    }
  }
  if (def.type === "number") {
    return { path, label: labelFor(lastSegment(path)), type: "number", optional, min: bounds.min, max: bounds.max }
  }
  if (def.type === "boolean") {
    return { path, label: labelFor(lastSegment(path)), type: "checkbox", optional }
  }
  if (def.type === "enum") {
    const values = Object.values(def.entries ?? {})
    return {
      path,
      label: labelFor(lastSegment(path)),
      type: "select",
      optional,
      options: values.map((value) => ({ id: value, label: optionLabel(value) })),
    }
  }
  return null
}

function lastSegment(path: string): string {
  const parts = path.split(".")
  return parts[parts.length - 1]
}

/**
 * Fields for `schema` at `path`, against `value` (needed only to pick a
 * discriminated union's branch).
 *
 * NEVER THROWS. The inspector opens on whatever is stored, including documents
 * written by an older build; refusing to render any fields because one branch
 * is unrecognised would be a worse answer than rendering the rest.
 */
function walk(schema: unknown, path: string, value: unknown): SectionField[] {
  const { schema: inner, optional } = unwrap(schema)

  // A CTA is one field, not a union to walk into. `CtaTarget`'s validity is not
  // local — a `{kind:"program", ref}` only publishes if the name resolves to
  // exactly one row — so it gets a purpose-built editor that can say so.
  // Compared by IDENTITY against the schema the registry exports, so a second
  // CTA-shaped schema could never be silently picked up by a shape heuristic.
  if (inner === ctaWithLabelSchema) {
    return [{ path, label: labelFor(lastSegment(path)), type: "cta", optional }]
  }

  const def = defOf(inner)
  if (!def) return []

  const scalar = scalarField(path, def, optional)
  if (scalar) return [scalar]

  if (def.type === "object") {
    const shape = def.shape ?? {}
    const record = (value ?? {}) as Record<string, unknown>
    return Object.entries(shape).flatMap(([key, child]) =>
      walk(child, path ? `${path}.${key}` : key, record[key]),
    )
  }

  if (def.type === "intersection") {
    // `form` and `faq` are each an options object intersected with a shared
    // schema. Both halves describe the same value, so both halves' fields
    // apply.
    return [...walk(def.left, path, value), ...walk(def.right, path, value)]
  }

  if (def.type === "union") {
    return unionFields(def, path, value)
  }

  if (def.type === "array") {
    const bounds = checkValues(def)
    const { schema: element } = unwrap(def.element)
    const elementDef = defOf(element)

    if (elementDef?.type === "object") {
      return [
        {
          path,
          label: labelFor(lastSegment(path)),
          type: "repeater",
          optional,
          min: bounds.min,
          max: bounds.max,
          // Paths RELATIVE to one item. The inspector composes
          // `${path}.${index}.${item.path}`, which is exactly the shape
          // `data-edit` uses, so a click on the page and a row in the panel
          // address the same thing.
          item: walk(element, "", undefined),
        },
      ]
    }

    const elementBounds = elementDef ? checkValues(elementDef) : {}
    return [
      {
        path,
        label: labelFor(lastSegment(path)),
        type: "list",
        optional,
        min: bounds.min,
        max: bounds.max,
        maxLength: elementBounds.max,
      },
    ]
  }

  // `literal` reaches here and is deliberately dropped: the only literals in
  // these schemas are union discriminants, and `unionFields` has already
  // emitted a select for the one that matters. Rendering it again as a
  // read-only box would be a second control for the same decision.
  return []
}

/**
 * A discriminated union contributes TWO things: a select that switches branch,
 * and the fields of whichever branch is currently in force.
 */
function unionFields(def: ZodDef, path: string, value: unknown): SectionField[] {
  const options = def.options ?? []
  const discriminator = def.discriminator
  if (!discriminator) return []

  const branchValues: string[] = []
  let active: unknown = null

  const currentValue = ((value ?? {}) as Record<string, unknown>)[discriminator]

  for (const option of options) {
    const optionDef = defOf(option)
    const literal = defOf(optionDef?.shape?.[discriminator])?.values?.[0]
    if (typeof literal !== "string") continue
    branchValues.push(literal)
    if (literal === currentValue) active = option
  }

  // No stored discriminant (a document from before this branch existed, or an
  // unrecognised value) falls back to the first branch rather than rendering
  // nothing — the select is still there to move off it.
  if (active === null) active = options[0] ?? null

  const selectPath = path ? `${path}.${discriminator}` : discriminator
  const select: SectionField = {
    path: selectPath,
    label: labelFor(discriminator),
    type: "select",
    optional: false,
    options: branchValues.map((id) => ({ id, label: optionLabel(id) })),
  }

  const activeDef = defOf(active)
  const branchFields = Object.entries(activeDef?.shape ?? {})
    // The discriminant itself is the select above, not a field of its own.
    .filter(([key]) => key !== discriminator)
    .flatMap(([key, child]) =>
      walk(child, path ? `${path}.${key}` : key, ((value ?? {}) as Record<string, unknown>)[key]),
    )

  return [select, ...branchFields]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Every prop of `section` the inspector may edit, in schema order.
 *
 * Paths are relative to `section.props` and match the `data-edit` anchors
 * `render.ts` stamps, so selecting on the page and selecting in the panel are
 * the same address.
 */
export function fieldsForSection(section: Section): SectionField[] {
  const def = SECTION_REGISTRY[section.kind]
  if (!def) return []
  return walk(def.propsSchema, "", section.props)
}

/**
 * The four shared style knobs, as fields.
 *
 * Read from `sectionStyleSchema` for the same reason the props are: the
 * renderer resolves these into `data-h` / `data-align` / `data-tone` /
 * `data-pad`, and an inspector offering a fifth value for one of them would
 * produce a section that validates and renders at its default.
 */
export function styleFields(): SectionField[] {
  return walk(sectionStyleSchema, "", {})
}

// ---------------------------------------------------------------------------
// Blank values, for growing a list
// ---------------------------------------------------------------------------

/**
 * A value for `field` that its own schema will accept.
 *
 * Adding a bullet needs something to add, and "something" is schema-specific:
 * `bulletItemSchema.title` is `min(1)`, so an empty object or `{title: ""}` is
 * refused — the owner would click Add and be told a field they never saw is
 * invalid. Every required leaf therefore gets a placeholder value, and
 * `fields.test.ts` proves the result parses for every repeater of every kind
 * by running the real `applyOps` over it.
 *
 * Optional fields are OMITTED rather than blanked. An optional string set to
 * "" is not the same as unset: `render.ts` renders the empty element instead of
 * the placeholder, so the new row would come back with a dead space in it.
 */
export function blankValueFor(field: SectionField): unknown {
  switch (field.type) {
    case "checkbox":
      return false
    case "number":
      return field.min ?? 1
    case "select":
      return field.options?.[0]?.id ?? ""
    case "cta":
      // `/` satisfies SAFE_LINK, so the button is valid and obviously a
      // placeholder rather than a dead link to somewhere real.
      return { label: "Button", target: { kind: "url", href: "/" } }
    case "list": {
      const count = Math.max(field.min ?? 0, 1)
      return Array.from({ length: count }, () => truncate(`New ${singular(field.label)}`, field.maxLength))
    }
    case "repeater": {
      const count = Math.max(field.min ?? 0, 1)
      return Array.from({ length: count }, () => blankItemFor(field))
    }
    default:
      // A FORMAT-BOUND field cannot take prose. `funnelFormFieldSchema.name` is
      // `^[a-z0-9_]+$`, so "New name" fails on the space and the capital, and
      // the owner would click Add and be refused over a value they never chose.
      // The slug of the label satisfies every pattern these schemas currently
      // use, and the per-kind test proves it against the real validator rather
      // than asserting it here.
      return field.pattern !== undefined
        ? truncate(slug(field.label), field.maxLength)
        : truncate(`New ${field.label.toLowerCase()}`, field.maxLength)
  }
}

/**
 * One item for a repeater, built from the item's own fields.
 *
 * AN ITEM IS NOT ALWAYS AN OBJECT OF FIELDS. `footer.links` is an array of
 * `ctaWithLabelSchema`, which `walk` reports as ONE field with an empty path
 * (a CTA is a single editor, never a walked union). Building a record from that
 * produced `{"": {…}}` — a shape the schema rejects with "label: expected
 * string, received undefined", naming a field the owner never touched. Caught
 * by the per-kind growth test, which is exactly what it is for.
 */
export function blankItemFor(field: SectionField): unknown {
  const children = field.item ?? []

  const whole = children.length === 1 && children[0].path === "" ? children[0] : null
  if (whole) return blankValueFor(whole)

  const item: Record<string, unknown> = {}
  for (const child of children) {
    // Optional leaves are left out entirely — see `blankValueFor`.
    if (child.optional) continue
    item[child.path] = blankValueFor(child)
  }
  return item
}

function truncate(value: string, max: number | undefined): string {
  return max !== undefined && value.length > max ? value.slice(0, max) : value
}

/** "Field name" -> "field_name". For fields whose schema constrains the format. */
function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

/** "Items" -> "item", "Lines" -> "line". Presentation only. */
function singular(label: string): string {
  const lower = label.toLowerCase()
  return lower.endsWith("s") ? lower.slice(0, -1) : lower
}

/** Variant choices for a kind — constrained per kind by the registry. */
export function variantOptions(section: Section): { id: string; label: string }[] {
  const def = SECTION_REGISTRY[section.kind]
  return (def?.variants ?? []).map((variant) => ({ id: variant, label: optionLabel(variant) }))
}

export type { z }
