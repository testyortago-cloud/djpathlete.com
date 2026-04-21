import { describe, it, expect } from "vitest"
import { computeSocialMetrics } from "@/lib/analytics/social"
import type { SocialPost, SocialAnalytics } from "@/types/database"
import type { DateRange } from "@/types/analytics"

function mkRange(fromIso: string, toIso: string): DateRange {
  return { from: new Date(fromIso), to: new Date(toIso) }
}

function mkPost(overrides: Partial<SocialPost>): SocialPost {
  return {
    id: overrides.id ?? "p-1",
    platform: overrides.platform ?? "instagram",
    content: overrides.content ?? "sample caption",
    media_url: null,
    approval_status: overrides.approval_status ?? "draft",
    scheduled_at: null,
    published_at: overrides.published_at ?? null,
    source_video_id: null,
    rejection_notes: null,
    platform_post_id: overrides.platform_post_id ?? null,
    created_by: null,
    created_at: overrides.created_at ?? "2026-04-10T12:00:00Z",
    updated_at: overrides.updated_at ?? "2026-04-10T12:00:00Z",
  }
}

function mkAnalytics(overrides: Partial<SocialAnalytics>): SocialAnalytics {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    social_post_id: overrides.social_post_id ?? "p-1",
    platform: overrides.platform ?? "instagram",
    platform_post_id: overrides.platform_post_id ?? "ig_1",
    impressions: overrides.impressions ?? 0,
    engagement: overrides.engagement ?? 0,
    likes: null,
    comments: null,
    shares: null,
    views: null,
    extra: null,
    recorded_at: overrides.recorded_at ?? "2026-04-20T03:00:00Z",
    created_at: overrides.created_at ?? "2026-04-20T03:00:00Z",
  }
}

const APRIL = mkRange("2026-04-01T00:00:00Z", "2026-04-30T23:59:59Z")
const MARCH = mkRange("2026-03-01T00:00:00Z", "2026-03-31T23:59:59Z")

