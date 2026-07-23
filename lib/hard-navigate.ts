/**
 * Full-page navigation (replaces the current history entry). Kept in its own
 * module as a test seam — jsdom's window.location is unforgeable, so
 * components that force a navigation call this instead.
 */
export function hardNavigate(url: string): void {
  window.location.replace(url)
}
