import { z } from "zod"
import { Heading1 } from "lucide-react"
import type { ElementDef } from "../element-def"
import { styleToCss, styleAttrs } from "../style"
import { richTextNodes } from "./rich-text"

const propsSchema = z.object({
  html: z.string().max(2000),
  level: z.number().int().min(1).max(6),
})

export type HeadingProps = z.infer<typeof propsSchema>

export const headingDef: ElementDef<HeadingProps> = {
  kind: "heading",
  label: "Heading",
  icon: Heading1,
  defaultProps: { html: "Your headline here", level: 2 },
  propsSchema,
  fields: [
    { name: "html", label: "Text", type: "richtext" },
    {
      name: "level",
      label: "Level",
      type: "select",
      options: [1, 2, 3, 4, 5, 6].map((n) => ({ id: String(n), label: `H${n}` })),
    },
  ],
  compile: ({ props, style, type }) => {
    const css = styleToCss(style, type)
    return {
      t: "el",
      tag: `h${props.level}`,
      attrs: styleAttrs(css),
      children: richTextNodes(props.html),
    }
  },
}
