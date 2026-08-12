import { z } from "zod"
import { MoveVertical } from "lucide-react"
import { safeStyle } from "@/lib/funnels/compile/sanitize"
import type { ElementDef } from "../element-def"
import { styleToCss, styleAttrs } from "../style"

const propsSchema = z.object({ height: z.string().max(20) })

export type SpacerProps = z.infer<typeof propsSchema>

export const spacerDef: ElementDef<SpacerProps> = {
  kind: "spacer",
  label: "Spacer",
  icon: MoveVertical,
  defaultProps: { height: "40px" },
  propsSchema,
  fields: [{ name: "height", label: "Height", type: "text" }],
  compile: ({ props, style }) => {
    // `height` is a prop rather than a style because it is the entire point of
    // this element — a spacer with no height is nothing at all.
    const own = safeStyle(`height:${props.height}`) ?? ""
    const box = styleToCss(style)
    const css = [box, own].filter(Boolean).join(";")
    return { t: "el", tag: "div", attrs: styleAttrs(css), children: [] }
  },
}
