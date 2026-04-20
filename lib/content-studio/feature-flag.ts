export function isContentStudioEnabled(): boolean {
  return process.env.CONTENT_STUDIO_ENABLED === "true"
}
