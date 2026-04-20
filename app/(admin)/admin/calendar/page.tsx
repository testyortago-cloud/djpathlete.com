// app/(admin)/admin/calendar/page.tsx
import { listSocialPosts } from "@/lib/db/social-posts"
import { WeekGrid } from "@/components/admin/calendar/WeekGrid"
import type { SocialPost } from "@/types/database"

export const metadata = { title: "Content Calendar" }

export default async function CalendarPage() {
  const scheduled = await listSocialPosts({ approval_status: "scheduled" })
  const published = await listSocialPosts({ approval_status: "published" })
  const posts: SocialPost[] = [...scheduled, ...published]

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-1">Content Calendar</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Scheduled and published social posts on a weekly grid. Schedule a post from the Social tab to add it here.
      </p>

      <WeekGrid posts={posts} />
    </div>
  )
}
