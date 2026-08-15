// components/admin/funnels/builder/section-patch.ts - building a props patch
// for a path that may be nested.
//
// `applyOps` merges props SHALLOW, per top-level key, and says why: a deep
// merge would splice an incoming array element-by-element over the old one and
// produce a Frankenstein array. `items` is one key's value and is replaced
// wholesale.
//
// So an edit to `plans.0.name` cannot be sent as `{ "plans.0.name": ... }`.
// This rebuilds the whole `plans` array with one leaf changed, which is what a
// shallow merge needs to receive. Shared by the inspector and the inline text
// canvas so the two cannot disagree about how a nested edit is expressed.

/** Reads `plans.0.name` out of a props object. Returns undefined at any gap. */
export function valueAtPath(source: unknown, path: string): unknown {
  if (path === "") return source
  let current: unknown = source
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * A props patch that sets `path` to `value`.
 *
 * Returns a patch touching exactly ONE top-level key. When the path cannot be
 * walked (a document shape this build does not recognise) it returns the
 * existing value for that key unchanged, so the resulting op is a no-op rather
 * than a write that invents structure - `applyOps` would reject the invented
 * shape anyway, and reporting "that change could not be applied" for something
 * the owner did not do is worse than doing nothing.
 */
export function patchForPath(
  props: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const [root, ...rest] = path.split(".")
  if (rest.length === 0) return { [root]: value }

  const branch = props[root]
  if (branch === null || typeof branch !== "object") return { [root]: branch }

  const clone = structuredClone(branch) as Record<string, unknown>
  let cursor: unknown = clone
  for (let index = 0; index < rest.length - 1; index++) {
    if (cursor === null || typeof cursor !== "object") return { [root]: branch }
    cursor = (cursor as Record<string, unknown>)[rest[index]]
  }
  if (cursor === null || typeof cursor !== "object") return { [root]: branch }

  ;(cursor as Record<string, unknown>)[rest[rest.length - 1]] = value
  return { [root]: clone }
}
