// A type guard for element kinds, in its own leaf module.
//
// It lives here rather than in `elements/index.ts` because the compiler needs
// it and importing the element registry to ask "is this a known kind?" would
// pull every element — and every lucide icon — into anything that only wanted
// to validate a string.

import { ELEMENT_KINDS, type ElementKind } from "./types"

export function isElementKind(value: unknown): value is ElementKind {
  return typeof value === "string" && (ELEMENT_KINDS as readonly string[]).includes(value)
}
