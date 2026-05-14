/**
 * Phase B gate for editor photo submissions and admin image-set review.
 * Off by default; flip in preview, dogfood, then enable in prod.
 */
export function isTeamImagesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TEAM_IMAGES_ENABLED === "true"
}
