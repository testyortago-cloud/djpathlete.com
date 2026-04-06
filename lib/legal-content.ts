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
  return (
    markdown
      // Strip the leading h1 title (already rendered by the page header)
      .replace(/^# .+\n*/m, "")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/^(?!<[hulo])/gm, (match) => (match ? `<p>${match}` : match))
      .replace(/\n---\n/g, "<hr />")
  )
}