describe("computeSocialMetrics", () => {
  it("returns zeros for empty input", () => {
    const m = computeSocialMetrics([], [], APRIL, MARCH)
    expect(m.totalPosts).toBe(0)
    expect(m.publishedPosts).toBe(0)
    expect(m.totalImpressions).toBe(0)
    expect(m.postsByPlatform).toHaveLength(0)
    expect(m.topPostsByEngagement).toHaveLength(0)
  })

  it("counts posts created and published in range separately", () => {
    const posts = [
      mkPost({ id: "p1", created_at: "2026-04-05T10:00:00Z", approval_status: "draft" }),
      mkPost({
        id: "p2",
        created_at: "2026-04-10T10:00:00Z",
        approval_status: "published",
        published_at: "2026-04-12T10:00:00Z",
      }),
      mkPost({
        id: "old",
        created_at: "2026-03-01T10:00:00Z",
        approval_status: "published",
        published_at: "2026-04-02T10:00:00Z",
      }),
    ]
    const m = computeSocialMetrics(posts, [], APRIL, MARCH)
    expect(m.totalPosts).toBe(2) // only April-created
    expect(m.publishedPosts).toBe(2) // both April-published
  })

  it("computes previous-period counts against previousRange", () => {
    const posts = [
      mkPost({ id: "old", created_at: "2026-03-15T10:00:00Z" }),
      mkPost({ id: "old2", created_at: "2026-03-20T10:00:00Z" }),
      mkPost({ id: "new", created_at: "2026-04-05T10:00:00Z" }),
    ]
    const m = computeSocialMetrics(posts, [], APRIL, MARCH)
    expect(m.previousTotalPosts).toBe(2)
  })

  it("sums only the latest snapshot per post for impressions + engagement", () => {
    const posts = [mkPost({ id: "p1", approval_status: "published" })]
    const analytics = [
      mkAnalytics({
        social_post_id: "p1",
        impressions: 100,
        engagement: 5,
        recorded_at: "2026-04-15T03:00:00Z",
      }),
      mkAnalytics({
        social_post_id: "p1",
        impressions: 500,
        engagement: 25,
        recorded_at: "2026-04-20T03:00:00Z",
      }),
      mkAnalytics({
        social_post_id: "p1",
        impressions: 300,
        engagement: 12,
        recorded_at: "2026-04-10T03:00:00Z",
      }),
    ]
    const m = computeSocialMetrics(posts, analytics, APRIL, MARCH)
    expect(m.totalImpressions).toBe(500)
    expect(m.totalEngagement).toBe(25)
  })

  it("buckets posts by month", () => {
    const posts = [
      mkPost({ id: "p1", created_at: "2026-04-05T10:00:00Z" }),
      mkPost({ id: "p2", created_at: "2026-04-15T10:00:00Z" }),
      mkPost({
        id: "p3",
        created_at: "2026-04-20T10:00:00Z",
        published_at: "2026-04-25T10:00:00Z",
      }),
    ]
    const m = computeSocialMetrics(posts, [], APRIL, null)
    const april = m.postsByMonth.find((x) => x.key === "2026-04")
    expect(april?.total).toBe(3)
    expect(april?.published).toBe(1)
  })

  it("breaks down published posts by platform", () => {
    const posts = [
      mkPost({
        id: "p1",
        platform: "instagram",
        approval_status: "published",
        published_at: "2026-04-10T10:00:00Z",
      }),
      mkPost({
        id: "p2",
        platform: "instagram",
        approval_status: "published",
        published_at: "2026-04-11T10:00:00Z",
      }),
      mkPost({
        id: "p3",
        platform: "facebook",
        approval_status: "published",
        published_at: "2026-04-12T10:00:00Z",
      }),
    ]
    const m = computeSocialMetrics(posts, [], APRIL, null)
    expect(m.postsByPlatform).toEqual([
      { label: "Instagram", count: 2 },
      { label: "Facebook", count: 1 },
    ])
  })

  it("breaks down created posts by approval status", () => {
    const posts = [
      mkPost({ id: "p1", approval_status: "draft", created_at: "2026-04-02T10:00:00Z" }),
      mkPost({ id: "p2", approval_status: "draft", created_at: "2026-04-05T10:00:00Z" }),
      mkPost({ id: "p3", approval_status: "approved", created_at: "2026-04-08T10:00:00Z" }),
    ]
    const m = computeSocialMetrics(posts, [], APRIL, null)
    expect(m.postsByStatus).toEqual([
      { label: "Draft", count: 2 },
      { label: "Approved", count: 1 },
    ])
  })

  it("returns top posts by engagement, truncating content previews", () => {
    const longContent = "x".repeat(200)
    const posts = [
      mkPost({ id: "p1", content: longContent, approval_status: "published" }),
      mkPost({ id: "p2", content: "short", approval_status: "published" }),
    ]
    const analytics = [
      mkAnalytics({ social_post_id: "p1", engagement: 100, impressions: 500 }),
      mkAnalytics({ social_post_id: "p2", engagement: 50, impressions: 200 }),
    ]
    const m = computeSocialMetrics(posts, analytics, APRIL, null)
    expect(m.topPostsByEngagement).toHaveLength(2)
    expect(m.topPostsByEngagement[0].social_post_id).toBe("p1")
    expect(m.topPostsByEngagement[0].engagement).toBe(100)
    expect(m.topPostsByEngagement[0].content_preview.length).toBeLessThanOrEqual(80)
    expect(m.topPostsByEngagement[0].content_preview.endsWith("…")).toBe(true)
  })

  it("drops zero-engagement rows from topPostsByEngagement", () => {
    const posts = [mkPost({ id: "p1" })]
    const analytics = [mkAnalytics({ social_post_id: "p1", engagement: 0 })]
    const m = computeSocialMetrics(posts, analytics, APRIL, null)
    expect(m.topPostsByEngagement).toHaveLength(0)
  })
})
