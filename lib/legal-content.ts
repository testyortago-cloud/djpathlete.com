/**
 * Renders legal document content for display.
 * Handles both HTML (from TipTap rich editor) and legacy markdown (from seed data).
 */
export function renderLegalContent(content: string): string {
  const trimmed = content.trim()

  // If content starts with an HTML tag, it's from TipTap — return as-is
  if (trimmed.startsWith("<")) {
    return trimmed
  }

  // Otherwise treat as markdown (legacy seed data)
  return markdownToHtml(trimmed)
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.split("\n")
  const html: string[] = []
  let inList = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Horizontal rule
    if (line.trim() === "---") {
      if (inList) { html.push("</ul>"); inList = false }
      html.push("<hr />")
      continue
    }

    // Headings
    const h3Match = line.match(/^### (.+)$/)
    if (h3Match) {
      if (inList) { html.push("</ul>"); inList = false }
      html.push(`<h3>${inlineFormat(h3Match[1])}</h3>`)
      continue
    }

    const h2Match = line.match(/^## (.+)$/)
    if (h2Match) {
      if (inList) { html.push("</ul>"); inList = false }
      html.push(`<h2>${inlineFormat(h2Match[1])}</h2>`)
      continue
    }

    const h1Match = line.match(/^# (.+)$/)
    if (h1Match) {
      if (inList) { html.push("</ul>"); inList = false }
      html.push(`<h1>${inlineFormat(h1Match[1])}</h1>`)
      continue
    }

    // List items
    const liMatch = line.match(/^- (.+)$/)
    if (liMatch) {
      if (!inList) { html.push("<ul>"); inList = true }
      html.push(`<li>${inlineFormat(liMatch[1])}</li>`)
      continue
    }

    // Close list if we're in one and hit a non-list line
    if (inList) {
      html.push("</ul>")
      inList = false
    }

    // Empty lines — skip (they separate paragraphs)
    if (line.trim() === "") {
      continue
    }

    // Regular paragraph
    html.push(`<p>${inlineFormat(line)}</p>`)
  }

  if (inList) html.push("</ul>")

  return html.join("")
}

/** Apply inline formatting: bold, italic */
function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
}
