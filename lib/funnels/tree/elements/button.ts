import { z } from "zod"
import { MousePointerClick } from "lucide-react"
import { safeUrl } from "@/lib/funnels/compile/sanitize"
import type { ElementDef } from "../element-def"
import { styleToCss, styleAttrs } from "../style"

const propsSchema = z.object({
  label: z.string().min(1).max(120),
  href: z.string().max(1000),
})

export type ButtonProps = z.infer<typeof propsSchema>

export const buttonDef: ElementDef<ButtonProps> = {
  kind: "button",
  label: "Button",
  icon: MousePointerClick,
  defaultProps: { label: "Get started", href: "/contact" },
  propsSchema,
  fields: [
    { name: "label", label: "Label", type: "text" },
    { name: "href", label: "Links to", type: "url" },
  ],
  compile: ({ props, style, type }) => {
    const css = styleToCss(style, type)
    // A `javascript:` href is the classic injection here, and `safeUrl` is the
    // thing that already knows that. An href it rejects yields a link with no
    // destination rather than a live one.
    const href = safeUrl(props.href)
    const attrs = styleAttrs(css)
    if (href) attrs.href = href
    return {
      t: "el",
      tag: "a",
      attrs,
      children: [{ t: "text", v: props.label }],
    }
  },
}
