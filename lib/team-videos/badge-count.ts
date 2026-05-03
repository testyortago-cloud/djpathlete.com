import { countSubmissionsByStatus } from "@/lib/db/team-video-submissions"

/** Count of "submitted" submissions waiting for admin review. */
export async function getTeamVideoReviewBadgeCount(): Promise<number> {
  return countSubmissionsByStatus("submitted")
}
