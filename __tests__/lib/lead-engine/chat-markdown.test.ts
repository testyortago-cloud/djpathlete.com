// __tests__/lib/lead-engine/chat-markdown.test.ts
//
// The reply formatter. Two things are being defended here and they pull in
// opposite directions:
//
//   1. The model's markdown must actually RENDER. A real turn came back as
//      "we have **Rotational Reboot**, a 6-week programme" over a hyphenated
//      list of options, and the panel printed the asterisks and the hyphens.
//   2. Nothing the model types may become markup, an address, or type at
//      display size. The reply is the one string on that page a stranger can
//      steer.
//
// So the assertions below are mostly about what does NOT come out: no `html`
// or `href` shape exists in the AST at all, an unpaired delimiter stays as
// punctuation, and a link keeps its label and loses where it pointed.
//
// Each test names the mutant it kills.
import { describe, expect, it } from "vitest"

import { parseAssistantMarkdown, parseInline, type Block } from "@/lib/lead-engine/chat/markdown"

/** The text of a block, ignoring emphasis — for asserting nothing was swallowed. */
function flatten(block: Block): string {
  if (block.kind === "paragraph") return block.spans.map((span) => span.text).join("")
  return block.items.map((item) => item.map((span) => span.text).join("")).join(" | ")
}

describe("the model's formatting reaches the screen as formatting", () => {
  it("turns a bold run into a strong span rather than four asterisks", () => {
    // MUTANT KILLED: dropping the `**` branch, which is what shipped — the
    // visitor read "we have **Rotational Reboot**".
    const spans = parseInline("we have **Rotational Reboot**, a 6-week programme")

    expect(spans).toEqual([
      { kind: "text", text: "we have " },
      { kind: "strong", text: "Rotational Reboot" },
      { kind: "text", text: ", a 6-week programme" },
    ])
  })

  it("collects consecutive hyphen lines into one list", () => {
    // MUTANT KILLED: one block per line, which renders three bullet lists.
    const blocks = parseAssistantMarkdown(
      "Are you looking for:\n\n- **One-on-one coaching** or **group sessions**?\n- In-person training or online coaching?\n- How often you can train per week?",
    )

    expect(blocks).toHaveLength(2)
    expect(blocks[0].kind).toBe("paragraph")
    expect(blocks[1].kind).toBe("bullets")
    const list = blocks[1]
    if (list.kind !== "bullets") throw new Error("expected bullets")
    expect(list.items).toHaveLength(3)
    expect(flatten(list)).toBe(
      "One-on-one coaching or group sessions? | In-person training or online coaching? | How often you can train per week?",
    )
    // The emphasis inside an item survives the list pass.
    expect(list.items[0]).toContainEqual({ kind: "strong", text: "One-on-one coaching" })
  })

  it("keeps a numbered list numbered, and separate from a bulleted one", () => {
    // MUTANT KILLED: treating every list line as a bullet, which renders "1."
    // as a dot and loses the order the model meant.
    const blocks = parseAssistantMarkdown("1. Book a call\n2. Pick a plan\n\n- and a note")

    expect(blocks.map((b) => b.kind)).toEqual(["numbers", "bullets"])
    expect(flatten(blocks[0])).toBe("Book a call | Pick a plan")
  })

  it("renders `code` and italics", () => {
    expect(parseInline("say `hello` and *mean it*")).toEqual([
      { kind: "text", text: "say " },
      { kind: "code", text: "hello" },
      { kind: "text", text: " and " },
      { kind: "em", text: "mean it" },
    ])
  })

  it("keeps a blank line as a paragraph break and a single newline inside one", () => {
    const blocks = parseAssistantMarkdown("first line\nsame paragraph\n\nsecond paragraph")

    expect(blocks).toHaveLength(2)
    expect(flatten(blocks[0])).toBe("first line\nsame paragraph")
    expect(flatten(blocks[1])).toBe("second paragraph")
  })
})

describe("what the model types can never become", () => {
  it("keeps a link's label and throws its address away", () => {
    // MUTANT KILLED: emitting a link node. The ways forward on this surface
    // are the server's cards, whose hrefs are constants in tools.ts. A model
    // that can write an href can send a visitor anywhere.
    const spans = parseInline("see [our other site](https://not-us.example.com/pay) for details")

    expect(spans.map((s) => s.text).join("")).toBe("see our other site for details")
    expect(JSON.stringify(spans)).not.toContain("not-us.example.com")
    // Positive evidence there is no shape that could carry one.
    for (const span of spans) expect(Object.keys(span).sort()).toEqual(["kind", "text"])
  })

  it("renders a heading as a bold line, never as a heading", () => {
    // MUTANT KILLED: emitting `{kind: "heading", level}`. Nothing the model
    // writes may set type at display size in a small panel.
    const blocks = parseAssistantMarkdown("### Our programmes\n\nHere they are.")

    expect(blocks[0]).toEqual({ kind: "paragraph", spans: [{ kind: "strong", text: "Our programmes" }] })
  })

  it("leaves an unclosed delimiter as the characters the model typed", () => {
    // MUTANT KILLED: treating end-of-text as a closing delimiter, which turns
    // one stray asterisk into bold running to the end of the reply.
    expect(parseInline("**never closed")).toEqual([{ kind: "text", text: "**never closed" }])
    // A delimiter with a space behind it is arithmetic or a bullet the block
    // pass already handled, never the start of a run.
    expect(parseInline("a ** stray star and _ an underscore")).toEqual([
      { kind: "text", text: "a ** stray star and _ an underscore" },
    ])
  })

  it("does not let a run cross a line break", () => {
    // MUTANT KILLED: dropping the newline guard in findClosing. Both lines are
    // one paragraph, so parseInline really does see the break — and a stray
    // `**` at the top of a reply would otherwise bold everything down to the
    // next one, several sentences away.
    expect(parseInline("**one\ntwo** three")).toEqual([{ kind: "text", text: "**one\ntwo** three" }])
  })

  it("does not turn arithmetic or a slug into emphasis", () => {
    // MUTANT KILLED: matching `_` inside a word, which mangles the column
    // names and slugs the model quotes back out of a lookup.
    expect(parseInline("sessions_per_week is 4")).toEqual([{ kind: "text", text: "sessions_per_week is 4" }])
    expect(parseInline("2 * 3 * 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }])
  })

  it("passes markup through as text for the renderer to escape", () => {
    // The panel test asserts the DOM half of this; here the point is that the
    // parser produces no shape that could carry it as markup.
    const spans = parseInline("<img src=x onerror=alert(1)> ask the coach")

    expect(spans).toEqual([{ kind: "text", text: "<img src=x onerror=alert(1)> ask the coach" }])
  })

  it("returns nothing at all for an empty or whitespace-only reply", () => {
    expect(parseAssistantMarkdown("")).toEqual([])
    expect(parseAssistantMarkdown("   \n\n  ")).toEqual([])
  })

  it("drops a horizontal rule and a code fence rather than printing them", () => {
    const blocks = parseAssistantMarkdown("before\n\n---\n\n```\nafter\n```")

    expect(blocks.map(flatten)).toEqual(["before", "after"])
  })
})
