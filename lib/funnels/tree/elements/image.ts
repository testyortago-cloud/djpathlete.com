import { z } from "zod"
import { ImageIcon } from "lucide-react"
import { safeUrl } from "@/lib/funnels/compile/sanitize"
import type { ElementDef } from "../element-def"
import { styleToCss, styleAttrs } from "../style"

const propsSchema = z.object({
  src: z.string().max(1000),
  alt: z.string().max(200),
})

export type ImageProps = z.infer<typeof propsSchema>

export const imageDef: ElementDef<ImageProps> = {
  kind: "image",
  label: "Image",
  icon: ImageIcon,
  defaultProps: { src: "", alt: "" },
  propsSchema,
  fields: [
    { name: "src", label: "Image URL", type: "url" },
    { name: "alt", label: "Alt text", type: "text" },
  ],
  compile: ({ props, style }) => {
    const css = styleToCss(style)
    // `safeUrl` decides, not a regex written here. An src it rejects becomes no
    // src at all rather than a broken or hostile one.
    const src = safeUrl(props.src, { allowDataImage: true })
    const attrs = styleAttrs(css, { alt: props.alt })
    if (src) attrs.src = src
    return { t: "el", tag: "img", attrs, children: [] }
  },
}
