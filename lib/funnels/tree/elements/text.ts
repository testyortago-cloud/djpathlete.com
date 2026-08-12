import { z } from "zod"
import { Type } from "lucide-react"
import type { ElementDef } from "../element-def"
import { styleToCss, styleAttrs } from "../style"
import { richTextNodes } from "./rich-text"

const propsSchema = z.object({ html: z.string().max(8000) })

export type TextProps = z.infer<typeof propsSchema>

export const textDef: ElementDef<TextProps> = {
  kind: "text",
  label: "Text",
  icon: Type,
  defaultProps: { html: "<p>Write something worth reading.</p>" },
  propsSchema,
  fields: [{ name: "html", label: "Text", type: "richtext" }],
  compile: ({ props, style, type }) => {
    const css = styleToCss(style, type)
    return {
      t: "el",
      tag: "div",
      attrs: styleAttrs(css),
      children: richTextNodes(props.html),
    }
  },
}
