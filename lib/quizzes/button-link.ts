// lib/quizzes/button-link.ts — what a quiz result band's button may say and
// where it may go. ONE rule, read by the PATCH route (which refuses) and by the
// quiz editor (which explains, naming the band, before it sends anything).
//
// The link lands in a public result page's <a href>, typed by a coach (G47).
// Allowed: a path on this site, or an http(s) address. Refused: anything else,
// javascript:, mailto: and bare "example.com" included. A path may not start
// "//" or "/\" (browsers read both as another host), and neither form may hold
// whitespace or a backslash anywhere.
//
// Imports nothing, so the client component can use it.

export const BUTTON_LABEL_MAX = 60
export const BUTTON_LINK_MAX = 300

export const BUTTON_LINK_RULE =
  "A button link must start with / (one of your own pages) or https:// (a full web address), with no spaces."

export function isAllowedButtonLink(href: string): boolean {
  if (href.length > BUTTON_LINK_MAX || /[\s\\]/.test(href)) return false
  return /^\/(?!\/)/.test(href) || /^https?:\/\/[^/]/i.test(href)
}

/** A label must say something: blank is "no button", which is null, never "". */
export function isAllowedButtonLabel(label: string): boolean {
  return label.trim().length > 0 && label.length <= BUTTON_LABEL_MAX
}
