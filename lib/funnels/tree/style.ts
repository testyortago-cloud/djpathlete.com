// lib/funnels/tree/style.ts — BoxStyle/TypeStyle -> an inline style string.
//
// v1 EMITS NO STYLESHEET. Every style is an inline `style` attribute, which
// NodeRenderer already turns back into a React style object via
// `styleStringToObject`. That is sufficient for a desktop-only builder and it
// removes an entire subsystem (CSS generation, class naming, scoping) from
// stage 2.
//
// Stage 4 (responsive) CANNOT use this approach: media queries do not exist
// inline, so it will need a real CSS emitter plus `scopeCss`. That is a known
// and accepted stage-4 cost, recorded here and in the spec so it is not
// discovered as a surprise halfway through building device toggles.

import { safeStyle } from "@/lib/funnels/compile/sanitize"
import type { BoxStyle, Sides, TypeStyle } from "./types"

/**
 * Longhand, never the shorthand: `padding` would force all four sides, so
 * setting only the top would silently zero the other three.
 */
function sides(prefix: string, value: Sides | undefined, out: string[]): void {
  if (!value) return
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const length = value[side]
    if (length) out.push(`${prefix}-${side}:${length}`)
  }
}

/**
 * The result passes through `safeStyle` — the same allowlist the published HTML
 * path uses. Every value here originated in a text input, so "we constructed
 * this object ourselves" is not a reason to trust its contents.
 *
 * `safeStyle` drops offending DECLARATIONS rather than the whole string, so one
 * bad colour does not cost the owner their padding.
 */
export function styleToCss(box: BoxStyle, type?: TypeStyle): string {
  const out: string[] = []

  sides("padding", box.padding, out)
  sides("margin", box.margin, out)

  if (box.background?.color) out.push(`background-color:${box.background.color}`)
  if (box.background?.image) out.push(`background-image:url(${box.background.image})`)
  if (box.border?.width) out.push(`border-width:${box.border.width}`)
  if (box.border?.style) out.push(`border-style:${box.border.style}`)
  if (box.border?.color) out.push(`border-color:${box.border.color}`)
  if (box.radius) out.push(`border-radius:${box.radius}`)
  if (box.align) out.push(`text-align:${box.align}`)
  if (box.maxWidth) out.push(`max-width:${box.maxWidth}`)

  if (type?.fontSize) out.push(`font-size:${type.fontSize}`)
  if (type?.fontWeight) out.push(`font-weight:${type.fontWeight}`)
  if (type?.lineHeight) out.push(`line-height:${type.lineHeight}`)
  if (type?.color) out.push(`color:${type.color}`)
  if (type?.letterSpacing) out.push(`letter-spacing:${type.letterSpacing}`)

  if (out.length === 0) return ""
  return safeStyle(out.join(";")) ?? ""
}
