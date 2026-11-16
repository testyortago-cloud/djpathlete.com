// @vitest-environment jsdom
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SocialPostCard } from "@/components/admin/social/SocialPostCard"
import type { SocialPost } from "@/types/database"

// Stub: renders which intent opened, plus buttons that fire the two callbacks.
vi.mock("@/components/admin/social/TikTokPostDialog", () => ({
  TikTokPostDialog: ({
    post,
    intent,
    open,
    onQueued,
    onReadyToSchedule,
  }: {
    post: SocialPost
    intent: string
    open: boolean
    onQueued: (p: SocialPost) => void
    onReadyToSchedule: (p: SocialPost) => void
  }) =>
    open ? (
      <div data-testid="tiktok-dialog">
        <span>tiktok intent: {intent}</span>
        <button onClick={() => onQueued({ ...post, content: "caption from dialog", approval_status: "approved" })}>stub queued</button>
        <button onClick={() => onReadyToSchedule({ ...post, content: "caption from dialog" })}>stub ready</button>
      </div>
    ) : null,
}))

function makePost(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "post-1",
    platform: "instagram",
    content: "Morning rotation check-in.",
    media_url: null,
    post_type: "video",
    approval_status: "draft",
    scheduled_at: null,
    published_at: null,
    source_video_id: "video-1",
    rejection_notes: null,
    platform_post_id: null,
    created_by: "user-1",
    created_at: "2026-04-15T12:10:00Z",
    updated_at: "2026-04-15T12:10:00Z",
    ...overrides,
  }
}

function renderCard(post: SocialPost, onUpdate = vi.fn()) {
  render(<SocialPostCard post={post} onUpdate={onUpdate} onRemove={vi.fn()} />)
  return onUpdate
}

describe("<SocialPostCard> TikTok routing", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("TikTok: Publish now opens the Post to TikTok dialog and does not call publish-now", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    renderCard(makePost({ platform: "tiktok" }))
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }))
    expect(screen.getByText("tiktok intent: now")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("TikTok: Schedule opens the Post to TikTok dialog, not the schedule picker", () => {
    renderCard(makePost({ platform: "tiktok" }))
    fireEvent.click(screen.getByRole("button", { name: /^schedule$/i }))
    expect(screen.getByText("tiktok intent: schedule")).toBeInTheDocument()
    expect(screen.queryByText("Schedule post")).not.toBeInTheDocument()
  })

  it("TikTok: once the settings are saved, the schedule picker opens and the saved post is applied", () => {
    const onUpdate = renderCard(makePost({ platform: "tiktok" }))
    fireEvent.click(screen.getByRole("button", { name: /^schedule$/i }))
    fireEvent.click(screen.getByText("stub ready"))
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ content: "caption from dialog" }))
    expect(screen.queryByTestId("tiktok-dialog")).not.toBeInTheDocument()
    expect(screen.getByText("Schedule post")).toBeInTheDocument()
  })

  it("TikTok: a queued post is applied to the card", () => {
    const onUpdate = renderCard(makePost({ platform: "tiktok" }))
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }))
    fireEvent.click(screen.getByText("stub queued"))
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ approval_status: "approved" }))
  })

  it("TikTok: after the dialog saves a new caption, Edit opens with that caption, not the old one", () => {
    function Harness() {
      const [post, setPost] = useState(makePost({ platform: "tiktok" }))
      return <SocialPostCard post={post} onUpdate={setPost} onRemove={vi.fn()} />
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }))
    fireEvent.click(screen.getByText("stub queued"))
    fireEvent.click(screen.getByRole("button", { name: /edit/i }))
    expect(screen.getByRole("textbox")).toHaveValue("caption from dialog")
  })

  it("TikTok: Retry now on a failed post opens the dialog to publish", () => {
    renderCard(makePost({ platform: "tiktok", approval_status: "failed", rejection_notes: "boom" }))
    fireEvent.click(screen.getByRole("button", { name: /retry now/i }))
    expect(screen.getByText("tiktok intent: now")).toBeInTheDocument()
  })

  it("Instagram: Publish now still calls publish-now directly and opens no TikTok dialog", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ approval_status: "approved", scheduled_at: null }),
    })
    vi.stubGlobal("fetch", fetchMock)
    renderCard(makePost())
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }))
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/social/posts/post-1/publish-now", { method: "POST" })
    expect(screen.queryByTestId("tiktok-dialog")).not.toBeInTheDocument()
  })

  it("Instagram: Schedule still opens the schedule picker, not the TikTok dialog", () => {
    renderCard(makePost())
    fireEvent.click(screen.getByRole("button", { name: /^schedule$/i }))
    expect(screen.getByText("Schedule post")).toBeInTheDocument()
    expect(screen.queryByTestId("tiktok-dialog")).not.toBeInTheDocument()
  })
})
