// lib/lead-engine/chat/markdown.ts — the assistant's reply, parsed into a
// closed set of shapes the panel is allowed to draw.
//
// WHY THIS EXISTS. The model writes markdown whether or not it is asked to:
// a real turn came back as "we have **Rotational Reboot**, a 6-week
// programme" with a bulleted list of options above it, and the panel — which
// rendered the reply as bare text nodes — put the asterisks and the hyphens
// on screen. The visitor reads punctuation the assistant did not mean to send.
//
// WHY IT IS A PARSER AND NOT A MARKDOWN LIBRARY. Every markdown renderer worth
// the name emits HTML, and the one string on this page a stranger can steer is
// the one the model wrote — see the header of components/public/AskPanel.tsx.
// So the reply never becomes markup:
//
//   * The output of this file is DATA, not HTML and not a string. `Block` and
//     `Inline` below are the complete list of things that can come out of it,
//     and there is no `html` case, no `href`, and no field a renderer would
//     ever pass to `dangerouslySetInnerHTML`. A renderer maps them to elements
//     and puts every scrap of model text in a React child, where it is escaped.
//   * LINKS ARE DEFLATED TO THEIR LABEL. `[click here](https://elsewhere)`
//     renders as "click here" and the address is dropped on the floor. The
//     model has no business sending a visitor anywhere: the ways forward on
//     this surface are CARDS the server built (`consult`, `capture`), whose
//     hrefs are constants in tools.ts. A model-authored link is either noise or
//     someone else's idea, and this is the cheapest place to make it neither.
//   * HEADINGS BECOME BOLD LINES. A reply is a few sentences in a small panel;
//     nothing the model types should be able to reach in and set type at
//     display size.
//
// Anything it does not recognise stays as the literal characters the model
// typed. An unclosed `**` is two asterisks, not a bold run to the end of the
// reply — the failure mode of a formatter is showing punctuation, never
// swallowing the sentence after it.

/** A run of reply text and how it is emphasised. There is deliberately no link case. */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }

/** The complete set of shapes a reply can take on screen. */
export type Block =
  | { kind: "paragraph"; spans: Inline[] }
  | { kind: "bullets"; items: Inline[][] }
  | { kind: "numbers"; items: Inline[][] }

const HEADING = /^ {0,3}#{1,6}\s+(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/
/** `---`, `***`, `___` — three or more, nothing else on the line. */
const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/
const BULLET = /^ {0,3}[-*+][ \t]+(.*)$/
const ORDERED = /^ {0,3}\d{1,9}[.)][ \t]+(.*)$/
/** A fence line. The reply is prose; a stray ``` is punctuation, not a code block. */
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char)
}

/**
 * Emphasis, code and links, left to right.
 *
 * Hand-written rather than one large regex because the interesting cases are
 * all about what does NOT match — an unpaired delimiter, an underscore inside
 * `sessions_per_week`, an empty `**​**` — and each of those is a readable line
 * here and an unreadable lookahead there.
 */
export function parseInline(source: string): Inline[] {
  const spans: Inline[] = []
  let buffer = ""

  function flush(): void {
    if (buffer) {
      spans.push({ kind: "text", text: buffer })
      buffer = ""
    }
  }

  let i = 0
  while (i < source.length) {
    const char = source[i]

    // `code`
    if (char === "`") {
      const close = source.indexOf("`", i + 1)
      if (close > i + 1) {
        flush()
        spans.push({ kind: "code", text: source.slice(i + 1, close) })
        i = close + 1
        continue
      }
    }

    // **strong** / __strong__ / *em* / _em_
    if (char === "*" || char === "_") {
      const double = source[i + 1] === char
      const marker = double ? char + char : char
      // `_` is a word character in prose the model quotes back — column names,
      // slugs. Only treat it as emphasis when it is not welded to a word.
      const underscoreInsideWord = char === "_" && isWordChar(source[i - 1])
      if (!underscoreInsideWord) {
        const closed = findClosing(source, i + marker.length, marker)
        if (closed !== -1) {
          const text = source.slice(i + marker.length, closed)
          flush()
          spans.push({ kind: double ? "strong" : "em", text })
          i = closed + marker.length
          continue
        }
      }
    }

    // [label](href) — the label survives, the address does not.
    if (char === "[") {
      const link = matchLink(source, i)
      if (link) {
        flush()
        // The label is parsed too: `[**the camps page**](/camps)` is bold text.
        spans.push(...parseInline(link.label))
        i = link.end
        continue
      }
    }

    buffer += char
    i += 1
  }

  flush()
  return spans
}

