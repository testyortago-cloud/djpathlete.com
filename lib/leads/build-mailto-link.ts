// mailto: bodies have practical length limits across mail clients (some
// truncate well before 2000 chars). Keep this well under that ceiling —
// generateLeadAnalysis's prompt also asks for a short draft, this is the
// defensive backstop regardless of what the model returns.
const MAILTO_BODY_MAX_CHARS = 600

export function buildLeadMailtoLink({
  email,
  subject,
  body,
}: {
  email: string
  subject: string
  body: string
}): string {
  const truncatedBody =
    body.length > MAILTO_BODY_MAX_CHARS ? `${body.slice(0, MAILTO_BODY_MAX_CHARS).trimEnd()}…` : body
  // encodeURIComponent (not URLSearchParams) — mailto per RFC 6068 expects
  // %20 for spaces; URLSearchParams' form-encoding would emit "+" instead,
  // which some mail clients render literally.
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(truncatedBody)}`
  return `mailto:${email}?${query}`
}

export function buildTelLink(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "")
  return `tel:${digits}`
}
