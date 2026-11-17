// @vitest-environment jsdom
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PostsTabRow } from "@/components/admin/content-studio/drawer/PostsTabRow"
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

describe("<PostsTabRow>", () => {
  it("shows platform label, status pill, and caption preview when collapsed", () => {
    render(<PostsTabRow post={makePost()} isExpanded={false} onToggle={vi.fn()} onMutate={vi.fn()} />)
    expect(screen.getByText(/Instagram/)).toBeInTheDocument()
    expect(screen.getByText(/needs review/i)).toBeInTheDocument()
    expect(screen.getByText(/Morning rotation check-in/)).toBeInTheDocument()
  })

  it("clicking the row header calls onToggle", () => {
    const onToggle = vi.fn()
    render(<PostsTabRow post={makePost()} isExpanded={false} onToggle={onToggle} onMutate={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /expand/i }))
    expect(onToggle).toHaveBeenCalledWith("post-1")
  })

  it("when expanded, shows the edit textarea and action buttons", () => {
    render(<PostsTabRow post={makePost()} isExpanded={true} onToggle={vi.fn()} onMutate={vi.fn()} />)
    expect(screen.getByRole("textbox", { name: /caption/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^schedule$/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /publish now/i })).toBeInTheDocument()
  })

  it("does not render a standalone Approve button (consolidated into Schedule)", () => {
    render(<PostsTabRow post={makePost()} isExpanded={true} onToggle={vi.fn()} onMutate={vi.fn()} />)
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument()
  })

  it("for failed posts, surfaces the rejection note and a Retry now button", () => {
    render(
      <PostsTabRow
        post={makePost({ approval_status: "failed", rejection_notes: "Facebook API 403" })}
        isExpanded={true}
        onToggle={vi.fn()}
        onMutate={vi.fn()}
      />,
    )
    expect(screen.getByText(/Facebook API 403/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /retry now/i })).toBeInTheDocument()
  })

  it("published posts lock the edit UI and hide schedule/publish-now", () => {
    render(
      <PostsTabRow
        post={makePost({ approval_status: "published", published_at: "2026-04-16T08:00:00Z" })}
        isExpanded={true}
        onToggle={vi.fn()}
        onMutate={vi.fn()}
      />,
    )
    expect(screen.queryByRole("button", { name: /^schedule$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /publish now/i })).not.toBeInTheDocument()
    // "Published [timestamp]" appears in the row footer when the post is published
    expect(screen.getByText(/Published\s+\d/)).toBeInTheDocument()
  })

  // Stories have no caption (Instagram ignores it) but can be scheduled: the
  // publish-due cron fires them at the chosen time (2026-11-10).
  it("gives a Story post a Schedule button but no caption box", () => {
    render(
      <PostsTabRow
        post={makePost({ post_type: "story", approval_status: "draft" })}
        isExpanded={true}
        onToggle={vi.fn()}
        onMutate={vi.fn()}
      />,
    )
    expect(screen.queryByRole("button", { name: /save caption/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: /caption/i })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^schedule$/i })).toBeInTheDocument()
    expect(screen.getByText("Instagram Story")).toBeInTheDocument()
  })

  it("shows a warning on the row when one is given", () => {
    render(
      <PostsTabRow
        post={makePost({ post_type: "story", approval_status: "draft" })}
        isExpanded={false}
        onToggle={vi.fn()}
        onMutate={vi.fn()}
        warning="This video is 2:14 long."
      />,
    )
    expect(screen.getByText("This video is 2:14 long.")).toBeInTheDocument()
  })

  it("keeps the caption box for a feed post", () => {
    render(
      <PostsTabRow post={makePost({ post_type: "video" })} isExpanded={true} onToggle={vi.fn()} onMutate={vi.fn()} />,
    )
    expect(screen.getByRole("textbox", { name: /caption/i })).toBeInTheDocument()
  })

  it("shows Publish now button for draft Story posts", () => {
    render(
      <PostsTabRow
        post={makePost({ post_type: "story", approval_status: "draft" })}
        isExpanded={true}
        onToggle={vi.fn()}
        onMutate={vi.fn()}
      />,
    )
    expect(screen.getByRole("button", { name: /publish now/i })).toBeInTheDocument()
  })

  it("renders attached carousel slides as thumbnails even when collapsed", () => {
    render(
      <PostsTabRow
        post={makePost({ post_type: "carousel" })}
        slides={[
          { assetId: "a0", position: 0, url: "https://signed.example/0.png", alt: "Quote one" },
          { assetId: "a1", position: 1, url: "https://signed.example/1.png", alt: null },
        ]}
        isExpanded={false}
        onToggle={vi.fn()}
        onMutate={vi.fn()}
      />,
    )
    expect(screen.getByAltText("Quote one")).toHaveAttribute("src", "https://signed.example/0.png")
    // Null alt falls back to a positional label.
    expect(screen.getByAltText("Slide 2")).toHaveAttribute("src", "https://signed.example/1.png")
  })

  it("renders a placeholder for a slide whose URL could not be signed", () => {
    render(
      <PostsTabRow
        post={makePost({ post_type: "carousel" })}
        slides={[{ assetId: "a0", position: 0, url: null, alt: null }]}
        isExpanded={false}
        onToggle={vi.fn()}
        onMutate={vi.fn()}
      />,
    )
    expect(screen.getByText(/n\/a/i)).toBeInTheDocument()
  })

  describe("TikTok posts", () => {
    afterEach(() => vi.unstubAllGlobals())

    function renderTikTok(onMutate = vi.fn()) {
      render(
        <PostsTabRow
          post={makePost({ platform: "tiktok" })}
          isExpanded={true}
          onToggle={vi.fn()}
          onMutate={onMutate}
        />,
      )
      return onMutate
    }

    it("TikTok: Publish now opens the Post to TikTok dialog and does not call publish-now", () => {
      const fetchMock = vi.fn()
      vi.stubGlobal("fetch", fetchMock)
      renderTikTok()
      fireEvent.click(screen.getByRole("button", { name: /publish now/i }))
      expect(screen.getByText("tiktok intent: now")).toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("TikTok: Schedule opens the Post to TikTok dialog, not the schedule picker", () => {
      renderTikTok()
      fireEvent.click(screen.getByRole("button", { name: /^schedule$/i }))
      expect(screen.getByText("tiktok intent: schedule")).toBeInTheDocument()
      expect(screen.queryByText("Schedule post")).not.toBeInTheDocument()
    })

    it("TikTok: once the settings are saved, the schedule picker opens and the saved post is applied", () => {
      const onMutate = renderTikTok()
      fireEvent.click(screen.getByRole("button", { name: /^schedule$/i }))
      fireEvent.click(screen.getByText("stub ready"))
      expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({ content: "caption from dialog" }))
      expect(screen.queryByTestId("tiktok-dialog")).not.toBeInTheDocument()
      expect(screen.getByText("Schedule post")).toBeInTheDocument()
    })

    it("TikTok: a queued post is applied to the row", () => {
      const onMutate = renderTikTok()
      fireEvent.click(screen.getByRole("button", { name: /publish now/i }))
      fireEvent.click(screen.getByText("stub queued"))
      expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({ approval_status: "approved" }))
    })

    // The row applies the updated post, as the real parent does.
    function Harness() {
      const [post, setPost] = useState(makePost({ platform: "tiktok" }))
      return <PostsTabRow post={post} isExpanded={true} onToggle={vi.fn()} onMutate={setPost} />
    }

    it.each([
      ["Publish now", "stub queued"],
      ["Schedule", "stub ready"],
    ])("TikTok: after %s saves a new caption, the caption box shows it and Save caption stays off", (button, stub) => {
      render(<Harness />)
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${button}$`, "i") }))
      fireEvent.click(screen.getByText(stub))
      expect(screen.getByRole("textbox", { name: /caption/i, hidden: true })).toHaveValue("caption from dialog")
      expect(screen.getByRole("button", { name: /save caption/i, hidden: true })).toBeDisabled()
    })

    it("TikTok: Retry now on a failed post opens the dialog to publish", () => {
      render(
        <PostsTabRow
          post={makePost({ platform: "tiktok", approval_status: "failed", rejection_notes: "boom" })}
          isExpanded={true}
          onToggle={vi.fn()}
          onMutate={vi.fn()}
        />,
      )
      fireEvent.click(screen.getByRole("button", { name: /retry now/i }))
      expect(screen.getByText("tiktok intent: now")).toBeInTheDocument()
    })

    it("Instagram: Publish now still calls publish-now directly and opens no TikTok dialog", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ approval_status: "approved", scheduled_at: null }),
      })
      vi.stubGlobal("fetch", fetchMock)
      render(<PostsTabRow post={makePost()} isExpanded={true} onToggle={vi.fn()} onMutate={vi.fn()} />)
      fireEvent.click(screen.getByRole("button", { name: /publish now/i }))
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/social/posts/post-1/publish-now", { method: "POST" })
      expect(screen.queryByTestId("tiktok-dialog")).not.toBeInTheDocument()
      // Let the request settle (button back from "Queueing...") so no update lands outside act().
      await waitFor(() => expect(screen.getByRole("button", { name: /publish now/i })).toBeEnabled())
    })

    it("Instagram: Schedule still opens the schedule picker, not the TikTok dialog", () => {
      render(<PostsTabRow post={makePost()} isExpanded={true} onToggle={vi.fn()} onMutate={vi.fn()} />)
      fireEvent.click(screen.getByRole("button", { name: /^schedule$/i }))
      expect(screen.getByText("Schedule post")).toBeInTheDocument()
      expect(screen.queryByTestId("tiktok-dialog")).not.toBeInTheDocument()
    })
  })
})
