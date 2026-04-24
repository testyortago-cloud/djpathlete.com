export function isContentStudioEnabled(): boolean {
  return process.env.CONTENT_STUDIO_ENABLED === "true"
}

/**
 * Phase 1a+ multimedia gate. When true, the studio surfaces image (and later
 * carousel, story) post flows. Off by default — flip the env var in staging,
 * dogfood the image path, then enable in prod.
 */
export function isContentStudioMultimediaEnabled(): boolean {
  return process.env.CS_MULTIMEDIA_ENABLED === "true"
}
