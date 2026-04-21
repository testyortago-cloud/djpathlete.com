// __tests__/db/social-analytics.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { createSocialPost, deleteSocialPost } from "@/lib/db/social-posts"
import { insertSocialAnalytics, listRecentAnalyticsByPost } from "@/lib/db/social-analytics"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_TAG = "__TEST_SOCIAL_ANALYTICS__"

describe("social-analytics DAL", () => {
  const supabase = createServiceRoleClient()

  async function cleanup() {
    // ON DELETE CASCADE on social_posts drops dependent social_analytics rows.
    await supabase.from("social_posts").delete().like("content", `${TEST_TAG}%`)
  }

  beforeEach(cleanup)
  afterAll(cleanup)

  it("inserts an analytics snapshot and reads it back", async () => {
    const post = await createSocialPost({
      platform: "instagram",
      content: `${TEST_TAG}single`,
      approval_status: "published",
      media_url: null,
      scheduled_at: null,
      source_video_id: null,
      created_by: null,
    })

    const inserted = await insertSocialAnalytics({
      social_post_id: post.id,
      platform: "instagram",
      platform_post_id: "ig_fake_123",
      impressions: 500,
      engagement: 25,
      likes: 20,
      comments: 3,
      shares: 2,
      views: null,
      extra: null,
      recorded_at: new Date().toISOString(),
    })

    expect(inserted.id).toBeTruthy()
    expect(inserted.impressions).toBe(500)
    expect(inserted.likes).toBe(20)

    const rows = await listRecentAnalyticsByPost(post.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].platform_post_id).toBe("ig_fake_123")

    await deleteSocialPost(post.id)
  })

  it("lists snapshots newest first and respects the limit", async () => {
    const post = await createSocialPost({
      platform: "youtube",
      content: `${TEST_TAG}multi`,
      approval_status: "published",
      media_url: null,
      scheduled_at: null,
      source_video_id: null,
      created_by: null,
    })

    const now = Date.now()
    for (let i = 0; i < 3; i++) {
      await insertSocialAnalytics({
        social_post_id: post.id,
        platform: "youtube",
        platform_post_id: "yt_fake_456",
        impressions: 100 * (i + 1),
        engagement: null,
        likes: null,
        comments: null,
        shares: null,
        views: 1000 * (i + 1),
        extra: null,
        recorded_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    }

    const top2 = await listRecentAnalyticsByPost(post.id, 2)
    expect(top2).toHaveLength(2)
    // Newest first: the row with recorded_at === now has the highest views we set last? No — views=1000 was i=0 (most recent).
    expect(top2[0].views).toBe(1000)
    expect(top2[1].views).toBe(2000)

    await deleteSocialPost(post.id)
  })

  it("cascades deletes when the parent social_post is removed", async () => {
    const post = await createSocialPost({
      platform: "facebook",
      content: `${TEST_TAG}cascade`,
      approval_status: "published",
      media_url: null,
      scheduled_at: null,
      source_video_id: null,
      created_by: null,
    })

    await insertSocialAnalytics({
      social_post_id: post.id,
      platform: "facebook",
      platform_post_id: "fb_fake_789",
      impressions: 1,
      engagement: null,
      likes: null,
      comments: null,
      shares: null,
      views: null,
      extra: null,
      recorded_at: new Date().toISOString(),
    })

    await deleteSocialPost(post.id)

    const rows = await listRecentAnalyticsByPost(post.id)
    expect(rows).toHaveLength(0)
  })
})
