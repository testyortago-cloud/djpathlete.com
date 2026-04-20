// __tests__/db/social-posts.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import {
  createSocialPost,
  getSocialPostById,
  listSocialPosts,
  updateSocialPost,
  deleteSocialPost,
} from "@/lib/db/social-posts"
import { addCaptionToPost, listCaptionsForPost } from "@/lib/db/social-captions"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_TAG = "__TEST_SOCIAL_POST__"

describe("social-posts + social-captions DAL", () => {
  const supabase = createServiceRoleClient()

  async function cleanup() {
    await supabase.from("social_posts").delete().like("content", `${TEST_TAG}%`)
  }

  beforeEach(cleanup)
  afterAll(cleanup)

  it("creates, reads, updates, deletes a social post", async () => {
    const created = await createSocialPost({
      platform: "instagram",
      content: `${TEST_TAG}hello`,
      approval_status: "draft",
      media_url: null,
      scheduled_at: null,
      source_video_id: null,
      created_by: null,
    })
    expect(created.id).toBeTruthy()

    const fetched = await getSocialPostById(created.id)
    expect(fetched?.platform).toBe("instagram")

    const updated = await updateSocialPost(created.id, { approval_status: "approved" })
    expect(updated.approval_status).toBe("approved")

    await deleteSocialPost(created.id)
    const gone = await getSocialPostById(created.id)
    expect(gone).toBeNull()
  })

  it("lists with platform + status filters", async () => {
    await createSocialPost({
      platform: "instagram",
      content: `${TEST_TAG}a`,
      approval_status: "draft",
      media_url: null,
      scheduled_at: null,
      source_video_id: null,
      created_by: null,
    })
    await createSocialPost({
      platform: "tiktok",
      content: `${TEST_TAG}b`,
      approval_status: "approved",
      media_url: null,
      scheduled_at: null,
      source_video_id: null,
      created_by: null,
    })

    const ig = await listSocialPosts({ platform: "instagram" })
    const approved = await listSocialPosts({ approval_status: "approved" })
    expect(ig.some((p) => p.content === `${TEST_TAG}a`)).toBe(true)
    expect(approved.some((p) => p.content === `${TEST_TAG}b`)).toBe(true)
  })

  it("adds captions linked to a post and lists them", async () => {
    const post = await createSocialPost({
      platform: "instagram",
      content: `${TEST_TAG}p`,
      approval_status: "draft",
      media_url: null,
      scheduled_at: null,
      source_video_id: null,
      created_by: null,
    })
    await addCaptionToPost({
      social_post_id: post.id,
      caption_text: "caption v1",
      hashtags: ["#fit", "#dj"],
      version: 1,
    })
    await addCaptionToPost({
      social_post_id: post.id,
      caption_text: "caption v2",
      hashtags: [],
      version: 2,
    })
    const captions = await listCaptionsForPost(post.id)
    expect(captions.length).toBe(2)
    expect(captions.find((c) => c.version === 2)?.caption_text).toBe("caption v2")
  })
})
