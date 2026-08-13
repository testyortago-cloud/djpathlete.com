"use client"

// Typing on the page instead of in the sidebar.
//
// THE ONE MOMENT WYSIWYG IS SUSPENDED, RECORDED HERE DELIBERATELY. Everywhere
// else the canvas renders `compile`'s own output, so what you see is what gets
// published by construction. While this editor is open the canvas is showing
// TipTap's rendering of the same html instead. It is an approximation for
// exactly as long as the caret is in the block, and the compiled output returns
// on blur. The alternative — making the compiled React tree contenteditable and
// reading changes back out of the DOM — means fighting React over the same
// nodes, which is worse than a bounded, documented approximation.
//
// The html this commits still passes through `htmlToNodes` when the element
// compiles, so the sanitiser remains the only gate on the free-HTML path. This
// component is not a security boundary and must not be treated as one.

import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"

/**
 * Does this html arrive as block content? A heading stores BARE text and drops
 * it straight inside `h{level}`, while a text element stores a real paragraph.
 * TipTap always returns block html, so committing its output verbatim would put
 * a `<p>` inside every `<h2>`.
 *
 * The rule is to give back the shape we were handed: block in, block out.
 */
function arrivedAsBlock(html: string): boolean {
  return /^\s*<(p|h[1-6]|ul|ol|blockquote|pre)\b/i.test(html)
}

/** Unwrap a lone top-level paragraph, leaving its inline markup intact. */
function unwrapSoleParagraph(html: string): string {
  const match = html.match(/^\s*<p>([\s\S]*)<\/p>\s*$/i)
  if (!match) return html
  // Only safe when there is exactly one paragraph; two would silently merge.
  return match[1].includes("<p") ? html : match[1]
}

export function InlineText({
  html,
  onCommit,
}: {
  html: string
  onCommit: (html: string) => void
}) {
  const wasBlock = arrivedAsBlock(html)

  const editor = useEditor({
    extensions: [StarterKit],
    content: html,
    // This only ever mounts after a double-click, so there is no server render
    // to defer for. Left explicit because TipTap warns when it is unset.
    immediatelyRender: true,
    // The block remounts on entering edit mode, so without this the owner would
    // have to click a third time to place the caret they already asked for.
    autofocus: "end",
    editorProps: {
      attributes: { class: "outline-none focus:outline-none" },
    },
    onBlur: ({ editor: instance }) => {
      const out = instance.getHTML()
      onCommit(wasBlock ? out : unwrapSoleParagraph(out))
    },
  })

  return <EditorContent editor={editor} />
}
