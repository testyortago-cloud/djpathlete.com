// Short, stable document ids — `s1`, `r2`, `c3`, `e4` — matching the convention
// SectionDoc already uses, where an id doubles as an anchor target.
//
// A counter rather than a UUID: these appear in URLs as anchors, and
// `#e4f8c1a2-...` is not something anyone would type or share. Collisions
// within a page are prevented by the monotonic counter; across pages they do
// not matter, because ids are only ever resolved within one document.

let counter = 0

export function newId(prefix: "s" | "r" | "c" | "e"): string {
  counter += 1
  return `${prefix}${counter}`
}

/** Test seam. Never call this in application code. */
export function __resetIdCounter(): void {
  counter = 0
}
