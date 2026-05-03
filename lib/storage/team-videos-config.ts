/**
 * Team video Firebase Storage path conventions.
 *
 * All team-video files live under a single namespace prefix in the project's
 * default Firebase Storage bucket. Reusing the default bucket (vs. spinning
 * up a dedicated one) matches Content Studio's existing video pattern at
 * app/api/admin/videos/route.ts.
 *
 * Path shape: team-videos/<submissionId>/v<versionNumber>/<safeFilename>
 */

export const TEAM_VIDEO_PATH_PREFIX = "team-videos"

export const TEAM_VIDEO_UPLOAD_URL_TTL_MS = 15 * 60 * 1000  // 15 min for the editor to PUT
export const TEAM_VIDEO_READ_URL_TTL_MS = 60 * 60 * 1000    // 1 hour for the player to stream
