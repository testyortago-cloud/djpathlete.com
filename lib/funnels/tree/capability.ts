// lib/funnels/tree/capability.ts — what the inspector may offer for an element,
// answered by the element itself.
//
// WHY A PROBE AND NOT A FLAG. `ElementDef` could carry `supportsType: true` and
// the inspector could read it. That flag would be a second statement about the
// same fact, and the compiler would be the one telling the truth: the day an
// element stops passing `type` to `styleToCss`, the flag still says it does and
// the owner gets a Typography group whose every control silently does nothing.
// Asking `compile` removes the disagreement instead of watching for it, which
// is the same reason the canvas renders `compile`'s own output rather than a
// second hand-written approximation of it. See `element-def.ts`.

import type { AnyElementDef, FieldSpec } from "./element-def"

/**
 * A length no element's default styling would contain on its own. If it comes
 * back out of `compile`, the only way it got there is the `type` argument.
 *
 * It must survive `safeStyle`, so it has to be a VALID css length — a made-up
 * token would be stripped by the sanitiser and every element would read as
 * discarding TypeStyle.
 */
const TYPE_SENTINEL = "9973px"

/**
 * The answer is a property of the definition, which never changes at runtime,
 * but the question is asked on every inspector render — including every
 * keystroke in a text field. `compile` is not free: a heading's runs its html
 * through `htmlToNodes`, so probing unmemoised would re-parse HTML per
 * keystroke to re-learn a constant.
 */
const typeCache = new WeakMap<AnyElementDef, boolean>()

/**
 * Does this element's compiled output honour `TypeStyle`?
 *
 * Pure: `compile` is called with the element's own defaults and a throwaway
 * style object, and nothing it returns is kept.
 */
export function honoursType(def: AnyElementDef): boolean {
  const cached = typeCache.get(def)
  if (cached !== undefined) return cached

  const answer = probeType(def)
  typeCache.set(def, answer)
  return answer
}

function probeType(def: AnyElementDef): boolean {
  let node: unknown
  try {
    node = def.compile({
      props: def.defaultProps,
      style: {},
      type: { fontSize: TYPE_SENTINEL },
    })
  } catch {
    // An element that cannot compile its own defaults has bigger problems, but
    // the inspector still has to render something — treat it as not honouring
    // typography rather than taking the whole panel down.
    return false
  }
  return JSON.stringify(node).includes(TYPE_SENTINEL)
}

/**
 * The element's rich text field, if it declares one. This is what makes an
 * element inline-editable: heading and text qualify, a button's plain `label`
 * does not, and nothing has to be declared twice to say so.
 */
export function richtextField(def: AnyElementDef): FieldSpec | null {
  return def.fields.find((field) => field.type === "richtext") ?? null
}