/**
 * The index of the delimiter that closes a run opened at `from`, or -1.
 *
 * A run must hold something, must not open or close on a space (`a * b * c` is
 * arithmetic, not emphasis) and must not run past the end of the line it
 * started on — an unclosed `**` in the first sentence would otherwise bold the
 * rest of the reply.
 */
function findClosing(source: string, from: number, marker: string): number {
  if (source[from] === undefined || /\s/.test(source[from])) return -1

  let i = from
  while (i < source.length) {
    if (source[i] === "\n") return -1
    if (source.startsWith(marker, i) && i > from) {
      // Not a longer run of the same character: `***bold-italic***` should not
      // close a `*` run on the first star of the closing three.
      if (marker.length === 1 && source[i + 1] === marker) {
        i += 2
        continue
      }
      if (/\s/.test(source[i - 1])) {
        i += 1
        continue
      }
      if (marker === "_" && isWordChar(source[i + 1])) {
        i += 1
        continue
      }
      return i
    }
    i += 1
  }
  return -1
}

function matchLink(source: string, at: number): { label: string; end: number } | null {
  const labelEnd = source.indexOf("]", at + 1)
  if (labelEnd === -1) return null
  if (source[labelEnd + 1] !== "(") return null
  const hrefEnd = source.indexOf(")", labelEnd + 2)
  if (hrefEnd === -1) return null
  const label = source.slice(at + 1, labelEnd)
  if (label.includes("\n")) return null
  return { label, end: hrefEnd + 1 }
}

/**
 * The reply, as blocks.
 *
 * Blank lines separate paragraphs; a single newline inside one is kept as a
 * line break, which is what the panel did before this file existed and is
 * still right for the model's habit of putting each option on its own line.
 */
export function parseAssistantMarkdown(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.split("\n")

  let paragraph: string[] = []
  let list: { kind: "bullets" | "numbers"; items: string[] } | null = null

  function closeParagraph(): void {
    if (paragraph.length === 0) return
    const joined = paragraph.join("\n").trim()
    paragraph = []
    if (joined) blocks.push({ kind: "paragraph", spans: parseInline(joined) })
  }

  function closeList(): void {
    if (!list) return
    const { kind, items } = list
    list = null
    const spans = items.map((item) => parseInline(item.trim())).filter((item) => item.length > 0)
    if (spans.length > 0) blocks.push({ kind, items: spans })
  }

  function close(): void {
    closeParagraph()
    closeList()
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "")

    if (FENCE.test(line)) continue

    if (line.trim() === "") {
      close()
      continue
    }

    if (RULE.test(line)) {
      close()
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      close()
      const content = heading[1].replace(/\s*#+\s*$/, "").trim()
      // Bold, at body size. Never a heading element: see the file header.
      if (content) blocks.push({ kind: "paragraph", spans: [{ kind: "strong", text: content }] })
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet) {
      closeParagraph()
      if (list?.kind !== "bullets") {
        closeList()
        list = { kind: "bullets", items: [] }
      }
      list.items.push(bullet[1])
      continue
    }

    const ordered = ORDERED.exec(line)
    if (ordered) {
      closeParagraph()
      if (list?.kind !== "numbers") {
        closeList()
        list = { kind: "numbers", items: [] }
      }
      list.items.push(ordered[1])
      continue
    }

    const quote = QUOTE.exec(line)
    const content = quote ? quote[1] : line

    // A line under a list item continues that item rather than starting a
    // paragraph inside the list, which is how a wrapped bullet reads.
    if (list) {
      if (list.items.length > 0) list.items[list.items.length - 1] += ` ${content.trim()}`
      continue
    }

    paragraph.push(content)
  }

  close()
  return blocks
}
