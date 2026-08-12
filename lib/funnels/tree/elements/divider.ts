import { z } from "zod"
import { Minus } from "lucide-react"
import type { ElementDef } from "../element-def"
import { styleToCss } from "../style"

const propsSchema = z.object({})

export type DividerProps = z.infer<typeof propsSchema>

export const dividerDef: ElementDef<DividerProps> = {
  kind: "divider",
  label: "Divider",
  icon: Minus,
  defaultProps: {},
  propsSchema,
  // Nothing to say about a horizontal rule that the Style tab does not already
  // say — border colour and width ARE the divider.
  fields: [],
  compile: ({ style }) => {
    const css = styleToCss(style)
    return { t: "el", tag: "hr", attrs: css ? { style: css } : {}, children: [] }
  },
}
