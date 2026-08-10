// lib/funnels/sections/stream-progress.ts — reading a half-written build
// response.
//
// `streamAgent` yields the build result filling in token by token: an object
// whose every field is optional and whose arrays grow an element at a time,
// with the newest element usually half-typed. This module turns that into the
// one thing a progress UI needs — "which sections has the model written so
// far, and what are they" — and nothing else.
//
// ---------------------------------------------------------------------------
// IT VALIDATES NOTHING, ON PURPOSE.
// ---------------------------------------------------------------------------
// Everywhere else in this subsystem, an unvalidated shape is a bug waiting to
// happen, and the house rule is to ask the schema rather than restate it. Here
// the input is BY DEFINITION not yet valid: `sectionSchema` would reject a
// section that is three tokens into its headline, which is exactly the moment
// this module exists to describe. So it reads defensively and reports what it
// can see, and every field it cannot see yet is `null` rather than a guess.
//
// The consequence to keep in mind: NOTHING HERE IS TRUSTWORTHY AS DATA. It is
// display copy for a progress animation that is thrown away the moment the
// real `result` arrives. It must never be applied, stored, or compiled — the
// route applies `applyOps` to the FINAL validated object, as it always did.

/** One section the model has begun writing, as far as it can be seen. */
export interface StreamedSection {
  /**
   * Stable identity across partials, so a section that grows a headline three
   * chunks later updates in place instead of appearing twice.
   *
   * Position-based (`${opIndex}:${sectionIndex}`) rather than id-based because
   * `id` is itself one of the fields that arrives late — keying on it would
   * mint a new entry the moment the model typed the id it was always going to
   * type.
   */
  key: string
  /** Which op is writing it, so the UI can say "adding" vs "rewriting". */
  op: "set_page" | "add_section" | "update_section"
  /** Null until the model has written it — `update_section` never carries one. */
  kind: string | null
  /** `update_section` names an existing section; the UI resolves its kind. */
  id: string | null
  variant: string | null
  /** The section's own copy, once there is any. See `readTitle`. */
  headline: string | null
}

interface PartialOp {
  op?: unknown
  sections?: unknown
  section?: unknown
  id?: unknown
  variant?: unknown
  props?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * The section's headline, whatever the kind calls it.
 *
 * DELIBERATELY NOT A PER-KIND TABLE. A `Record<SectionKind, string>` mapping
 * kind -> field name would be a tenth thing to remember when a tenth kind is
 * added, and forgetting it fails silently as a blank caption. Every kind in the
 * registry names its primary copy one of these three, so trying them in order
 * covers the closed set today and covers a new kind that follows the same
 * convention tomorrow — which is the convention the registry already has.
 */
function readTitle(props: unknown): string | null {
  if (!isRecord(props)) return null
  return readString(props.headline) ?? readString(props.heading) ?? readString(props.businessName)
}

function readSection(raw: unknown, key: string, op: StreamedSection["op"]): StreamedSection | null {
  if (!isRecord(raw)) return null
  return {
    key,
    op,
    kind: readString(raw.kind),
    id: readString(raw.id),
    variant: readString(raw.variant),
    headline: readTitle(raw.props),
  }
}

/**
 * Every section visible in a partial build result, in the order the model is
 * writing them.
 *
 * `move_section`, `remove_section` and `set_theme` are absent by design: they
 * carry no section to draw, and a wireframe block for "removed the pricing
 * section" would be actively misleading. The turn's receipt reports those
 * accurately once the real result lands.
 */
export function collectStreamedSections(partial: unknown): StreamedSection[] {
  if (!isRecord(partial)) return []
  const ops = partial.ops
  if (!Array.isArray(ops)) return []

  const out: StreamedSection[] = []

  ops.forEach((rawOp: unknown, opIndex: number) => {
    if (!isRecord(rawOp)) return
    const op = rawOp as PartialOp
    const name = readString(op.op)

    if (name === "set_page") {
      if (!Array.isArray(op.sections)) return
      op.sections.forEach((rawSection: unknown, sectionIndex: number) => {
        const section = readSection(rawSection, `${opIndex}:${sectionIndex}`, "set_page")
        if (section) out.push(section)
      })
      return
    }

    if (name === "add_section") {
      const section = readSection(op.section, `${opIndex}:0`, "add_section")
      if (section) out.push(section)
      return
    }

    if (name === "update_section") {
      // No `kind` exists on this op — the section being edited already has one,
      // and only the caller holding the current document knows what it is. `id`
      // is what it carries, so `id` is what gets reported.
      const id = readString(op.id)
      const variant = readString(op.variant)
      const headline = readTitle(op.props)
      if (id === null && variant === null && headline === null) return
      out.push({ key: `${opIndex}:0`, op: "update_section", kind: null, id, variant, headline })
    }
  })

  return out
}

/**
 * The entries that are new or have changed since the last partial — what the
 * route actually puts on the wire.
 *
 * Without this a 24-section page re-sends all 24 sections on every one of the
 * hundreds of partials a long generation produces. With it, each section is
 * sent once when it appears and again only when it grows a field.
 */
export function changedSections(
  previous: readonly StreamedSection[],
  next: readonly StreamedSection[],
): StreamedSection[] {
  const before = new Map(previous.map((section) => [section.key, section]))
  return next.filter((section) => {
    const prior = before.get(section.key)
    if (!prior) return true
    return (
      prior.kind !== section.kind ||
      prior.id !== section.id ||
      prior.variant !== section.variant ||
      prior.headline !== section.headline
    )
  })
}
