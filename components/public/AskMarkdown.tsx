// components/public/AskMarkdown.tsx — the assistant's reply, drawn.
//
// The parse is in lib/lead-engine/chat/markdown.ts and its header explains why
// the reply is turned into DATA rather than HTML. This file is the other half
// of that promise and is deliberately dull: it maps a closed set of shapes onto
// elements, and every piece of model text arrives as a React child, where it is
// escaped. There is no `dangerouslySetInnerHTML` here and there must never be
// one — the whole point of the parser returning `Block[]` is that this file has
// nothing it could pass to it.
//
// Type sizes are the panel's own. A reply cannot set type: a heading the model
// wrote is a bold line (see the parser), so the biggest thing on screen is
// still whatever the panel decided.

import { parseAssistantMarkdown, type Inline } from "@/lib/lead-engine/chat/markdown"

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((span, index) => {
        switch (span.kind) {
          case "strong":
            return (
              <strong key={index} className="font-semibold">
                {span.text}
              </strong>
            )
          case "em":
            return <em key={index}>{span.text}</em>
          case "code":
            return (
              <code key={index} className="rounded bg-background/70 px-1 py-0.5 font-mono text-[0.9em]">
                {span.text}
              </code>
            )
          case "text":
            return <span key={index}>{span.text}</span>
        }
      })}
    </>
  )
}

/**
 * `text` is the model's, and nothing else on this surface is. It is rendered
 * through the parser above and never through a markdown library, an HTML
 * string, or `innerHTML`.
 */
export function AskMarkdown({ text }: { text: string }) {
  const blocks = parseAssistantMarkdown(text)

  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === "paragraph") {
          return (
            // Preserved single newlines: the model puts each option on its own
            // line, and joining them into one run reads as a wall.
            <p key={index} className="whitespace-pre-wrap">
              <Spans spans={block.spans} />
            </p>
          )
        }

        const List = block.kind === "bullets" ? "ul" : "ol"
        return (
          <List
            key={index}
            className={[
              "space-y-1 pl-5",
              block.kind === "bullets" ? "list-disc" : "list-decimal",
              "marker:text-muted-foreground",
            ].join(" ")}
          >
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Spans spans={item} />
              </li>
            ))}
          </List>
        )
      })}
    </>
  )
}
