// lib/funnels/tree/elements/index.ts — every element the builder can place.
//
// The palette, the inspector and the compiler all read this one registry, so an
// element cannot exist in the palette without a compiler, or carry a setting
// the compiler will not honour.

import type { ElementKind } from "../types"
import type { AnyElementDef } from "../element-def"
import { headingDef } from "./heading"
import { textDef } from "./text"
import { imageDef } from "./image"
import { buttonDef } from "./button"
import { dividerDef } from "./divider"
import { spacerDef } from "./spacer"
import { islandDef } from "./island"

export const ELEMENT_REGISTRY: Record<ElementKind, AnyElementDef> = {
  heading: headingDef,
  text: textDef,
  image: imageDef,
  button: buttonDef,
  divider: dividerDef,
  spacer: spacerDef,
  island: islandDef,
}

export const ELEMENT_LIST: readonly AnyElementDef[] = Object.values(ELEMENT_REGISTRY)

export function getElementDef(kind: ElementKind): AnyElementDef {
  return ELEMENT_REGISTRY[kind]
}

export { fieldsForIsland } from "./island"
